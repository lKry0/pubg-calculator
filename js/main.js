'use strict';

// ── MAP PRESETS ───────────────────────────────────────────────────────────────
const MAP_PRESETS = {
  erangel: { name: 'Erangel', size: 8000, file: 'maps/erangel.webp' },
  miramar: { name: 'Miramar', size: 8000, file: 'maps/miramar.webp' },
  vikendi: { name: 'Vikendi', size: 6000, file: 'maps/vikendi.webp' },
  rondo:   { name: 'Rondo',   size: 8000, file: 'maps/rondo.webp'   },
  taego:   { name: 'Taego',   size: 8000, file: 'maps/taego.webp'   },
  deston:  { name: 'Deston',  size: 8000, file: 'maps/deston.webp'  },
  sanhok:  { name: 'Sanhok',  size: 4000, file: 'maps/sanhok.webp'  },
};

const RADIUS_LIMIT = 700;

// ══════════════════════════════════════════════════════════════════════════════
// НАСТРОЙКА ТОЧЕК
// ══════════════════════════════════════════════════════════════════════════════
const POINT_CONFIG = {
  A: { icon: 'circle',    color: '#4aaeffbb', size: 11 },
  B: { icon: 'crosshair', color: '#ffffff', size: 10 },
};

// Радиус захвата для перемещения уже поставленной точки (в метрах карты)
const SNAP_RADIUS_M = 127;

// ── APP ───────────────────────────────────────────────────────────────────────
const app = (() => {
  const canvas  = document.getElementById('map-canvas');
  const ctx     = canvas.getContext('2d');
  const overlay = document.getElementById('loading-overlay');

  let currentKey = 'erangel';
  let mapImage   = null;
  let mapSize    = 8000;
  let pointA     = null;
  let pointB     = null;
  let mode       = 'A';
  let zoomLevel  = 1;
  let offsetX    = 0;
  let offsetY    = 0;
  let isDragging = false;
  let dragStart  = null;
  let dragOffset = null;

  const imageCache = {};

  // ── INIT ──────────────────────────────────────────────────────────────────
  function init() {
    resize();
    window.addEventListener('resize', () => { resize(); draw(); });

    canvas.addEventListener('mousedown',  onMouseDown);
    canvas.addEventListener('mousemove',  onMouseMove);
    canvas.addEventListener('mouseup',    onMouseUp);
    canvas.addEventListener('mouseleave', () => { isDragging = false; dragStart = null; });
    canvas.addEventListener('wheel',      onWheel, { passive: false });

    document.getElementById('map-select').addEventListener('click', e => {
      const option = e.target.closest('.map-option');
      if (!option) return;
      loadMap(option.dataset.value);
    });

    loadMap('erangel');
  }

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  // ── MAP LOADING ───────────────────────────────────────────────────────────
  function loadMap(key) {
    const preset = MAP_PRESETS[key];
    if (!preset) return;

    currentKey = key;
    mapSize    = preset.size;
    mapImage   = null;
    pointA     = null;
    pointB     = null;
    setMode('A');
    updateInfo();
    updateSizeDisplay();
    resetView();
    draw();

    overlay.classList.add('visible');

    if (imageCache[key]) {
      mapImage = imageCache[key];
      overlay.classList.remove('visible');
      draw();
      return;
    }

    const img    = new Image();
    img.onload   = () => {
      imageCache[key] = img;
      mapImage = img;
      overlay.classList.remove('visible');
      draw();
    };
    img.onerror  = () => {
      overlay.classList.remove('visible');
      draw();
      drawError(preset.name, preset.file);
    };
    img.src = preset.file;
  }

  function updateSizeDisplay() {
    const km = MAP_PRESETS[currentKey].size / 1000;
    document.getElementById('map-size-display').textContent = `${km} × ${km} км`;
  }

  // ── COORDINATE TRANSFORMS ─────────────────────────────────────────────────
  function baseScale() {
    return Math.min(canvas.width, canvas.height) / mapSize;
  }

  function toCanvas(mx, my) {
    const s = baseScale() * zoomLevel;
    return [mx * s + offsetX, my * s + offsetY];
  }

  function toMap(cx, cy) {
    const s = baseScale() * zoomLevel;
    return [(cx - offsetX) / s, (cy - offsetY) / s];
  }

  function mapPx(meters) {
    return meters * baseScale() * zoomLevel;
  }

  function dist(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
  }

  // ── TOUCH / MOUSE HELPERS ─────────────────────────────────────────────────
  function canvasPos(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  }

  function getPos(e) {
    if (e.touches && e.touches.length)
      return canvasPos(e.touches[0].clientX, e.touches[0].clientY);
    return canvasPos(e.clientX, e.clientY);
  }

  // ── TOUCH EVENTS ──────────────────────────────────────────────────────────
  let pinchStartDist   = null;
  let pinchStartZoom   = null;
  let pinchStartOffset = null;
  let pinchMidStart    = null;
  let touchMoved       = false;

  function touchDist(t) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function touchMid(t) {
    const r = canvas.getBoundingClientRect();
    return [
      (t[0].clientX + t[1].clientX) / 2 - r.left,
      (t[0].clientY + t[1].clientY) / 2 - r.top,
    ];
  }

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    if (!mapImage) return;
    touchMoved = false;

    if (e.touches.length === 1) {
      isDragging       = false;
      dragStart        = getPos(e);
      dragOffset       = [offsetX, offsetY];
      pinchStartDist   = null;
    } else if (e.touches.length === 2) {
      pinchStartDist   = touchDist(e.touches);
      pinchStartZoom   = zoomLevel;
      pinchMidStart    = touchMid(e.touches);
      pinchStartOffset = [offsetX, offsetY];
      dragStart        = null;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!mapImage) return;

    if (e.touches.length === 2 && pinchStartDist !== null) {
      touchMoved = true;

      const currentDist = touchDist(e.touches);
      const scale       = currentDist / pinchStartDist;
      const newZoom     = Math.max(0.8, Math.min(16, pinchStartZoom * scale));
      const mid         = touchMid(e.touches);

      // FIX (Bug 3): anchor the midpoint correctly using pinchStartOffset
      offsetX   = pinchStartOffset[0] + (mid[0] - pinchMidStart[0]) - (pinchMidStart[0] - pinchStartOffset[0]) * (newZoom / pinchStartZoom - 1);
      offsetY   = pinchStartOffset[1] + (mid[1] - pinchMidStart[1]) - (pinchMidStart[1] - pinchStartOffset[1]) * (newZoom / pinchStartZoom - 1);
      zoomLevel = newZoom;
      updateZoomDisplay();
      draw();

    } else if (e.touches.length === 1 && dragStart) {
      const [x, y] = getPos(e);
      const dx = x - dragStart[0], dy = y - dragStart[1];
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        touchMoved = true;
        isDragging = true;
        offsetX    = dragOffset[0] + dx;
        offsetY    = dragOffset[1] + dy;
        draw();
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    if (!mapImage) return;

    if (e.touches.length < 2) pinchStartDist = null;

    if (e.changedTouches.length === 1 && !touchMoved && !isDragging && pinchStartDist === null) {
      const r  = canvas.getBoundingClientRect();
      const cx = e.changedTouches[0].clientX - r.left;
      const cy = e.changedTouches[0].clientY - r.top;
      placeOrMovePoint(...toMap(cx, cy));
    }

    isDragging = false;
    dragStart  = null;
    touchMoved = false;
  }, { passive: false });

  // ── MOUSE EVENTS ──────────────────────────────────────────────────────────
  function onMouseDown(e) {
    if (!mapImage) return;
    isDragging = false;
    dragStart  = getPos(e);
    dragOffset = [offsetX, offsetY];
  }

  function onMouseMove(e) {
    if (!mapImage || !dragStart) return;
    const [x, y] = getPos(e);
    const dx = x - dragStart[0], dy = y - dragStart[1];
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      isDragging = true;
      offsetX    = dragOffset[0] + dx;
      offsetY    = dragOffset[1] + dy;
      draw();
    }
  }

  function onMouseUp(e) {
    if (!mapImage) return;
    if (!isDragging) {
      placeOrMovePoint(...toMap(...getPos(e)));
    }
    isDragging = false;
    dragStart  = null;
  }

  function onWheel(e) {
    if (!mapImage) return;
    e.preventDefault();
    const [cx, cy] = getPos(e);
    const factor   = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const newZoom  = Math.max(0.8, Math.min(16, zoomLevel * factor));
    if (newZoom === zoomLevel) return;
    offsetX   = cx - (cx - offsetX) * (newZoom / zoomLevel);
    offsetY   = cy - (cy - offsetY) * (newZoom / zoomLevel);
    zoomLevel = newZoom;
    // FIX (Bug 1): no longer tries to reassign const POINT_CONFIG.
    // Crosshair size at high zoom is handled inside drawCrosshair() via
    // the effectiveSize local variable.
    updateZoomDisplay();
    draw();
  }

  // ── PLACE / MOVE POINT ────────────────────────────────────────────────────
  function placeOrMovePoint(mx, my) {
    if (mx < 0 || mx > mapSize || my < 0 || my > mapSize) return;

    const nearA = pointA && dist([mx, my], pointA) <= SNAP_RADIUS_M;
    const nearB = pointB && dist([mx, my], pointB) <= SNAP_RADIUS_M;

    if (nearA && nearB) {
      if (dist([mx, my], pointA) <= dist([mx, my], pointB)) pointA = [mx, my];
      else                                                    pointB = [mx, my];
    } else if (nearA) {
      pointA = [mx, my];
    } else if (nearB) {
      pointB = [mx, my];
    } else {
      if (mode === 'A') { pointA = [mx, my]; setMode('B'); }
      else              { pointB = [mx, my]; setMode('A'); }
    }

    updateInfo();
    draw();
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────
  function setMode(m) {
    mode = m;
    document.getElementById('hint-mode').textContent = m;
    document.getElementById('btn-a').className = 'mode-btn' + (m === 'A' ? ' active-a' : '');
    document.getElementById('btn-b').className = 'mode-btn' + (m === 'B' ? ' active-b' : '');
  }

  function reset() {
    pointA = null; pointB = null;
    setMode('A');
    updateInfo();
    draw();
  }

  function zoom(factor) {
    const newZoom = Math.max(0.8, Math.min(16, zoomLevel * factor));
    if (newZoom === zoomLevel) return;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    offsetX   = cx - (cx - offsetX) * (newZoom / zoomLevel);
    offsetY   = cy - (cy - offsetY) * (newZoom / zoomLevel);
    zoomLevel = newZoom;
    updateZoomDisplay();
    draw();
  }

  function resetZoom() { resetView(); draw(); }

  function resetView() {
    zoomLevel = 1;
    const s   = baseScale();
    offsetX   = (canvas.width  - mapSize * s) / 2;
    offsetY   = (canvas.height - mapSize * s) / 2;
    updateZoomDisplay();
  }

  function updateZoomDisplay() {
    document.getElementById('zoom-level').textContent = `×${zoomLevel.toFixed(1)}`;
  }

  // ── UI INFO ───────────────────────────────────────────────────────────────
  function updateInfo() {
    document.getElementById('coord-a').textContent =
      pointA ? `${Math.round(pointA[0])}, ${Math.round(pointA[1])}` : 'не задана';
    document.getElementById('coord-b').textContent =
      pointB ? `${Math.round(pointB[0])}, ${Math.round(pointB[1])}` : 'не задана';

    const dv = document.getElementById('dist-value');
    const db = document.getElementById('dist-bar');
    const dw = document.getElementById('dist-warn');

    if (pointA && pointB) {
      const d    = dist(pointA, pointB);
      const over = d > RADIUS_LIMIT;
      dv.textContent   = `${Math.round(d)}м`;
      dv.style.color   = over ? '#ff6b35' : '#b4d24a';
      db.style.width   = `${Math.min(100, (d / RADIUS_LIMIT) * 100)}%`;
      db.style.background = over ? '#ff6b35' : '#4cde8a';
      dw.classList.toggle('hidden', !over);
    } else {
      dv.textContent   = '—';
      dv.style.color   = '#b4d24a';
      db.style.width   = '0%';
      dw.classList.add('hidden');
    }
  }

  // ── DRAW ──────────────────────────────────────────────────────────────────
  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0c08';
    ctx.fillRect(0, 0, W, H);

    if (mapImage) {
      drawMapImage();
      drawGrid();
    }

    if (pointA) drawRadiusCircle(pointA, RADIUS_LIMIT, 'rgba(74,173,255,0.75)', 'rgba(74,173,255,0.07)');
    if (pointA) drawRadiusCircle(pointA, 121,          'rgba(255,57,57,0.75)',  'rgba(255,74,74,0.07)');

    if (pointA && pointB) drawLine(pointA, pointB);
    if (pointA) drawPoint(pointA, POINT_CONFIG.A);
    if (pointB) drawPoint(pointB, POINT_CONFIG.B);
  }

  function drawMapImage() {
    const [x0, y0] = toCanvas(0, 0);
    const [x1, y1] = toCanvas(mapSize, mapSize);
    ctx.drawImage(mapImage, x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(180,210,80,0.4)';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  function drawGrid() {
    const totalKm = mapSize / 1000;
    const step    = 1000;

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth   = 0.5;
    ctx.setLineDash([]);

    for (let i = 0; i <= totalKm; i++) {
      const [x1, y1] = toCanvas(i * step, 0);
      const [x2, y2] = toCanvas(i * step, mapSize);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

      const [ax, ay] = toCanvas(0, i * step);
      const [bx, by] = toCanvas(mapSize, i * step);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }

    const fontSize = Math.max(9, 11 * Math.min(zoomLevel, 1.5));
    ctx.font      = `500 ${fontSize}px 'Share Tech Mono', monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.textAlign = 'left';

    for (let i = 1; i <= totalKm; i++) {
      const [cx] = toCanvas(i * step - step / 2, 8);
      const [, cy] = toCanvas(8, i * step - step / 2);
      if (cx > 20 && cx < canvas.width  - 20) ctx.fillText(`${i}km`, cx - 12, 14);
      if (cy > 20 && cy < canvas.height - 20) ctx.fillText(`${i}km`, 4, cy + 4);
    }
  }

  function drawRadiusCircle(p, radiusM, strokeColor, fillColor) {
    const [cx, cy] = toCanvas(p[0], p[1]);
    const rPx      = mapPx(radiusM);

    ctx.beginPath();
    ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawLine(a, b) {
    const [ax, ay] = toCanvas(a[0], a[1]);
    const [bx, by] = toCanvas(b[0], b[1]);
    const d        = dist(a, b);
    const over     = d > RADIUS_LIMIT;

    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.strokeStyle = over ? '#ff6b35' : '#4cde8a';
    ctx.lineWidth   = 2;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    const mx  = (ax + bx) / 2;
    const my  = (ay + by) / 2;
    const lbl = `${Math.round(d)}м`;
    const fs  = Math.max(11, 13 * Math.min(zoomLevel, 2));
    ctx.font  = `700 ${fs}px 'Share Tech Mono', monospace`;
    const tw  = ctx.measureText(lbl).width;
    const pad = 8;

    ctx.fillStyle = 'rgba(8,10,6,0.82)';
    ctx.beginPath();
    ctx.roundRect(mx - tw / 2 - pad, my - 12, tw + pad * 2, 22, 4);
    ctx.fill();

    ctx.strokeStyle = over ? 'rgba(255,107,53,0.55)' : 'rgba(76,222,138,0.55)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    ctx.fillStyle  = over ? '#ff6b35' : '#4cde8a';
    ctx.textAlign  = 'center';
    ctx.fillText(lbl, mx, my + 5);
    ctx.textAlign  = 'left';
  }

  // ── ОТРИСОВКА ТОЧЕК ───────────────────────────────────────────────────────
  function drawPoint(p, cfg) {
    const [cx, cy] = toCanvas(p[0], p[1]);
    ctx.save();

    if (cfg.icon === 'crosshair') {
      drawCrosshair(cx, cy, cfg.color, cfg.size);
    } else {
      drawCirclePoint(cx, cy, cfg.color, cfg.size, 'A');
    }

    ctx.restore();
  }

  function drawCirclePoint(cx, cy, color, r, label) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = color + '40';
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle     = '#fff';
    ctx.font          = `700 ${Math.round(r * 1.1)}px 'Rajdhani', sans-serif`;
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'middle';
    ctx.fillText(label, cx, cy + 1);
  }

  // FIX (Bug 1 + Bug 2):
  //   • effectiveSize scales the crosshair at high zoom without touching POINT_CONFIG.
  //   • Each pass (shadow then main) wraps its own ctx.save() / ctx.restore() so
  //     stroke state doesn't leak between them.
  function drawCrosshair(cx, cy, color, size) {
    // Shrink crosshair when zoomed in far so it stays precise
    const effectiveSize = zoomLevel > 10 ? Math.max(4, size * (10 / zoomLevel)) : size;
    const s   = effectiveSize;
    const gap = s * 0.28;

    // Shadow pass
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    _crosshairLines(cx, cy, s, gap);
    ctx.restore();

    // Main pass
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.lineCap     = 'round';
    _crosshairLines(cx, cy, s, gap);
    ctx.restore();

    // Centre dot
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function _crosshairLines(cx, cy, s, gap) {
    ctx.beginPath(); ctx.moveTo(cx,       cy - gap); ctx.lineTo(cx,       cy - s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx,       cy + gap); ctx.lineTo(cx,       cy + s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - gap, cy      ); ctx.lineTo(cx - s,   cy    ); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + gap, cy      ); ctx.lineTo(cx + s,   cy    ); ctx.stroke();
  }

  function drawError(name, path) {
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = 'rgba(180,50,30,0.08)';
    ctx.fillRect(0, 0, W, H);
    ctx.font      = '600 14px Rajdhani, sans-serif';
    ctx.fillStyle = 'rgba(255,100,80,0.7)';
    ctx.textAlign = 'center';
    ctx.fillText(`Не удалось загрузить карту: ${path}`, W / 2, H / 2 - 10);
    ctx.font      = '500 12px Share Tech Mono, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText(`Поместите файл ${path} рядом с index.html`, W / 2, H / 2 + 16);
    ctx.textAlign = 'left';
  }

  // ── START ─────────────────────────────────────────────────────────────────
  init();

  return { setMode, reset, zoom, resetZoom };
})();