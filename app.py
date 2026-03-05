import cv2
from ultralytics import YOLO
from flask import Flask, Response, render_template, jsonify
import psycopg2
import threading
import time
import datetime
from collections import deque

# =================CONFIGURATIONS=================
# 1. ตั้งค่า Database Neon Tech (อย่าลืมตรวจสอบ Password)
DB_URI = 'postgresql://neondb_owner:npg_pXZRfEhvq85k@ep-shy-morning-a10m07ah-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

# 2. ตั้งค่ากล้อง IP Webcam
# รูปแบบ: http://User:Password@IP:Port/video
IP_WEBCAM_URL = 0  # ใช้ 0 สำหรับกล้องเว็บแคมในเครื่อง (ทดสอบง่ายๆ ก่อนเปลี่ยนเป็น IP Webcam)

model = YOLO('yolov8n.pt', task='detect') 

# เปลี่ยนมาใช้พิกัดนี้สำหรับการทดสอบก่อนครับ
LINE_START = (0, 200)    # Y=200 จะอยู่ค่อนไปทางด้านบนของจอ
LINE_END = (1280, 200)   # Y=200 จะอยู่ค่อนไปทางด้านบนของจอ

app = Flask(__name__, template_folder='.', static_folder='.', static_url_path='')

# =================GLOBAL VARIABLES=================
# ใช้เก็บข้อมูล Log ย้อนหลัง 10 รายการ
recent_logs = deque(maxlen=10) 

# ใช้เก็บข้อมูลนับรถ (ใช้ Global เพื่อไม่ให้ค่าหายเวลารีเฟรชหน้าเว็บ)
global_data = {
    'total_in': 0,
    'total_out': 0,
    'last_in_time': "-",
    'last_out_time': "-"
}
lock = threading.Lock()

# =================DATABASE FUNCTIONS=================
def get_db_connection():
    try:
        return psycopg2.connect(DB_URI)
    except Exception as e:
        print(f"DB Connection Error: {e}")
        return None

def update_db(total_in, total_out):
    """บันทึกข้อมูลลงฐานข้อมูล (ทำงานใน Thread แยก)"""
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
            print(f"[DB SAVED] In: {total_in}, Out: {total_out}")
        except Exception as e:
            print(f"[DB ERROR] {e}")

# =================CORE LOGIC=================
def generate_frames():
    global global_data, recent_logs
    
    # เปิดกล้องจาก URL
    cap = cv2.VideoCapture(0)
    
    # ลด Buffer เพื่อให้ภาพ Real-time ที่สุด
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    tracked_objects = {} 

    while True:
        success, frame = cap.read()
        
        # กรณีอ่านภาพไม่ได้ (เน็ตหลุด/กล้องดับ) ให้พยายามต่อใหม่
        if not success:
            print("Connection lost... Retrying in 2 seconds")
            cap.release()
            time.sleep(2)
            cap = cv2.VideoCapture(0)
            continue

        # ลดขนาดภาพลงเล็กน้อยเพื่อให้ประมวลผลเร็วขึ้น (Optional)
        # frame = cv2.resize(frame, (800, 450))

        # รัน YOLO Tracking (Detect: Car, Motorbike, Bus, Truck)
        results = model.track(frame, classes=[2, 3, 5, 7], persist=True, tracker="bytetrack.yaml", verbose=False)
        
        count_changed = False # ตัวแปรเช็คว่ารอบนี้มีการนับเพิ่มไหม

        if results[0].boxes.id is not None:
            boxes = results[0].boxes.xyxy.cpu().numpy()
            track_ids = results[0].boxes.id.int().cpu().tolist()
            class_ids = results[0].boxes.cls.int().cpu().tolist()

            for box, track_id, class_id in zip(boxes, track_ids, class_ids):
                x1, y1, x2, y2 = map(int, box)
                cx = int((x1 + x2) / 2)
                cy = int((y1 + y2) / 2)
                
                # Logic การนับรถ (Line Crossing)
                if track_id in tracked_objects:
                    prev_cy = tracked_objects[track_id]
                    line_y = LINE_START[1]
                    current_time = datetime.datetime.now().strftime("%H:%M:%S")

                    # เช็คขาเข้า (บนลงล่าง หรือ ล่างขึ้นบน แล้วแต่การติดตั้งกล้อง)
                    if prev_cy < line_y and cy >= line_y:
                        with lock:
                            global_data['total_in'] += 1 # บวกค่า Global โดยตรง
                            global_data['last_in_time'] = current_time
                            recent_logs.appendleft({'time': current_time, 'type': 'IN'})
                        count_changed = True

                    # เช็คขาออก
                    elif prev_cy > line_y and cy <= line_y:
                        with lock:
                            global_data['total_out'] += 1 # บวกค่า Global โดยตรง
                            global_data['last_out_time'] = current_time
                            recent_logs.appendleft({'time': current_time, 'type': 'OUT'})
                        count_changed = True

                tracked_objects[track_id] = cy
                
                # วาดกรอบและจุด Center
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.circle(frame, (cx, cy), 4, (0, 0, 255), -1)

        # เคลียร์ ID ที่หายไปนานๆ ออกจาก Memory (Optional)
        
        # วาดเส้น Line Check
        cv2.line(frame, LINE_START, LINE_END, (0, 0, 255), 3)

        # บันทึกลง DB (ทำงานเมื่อตัวเลขเปลี่ยนเท่านั้น)
        if count_changed:
            threading.Thread(target=update_db, args=(global_data['total_in'], global_data['total_out'])).start()

        # แปลงภาพเป็น JPEG ส่งให้ Web
        
        cv2.line(frame, (0, 200), (1500, 200), (0, 255, 0), 5)
        ret, buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

# =================WEB ROUTES=================

@app.route('/')
def index():
    return render_template('index.html') 

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/data')
def api_data():
    with lock:
        # ส่งข้อมูลกลับเป็น JSON
        return jsonify({
            'total_in': global_data['total_in'],
            'total_out': global_data['total_out'],
            'last_in_time': global_data['last_in_time'],
            'last_out_time': global_data['last_out_time'],
            'recent_logs': list(recent_logs)
        })

if __name__ == '__main__':
    # ปิด debug=True เมื่อใช้ Threading กับ Video Stream เพื่อป้องกันการรันซ้ำ
    app.run(host='0.0.0.0', port=5000, debug=False)