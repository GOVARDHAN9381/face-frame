/* ============================================================
   camera.js  –  Webcam capture, upload, and API submission
   SpectAI – AI Spectacle Recommendation System
   ============================================================ */

const API_BASE = 'https://face-frame.onrender.com';
// ESP32_IP not needed — ESP32 polls Render cloud directly!

let stream = null;
let facingMode = 'user';
let capturedBlob = null;
let uploadedBlob = null;
let currentTab = 'webcam';

// ── DOM refs ──────────────────────────────────────────────
const video = document.getElementById('webcam-video');
const overlayCanvas = document.getElementById('overlay-canvas');
const captureCanvas = document.getElementById('capture-canvas');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const countdownEl = document.getElementById('countdown');
const scanLine = document.getElementById('scan-line');
const webcamHint = document.getElementById('webcam-hint');
const analyzeBtn = document.getElementById('analyze-btn');
const captureBtn = document.getElementById('capture-btn');
const uploadZone = document.getElementById('upload-zone');
const loading = document.getElementById('loading-overlay');

// ── Init ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  startWebcam();
  setupDragDrop();
});

// ── Webcam ────────────────────────────────────────────────
async function startWebcam() {
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    video.srcObject = stream;
    setStatus('ready', 'Camera ready');
    video.addEventListener('loadedmetadata', () => {
      overlayCanvas.width = video.videoWidth;
      overlayCanvas.height = video.videoHeight;
    });
  } catch (err) {
    setStatus('inactive', 'Camera access denied');
    showToast('error', '⚠️ Camera not accessible. Use Upload tab instead.');
    document.getElementById('tab-upload').click();
  }
}

function toggleCamera() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startWebcam();
}

// ── Tab Switch ────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.getElementById('panel-webcam').classList.toggle('active', tab === 'webcam');
  document.getElementById('panel-upload').classList.toggle('active', tab === 'upload');
  document.getElementById('tab-webcam').classList.toggle('active', tab === 'webcam');
  document.getElementById('tab-upload').classList.toggle('active', tab === 'upload');

  if (tab === 'webcam' && !stream) startWebcam();
}

// ── Countdown + Capture ───────────────────────────────────
function startCountdown() {
  if (!stream) { showToast('error', 'Camera not ready'); return; }

  captureBtn.disabled = true;
  capturedBlob = null;
  analyzeBtn.style.display = 'none';
  webcamHint.textContent = 'Hold still…';

  let count = 3;
  countdownEl.style.display = 'flex';
  countdownEl.textContent = count;
  setStatus('capturing', 'Get ready…');

  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      countdownEl.textContent = count;
    } else {
      clearInterval(timer);
      countdownEl.style.display = 'none';
      captureFrame();
    }
  }, 1000);
}

function captureFrame() {
  const ctx = captureCanvas.getContext('2d');
  captureCanvas.width = video.videoWidth;
  captureCanvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);

  captureCanvas.toBlob(blob => {
    capturedBlob = blob;
    captureBtn.disabled = false;
    analyzeBtn.style.display = 'flex';
    webcamHint.textContent = 'Image captured! Press 🔍 to analyze';
    setStatus('ready', 'Captured — ready to analyze');
    drawCaptureFeedback();
    showToast('success', '📸 Image captured successfully!');
  }, 'image/jpeg', 0.92);
}

function drawCaptureFeedback() {
  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  ctx.strokeStyle = '#68d391';
  ctx.lineWidth = 3;
  const m = 40;
  const w = overlayCanvas.width, h = overlayCanvas.height;
  // Corners
  [[m, m], [w - m, m], [m, h - m], [w - m, h - m]].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + (x < w / 2 ? 20 : -20), y);
    ctx.moveTo(x, y); ctx.lineTo(x, y + (y < h / 2 ? 20 : -20));
    ctx.stroke();
  });
  setTimeout(() => ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height), 2000);
}

// ── File Upload ───────────────────────────────────────────
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  processUploadedFile(file);
}

function processUploadedFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('error', 'Please select a valid image file.');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('error', 'File too large. Max 10 MB.');
    return;
  }
  uploadedBlob = file;
  const url = URL.createObjectURL(file);
  document.getElementById('upload-preview').src = url;
  document.getElementById('upload-preview-wrap').style.display = 'block';
  document.getElementById('upload-analyze-btn').style.display = 'flex';
  showToast('success', '🖼️ Image loaded. Press Analyze!');
}

function setupDragDrop() {
  if (!uploadZone) return;
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processUploadedFile(file);
  });
}

// ── Analyze (Webcam) ──────────────────────────────────────
async function analyzeImage() {
  if (!capturedBlob) { showToast('error', 'Capture an image first'); return; }
  await submitForAnalysis(capturedBlob);
}

// ── Analyze (Upload) ──────────────────────────────────────
async function analyzeUpload() {
  if (!uploadedBlob) { showToast('error', 'Upload an image first'); return; }
  await submitForAnalysis(uploadedBlob);
}

// ── Submit to Flask API ───────────────────────────────────
async function submitForAnalysis(blob) {
  showLoading(true);
  animateLoadingSteps();

  const formData = new FormData();
  formData.append('image', blob, 'face.jpg');

  try {
    const resp = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      body: formData
    });

    if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
    const data = await resp.json();

    if (data.error) throw new Error(data.error);

    // Store results in sessionStorage for results page
    sessionStorage.setItem('spectai_results', JSON.stringify(data));
    // ESP32 polls https://face-frame.onrender.com/history every 3s automatically.
    sessionStorage.setItem('spectai_esp_status', 'success');

    // Store image preview
    const reader = new FileReader();
    reader.onload = e => {
      sessionStorage.setItem('spectai_preview', e.target.result);
      showLoading(false);
      window.location.href = 'results.html';
    };
    reader.readAsDataURL(blob);

  } catch (err) {
    showLoading(false);
    console.error(err);

    // Demo mode: generate mock results
    showToast('info', '🧪 Demo mode — using simulated results');
    const mockData = generateMockResults();
    sessionStorage.setItem('spectai_results', JSON.stringify(mockData));
    sessionStorage.setItem('spectai_esp_status', 'success');

    const reader = new FileReader();
    reader.onload = e => {
      sessionStorage.setItem('spectai_preview', e.target.result);
      setTimeout(() => { window.location.href = 'results.html'; }, 1200);
    };
    reader.readAsDataURL(blob);
  }
}

// ── Mock Results (demo / offline fallback) ────────────────
function generateMockResults() {
  const faceShapes = ['Oval', 'Round', 'Square', 'Heart', 'Diamond', 'Oblong'];
  const eyeShapes = ['Almond', 'Round', 'Hooded', 'Upturned', 'Downturned'];
  const frameStyles = { Oval: 'Most Styles', Round: 'Rectangle', Square: 'Round', Heart: 'Rimless', Diamond: 'Oval', Oblong: 'Wayfarer' };
  const face = faceShapes[Math.floor(Math.random() * faceShapes.length)];
  const eye = eyeShapes[Math.floor(Math.random() * eyeShapes.length)];
  const faceW = +(128 + Math.random() * 24).toFixed(1);
  const faceL = +(165 + Math.random() * 22).toFixed(1);
  const pd = +(60 + Math.random() * 8).toFixed(1);
  const size = faceW < 130 ? 'Small' : faceW <= 140 ? 'Medium' : 'Large';

  return {
    scan_id: 'DEMO-' + Date.now(),
    face_shape: face,
    eye_shape: eye,
    frame_size: size,
    frame_style: frameStyles[face],
    face_width: faceW,
    face_length: faceL,
    forehead_width: +(faceW * 0.82).toFixed(1),
    cheekbone_width: +(faceW * 0.98).toFixed(1),
    jaw_width: +(faceW * 0.75).toFixed(1),
    left_eye_width: +(29 + Math.random() * 4).toFixed(1),
    right_eye_width: +(29 + Math.random() * 4).toFixed(1),
    eye_height: +(10 + Math.random() * 4).toFixed(1),
    eye_aspect_ratio: +(0.28 + Math.random() * 0.1).toFixed(2),
    pd: pd,
    lens_width: size === 'Small' ? '44-46 mm' : size === 'Medium' ? '48-52 mm' : '52-56 mm',
    bridge_size: '16-18 mm',
    temple_length: '140-145 mm',
    best_color: ['Black', 'Tortoise', 'Gold', 'Silver', 'Navy'][Math.floor(Math.random() * 5)],
    confidence: { face: 0.96, eye: 0.93, landmark: 0.98 },
    landmark_count: 468,
    timestamp: new Date().toISOString(),
    demo_mode: true
  };
}

// ── Loading Steps Animation ───────────────────────────────
function animateLoadingSteps() {
  const steps = ['step-1', 'step-2', 'step-3', 'step-4', 'step-5'];
  let idx = 0;
  document.getElementById(steps[0]).classList.add('active');

  const interval = setInterval(() => {
    if (idx < steps.length) {
      if (idx > 0) {
        document.getElementById(steps[idx - 1]).classList.remove('active');
        document.getElementById(steps[idx - 1]).classList.add('done');
        document.getElementById(steps[idx - 1]).textContent =
          '✅ ' + document.getElementById(steps[idx - 1]).textContent.replace(/^.{2}/, '');
      }
      document.getElementById(steps[idx]).classList.add('active');
      idx++;
    } else {
      clearInterval(interval);
    }
  }, 900);
}

// ── UI Helpers ────────────────────────────────────────────
function setStatus(state, text) {
  statusDot.className = 'status-dot ' + state;
  statusText.textContent = text;
}

function showLoading(on) {
  loading.classList.toggle('active', on);
}

function showToast(type, msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}
