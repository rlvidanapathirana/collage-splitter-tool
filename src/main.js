// main.js — Collage Splitter V5 entry point
import JSZip from 'jszip';
import { detectGrid } from './detection.js';
import { cropToBlob, buildFilename } from './downloader.js';
import { saveSettings, loadSettings, clearLineSettings } from './storage.js';

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
let img = null;
let colLines = [];     // fractions (0,1) — internal vertical dividers
let rowLines = [];     // fractions (0,1) — internal horizontal dividers
let selected = new Set();
let activeHandle = null; // {type:'col'|'row', index}
let activeBlobUrls = [];
let trimEnabled = true;
let trimX = 0;
let trimY = 0;
const MIN_GAP = 0.02;

// ─────────────────────────────────────────────
//  DOM refs
// ─────────────────────────────────────────────
const canvasArea       = document.getElementById('canvasArea');
const canvasPanel      = document.getElementById('canvasPanel');
const controls         = document.getElementById('controls');
const colsInput        = document.getElementById('colsInput');
const rowsInput        = document.getElementById('rowsInput');
const applyUniformBtn  = document.getElementById('applyUniformBtn');
const autoDetectBtn    = document.getElementById('autoDetectBtn');
const detectStatus     = document.getElementById('detectStatus');
const addColBtn        = document.getElementById('addColBtn');
const addRowBtn        = document.getElementById('addRowBtn');
const newImageBtn      = document.getElementById('newImageBtn');
const tryNextBtn       = document.getElementById('tryNextBtn');
const frameCounter     = document.getElementById('frameCounter');
const fileInput        = document.getElementById('fileInput');
const enableTrimCheck  = document.getElementById('enableTrimCheck');
const trimXSlider      = document.getElementById('trimXSlider');
const trimXValue       = document.getElementById('trimXValue');
const trimYSlider      = document.getElementById('trimYSlider');
const trimYValue       = document.getElementById('trimYValue');

const framesSection    = document.getElementById('framesSection');
const framesGrid       = document.getElementById('framesGrid');
const selectAllBtn     = document.getElementById('selectAllBtn');
const clearBtn         = document.getElementById('clearBtn');
const downloadBtn      = document.getElementById('downloadBtn');
const selCountEl       = document.getElementById('selCount');
const totalCountEl     = document.getElementById('totalCount');

const modalOverlay     = document.getElementById('modalOverlay');
const modalClose       = document.getElementById('modalClose');
const modalList        = document.getElementById('modalList');
const modalHint        = document.getElementById('modalHint');
const shareAllBtn      = document.getElementById('shareAllBtn');
const zipBtn           = document.getElementById('zipBtn');

// ─────────────────────────────────────────────
//  Init — restore settings
// ─────────────────────────────────────────────
document.getElementById('year').textContent = new Date().getFullYear();

const saved = loadSettings();
colsInput.value = saved.cols;
rowsInput.value = saved.rows;
trimEnabled = saved.trimEnabled ?? true;
trimX = saved.trimX || 0;
trimY = saved.trimY || 0;

enableTrimCheck.checked = trimEnabled;
trimXSlider.value = trimX;
trimXValue.textContent = trimX + ' px';
trimYSlider.value = trimY;
trimYValue.textContent = trimY + ' px';

trimXSlider.disabled = !trimEnabled;
trimYSlider.disabled = !trimEnabled;

// ─────────────────────────────────────────────
//  Upload handling
// ─────────────────────────────────────────────
function wireDropzone(el) {
  // Label inherently triggers its child input, no JS click needed
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', e => {
    e.preventDefault(); el.classList.remove('drag');
    if (e.dataTransfer.files?.[0]) loadFile(e.dataTransfer.files[0]);
  });
}
wireDropzone(document.getElementById('dropzone'));

fileInput.addEventListener('change', e => {
  if (e.target.files?.[0]) loadFile(e.target.files[0]);
});

function loadFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const image = new Image();
    image.onload = () => setupImage(image, file.name);
    image.onerror = () => alert("Could not load image. Please ensure it is a valid JPG/PNG/WEBP file.");
    image.src = ev.target.result;
  };
  reader.onerror = () => alert("Failed to read the file from your device.");
  reader.readAsDataURL(file);
}

// ─────────────────────────────────────────────
//  "Try next image" — reopen picker without resetting state
// ─────────────────────────────────────────────
tryNextBtn.addEventListener('click', () => {
  fileInput.value = '';
  fileInput.click();
});

// ─────────────────────────────────────────────
//  Setup image
// ─────────────────────────────────────────────
function setupImage(image, name) {
  img = image;
  selected.clear();
  activeHandle = null;

  // Inject canvas into dedicated panel (NOT canvasArea — dropzone lives there)
  canvasPanel.innerHTML = `
    <div class="canvas-panel">
      <div class="sprocket-row" id="sprocketTop"></div>
      <div class="board-grid">
        <div class="corner"></div>
        <div class="ruler-top" id="rulerTop"></div>
        <div class="ruler-left" id="rulerLeft"></div>
        <div class="board-view" id="boardView"><canvas id="board"></canvas></div>
      </div>
      <div class="sprocket-row" id="sprocketBottom"></div>
    </div>`;

  // Hide the dropzone, show the canvas panel
  document.getElementById('dropzone').style.display = 'none';
  canvasPanel.style.display = 'block';

  buildSprockets();
  controls.style.display = 'flex';
  framesSection.style.display = 'block';
  tryNextBtn.style.display = 'flex';
  frameCounter.textContent = `${img.naturalWidth}×${img.naturalHeight}px — ${name}`;


  // Restore saved lines or set uniform grid
  const st = loadSettings();
  if (st.colLines && st.rowLines) {
    colLines = st.colLines;
    rowLines = st.rowLines;
    colsInput.value = colLines.length + 1;
    rowsInput.value = rowLines.length + 1;
  } else {
    const c = clamp(parseInt(colsInput.value) || 3, 1, 12);
    const r = clamp(parseInt(rowsInput.value) || 3, 1, 12);
    setUniformGrid(c, r);
  }

  const canvasEl2 = document.getElementById('board');
  canvasEl2.width  = img.naturalWidth;
  canvasEl2.height = img.naturalHeight;

  // Fix canvas aspect ratio so the board-view matches the real image proportions
  const boardViewEl = document.getElementById('boardView');
  boardViewEl.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;

  const rulerTop = document.getElementById('rulerTop');
  const rulerLeft = document.getElementById('rulerLeft');

  rulerTop.addEventListener('pointerdown', onRulerPointerDown('col'));
  rulerLeft.addEventListener('pointerdown', onRulerPointerDown('row'));

  detectStatus.textContent = '';
  render();
}

function buildSprockets() {
  ['sprocketTop', 'sprocketBottom'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = '';
    for (let i = 0; i < 26; i++) el.appendChild(document.createElement('span'));
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─────────────────────────────────────────────
//  Grid model
// ─────────────────────────────────────────────
function setUniformGrid(c, r) {
  colLines = []; for (let i = 1; i < c; i++) colLines.push(i / c);
  rowLines = []; for (let i = 1; i < r; i++) rowLines.push(i / r);
  selected.clear();
}
function boundariesX() { return [0, ...colLines, 1]; }
function boundariesY() { return [0, ...rowLines, 1]; }

// ─────────────────────────────────────────────
//  Render: canvas + rulers + frame thumbs
// ─────────────────────────────────────────────
function render() {
  if (!img) return;
  const canvas = document.getElementById('board');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  drawCanvas(canvas, ctx);
  renderHandles();
  regenerateFrames();
  persistLines();
}

function drawCanvas(canvas, ctx) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  const lw = Math.max(1, canvas.width / 900);

  // Divider lines — teal dashed
  ctx.strokeStyle = 'rgba(0,229,204,0.6)';
  ctx.lineWidth = lw;
  ctx.setLineDash([canvas.width / 180, canvas.width / 180]);
  colLines.forEach(f => {
    const x = f * canvas.width;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  });
  rowLines.forEach(f => {
    const y = f * canvas.height;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  });
  ctx.setLineDash([]);

  // ── Trim inset overlay ───────────────────────────────────────
  // Show exactly what will be cropped (dark semi-transparent strip + bright border)
  if (trimEnabled && (trimX > 0 || trimY > 0)) {
    const bx = boundariesX(), by = boundariesY();
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    for (let r = 0; r < by.length - 1; r++) {
      for (let c = 0; c < bx.length - 1; c++) {
        const sx = bx[c]  * canvas.width,  sy = by[r]  * canvas.height;
        const sw = (bx[c+1] - bx[c]) * canvas.width;
        const sh = (by[r+1] - by[r]) * canvas.height;
        // top strip
        if (trimY > 0) ctx.fillRect(sx, sy, sw, trimY);
        // bottom strip
        if (trimY > 0) ctx.fillRect(sx, sy + sh - trimY, sw, trimY);
        // left strip
        if (trimX > 0) ctx.fillRect(sx, sy, trimX, sh);
        // right strip
        if (trimX > 0) ctx.fillRect(sx + sw - trimX, sy, trimX, sh);
      }
    }
    // bright crop boundary line
    ctx.strokeStyle = 'rgba(255,210,70,0.95)';
    ctx.lineWidth = Math.max(1.5, lw * 1.5);
    ctx.setLineDash([canvas.width / 120, canvas.width / 240]);
    for (let r = 0; r < by.length - 1; r++) {
      for (let c = 0; c < bx.length - 1; c++) {
        const sx = bx[c]  * canvas.width  + trimX;
        const sy = by[r]  * canvas.height + trimY;
        const sw = (bx[c+1] - bx[c]) * canvas.width  - trimX * 2;
        const sh = (by[r+1] - by[r]) * canvas.height - trimY * 2;
        if (sw > 0 && sh > 0) ctx.strokeRect(sx, sy, sw, sh);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Outer border
  ctx.strokeStyle = 'rgba(255,210,70,0.85)';
  ctx.lineWidth = Math.max(2, canvas.width / 450);
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
}

function renderHandles() {
  const rulerTop  = document.getElementById('rulerTop');
  const rulerLeft = document.getElementById('rulerLeft');
  if (!rulerTop || !rulerLeft) return;

  rulerTop.querySelectorAll('.handle, .remove-tip').forEach(n => n.remove());
  rulerLeft.querySelectorAll('.handle, .remove-tip').forEach(n => n.remove());

  colLines.forEach((f, i) => {
    const h = makeHandle('col', f, i);
    rulerTop.appendChild(h);
  });
  rowLines.forEach((f, i) => {
    const h = makeHandle('row', f, i);
    rulerLeft.appendChild(h);
  });

  if (activeHandle) {
    const tip = document.createElement('div');
    tip.className = 'remove-tip';
    tip.textContent = '✕ Remove';
    if (activeHandle.type === 'col') {
      const f = colLines[activeHandle.index];
      tip.style.left = (f * 100) + '%';
      tip.style.top = '-28px';
      tip.style.transform = 'translateX(-50%)';
      tip.addEventListener('click', e => { e.stopPropagation(); removeLine('col', activeHandle.index); });
      rulerTop.appendChild(tip);
    } else {
      const f = rowLines[activeHandle.index];
      tip.style.top = (f * 100) + '%';
      tip.style.left = '26px';
      tip.style.transform = 'translateY(-50%)';
      tip.addEventListener('click', e => { e.stopPropagation(); removeLine('row', activeHandle.index); });
      rulerLeft.appendChild(tip);
    }
  }
}

function makeHandle(type, f, i) {
  const h = document.createElement('button');
  h.type = 'button';
  h.className = 'handle' + (activeHandle?.type === type && activeHandle?.index === i ? ' active' : '');
  if (type === 'col') h.style.left = (f * 100) + '%';
  else h.style.top = (f * 100) + '%';
  h.innerHTML = '<span class="grip"></span>';
  h.addEventListener('pointerdown', e => startDrag(e, type, i));
  h.addEventListener('click', e => onHandleTap(e, type, i));
  return h;
}

function onHandleTap(e, type, index) {
  e.stopPropagation();
  activeHandle = (activeHandle?.type === type && activeHandle?.index === index) ? null : { type, index };
  renderHandles();
}

function removeLine(type, index) {
  if (type === 'col') colLines.splice(index, 1); else rowLines.splice(index, 1);
  activeHandle = null;
  selected.clear();
  render();
}

// ─────────────────────────────────────────────
//  Drag handles
// ─────────────────────────────────────────────
function startDrag(e, type, index) {
  e.preventDefault(); e.stopPropagation();
  activeHandle = { type, index };
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);
  const ruler = type === 'col' ? document.getElementById('rulerTop') : document.getElementById('rulerLeft');
  const rulerRect = ruler.getBoundingClientRect();
  let moved = false;

  function onMove(ev) {
    moved = true;
    const arr = type === 'col' ? colLines : rowLines;
    let frac = type === 'col'
      ? (ev.clientX - rulerRect.left) / rulerRect.width
      : (ev.clientY - rulerRect.top) / rulerRect.height;
    const lower = index === 0 ? 0 : arr[index - 1];
    const upper = index === arr.length - 1 ? 1 : arr[index + 1];
    frac = clamp(frac, lower + MIN_GAP, upper - MIN_GAP);
    arr[index] = frac;
    const canvas = document.getElementById('board');
    drawCanvas(canvas, canvas.getContext('2d'));
    // update just this handle position during drag
    const handles = ruler.querySelectorAll('.handle');
    if (handles[index]) {
      if (type === 'col') handles[index].style.left = (frac * 100) + '%';
      else handles[index].style.top = (frac * 100) + '%';
    }
  }
  function onUp() {
    target.releasePointerCapture(e.pointerId);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    if (moved) { selected.clear(); render(); }
  }
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
}

function onRulerPointerDown(type) {
  return function (e) {
    if (e.target.closest('.handle') || e.target.closest('.remove-tip')) return;
    const rect = this.getBoundingClientRect();
    const frac = type === 'col'
      ? (e.clientX - rect.left) / rect.width
      : (e.clientY - rect.top) / rect.height;
    addLineAt(type, clamp(frac, 0.01, 0.99));
  };
}

function addLineAt(type, frac) {
  const arr = type === 'col' ? colLines : rowLines;
  const all = [0, ...arr, 1];
  for (const v of all) { if (Math.abs(v - frac) < MIN_GAP) return; }
  arr.push(frac); arr.sort((a, b) => a - b);
  activeHandle = null; selected.clear(); render();
}

function addLineAtLargestGap(type) {
  const arr = type === 'col' ? colLines : rowLines;
  const all = [0, ...arr, 1];
  let bestGap = -1, bestMid = 0.5;
  for (let i = 0; i < all.length - 1; i++) {
    const gap = all[i + 1] - all[i];
    if (gap > bestGap) { bestGap = gap; bestMid = (all[i] + all[i + 1]) / 2; }
  }
  if (bestGap > MIN_GAP * 2.5) { arr.push(bestMid); arr.sort((a, b) => a - b); selected.clear(); render(); }
}

addColBtn.addEventListener('click', () => addLineAtLargestGap('col'));
addRowBtn.addEventListener('click', () => addLineAtLargestGap('row'));

// ─────────────────────────────────────────────
//  Frame thumbnail grid
// ─────────────────────────────────────────────
function regenerateFrames() {
  if (!img) return;
  const bx = boundariesX(), by = boundariesY();
  framesGrid.innerHTML = '';
  const THUMB = 240;

  for (let r = 0; r < by.length - 1; r++) {
    for (let c = 0; c < bx.length - 1; c++) {
      const key = `${r}_${c}`;
      const sx = bx[c] * img.naturalWidth, sy = by[r] * img.naturalHeight;
      const sw = (bx[c + 1] - bx[c]) * img.naturalWidth, sh = (by[r + 1] - by[r]) * img.naturalHeight;

      // Apply trim inset for thumbnail preview
      const tx = trimEnabled ? Math.max(0, trimX) : 0;
      const ty = trimEnabled ? Math.max(0, trimY) : 0;
      const cx = sx + tx, cy = sy + ty;
      const cw = Math.max(1, sw - tx * 2), ch = Math.max(1, sh - ty * 2);

      // Render thumbnail at correct aspect ratio (not forced square)
      const ratio = cw / ch;
      const tmp = document.createElement('canvas');
      tmp.width  = ratio >= 1 ? THUMB : Math.max(1, Math.round(THUMB * ratio));
      tmp.height = ratio >= 1 ? Math.max(1, Math.round(THUMB / ratio)) : THUMB;
      tmp.getContext('2d').drawImage(img, cx, cy, cw, ch, 0, 0, tmp.width, tmp.height);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'frame-thumb' + (selected.has(key) ? ' selected' : '');
      btn.dataset.key = key;
      // Set the natural aspect ratio inline so grid cells match the actual crop shape
      btn.style.aspectRatio = `${Math.round(cw)} / ${Math.round(ch)}`;
      btn.innerHTML = `<img src="${tmp.toDataURL('image/jpeg', 0.85)}" alt="frame ${r + 1},${c + 1}">
        <span class="tick"></span>
        <span class="idx">R${r + 1}·C${c + 1}</span>`;
      btn.addEventListener('click', () => toggleFrame(key, btn));
      framesGrid.appendChild(btn);
    }
  }
  updateSummary();
}


function toggleFrame(key, btn) {
  if (selected.has(key)) { selected.delete(key); btn.classList.remove('selected'); }
  else { selected.add(key); btn.classList.add('selected'); }
  updateSummary();
}

function updateSummary() {
  const total = (boundariesX().length - 1) * (boundariesY().length - 1);
  selCountEl.textContent = selected.size;
  totalCountEl.textContent = total;
  downloadBtn.disabled = selected.size === 0;
}

// ─────────────────────────────────────────────
//  Uniform grid — live preview on stepper change
// ─────────────────────────────────────────────
function applyUniformPreview() {
  if (!img) return;
  const c = clamp(parseInt(colsInput.value) || 1, 1, 12);
  const r = clamp(parseInt(rowsInput.value) || 1, 1, 12);
  colsInput.value = c; rowsInput.value = r;
  activeHandle = null;
  setUniformGrid(c, r);
  detectStatus.textContent = '';
  saveSettings({ cols: c, rows: r });
  persistLines();
  render();
}

document.querySelectorAll('[data-adj]').forEach(btn => {
  btn.addEventListener('click', () => {
    const which = btn.dataset.adj, dir = parseInt(btn.dataset.dir);
    if (which === 'cols') colsInput.value = clamp((parseInt(colsInput.value) || 1) + dir, 1, 12);
    else rowsInput.value = clamp((parseInt(rowsInput.value) || 1) + dir, 1, 12);
    // Live preview — immediately show the grid on canvas
    applyUniformPreview();
  });
});

// Also update live when user types directly in the input
colsInput.addEventListener('change', applyUniformPreview);
rowsInput.addEventListener('change', applyUniformPreview);

applyUniformBtn.addEventListener('click', () => {
  if (!img) return;
  applyUniformPreview();
});



selectAllBtn.addEventListener('click', () => {
  selected.clear();
  const cCount = boundariesX().length - 1, rCount = boundariesY().length - 1;
  for (let r = 0; r < rCount; r++) for (let c = 0; c < cCount; c++) selected.add(`${r}_${c}`);
  framesGrid.querySelectorAll('.frame-thumb').forEach(b => b.classList.add('selected'));
  updateSummary();
});

clearBtn.addEventListener('click', () => {
  selected.clear();
  framesGrid.querySelectorAll('.frame-thumb').forEach(b => b.classList.remove('selected'));
  updateSummary();
});

newImageBtn.addEventListener('click', () => {
  img = null; selected.clear(); activeHandle = null;
  controls.style.display = 'none';
  framesSection.style.display = 'none';
  tryNextBtn.style.display = 'none';
  framesGrid.innerHTML = '';
  fileInput.value = '';
  clearLineSettings();
  // Show dropzone, hide canvas panel
  document.getElementById('dropzone').style.display = '';
  canvasPanel.style.display = 'none';
  canvasPanel.innerHTML = '';
  frameCounter.textContent = 'NO IMAGE LOADED';
  detectStatus.textContent = '';
});

// ─────────────────────────────────────────────
//  Trim border sliders
// ─────────────────────────────────────────────
enableTrimCheck.addEventListener('change', e => {
  trimEnabled = e.target.checked;
  trimXSlider.disabled = !trimEnabled;
  trimYSlider.disabled = !trimEnabled;
  saveSettings({ trimEnabled });
  if (img) render();
});

trimXSlider.addEventListener('input', () => {
  trimX = parseInt(trimXSlider.value) || 0;
  trimXValue.textContent = trimX + ' px';
  saveSettings({ trimX });
  if (img) render(); // full render = canvas overlay + frame thumbs
});

trimYSlider.addEventListener('input', () => {
  trimY = parseInt(trimYSlider.value) || 0;
  trimYValue.textContent = trimY + ' px';
  saveSettings({ trimY });
  if (img) render();
});


// ─────────────────────────────────────────────
//  Auto-detect
// ─────────────────────────────────────────────
autoDetectBtn.addEventListener('click', () => {
  if (!img) return;
  detectStatus.textContent = '';
  detectStatus.className = 'status scanning';
  autoDetectBtn.disabled = true;
  autoDetectBtn.textContent = 'Scanning…';

  setTimeout(() => {
    const result = detectGrid(img);
    colLines = result.colLines;
    rowLines = result.rowLines;
    colsInput.value = colLines.length + 1;
    rowsInput.value = rowLines.length + 1;
    selected.clear();
    activeHandle = null;

    // Auto-set trim slider from detected seam width/height
    if (result.seamWidthPx > 0) {
      trimX = Math.min(Math.round(result.seamWidthPx / 2), 80);
      trimXSlider.value = trimX;
      trimXValue.textContent = trimX + ' px';
    } else trimX = 0;

    if (result.seamHeightPx > 0) {
      trimY = Math.min(Math.round(result.seamHeightPx / 2), 80);
      trimYSlider.value = trimY;
      trimYValue.textContent = trimY + ' px';
    } else trimY = 0;

    if (result.seamWidthPx > 0 || result.seamHeightPx > 0) {
      saveSettings({ trimX, trimY, trimEnabled });
    }

    render();
    saveSettings({ cols: colLines.length + 1, rows: rowLines.length + 1 });

    const confLabel = { high: '✦ High confidence', medium: '◈ Medium confidence', low: '◇ Low confidence — please fine-tune' };
    const confClass = { high: 'conf-high', medium: 'conf-medium', low: 'conf-low' };
    const grid = `${colLines.length + 1}×${rowLines.length + 1}`;
    const seamInfo = (result.seamWidthPx > 0 || result.seamHeightPx > 0)
      ? ` · seam X:${result.seamWidthPx} Y:${result.seamHeightPx}` : '';
    detectStatus.textContent = `${confLabel[result.confidence]} · ${grid}${seamInfo}`;
    detectStatus.className = 'status ' + confClass[result.confidence];

    autoDetectBtn.disabled = false;
    autoDetectBtn.textContent = '⊹ Auto-detect grid';
  }, 30);
});

// ─────────────────────────────────────────────
//  Persist line positions to localStorage
// ─────────────────────────────────────────────
function persistLines() {
  saveSettings({ colLines: [...colLines], rowLines: [...rowLines] });
}

// ─────────────────────────────────────────────
//  Download / save modal
// ─────────────────────────────────────────────
function clearModalUrls() {
  activeBlobUrls.forEach(u => URL.revokeObjectURL(u));
  activeBlobUrls = [];
}

downloadBtn.addEventListener('click', async () => {
  if (!img || selected.size === 0) return;
  const keys = Array.from(selected);
  downloadBtn.disabled = true;
  const originalLabel = downloadBtn.innerHTML;
  downloadBtn.innerHTML = '<span class="spinner"></span> Preparing…';

  clearModalUrls();
  modalList.innerHTML = '';

  const bx = boundariesX(), by = boundariesY();
  const items = [];
  for (const key of keys) {
    const [r, c] = key.split('_').map(Number);
    const sx = bx[c] * img.naturalWidth, sy = by[r] * img.naturalHeight;
    const sw = (bx[c + 1] - bx[c]) * img.naturalWidth, sh = (by[r + 1] - by[r]) * img.naturalHeight;
    const blob = await cropToBlob(img, sx, sy, sw, sh, trimEnabled ? trimX : 0, trimEnabled ? trimY : 0);
    const filename = buildFilename(r, c);
    items.push({ r, c, blob, filename });
  }

  // 1) Build blob URLs and modal preview rows
  const rowUrls = [];
  items.forEach(item => {
    const url = URL.createObjectURL(item.blob);
    activeBlobUrls.push(url);
    rowUrls.push(url);

    const row = document.createElement('a');
    row.className = 'modal-row';
    row.href = url;
    row.download = item.filename;
    row.innerHTML = `
      <img src="${url}" alt="">
      <span class="meta">
        <span class="fname">${item.filename}</span>
        <span class="save-hint">tap to save</span>
      </span>
      <span class="save-icon">↓</span>`;
    row.addEventListener('click', () => {
      row.classList.add('saved');
      row.querySelector('.save-hint').textContent = '✓ saved';
    });
    modalList.appendChild(row);
  });

  // 2) Sequential direct download with delay (prevents browser popup blocker)
  const delay = ms => new Promise(res => setTimeout(res, ms));
  for (let i = 0; i < items.length; i++) {
    const a = document.createElement('a');
    a.href = rowUrls[i];
    a.download = items[i].filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (items.length > 1) await delay(400);
  }

  // 3) Optional ZIP
  zipBtn.style.display = items.length > 1 ? 'flex' : 'none';
  zipBtn.onclick = async () => {
    zipBtn.innerHTML = '<span class="spinner"></span> Zipping...';
    try {
      const zip = new JSZip();
      items.forEach(item => zip.file(item.filename, item.blob));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = zipUrl;
      const now = new Date();
      a.download = `collage_frames_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(zipUrl), 5000);
    } catch (e) {
      console.error('ZIP failed', e);
    }
    zipBtn.innerHTML = '📦 Download as .ZIP (Optional)';
  };

  modalHint.textContent = items.length > 1
    ? 'Downloading images... If your browser blocks them, use the optional ZIP download below.'
    : 'Frame downloaded successfully! You can also share it below.';

  shareAllBtn.style.display = 'none';
  if (navigator.canShare && navigator.share) {
    try {
      const files = items.map(it => new File([it.blob], it.filename, { type: 'image/png' }));
      if (navigator.canShare({ files })) {
        shareAllBtn.style.display = 'flex';
        shareAllBtn.textContent = '⬆ Share / Save to Photos';
        shareAllBtn.onclick = async () => {
          try { await navigator.share({ files, title: 'Collage frames' }); } catch (_) {}
        };
      }
    } catch (_) {}
  }

  downloadBtn.innerHTML = originalLabel;
  downloadBtn.disabled = selected.size === 0;
  modalOverlay.classList.add('open');
});

modalClose.addEventListener('click', () => modalOverlay.classList.remove('open'));
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.remove('open'); });
