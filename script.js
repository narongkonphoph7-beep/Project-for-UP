let currentCamera = 1;
// ตั้งค่ากราฟ Chart.js
const ctx = document.getElementById('vehicleChart').getContext('2d');
const vehicleChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [], // เวลา (แกน X)
        datasets: [
            {
                label: 'รถเข้า (IN)',
                data: [],
                borderColor: '#36a2eb', // สีฟ้า
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                tension: 0.4,
                fill: true
            },
            {
                label: 'รถออก (OUT)',
                data: [],
                borderColor: '#ff6384', // สีแดง
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
            legend: { display: false } // ซ่อน Legend ดั้งเดิม
        }
    }
});

// ฟังก์ชันสำหรับเปลี่ยนปุ่ม Active (Gate 1 / Gate 2)
function setActive(button) {
    document.querySelectorAll('.BUT').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.add('inactive');
    });
    button.classList.remove('inactive');
    button.classList.add('active');

    // เปลี่ยน video feed ตามกล้องที่เลือก
    currentCamera = button.innerText.includes('1') ? 1 : 2;
    document.querySelector('.video-REAL').src = `/video_feed?camera=${currentCamera}`;
    vehicleChart.data.labels = [];
    vehicleChart.data.datasets[0].data = [];
    vehicleChart.data.datasets[1].data = [];
    vehicleChart.update();
    updateGraph();
}

function toggleMenu() {
    document.querySelector('.sidebar').classList.toggle('open');
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.toggle('show');
    });
}

// ตัวแปรเก็บยอดสะสมรอบที่แล้ว เพื่อเอามาคำนวณ "จำนวนรถเฉพาะชั่วโมงนี้" **แบบแยกกล้อง
const cameraState = {
    1: { prevTotalIn: 0, prevTotalOut: 0, isFirstGraphUpdate: true },
    2: { prevTotalIn: 0, prevTotalOut: 0, isFirstGraphUpdate: true }
};

// ==========================================
// 1. ฟังก์ชันอัปเดต "ตัวเลข" (ทำทุก 1 วินาที)
// ==========================================
async function updateNumbers() {
    try {
        const response = await fetch(`/api/data?camera=${currentCamera}`);
        const data = await response.json();

        // อัปเดตตัวเลขสะสม
        document.getElementById('car-in').innerText = data.total_in;
        document.getElementById('car-out').innerText = data.total_out;

        // เพิ่มฟังก์ชัน ถ้าข้อมูลขึ้น(กำลังทำงาน/Active) จะขึ้นเป็นปุ่มสีเขียว ถ้า error จะขึ้นปุ่มสีแดง 
        setStatus('status-in', true);
        setStatus('status-out', true);

    } catch (error) {
        console.error("Error fetching numbers:", error);
        // ถ้า fetch error = inactive (red)
        setStatus('status-in', false);
        setStatus('status-out', false);
    }
}

// ==========================================
// 2. ฟังก์ชันอัปเดต "กราฟ" (ทำทุก 1 ชั่วโมง)
// ==========================================
async function updateGraph() {
    try {
        const response = await fetch(`/api/data?camera=${currentCamera}`);
        const data = await response.json();

        // ดึงเวลาปัจจุบัน (เอาแค่ ชั่วโมง:นาที เช่น "14:00")
        const now = new Date();
        const timeLabel = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

        let currentIn = data.total_in;
        let currentOut = data.total_out;

        let carsInThisPeriod = 0;
        let carsOutThisPeriod = 0;

        const state = cameraState[currentCamera]
        if (state.isFirstGraphUpdate) {
            // รอบแรกที่เปิดเว็บ ให้โชว์ยอดสะสมทั้งหมดไปก่อน
            carsInThisPeriod = currentIn;
            carsOutThisPeriod = currentOut;
            state.isFirstGraphUpdate = false;
        } else {
            // รอบต่อๆ ไป ให้เอายอดปัจจุบัน ลบด้วย ยอดของชั่วโมงที่แล้ว
            carsInThisPeriod = currentIn - state.prevTotalIn;
            carsOutThisPeriod = currentOut - state.prevTotalOut;
            
            // ป้องกันกราฟติดลบ กรณีสั่งรีสตาร์ทเซิร์ฟเวอร์
            if(carsInThisPeriod < 0) carsInThisPeriod = currentIn; 
            if(carsOutThisPeriod < 0) carsOutThisPeriod = currentOut;
        }


        // เก็บยอดปัจจุบันไว้ลบในรอบถัดไป
        state.prevTotalIn = currentIn;
        state.prevTotalOut = currentOut;

        // แสดงกราฟย้อนหลังสูงสุด 24 จุด (24 ชั่วโมง)
        if (vehicleChart.data.labels.length >= 24) {
            vehicleChart.data.labels.shift();
            vehicleChart.data.datasets[0].data.shift();
            vehicleChart.data.datasets[1].data.shift();
        }

        // เพิ่มจุดใหม่ลงไปในกราฟ
        vehicleChart.data.labels.push(timeLabel);
        vehicleChart.data.datasets[0].data.push(carsInThisPeriod);
        vehicleChart.data.datasets[1].data.push(carsOutThisPeriod);
        vehicleChart.update();

    } catch (error) {
        console.error("Error updating graph:", error);
    }
}

function setStatus(id, isActive) {
    const badge = document.getElementById(id);
    badge.className = 'status-badge ' + (isActive ? 'active' : 'inactive');
    badge.innerText = isActive ? 'Active' : 'Inactive';

}

// ==========================================
// สั่งให้ระบบเริ่มทำงาน
// ==========================================

// โหลดข้อมูลครั้งแรกทันทีที่เปิดเว็บ
updateNumbers();
updateGraph();

// ตัวเลข: ให้อัปเดตทุกๆ 1 วินาที (1,000 มิลลิวินาที)
setInterval(updateNumbers, 1000);

// กราฟ: ให้อัปเดตทุกๆ 1 ชั่วโมง (3,600,000 มิลลิวินาที)
setInterval(updateGraph, 30000); 

// 💡 คำแนะนำสำหรับการทดสอบพรีเซนต์: 
// ถ้าไม่อยากรอ 1 ชั่วโมงเพื่อดูกราฟขยับ ให้เปลี่ยนเลข 3600000 ด้านบนเป็น 60000 (1 นาที) ดูก่อนได้ครับ