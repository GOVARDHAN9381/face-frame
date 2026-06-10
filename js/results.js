/* ============================================================
   results.js  –  Load & render analysis results on results.html
   SpectAI – AI Spectacle Recommendation System
   ============================================================ */

const API_BASE = 'https://face-frame.onrender.com';

// Shape meta-data
const FACE_SHAPE_META = {
  Oval:    { icon:'🥚', desc:'Balanced proportions. Most frame styles work beautifully.' },
  Round:   { icon:'⭕', desc:'Soft features with similar width and length.' },
  Square:  { icon:'⬛', desc:'Strong jawline with angular features.' },
  Heart:   { icon:'❤️', desc:'Wide forehead tapering to a narrow chin.' },
  Diamond: { icon:'💎', desc:'Narrow forehead & jaw with wide cheekbones.' },
  Oblong:  { icon:'📏', desc:'Face length considerably greater than width.' }
};

const EYE_SHAPE_META = {
  Almond:    { icon:'🌾', desc:'Classic almond shape — widest in the middle.' },
  Round:     { icon:'⭕', desc:'Circular eyes with visible white above & below.' },
  Hooded:    { icon:'🎭', desc:'Heavy lid that partially covers the eye.' },
  Upturned:  { icon:'↗️',  desc:'Outer corner turns upward at the outer edge.' },
  Downturned:{ icon:'↘️',  desc:'Outer corner turns slightly downward.' }
};

const FRAME_REASONS = {
  Oval:    'Your balanced oval face pairs well with almost any frame style. We recommend a classic rectangle for a sharp, professional look.',
  Round:   'Rectangle frames add definition and structure to your soft round features, creating a flattering contrast.',
  Square:  'Round or oval frames soften your strong angular jaw and balance your facial proportions perfectly.',
  Heart:   'Rimless or light frames draw attention away from the wider forehead and complement your delicate chin.',
  Diamond: 'Oval frames highlight your cheekbones while adding softness to your narrow forehead and jaw.',
  Oblong:  'Wayfarer or decorative frames add width and break the vertical length of your face beautifully.'
};

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const raw = sessionStorage.getItem('spectai_results');
  if (!raw) {
    document.getElementById('no-results-banner').style.display = 'flex';
    return;
  }
  try {
    const data = JSON.parse(raw);
    document.getElementById('results-content').style.display = 'block';
    renderResults(data);
    startOledRotation(data);
    updateEspStatus();
  } catch(e) {
    document.getElementById('no-results-banner').style.display = 'flex';
  }
});

// ── Main Render ───────────────────────────────────────────
function renderResults(d) {
  // Timestamp
  const ts = d.timestamp ? new Date(d.timestamp) : new Date();
  document.getElementById('scan-timestamp').textContent =
    'Scanned on ' + ts.toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' });

  // Scan ID
  document.getElementById('scan-id-label').textContent = 'Scan ID: ' + (d.scan_id || '—');
  if (d.demo_mode) {
    document.getElementById('scan-id-label').textContent += '  [Demo Mode]';
  }

  // Preview image
  const preview = sessionStorage.getItem('spectai_preview');
  if (preview) {
    const img = document.createElement('img');
    img.src = preview;
    img.alt = 'Captured face';
    document.getElementById('face-preview').innerHTML = '';
    document.getElementById('face-preview').appendChild(img);
  }

  // ── Face Measurements ──
  setText('r-face-width',  fmt(d.face_width,  'mm'));
  setText('r-face-length', fmt(d.face_length, 'mm'));
  setText('r-forehead',    fmt(d.forehead_width, 'mm'));
  setText('r-cheekbone',   fmt(d.cheekbone_width, 'mm'));
  setText('r-jaw',         fmt(d.jaw_width,   'mm'));

  // ── Eye Measurements ──
  setText('r-left-eye-w',  fmt(d.left_eye_width,  'mm'));
  setText('r-right-eye-w', fmt(d.right_eye_width, 'mm'));
  setText('r-eye-height',  fmt(d.eye_height,       'mm'));
  setText('r-eye-ratio',   d.eye_aspect_ratio ? d.eye_aspect_ratio.toFixed(2) : '—');
  setText('r-pd',          fmt(d.pd, 'mm'));

  // ── Face Shape ──
  const fs   = d.face_shape || 'Unknown';
  const fMeta = FACE_SHAPE_META[fs] || { icon:'🔮', desc:'Shape detected.' };
  setText('r-face-shape',      fs);
  setText('r-face-shape-desc', fMeta.desc);
  document.getElementById('face-shape-icon').textContent = fMeta.icon;
  highlightChip('face-shape-chips', fs);

  // ── Eye Shape ──
  const es   = d.eye_shape || 'Unknown';
  const eMeta = EYE_SHAPE_META[es] || { icon:'👁️', desc:'Shape detected.' };
  setText('r-eye-shape',      es);
  setText('r-eye-shape-desc', eMeta.desc);
  document.getElementById('eye-shape-icon').textContent = eMeta.icon;
  highlightChip('eye-shape-chips', es);

  // ── Recommendation ──
  setText('r-frame-size',  d.frame_size  || '—');
  setText('r-frame-style', d.frame_style || '—');
  setText('r-lens-width',  d.lens_width  || '—');
  setText('r-bridge',      d.bridge_size || '—');
  setText('r-temple',      d.temple_length || '—');
  setText('r-color',       d.best_color   || '—');
  setText('r-reason',      FRAME_REASONS[fs] || 'Recommendation generated based on your facial measurements.');

  // ── Confidence Bars ──
  const conf = d.confidence || { face: 0.95, eye: 0.93, landmark: 0.97 };
  animateBar('prog-face', conf.face, 'conf-face');
  animateBar('prog-eye',  conf.eye,  'conf-eye');
  animateBar('prog-lm',   conf.landmark, 'conf-lm');
}

// ── OLED Rotation ─────────────────────────────────────────
function startOledRotation(d) {
  const fs = d.face_shape || '—';
  const es = d.eye_shape  || '—';
  const pd = d.pd ? d.pd + ' mm' : '—';
  const fr = `${d.frame_size || '—'} ${d.frame_style || '—'}`;

  const slides = [
    `Face:\n${fs}`,
    `Eye:\n${es}`,
    `PD: ${pd}`,
    `Frame:\n${fr}`
  ];

  const oledEls = [
    document.getElementById('oled-s1'),
    document.getElementById('oled-s2'),
    document.getElementById('oled-s3'),
    document.getElementById('oled-s4')
  ];

  oledEls.forEach((el, i) => {
    el.style.whiteSpace = 'pre';
    el.textContent = slides[i];
  });

  let cur = 0;
  oledEls[0].classList.add('active');

  setInterval(() => {
    oledEls[cur].classList.remove('active');
    cur = (cur + 1) % 4;
    oledEls[cur].classList.add('active');
  }, 3000);
}

// ── ESP32 Status Update ───────────────────────────────────
function updateEspStatus() {
  const statusEl   = document.getElementById('esp-status');
  const statusText = document.getElementById('esp-status-text');
  const espStatus  = sessionStorage.getItem('spectai_esp_status');

  if (espStatus === 'success') {
    statusEl.style.background   = 'rgba(104,211,145,0.08)';
    statusEl.style.borderColor  = 'rgba(104,211,145,0.2)';
    statusEl.style.color        = 'var(--accent-green)';
    statusText.textContent = '✅ Sent to ESP32 successfully';
    const dot = statusEl.querySelector('.esp-dot');
    if (dot) { dot.style.display = 'none'; }
  } else {
    statusEl.style.background  = 'rgba(237,100,166,0.08)';
    statusEl.style.borderColor = 'rgba(237,100,166,0.2)';
    statusEl.style.color       = 'var(--accent-pink)';
    statusText.textContent = '⚠️ ESP32 not connected';
    const dot = statusEl.querySelector('.esp-dot');
    if (dot) { dot.style.background = 'var(--accent-pink)'; dot.style.animation = 'none'; }
  }
}

// ── PDF Report ────────────────────────────────────────────
function downloadReport() {
  const raw = sessionStorage.getItem('spectai_results');
  if (!raw) return;
  const d = JSON.parse(raw);
  const ts = d.timestamp ? new Date(d.timestamp).toLocaleString() : new Date().toLocaleString();

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>SpectAI Report – ${d.scan_id || ''}</title>
<style>
  body { font-family: Arial, sans-serif; max-width:700px; margin:40px auto; color:#111; }
  h1   { color:#2b6cb0; border-bottom:2px solid #2b6cb0; padding-bottom:10px; }
  h2   { color:#2c7a7b; margin-top:30px; }
  table { width:100%; border-collapse:collapse; margin-top:12px; }
  th,td { text-align:left; padding:10px 14px; border-bottom:1px solid #e2e8f0; }
  th    { background:#ebf8ff; color:#2b6cb0; font-weight:600; }
  .rec  { background:#f0fff4; border:1px solid #9ae6b4; border-radius:8px; padding:20px; margin-top:20px; }
  .rec h2 { color:#276749; margin-top:0; }
  .footer { margin-top:40px; color:#718096; font-size:0.8rem; text-align:center; }
</style>
</head>
<body>
<h1>👓 SpectAI – Facial Analysis Report</h1>
<p><strong>Scan ID:</strong> ${d.scan_id || '—'} &nbsp;|&nbsp; <strong>Date:</strong> ${ts}</p>

<h2>📏 Face Measurements</h2>
<table>
<tr><th>Measurement</th><th>Value</th></tr>
<tr><td>Face Width</td><td>${fmt(d.face_width,'mm')}</td></tr>
<tr><td>Face Length</td><td>${fmt(d.face_length,'mm')}</td></tr>
<tr><td>Forehead Width</td><td>${fmt(d.forehead_width,'mm')}</td></tr>
<tr><td>Cheekbone Width</td><td>${fmt(d.cheekbone_width,'mm')}</td></tr>
<tr><td>Jaw Width</td><td>${fmt(d.jaw_width,'mm')}</td></tr>
<tr><td>Face Shape</td><td><strong>${d.face_shape||'—'}</strong></td></tr>
</table>

<h2>👁️ Eye Measurements</h2>
<table>
<tr><th>Measurement</th><th>Value</th></tr>
<tr><td>Left Eye Width</td><td>${fmt(d.left_eye_width,'mm')}</td></tr>
<tr><td>Right Eye Width</td><td>${fmt(d.right_eye_width,'mm')}</td></tr>
<tr><td>Eye Height (avg)</td><td>${fmt(d.eye_height,'mm')}</td></tr>
<tr><td>Eye Aspect Ratio</td><td>${d.eye_aspect_ratio||'—'}</td></tr>
<tr><td>Interpupillary Distance (PD)</td><td>${fmt(d.pd,'mm')}</td></tr>
<tr><td>Eye Shape</td><td><strong>${d.eye_shape||'—'}</strong></td></tr>
</table>

<div class="rec">
<h2>👓 Frame Recommendation</h2>
<table>
<tr><th>Parameter</th><th>Recommendation</th></tr>
<tr><td>Frame Size</td><td><strong>${d.frame_size||'—'}</strong></td></tr>
<tr><td>Frame Style</td><td><strong>${d.frame_style||'—'}</strong></td></tr>
<tr><td>Lens Width</td><td>${d.lens_width||'—'}</td></tr>
<tr><td>Bridge Size</td><td>${d.bridge_size||'—'}</td></tr>
<tr><td>Temple Length</td><td>${d.temple_length||'—'}</td></tr>
<tr><td>Best Frame Color</td><td>${d.best_color||'—'}</td></tr>
</table>
<p style="margin-top:14px;color:#276749;">${FRAME_REASONS[d.face_shape]||''}</p>
</div>

<div class="footer">
  Generated by SpectAI – AI Spectacle Recommendation System<br/>
  Powered by MediaPipe · OpenCV · Flask · ESP32
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `SpectAI_Report_${d.scan_id || Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('success', '📄 Report downloaded!');
}

// ── Helpers ───────────────────────────────────────────────
function fmt(val, unit) {
  return val != null ? `${Number(val).toFixed(1)} ${unit}` : '—';
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function highlightChip(containerId, shapeName) {
  document.querySelectorAll(`#${containerId} .shape-chip`).forEach(chip => {
    chip.classList.toggle('active', chip.dataset.shape === shapeName);
  });
}

function animateBar(barId, ratio, labelId) {
  const bar = document.getElementById(barId);
  const lbl = document.getElementById(labelId);
  const pct = Math.round((ratio || 0) * 100);
  setTimeout(() => {
    if (bar) bar.style.width = pct + '%';
    if (lbl) lbl.textContent = pct + '%';
  }, 300);
}

function showToast(type, msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className   = `toast ${type}`;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}
