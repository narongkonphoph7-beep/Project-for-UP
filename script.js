/*
=======================================================
  Detective Vehicle Dashboard — script.js
=======================================================
  โครงสร้างหลักแบ่งเป็น 2 ส่วน:

  ── ส่วนที่ 1: DASHBOARD VIEW ──────────────────────
  - vehicleChart       กราฟ real-time หน้าหลัก
  - setActive()        สลับกล้อง (Camera 1 / Camera 2)
  - toggleMenu()       เปิด/ปิด sidebar
  - updateNumbers()    ดึงยอดรถจาก /api/data ทุก 1 วินาที
  - updateGraph()      เพิ่มจุดกราฟทุก 30 วินาที
  - setStatus()        อัปเดต badge Active/Inactive

  ── ส่วนที่ 2: STATS VIEW ──────────────────────────
  - switchView()           สลับระหว่าง dashboard ↔ stats
  - switchCamera()         สลับกล้องในหน้าสถิติ (1/2/all)
  - updateStatsView()      ดึงข้อมูล live อัปเดต KPI + ตาราง log
  - initSvBarChart()       สร้างกราฟ session (ครั้งเดียว)
  - onTypeChange()         เปลี่ยน input วัน/เดือน/ปีตาม dropdown
  - resetHistoryChart()    เคลียร์กราฟย้อนหลัง
  - fetchHistoryByDate()   ดึงข้อมูลจาก /api/history แสดงกราฟย้อนหลัง

  API ที่ใช้:
  - GET /api/data?camera=N    → { total_in, total_out, last_in_time,
                                   last_out_time, recent_logs[] }
  - GET /api/history?type=&date=&camera=
                              → { total_in, total_out, labels[],
                                   chart_in[], chart_out[] }
                                ⚠️ ยังไม่ได้เพิ่มใน app.py รอ DB schema
=======================================================
*/


/* ══════════════════════════════════════════════════
   ส่วนที่ 1 — DASHBOARD VIEW
══════════════════════════════════════════════════ */

// กล้องปัจจุบันที่หน้า dashboard กำลังแสดงอยู่ (1 หรือ 2)
// ใช้ใน updateNumbers(), updateGraph(), setActive()
let currentCamera = 1;


// ── กราฟ Real-time หน้าหลัก (vehicleChart) ──────
// กราฟเส้นแสดงยอดรถ IN/OUT แต่ละช่วงเวลา
// อัปเดตโดย updateGraph() ทุก 30 วินาที
// ถ้าจะเปลี่ยนสีเส้น: แก้ borderColor ในแต่ละ dataset
const ctx = document.getElementById('vehicleChart').getContext('2d');
const vehicleChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [], // แกน X = เวลา เช่น "14:00"
        datasets: [
            {
                label: 'รถเข้า (IN)',
                data: [],
                borderColor: '#36a2eb',                    // สีฟ้า
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                tension: 0.4,
                fill: true
            },
            {
                label: 'รถออก (OUT)',
                data: [],
                borderColor: '#ff6384',                    // สีแดง
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                tension: 0.4,
                fill: true
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: { grid: { color: '#444' }, ticks: { color: '#aaa' } },
            y: { grid: { color: '#444' }, ticks: { color: '#aaa' }, beginAtZero: true }
        },
        plugins: {
            legend: { display: false } // ซ่อน legend เพราะมี custom legend ใน HTML แล้ว
        }
    }
});


// ── setActive(): สลับกล้อง Dashboard ───────────
// เรียกเมื่อคลิกปุ่ม Camera 1 / Camera 2 ใน sidebar
// จะ: เปลี่ยน video feed, reset กราฟ, อัปเดตทันที
function setActive(button) {
    // ปุ่มทุกตัวกลับเป็น inactive ก่อน
    document.querySelectorAll('.BUT').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.add('inactive');
    });
    button.classList.remove('inactive');
    button.classList.add('active');

    // เปลี่ยน video stream ตามกล้องที่เลือก
    currentCamera = button.innerText.includes('1') ? 1 : 2;
    document.querySelector('.video-REAL').src = `/video_feed?camera=${currentCamera}`;

    // reset กราฟเมื่อสลับกล้อง เพื่อไม่ให้ข้อมูลสองกล้องปนกัน
    vehicleChart.data.labels = [];
    vehicleChart.data.datasets[0].data = [];
    vehicleChart.data.datasets[1].data = [];
    vehicleChart.update();
    updateGraph(); // โหลดจุดแรกของกล้องใหม่ทันที
}


// ── toggleMenu(): เปิด/ปิด Sidebar ─────────────
function toggleMenu() {
    document.querySelector('.sidebar').classList.toggle('open');
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.toggle('show');
    });
}


// ── cameraState: เก็บ state กราฟแยกตามกล้อง ───
// ใช้เพื่อคำนวณยอดรถ "ช่วงเวลานี้" = ยอดปัจจุบัน - ยอดรอบที่แล้ว
// แยกกันเพราะเมื่อสลับกล้องต้องเริ่มนับใหม่
const cameraState = {
    1: { prevTotalIn: 0, prevTotalOut: 0, isFirstGraphUpdate: true },
    2: { prevTotalIn: 0, prevTotalOut: 0, isFirstGraphUpdate: true }
};


// ── updateNumbers(): อัปเดตตัวเลขสะสม ──────────
// ดึงข้อมูลจาก /api/data ทุก 1 วินาที
// อัปเดต: #car-in, #car-out, status badge
async function updateNumbers() {
    try {
        const response = await fetch(`/api/data?camera=${currentCamera}`);
        const data = await response.json();

        document.getElementById('car-in').innerText = data.total_in;
        document.getElementById('car-out').innerText = data.total_out;

        // fetch สำเร็จ → สถานะ Active (เขียว)
        setStatus('status-in', true);
        setStatus('status-out', true);

    } catch (error) {
        console.error("Error fetching numbers:", error);
        // fetch ล้มเหลว (เซิร์ฟเวอร์ดับ / network error) → Inactive (แดง)
        setStatus('status-in', false);
        setStatus('status-out', false);
    }
}


// ── updateGraph(): เพิ่มจุดกราฟ real-time ───────
// เรียกทุก 30 วินาที (ดูที่ setInterval ด้านล่าง)
// logic: คำนวณยอดรถ "ช่วงนี้" = ยอดสะสมปัจจุบัน - ยอดสะสมรอบที่แล้ว
// เก็บข้อมูลย้อนหลังสูงสุด 24 จุด (24 ชั่วโมง) แล้ว shift ทิ้ง
async function updateGraph() {
    try {
        const response = await fetch(`/api/data?camera=${currentCamera}`);
        const data = await response.json();

        // label แกน X = เวลาปัจจุบัน เช่น "14:30"
        const now = new Date();
        const timeLabel = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

        let currentIn = data.total_in;
        let currentOut = data.total_out;
        let carsInThisPeriod = 0;
        let carsOutThisPeriod = 0;

        const state = cameraState[currentCamera];

        if (state.isFirstGraphUpdate) {
            // รอบแรก: ใช้ยอดสะสมทั้งหมดเป็น baseline ของกราฟ
            carsInThisPeriod = currentIn;
            carsOutThisPeriod = currentOut;
            state.isFirstGraphUpdate = false;
        } else {
            // รอบต่อไป: เอายอดปัจจุบัน ลบ ยอดรอบที่แล้ว = จำนวนช่วงนี้
            carsInThisPeriod = currentIn - state.prevTotalIn;
            carsOutThisPeriod = currentOut - state.prevTotalOut;

            // ป้องกันค่าติดลบ กรณีเซิร์ฟเวอร์ restart แล้วยอดเริ่มนับใหม่จาก 0
            if (carsInThisPeriod < 0) carsInThisPeriod = currentIn;
            if (carsOutThisPeriod < 0) carsOutThisPeriod = currentOut;
        }

        // บันทึกยอดนี้ไว้สำหรับรอบถัดไป
        state.prevTotalIn = currentIn;
        state.prevTotalOut = currentOut;

        // เก็บสูงสุด 24 จุด ถ้าเกินให้ลบจุดเก่าสุดออก
        if (vehicleChart.data.labels.length >= 24) {
            vehicleChart.data.labels.shift();
            vehicleChart.data.datasets[0].data.shift();
            vehicleChart.data.datasets[1].data.shift();
        }

        vehicleChart.data.labels.push(timeLabel);
        vehicleChart.data.datasets[0].data.push(carsInThisPeriod);
        vehicleChart.data.datasets[1].data.push(carsOutThisPeriod);
        vehicleChart.update();

    } catch (error) {
        console.error("Error updating graph:", error);
    }
}


// ── setStatus(): อัปเดต badge Active/Inactive ───
// id = 'status-in' หรือ 'status-out'
// isActive = true → เขียว "Active", false → แดง "Inactive"
function setStatus(id, isActive) {
    const badge = document.getElementById(id);
    badge.className = 'status-badge ' + (isActive ? 'active' : 'inactive');
    badge.innerText = isActive ? 'Active' : 'Inactive';
}


// ── เริ่มต้นระบบ ─────────────────────────────────
// โหลดข้อมูลครั้งแรกทันทีที่เปิดเว็บ
updateNumbers();
updateGraph();

// ตัวเลข: อัปเดตทุก 1 วินาที
setInterval(updateNumbers, 1000);

// กราฟ: อัปเดตทุก 30 วินาที
// 💡 ตอน dev/ทดสอบ: เปลี่ยนเป็น 5000 (5 วินาที) เพื่อดูกราฟขยับเร็วขึ้น
// 💡 ตอน production จริง: เปลี่ยนเป็น 3600000 (1 ชั่วโมง) ตามที่ออกแบบไว้
setInterval(updateGraph, 30000);


/* ══════════════════════════════════════════════════
   ส่วนที่ 2 — STATS VIEW (หน้าสถิติ)
══════════════════════════════════════════════════ */

// instance ของกราฟในหน้าสถิติ
// svBarChart     = กราฟ session (sync จาก vehicleChart)
// svHistoryChart = กราฟย้อนหลัง (ดึงจาก /api/history)
// ทั้งคู่สร้างครั้งเดียวแบบ lazy (ตรวจ null ก่อนสร้าง)
let svBarChart = null;
let svHistoryChart = null;

// กล้องที่เลือกในหน้าสถิติ (อิสระจาก currentCamera ของ dashboard)
// ค่าได้: 1, 2, หรือ 'all'
let statsCamera = 1;

// config สำหรับ date picker แต่ละประเภท
// label = ข้อความใน input label
// title = ฟังก์ชันสร้าง title กราฟประวัติ รับ dateValue เป็น parameter
const DP_CONFIG = {
    daily: { label: 'เลือกวันที่', title: d => `📊 สรุปรายชั่วโมง — ${d}` },
    monthly: { label: 'เลือกเดือน', title: d => `📊 สรุปรายวัน — ${d}` },
    yearly: { label: 'เลือกปี', title: d => `📊 สรุปรายเดือน — ปี ${d}` }
};


// ── switchView(): สลับ dashboard ↔ stats ────────
// viewName = 'stats' หรือ 'dashboard'
// ใช้ display:none/flex แทน routing เพื่อไม่ให้ video stream ถูกรบกวน
function switchView(viewName) {
    const dashView = document.getElementById('dashboard-view');
    const statsView = document.getElementById('stats-view');
    const statsBtn = document.querySelector('.stats-btn');
    const camBtns = document.querySelectorAll('.BUT:not(.stats-btn)');

    if (viewName === 'stats') {
        dashView.style.display = 'none';
        statsView.style.display = 'flex';
        statsBtn.classList.add('active');
        statsBtn.classList.remove('inactive');
        camBtns.forEach(b => { b.classList.remove('active'); b.classList.add('inactive'); });

        // ตั้งค่า date input เป็นวันนี้โดยอัตโนมัติ (YYYY-MM-DD)
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        document.getElementById('sv-input-date').value = `${yyyy}-${mm}-${dd}`;

        initSvBarChart();          // สร้างกราฟ session (ถ้ายังไม่มี)
        switchCamera(statsCamera); // โหลดข้อมูลกล้องที่เลือกอยู่

    } else {
        // กลับหน้า dashboard
        dashView.style.display = 'flex';
        statsView.style.display = 'none';
        statsBtn.classList.remove('active');
        statsBtn.classList.add('inactive');
        // sync ปุ่มกล้องใน sidebar ให้ตรงกับ currentCamera ของ dashboard
        camBtns.forEach(b => {
            const n = b.innerText.includes('1') ? 1 : 2;
            b.classList.toggle('active', n === currentCamera);
            b.classList.toggle('inactive', n !== currentCamera);
        });
    }
}


// ── switchCamera(): สลับกล้องใน Stats View ──────
// cam = 1, 2, หรือ 'all'
// อัปเดต: ปุ่ม toggle, dot สี, subtitle, KPI cards, log table, history chart reset
// ถ้าอยากเพิ่มกล้อง: เพิ่ม id ในอาร์เรย์ ['1','2','all'] และเพิ่ม case ใน updateStatsView()
function switchCamera(cam) {
    statsCamera = cam;
    const isAll = cam === 'all';

    // อัปเดต class active บนปุ่ม toggle
    ['1', '2', 'all'].forEach(id => {
        const btn = document.getElementById(`cam-btn-${id}`);
        if (btn) btn.classList.toggle('active', String(cam) === String(id));
    });

    // เปลี่ยนสี dot และชื่อกล้องที่แสดง
    // cam1 = default (เขียว), cam2 = .cam2 (ม่วง), all = .all (เขียวกะพริบเร็ว)
    const dot = document.getElementById('sv-cam-dot');
    dot.className = 'sv-cam-dot' + (isAll ? ' all' : cam === 2 ? ' cam2' : '');
    document.getElementById('sv-cam-name').textContent = isAll ? 'รวมทุกกล้อง' : `Camera ${cam}`;
    document.getElementById('sv-subtitle').textContent =
        `สรุปข้อมูลการตรวจจับยานพาหนะ — ${isAll ? 'รวมทุกกล้อง' : `Camera ${cam}`}`;

    updateStatsView();   // โหลด KPI + log ใหม่
    resetHistoryChart(); // เคลียร์กราฟย้อนหลัง (ต้องเลือกวันที่ใหม่)
}


// ── updateStatsView(): อัปเดต KPI + Log Table ───
// เรียกโดย: switchCamera(), setInterval ทุก 2 วินาที
// - ถ้า statsCamera = 'all' → fetch 2 กล้องพร้อมกัน (Promise.all) แล้วรวมยอด
// - ถ้า statsCamera = 1/2  → fetch กล้องเดียว
async function updateStatsView() {
    try {
        let totalIn = 0, totalOut = 0, lastIn = '--:--:--', lastOut = '--:--:--';
        let logs = [];

        if (statsCamera === 'all') {
            // ดึงพร้อมกัน 2 กล้อง เร็วกว่า fetch ทีละตัว
            const [r1, r2] = await Promise.all([
                fetch('/api/data?camera=1').then(r => r.json()),
                fetch('/api/data?camera=2').then(r => r.json())
            ]);
            totalIn = r1.total_in + r2.total_in;
            totalOut = r1.total_out + r2.total_out;
            // ใช้เวลาล่าสุดที่มากกว่า (string compare ได้เพราะ format HH:MM:SS)
            lastIn = r1.last_in_time > r2.last_in_time ? r1.last_in_time : r2.last_in_time;
            lastOut = r1.last_out_time > r2.last_out_time ? r1.last_out_time : r2.last_out_time;
            // รวม log ทั้งสองกล้อง ติด .cam เพื่อแสดง badge แล้ว sort เวลาล่าสุดก่อน
            const logs1 = (r1.recent_logs || []).map(l => ({ ...l, cam: 1 }));
            const logs2 = (r2.recent_logs || []).map(l => ({ ...l, cam: 2 }));
            logs = [...logs1, ...logs2].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 20);

        } else {
            const res = await fetch(`/api/data?camera=${statsCamera}`);
            const data = await res.json();
            totalIn = data.total_in;
            totalOut = data.total_out;
            lastIn = data.last_in_time || '--:--:--';
            lastOut = data.last_out_time || '--:--:--';
            logs = (data.recent_logs || []).map(l => ({ ...l, cam: statsCamera }));
        }

        // อัปเดต KPI cards
        document.getElementById('sv-total-in').textContent = totalIn;
        document.getElementById('sv-total-out').textContent = totalOut;
        document.getElementById('sv-net').textContent = Math.max(0, totalIn - totalOut);
        document.getElementById('sv-last-in').textContent = lastIn;
        document.getElementById('sv-last-out').textContent = lastOut;

        // sync กราฟ session กับ vehicleChart (กราฟหน้า dashboard)
        // ทำให้กราฟทั้งสองหน้าแสดงข้อมูลเดียวกัน
        if (svBarChart && vehicleChart.data.labels.length > 0) {
            svBarChart.data.labels = [...vehicleChart.data.labels];
            svBarChart.data.datasets[0].data = [...vehicleChart.data.datasets[0].data];
            svBarChart.data.datasets[1].data = [...vehicleChart.data.datasets[1].data];
            svBarChart.update();
        }

        // render ตาราง log
        const tbody = document.getElementById('sv-log-body');
        document.getElementById('sv-log-count').textContent = logs.length;

        if (logs.length === 0) {
            tbody.innerHTML = '<tr class="sv-empty-row"><td colspan="4">ยังไม่มีประวัติ</td></tr>';
            return;
        }

        // สร้าง row แต่ละรายการ พร้อม badge ทิศทาง IN/OUT และ tag ชื่อกล้อง
        tbody.innerHTML = logs.map((log, i) => {
            const isIn = log.type === 'IN';
            const camCls = log.cam === 1 ? 'c1' : 'c2'; // ใช้กำหนดสีใน .cam-tag
            return `<tr>
                <td class="sv-row-num">${i + 1}</td>
                <td class="sv-time-cell">${log.time}</td>
                <td><span class="sv-badge ${isIn ? 'sv-badge-in' : 'sv-badge-out'}">
                    <span class="sv-dot ${isIn ? 'sv-dot-in' : 'sv-dot-out'}"></span>
                    ${isIn ? '↓ IN' : '↑ OUT'}
                </span></td>
                <td><span class="cam-tag ${camCls}">CAM ${log.cam}</span></td>
            </tr>`;
        }).join('');

    } catch (e) { console.error('updateStatsView:', e); }
}


// ── initSvBarChart(): สร้างกราฟ Session ─────────
// สร้างครั้งเดียว (lazy init) ตอนเปิดหน้าสถิติ
// ข้อมูลดึงมาจาก vehicleChart โดย updateStatsView()
function initSvBarChart() {
    if (svBarChart) return; // สร้างแล้ว ข้ามได้
    svBarChart = new Chart(document.getElementById('sv-bar-chart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                { label: 'รถเข้า', data: [], backgroundColor: 'rgba(74,222,128,0.55)', borderColor: '#4ade80', borderWidth: 1, borderRadius: 4 },
                { label: 'รถออก', data: [], backgroundColor: 'rgba(251,146,60,0.55)', borderColor: '#fb923c', borderWidth: 1, borderRadius: 4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: { color: '#2a2a2c' }, ticks: { color: '#666', font: { size: 10 } } },
                y: { grid: { color: '#2a2a2c' }, ticks: { color: '#666', font: { size: 10 } }, beginAtZero: true }
            },
            plugins: { legend: { display: false } }
        }
    });
}


// ── onTypeChange(): เปลี่ยนประเภท Date Picker ───
// เรียกเมื่อเปลี่ยน dropdown รายวัน/เดือน/ปี
// จะ: เปลี่ยน label input, ซ่อน/แสดง input ที่ถูกต้อง, reset ผลลัพธ์ + กราฟ
function onTypeChange() {
    const type = document.getElementById('sv-type-select').value;

    document.getElementById('sv-dp-label').textContent = DP_CONFIG[type].label;
    document.getElementById('sv-input-date').style.display = type === 'daily' ? '' : 'none';
    document.getElementById('sv-input-month').style.display = type === 'monthly' ? '' : 'none';
    document.getElementById('sv-input-year').style.display = type === 'yearly' ? '' : 'none';

    // เคลียร์ผลลัพธ์เดิมออก
    ['sv-dp-total-in', 'sv-dp-total-out', 'sv-dp-net'].forEach(id =>
        document.getElementById(id).textContent = '—'
    );
    resetHistoryChart();
}


// ── resetHistoryChart(): เคลียร์กราฟย้อนหลัง ───
// เรียกเมื่อ: switchCamera(), onTypeChange()
// คืน overlay กลับไปเป็น "เลือกวันที่เพื่อแสดงกราฟ"
function resetHistoryChart() {
    const overlay = document.getElementById('sv-chart-overlay');
    overlay.classList.remove('hidden');
    overlay.style.color = '#555';
    overlay.textContent = '📅 เลือกวันที่เพื่อแสดงกราฟ';

    document.getElementById('sv-history-title').textContent = '📊 เลือกช่วงเวลาเพื่อดูกราฟ';

    // เคลียร์ผลลัพธ์ date picker
    ['sv-dp-total-in', 'sv-dp-total-out', 'sv-dp-net'].forEach(id =>
        document.getElementById(id).textContent = '—'
    );

    // เคลียร์ status label
    const statusEl = document.getElementById('sv-dp-status');
    statusEl.className = 'sv-dp-status';
    statusEl.textContent = '';
}


// ── fetchHistoryByDate(): ดึงข้อมูลย้อนหลัง ────
// เรียกเมื่อ: เลือกวันที่ใน input (oninput event)
// เรียก /api/history แล้ว:
//   - ถ้าไม่มีข้อมูล: แสดง overlay สีเหลือง "ไม่มีข้อมูล"
//   - ถ้ามีข้อมูล: อัปเดตผลลัพธ์ + render svHistoryChart
//
// ⚠️ /api/history ยังไม่ได้เพิ่มใน app.py — รอ schema DB จากทีม backend
//    expected response: { total_in, total_out, labels[], chart_in[], chart_out[] }
//    กรณีไม่มีข้อมูล: { total_in:0, total_out:0, labels:[] }
async function fetchHistoryByDate() {
    const type = document.getElementById('sv-type-select').value;

    // อ่านค่าจาก input ที่กำลังแสดงอยู่ตามประเภท
    let dateValue = '';
    if (type === 'daily') dateValue = document.getElementById('sv-input-date').value;
    if (type === 'monthly') dateValue = document.getElementById('sv-input-month').value;
    if (type === 'yearly') dateValue = document.getElementById('sv-input-year').value;
    if (!dateValue) return; // ยังไม่ได้เลือก ออกก่อน

    const statusEl = document.getElementById('sv-dp-status');
    const overlay = document.getElementById('sv-chart-overlay');

    // แสดง loading state
    statusEl.className = 'sv-dp-status loading';
    statusEl.textContent = 'กำลังโหลด...';
    overlay.classList.remove('hidden');
    overlay.style.color = '#555';
    overlay.textContent = '⏳ กำลังโหลดข้อมูล...';

    try {
        let totalIn = 0, totalOut = 0, labels = [], chartIn = [], chartOut = [];

        if (statsCamera === 'all') {
            // ดึงพร้อมกัน 2 กล้อง แล้วรวมยอด
            const [r1, r2] = await Promise.all([
                fetch(`/api/history?type=${type}&date=${dateValue}&camera=1`).then(r => r.json()),
                fetch(`/api/history?type=${type}&date=${dateValue}&camera=2`).then(r => r.json())
            ]);
            totalIn = r1.total_in + r2.total_in;
            totalOut = r1.total_out + r2.total_out;
            labels = r1.labels; // ใช้ labels จากกล้อง 1 (เหมือนกันทั้งคู่)
            // รวม chart data ทีละ index
            chartIn = r1.chart_in.map((v, i) => v + (r2.chart_in[i] || 0));
            chartOut = r1.chart_out.map((v, i) => v + (r2.chart_out[i] || 0));

        } else {
            const data = await fetch(`/api/history?type=${type}&date=${dateValue}&camera=${statsCamera}`).then(r => r.json());
            totalIn = data.total_in;
            totalOut = data.total_out;
            labels = data.labels;
            chartIn = data.chart_in;
            chartOut = data.chart_out;
        }

        const camLabel = statsCamera === 'all' ? 'ALL' : `CAM ${statsCamera}`;

        // ── กรณีไม่มีข้อมูล ────────────────────────
        if (!labels || labels.length === 0) {
            document.getElementById('sv-dp-total-in').textContent = '0';
            document.getElementById('sv-dp-total-out').textContent = '0';
            document.getElementById('sv-dp-net').textContent = '0';
            document.getElementById('sv-history-title').textContent = DP_CONFIG[type].title(dateValue);

            // เคลียร์กราฟถ้ามีอยู่แล้ว
            if (svHistoryChart) {
                svHistoryChart.data.labels = [];
                svHistoryChart.data.datasets[0].data = [];
                svHistoryChart.data.datasets[1].data = [];
                svHistoryChart.update();
            }

            overlay.classList.remove('hidden');
            overlay.style.color = '#f59e0b'; // สีเหลือง = เตือน ไม่ใช่ error
            overlay.textContent = '📭 ไม่มีข้อมูลในช่วงเวลานี้';
            statusEl.className = 'sv-dp-status error';
            statusEl.textContent = `ไม่พบข้อมูล (${camLabel})`;
            return;
        }

        // ── กรณีมีข้อมูล ────────────────────────────
        const net = totalIn - totalOut;
        document.getElementById('sv-dp-total-in').textContent = totalIn.toLocaleString();
        document.getElementById('sv-dp-total-out').textContent = totalOut.toLocaleString();
        // แสดงเครื่องหมาย + ถ้า net เป็นบวก
        document.getElementById('sv-dp-net').textContent = (net >= 0 ? '+' : '') + net.toLocaleString();
        document.getElementById('sv-history-title').textContent = DP_CONFIG[type].title(dateValue);

        // สร้าง svHistoryChart ครั้งแรก (lazy init เหมือน svBarChart)
        if (!svHistoryChart) {
            svHistoryChart = new Chart(
                document.getElementById('sv-history-chart').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: [], datasets: [
                        { label: 'รถเข้า', data: [], backgroundColor: 'rgba(74,222,128,0.55)', borderColor: '#4ade80', borderWidth: 1, borderRadius: 4 },
                        { label: 'รถออก', data: [], backgroundColor: 'rgba(251,146,60,0.55)', borderColor: '#fb923c', borderWidth: 1, borderRadius: 4 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        x: { grid: { color: '#2a2a2c' }, ticks: { color: '#666', font: { size: 10 } } },
                        y: { grid: { color: '#2a2a2c' }, ticks: { color: '#666', font: { size: 10 } }, beginAtZero: true }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor: '#1e1e20', titleColor: '#ccc', bodyColor: '#aaa', borderColor: '#333', borderWidth: 1 }
                    },
                    animation: { duration: 400 }
                }
            });
        }

        // อัปเดตข้อมูลกราฟ
        svHistoryChart.data.labels = labels;
        svHistoryChart.data.datasets[0].data = chartIn;
        svHistoryChart.data.datasets[1].data = chartOut;
        svHistoryChart.update();

        // ซ่อน overlay เมื่อกราฟแสดงแล้ว
        overlay.classList.add('hidden');
        statusEl.className = 'sv-dp-status ok';
        statusEl.textContent = `อัปเดต: ${new Date().toLocaleTimeString('th-TH')} (${camLabel})`;

    } catch (e) {
        // network error หรือ server error
        console.error('fetchHistoryByDate:', e);
        overlay.style.color = '#f87171';
        overlay.textContent = '❌ เกิดข้อผิดพลาด';
        statusEl.className = 'sv-dp-status error';
        statusEl.textContent = 'โหลดข้อมูลไม่สำเร็จ';
    }
}


// ── cam-tag style (inject ด้วย JS) ──────────────
// inject แบบนี้เพื่อไม่ต้องเพิ่มใน styles.css
// ถ้าอยากย้ายไปไว้ใน styles.css ก็ได้ ไม่มีผลกับการทำงาน
const camTagStyle = document.createElement('style');
camTagStyle.textContent = `
    .cam-tag { display:inline-block; font-size:10px; padding:2px 7px; border-radius:4px; font-weight:700; }
    .cam-tag.c1 { background:rgba(98,0,148,0.2);   color:#d8b4fe; border:1px solid rgba(98,0,148,0.3); }
    .cam-tag.c2 { background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid rgba(168,85,247,0.3); }
`;
document.head.appendChild(camTagStyle);


// ── auto-refresh stats view ───────────────────────
// อัปเดต KPI + log table ทุก 2 วินาที เฉพาะตอนที่หน้าสถิติเปิดอยู่
// ไม่รัน background เมื่ออยู่หน้า dashboard เพื่อประหยัด request
setInterval(() => {
    if (document.getElementById('stats-view').style.display !== 'none') updateStatsView();
}, 2000);