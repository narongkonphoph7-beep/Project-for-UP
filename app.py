import cv2
from ultralytics import YOLO
from flask import Flask, Response, render_template, jsonify, request
import psycopg2
import threading
import time
import datetime
from collections import deque

DB_URI = ''

IP_WEBCAM_URL_1 = 0
IP_WEBCAM_URL_2 = 0

model = YOLO('yolov8n.pt', task='detect')

LINE_START = (0, 200)
LINE_END = (1280, 200)

app = Flask(__name__, template_folder='.', static_folder='.', static_url_path='')

recent_logs = deque(maxlen=10)

global_data = {
    1: {'total_in': 0, 'total_out': 0, 'last_in_time': '-', 'last_out_time': '-'},
    2: {'total_in': 0, 'total_out': 0, 'last_in_time': '-', 'last_out_time': '-'}
}
lock = threading.Lock()

# เก็บ frame ล่าสุดของแต่ละกล้องไว้แชร์กัน
latest_frames = {1: None, 2: None}
frame_locks = {1: threading.Lock(), 2: threading.Lock()}

def get_db_connection():
    try:
        return psycopg2.connect(DB_URI)
    except Exception as e:
        print(f"DB Connection Error: {e}")
        return None

def update_db(total_in, total_out):
    conn = get_db_connection()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO vehicle_logs (total_in, total_out) VALUES (%s, %s)",
                (total_in, total_out)
            )
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            print(f"[DB ERROR] {e}")

# ฟังก์ชันหลัก — อ่านกล้อง + นับรถ + เก็บ frame
def camera_worker(camera_index):
    url = IP_WEBCAM_URL_1 if camera_index == 1 else IP_WEBCAM_URL_2
    cap = cv2.VideoCapture(url)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    tracked_objects = {}
    track_directions = {}

    while True:
        success, frame = cap.read()
        if not success:
            cap.release()
            time.sleep(2)
            cap = cv2.VideoCapture(url)
            continue

        # นับรถ
        results = model.track(frame, classes=[2, 3, 5, 7], persist=True, tracker="bytetrack.yaml", verbose=False)
        count_changed = False

        if results[0].boxes.id is not None:
            boxes = results[0].boxes.xyxy.cpu().numpy()
            track_ids = results[0].boxes.id.int().cpu().tolist()

            for box, track_id in zip(boxes, track_ids):
                x1, y1, x2, y2 = map(int, box)
                cy = int((y1 + y2) / 2)

                if track_id in tracked_objects:
                    prev_cy = tracked_objects[track_id]
                    line_y = LINE_START[1]
                    current_time = datetime.datetime.now().strftime("%H:%M:%S")

                    if prev_cy < line_y and cy >= line_y:
                        with lock:
                            global_data[camera_index]['total_in'] += 1
                            global_data[camera_index]['last_in_time'] = current_time
                            recent_logs.appendleft({'time': current_time, 'type': 'IN'})
                        count_changed = True
                        track_directions[track_id] = 'IN'

                    elif prev_cy > line_y and cy <= line_y:
                        with lock:
                            global_data[camera_index]['total_out'] += 1
                            global_data[camera_index]['last_out_time'] = current_time
                            recent_logs.appendleft({'time': current_time, 'type': 'OUT'})
                        count_changed = True
                        track_directions[track_id] = 'OUT'

                tracked_objects[track_id] = cy
                # วาดกรอบ

                if track_id in tracked_objects:
                    prev_cy = tracked_objects[track_id]
                    if cy < prev_cy:
                        color = (0, 0, 255)
                    elif cy > prev_cy:
                        color = (0, 255, 0)
                    else:
                        color = (0, 0, 255) if track_directions.get(track_id) == 'OUT' else (0, 255, 0)
                else:
                    color = (0, 255, 0)
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                cv2.putText(frame, f'ID:{track_id}', (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                cv2.circle(frame, (int((x1+x2)/2), cy), 4, (0, 0, 255), -1)
        if count_changed:
            threading.Thread(target=update_db, args=(
                global_data[camera_index]['total_in'],
                global_data[camera_index]['total_out']
            )).start()

        # วาดเส้นและเก็บ frame
        cv2.line(frame, (0, 200), (1500, 200), (0, 255, 0), 5)
        with frame_locks[camera_index]:
            latest_frames[camera_index] = frame.copy()

#  generate_frames ดึง frame จาก latest_frames แทนการเปิดกล้องซ้ำ
def generate_frames(camera_index=1):
    while True:
        with frame_locks[camera_index]:
            frame = latest_frames[camera_index]

        if frame is None:
            time.sleep(0.05)
            continue

        ret, buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.03)  # ~30fps

# =================WEB ROUTES=================
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    camera = request.args.get('camera', 1, type=int)
    return Response(generate_frames(camera), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/data')
def api_data():
    camera = request.args.get('camera', 1, type=int)
    with lock:
        return jsonify({
            'total_in': global_data[camera]['total_in'],
            'total_out': global_data[camera]['total_out'],
            'last_in_time': global_data[camera]['last_in_time'],
            'last_out_time': global_data[camera]['last_out_time'],
            'recent_logs': list(recent_logs)
        })

#  รันกล้องทั้ง 2 ตัวใน Thread แยก ตั้งแต่เริ่มต้น
threading.Thread(target=camera_worker, args=(1,), daemon=True).start()
threading.Thread(target=camera_worker, args=(2,), daemon=True).start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)