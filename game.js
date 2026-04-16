/* ============================================================
   NEON SNAKE – game.js
   Full game engine with hurdles, power-ups, levels & audio
   ============================================================ */

// ─── Audio Engine (Web Audio API) ─────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}
function playTone(freq, type, duration, vol = 0.18, detune = 0) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = type;
    osc.detune.value = detune;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) { }
}
function sfxEat() { playTone(660, 'sine', 0.1, 0.22); playTone(880, 'sine', 0.08, 0.12, 400); }
function sfxHurdle() { playTone(200, 'sawtooth', 0.18, 0.15, -200); playTone(140, 'square', 0.14, 0.12); }
function sfxDie() {
  [280, 220, 160, 100].forEach((f, i) => setTimeout(() => playTone(f, 'sawtooth', 0.3, 0.2), i * 100));
}
function sfxPowerUp() { [440, 550, 660, 880].forEach((f, i) => setTimeout(() => playTone(f, 'sine', 0.12, 0.18), i * 60)); }
function sfxLevelUp() {
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 'triangle', 0.18, 0.22), i * 80));
}

// ─── DOM refs ─────────────────────────────────────────────────
const startScreen = document.getElementById('startScreen');
const gameScreen = document.getElementById('gameScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('highScore');
const levelBadge = document.getElementById('levelBadge');
const hurdleWarning = document.getElementById('hurdleWarning');
const powerupBar = document.getElementById('powerupBar');
const finalScore = document.getElementById('finalScore');
const finalHigh = document.getElementById('finalHigh');
const finalLevel = document.getElementById('finalLevel');
const finalLength = document.getElementById('finalLength');
const deathReason = document.getElementById('deathReason');
const startBtn = document.getElementById('startBtn');
const replayBtn = document.getElementById('replayBtn');
const menuBtn = document.getElementById('menuBtn');

// ─── Constants ────────────────────────────────────────────────
const CELL = 20;         // px per grid cell
const TICK_BASE = 130;        // ms per frame at level 1
const TICK_MIN = 55;         // fastest possible
const SCORE_PER_FOOD = 10;
const MAX_HURDLES = 18;

// Power-up types
const POWERUPS = {
  SHIELD: { label: '🛡 SHIELD', color: '#00e5ff', border: 'rgba(0,229,255,.5)', duration: 7000 },
  SLOW: { label: '🐢 SLOW MO', color: '#00ff88', border: 'rgba(0,255,136,.5)', duration: 5000 },
  SHRINK: { label: '✂ SHRINK', color: '#ffea00', border: 'rgba(255,234,0,.5)', duration: 0 },
  MAGNET: { label: '🧲 MAGNET', color: '#bf5fff', border: 'rgba(191,95,255,.5)', duration: 6000 },
  DOUBLE: { label: '✖2 DOUBLE', color: '#ff6a00', border: 'rgba(255,106,0,.5)', duration: 5000 },
};

// Hurdle shapes (relative cells)
const HURDLE_SHAPES = [
  // L-shape
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  // T-shape
  [[0, 0], [1, 0], [2, 0], [1, 1]],
  // Line 3
  [[0, 0], [0, 1], [0, 2]],
  // Dot cluster
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  // Z-shape
  [[0, 0], [1, 0], [1, 1], [2, 1]],
  // Cross
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  // S-shape
  [[1, 0], [2, 0], [0, 1], [1, 1]],
  // Long line 4
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  // Corner
  [[0, 0], [0, 1], [1, 1], [1, 2]],
  // Single dot
  [[0, 0]],
];

// ─── Game State ───────────────────────────────────────────────
let snake, dir, nextDir, food, hurdles, obstacles, score, highScore,
  level, speed, tickMs, lastTick, animId, gameRunning,
  activePowerups, foodCount, hurdleTimer, warnTimer,
  warnTimeout, magnetActive, doubleActive, shieldActive, slowActive;

function initState() {
  const cols = Math.floor(canvas.width / CELL);
  const rows = Math.floor(canvas.height / CELL);
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  snake = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
  dir = { x: 1, y: 0 };
  nextDir = { x: 1, y: 0 };
  food = null;
  hurdles = [];   // timed hurdles (disappear eventually)
  obstacles = [];   // permanent blocks
  score = 0;
  level = 1;
  tickMs = TICK_BASE;
  lastTick = performance.now();
  gameRunning = true;
  activePowerups = {};
  foodCount = 0;
  magnetActive = false;
  doubleActive = false;
  shieldActive = false;
  slowActive = false;

  clearHurdleWarning();
  powerupBar.innerHTML = '';
  updateHUD();
  placeFood();
}

// ─── Canvas sizing ────────────────────────────────────────────
function resizeCanvas() {
  const maxW = Math.min(window.innerWidth - 20, 700);
  const maxH = Math.min(window.innerHeight - 120, 600);
  canvas.width = Math.floor(maxW / CELL) * CELL;
  canvas.height = Math.floor(maxH / CELL) * CELL;
}

// ─── Grid helpers ─────────────────────────────────────────────
function cols() { return canvas.width / CELL; }
function rows() { return canvas.height / CELL; }

function rnd(n) { return Math.floor(Math.random() * n); }

function isFree(x, y, excludeSnake = true) {
  if (x < 0 || y < 0 || x >= cols() || y >= rows()) return false;
  if (excludeSnake && snake.some(s => s.x === x && s.y === y)) return false;
  if (hurdles.some(h => h.x === x && h.y === y)) return false;
  if (obstacles.some(o => o.x === x && o.y === y)) return false;
  if (food && food.x === x && food.y === y) return false;
  return true;
}

function randomFreeCell() {
  let tries = 0, x, y;
  do { x = rnd(cols()); y = rnd(rows()); tries++; }
  while (!isFree(x, y) && tries < 500);
  return tries < 500 ? { x, y } : null;
}

function placeFood() {
  const cell = randomFreeCell();
  if (!cell) return;
  // random powerup chance
  const roll = Math.random();
  if (roll < 0.20 && foodCount > 0) {
    const keys = Object.keys(POWERUPS);
    cell.type = 'powerup';
    cell.powerup = keys[rnd(keys.length)];
  } else {
    cell.type = 'food';
    cell.value = POWERUPS.DOUBLE && activePowerups.DOUBLE ? SCORE_PER_FOOD * 2 : SCORE_PER_FOOD;
  }
  cell.spawnTime = performance.now();
  food = cell;
}

// ─── Level & speed ────────────────────────────────────────────
function getTickMs() {
  const t = TICK_BASE - (level - 1) * 10;
  const effective = slowActive ? t * 1.6 : t;
  return Math.max(TICK_MIN, effective);
}

function checkLevel() {
  const newLevel = Math.floor(foodCount / 5) + 1;
  if (newLevel > level) {
    level = newLevel;
    sfxLevelUp();
    flashLevelBadge();
    // every new level: surprise hurdle event
    scheduleHurdle(true);
  }
  tickMs = getTickMs();
  levelBadge.textContent = `LVL ${level}`;
}

function flashLevelBadge() {
  levelBadge.style.background = 'rgba(191,95,255,.45)';
  levelBadge.style.boxShadow = '0 0 22px rgba(191,95,255,.7)';
  setTimeout(() => {
    levelBadge.style.background = '';
    levelBadge.style.boxShadow = '';
  }, 700);
}

// ─── Hurdle system ────────────────────────────────────────────
function scheduleHurdle(immediate = false) {
  clearTimeout(warnTimeout);
  const delay = immediate ? 800 : 3000 + rnd(5000);
  warnTimeout = setTimeout(() => {
    showHurdleWarning();
    setTimeout(dropHurdle, 1200);
  }, delay);
}

function showHurdleWarning() {
  hurdleWarning.classList.remove('hidden');
  sfxHurdle();
}
function clearHurdleWarning() {
  hurdleWarning.classList.add('hidden');
  clearTimeout(warnTimeout);
}

function dropHurdle() {
  if (!gameRunning) return;
  clearHurdleWarning();

  const shape = HURDLE_SHAPES[rnd(HURDLE_SHAPES.length)];
  const safeZone = 3; // cells around snake head
  let ox, oy, tries = 0;
  do {
    ox = rnd(cols() - 4) + 1;
    oy = rnd(rows() - 4) + 1;
    tries++;
  } while (
    tries < 200 &&
    shape.some(([dx, dy]) => {
      const hx = ox + dx, hy = oy + dy;
      return Math.abs(hx - snake[0].x) < safeZone &&
        Math.abs(hy - snake[0].y) < safeZone;
    })
  );

  const now = performance.now();
  const lifeMs = 6000 + rnd(6000); // live 6–12 s

  shape.forEach(([dx, dy]) => {
    const hx = ox + dx, hy = oy + dy;
    if (hx >= 0 && hy >= 0 && hx < cols() && hy < rows()) {
      hurdles.push({
        x: hx, y: hy, spawnTime: now, lifeMs,
        color: `hsl(${rnd(360)},100%,60%)`
      });
    }
  });

  // schedule next hurdle
  const nextIn = 4000 + rnd(6000);
  clearTimeout(warnTimeout);
  warnTimeout = setTimeout(() => {
    if (!gameRunning) return;
    showHurdleWarning();
    setTimeout(dropHurdle, 1200);
  }, nextIn);
}

function ageHurdles(now) {
  hurdles = hurdles.filter(h => now - h.spawnTime < h.lifeMs);
}

// ─── Power-up system ─────────────────────────────────────────
function activatePowerup(type) {
  sfxPowerUp();
  const def = POWERUPS[type];

  if (type === 'SHRINK') {
    const cut = Math.floor(snake.length / 3);
    snake.splice(snake.length - cut);
    showFloating('✂ SHRINK!', '#ffea00');
    return;
  }

  activePowerups[type] = {
    endsAt: performance.now() + def.duration,
    label: def.label, color: def.color, border: def.border,
  };

  magnetActive = !!activePowerups.MAGNET;
  doubleActive = !!activePowerups.DOUBLE;
  shieldActive = !!activePowerups.SHIELD;
  slowActive = !!activePowerups.SLOW;
  tickMs = getTickMs();

  renderPowerupBar();
  showFloating(def.label, def.color);
}

function tickPowerups(now) {
  let changed = false;
  for (const k of Object.keys(activePowerups)) {
    if (now >= activePowerups[k].endsAt) {
      delete activePowerups[k];
      changed = true;
    }
  }
  if (changed) {
    magnetActive = !!activePowerups.MAGNET;
    doubleActive = !!activePowerups.DOUBLE;
    shieldActive = !!activePowerups.SHIELD;
    slowActive = !!activePowerups.SLOW;
    tickMs = getTickMs();
    renderPowerupBar();
  }
}

function renderPowerupBar() {
  powerupBar.innerHTML = '';
  for (const [k, v] of Object.entries(activePowerups)) {
    const pill = document.createElement('div');
    pill.className = 'powerup-pill';
    const remaining = Math.ceil((v.endsAt - performance.now()) / 1000);
    pill.style.color = v.color;
    pill.style.borderColor = v.border;
    pill.style.background = v.color + '18';
    pill.innerHTML = `${v.label}<span class="pill-timer">${remaining}s</span>`;
    powerupBar.appendChild(pill);
  }
}

// ─── Floating text ────────────────────────────────────────────
function showFloating(text, color) {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%', top: '50%',
    transform: 'translate(-50%,-50%)',
    fontFamily: "'Orbitron', sans-serif",
    fontSize: '1.6rem', fontWeight: '700',
    color, textShadow: `0 0 20px ${color}`,
    pointerEvents: 'none',
    zIndex: 100,
    animation: 'floatText .9s ease forwards',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// inject float animation once
; (function () {
  const s = document.createElement('style');
  s.textContent = `@keyframes floatText {
    0%   { opacity:0; transform:translate(-50%,-60%) scale(.8); }
    30%  { opacity:1; transform:translate(-50%,-50%) scale(1.1); }
    100% { opacity:0; transform:translate(-50%,-110%) scale(.9); }
  }`;
  document.head.appendChild(s);
})();

// ─── HUD ──────────────────────────────────────────────────────
function updateHUD() {
  scoreEl.textContent = score;
  highScoreEl.textContent = highScore || 0;
}
function popScore() {
  scoreEl.classList.remove('pop');
  void scoreEl.offsetWidth;
  scoreEl.classList.add('pop');
}

// ─── Movement & collision ─────────────────────────────────────
let deathMsg = '';

function step() {
  dir = { ...nextDir };

  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  // wall collision
  if (head.x < 0 || head.y < 0 || head.x >= cols() || head.y >= rows()) {
    if (shieldActive) {
      // wrap around
      head.x = (head.x + cols()) % cols();
      head.y = (head.y + rows()) % rows();
    } else {
      deathMsg = '💥 Hit the wall!';
      endGame(); return;
    }
  }

  // self collision
  if (snake.some(s => s.x === head.x && s.y === head.y)) {
    if (shieldActive) { /* ignore */ }
    else { deathMsg = '🐍 Bit yourself!'; endGame(); return; }
  }

  // hurdle collision
  if (hurdles.some(h => h.x === head.x && h.y === head.y) ||
    obstacles.some(o => o.x === head.x && o.y === head.y)) {
    if (shieldActive) {
      delete activePowerups.SHIELD;
      shieldActive = false;
      renderPowerupBar();
      showFloating('🛡 SHIELD BROKEN', '#00e5ff');
    } else {
      deathMsg = '🚧 Crashed into a hurdle!';
      endGame(); return;
    }
  }

  snake.unshift(head);

  // check food
  if (food && head.x === food.x && head.y === food.y) {
    if (food.type === 'powerup') {
      activatePowerup(food.powerup);
    } else {
      const gain = doubleActive ? SCORE_PER_FOOD * 2 : SCORE_PER_FOOD;
      score += gain + (level - 1) * 2;
      if (score > highScore) highScore = score;
      popScore();
      sfxEat();
      foodCount++;
      checkLevel();
    }
    updateHUD();
    placeFood();
  } else {
    snake.pop();
  }

  // magnet: pull food closer (teleport food one step toward snake)
  if (magnetActive && food && Math.random() < 0.08) {
    const dx = Math.sign(snake[0].x - food.x);
    const dy = Math.sign(snake[0].y - food.y);
    const nx = food.x + dx;
    const ny = food.y + dy;
    if (isFree(nx, ny, true)) {
      food.x = nx; food.y = ny;
    }
  }
}

// ─── Rendering ────────────────────────────────────────────────
const GRID_COLOR = 'rgba(0,229,255,0.04)';
const SNAKE_HEAD = '#00ff88';
const SNAKE_BODY = '#00cc6a';
const FOOD_COLOR = '#ff4466';
const HURDLE_COLOR = '#ff6a00';

function drawGrid() {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += CELL) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += CELL) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function drawCell(x, y, color, glow, radius = 4) {
  const px = x * CELL + 1, py = y * CELL + 1;
  const sz = CELL - 2;
  if (glow) {
    ctx.shadowBlur = 16; ctx.shadowColor = color;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(px, py, sz, sz, radius);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawSnake(now) {
  const len = snake.length;
  snake.forEach((seg, i) => {
    const t = i / (len - 1 || 1);
    // gradient from head (bright green) to tail (dark teal)
    const r = Math.round((1 - t) * 0, 0);
    const g = Math.round((1 - t) * 255 + t * 120);
    const b = Math.round((1 - t) * 136 + t * 80);
    const color = i === 0
      ? (shieldActive ? '#00e5ff' : SNAKE_HEAD)
      : `rgb(0,${g},${b})`;
    const glow = i === 0 || i < 3;
    drawCell(seg.x, seg.y, color, glow, i === 0 ? 6 : 4);
  });

  // Draw eyes on head
  const head = snake[0];
  const ex1 = head.x * CELL + (dir.x === 0 ? 4 : dir.x > 0 ? 13 : 3);
  const ey1 = head.y * CELL + (dir.y === 0 ? 4 : dir.y > 0 ? 13 : 3);
  const ex2 = head.x * CELL + (dir.x === 0 ? 14 : dir.x > 0 ? 13 : 3);
  const ey2 = head.y * CELL + (dir.y === 0 ? 14 : dir.y > 0 ? 13 : 3);
  ctx.fillStyle = '#fff';
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(ex1, ey1, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(ex2, ey2, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(ex1 + .5, ey1 + .5, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(ex2 + .5, ey2 + .5, 1.2, 0, Math.PI * 2); ctx.fill();
}

function drawFood(now) {
  if (!food) return;
  const pulse = 0.7 + 0.3 * Math.sin(now / 250);
  const px = food.x * CELL + CELL / 2;
  const py = food.y * CELL + CELL / 2;
  const radius = (CELL / 2 - 3) * pulse;

  if (food.type === 'powerup') {
    const def = POWERUPS[food.powerup];
    ctx.shadowBlur = 24; ctx.shadowColor = def.color;
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(px, py, radius + 2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // icon text
    ctx.font = `${CELL - 6}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.label.split(' ')[0], px, py + 1);
  } else {
    // animated food orb
    const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.3, FOOD_COLOR);
    grad.addColorStop(1, 'rgba(255,0,80,0)');
    ctx.shadowBlur = 22; ctx.shadowColor = FOOD_COLOR;
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawHurdles(now) {
  hurdles.forEach(h => {
    const age = now - h.spawnTime;
    const pct = age / h.lifeMs;
    const fade = pct > 0.7 ? 1 - (pct - 0.7) / 0.3 : 1;
    const pulse = 0.6 + 0.4 * Math.sin(now / 180 + h.x + h.y);
    ctx.globalAlpha = fade * pulse;
    ctx.shadowBlur = 12; ctx.shadowColor = h.color;
    ctx.fillStyle = h.color;
    const px = h.x * CELL + 2, py = h.y * CELL + 2, sz = CELL - 4;
    ctx.beginPath();
    ctx.roundRect(px, py, sz, sz, 3);
    ctx.fill();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  });

  // permanent obstacles (brick-style)
  obstacles.forEach(o => {
    ctx.fillStyle = '#ff2244';
    ctx.shadowBlur = 8; ctx.shadowColor = '#ff2244';
    ctx.strokeStyle = 'rgba(255,34,68,.4)';
    ctx.lineWidth = 1;
    const px = o.x * CELL + 1, py = o.y * CELL + 1, sz = CELL - 2;
    ctx.beginPath(); ctx.roundRect(px, py, sz, sz, 2);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
  });
}

function render(now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // subtle background glow
  const grd = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 0,
    canvas.width / 2, canvas.height / 2, canvas.width / 1.5
  );
  grd.addColorStop(0, 'rgba(0,30,20,.6)');
  grd.addColorStop(1, 'rgba(5,10,18,1)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid();
  drawHurdles(now);
  drawFood(now);
  drawSnake(now);
}

// ─── Game loop ────────────────────────────────────────────────
function loop(now) {
  if (!gameRunning) return;
  animId = requestAnimationFrame(loop);

  tickPowerups(now);
  renderPowerupBar();

  if (now - lastTick >= tickMs) {
    lastTick = now;
    step();
    ageHurdles(now);
  }
  render(now);
}

// ─── End game ─────────────────────────────────────────────────
function endGame() {
  gameRunning = false;
  cancelAnimationFrame(animId);
  clearTimeout(warnTimeout);
  sfxDie();

  finalScore.textContent = score;
  finalHigh.textContent = highScore;
  finalLevel.textContent = level;
  finalLength.textContent = snake.length;
  deathReason.textContent = deathMsg;

  gameScreen.classList.add('hidden');
  gameOverScreen.classList.remove('hidden');
}

// ─── Screens ──────────────────────────────────────────────────
function showGame() {
  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  resizeCanvas();
  deathMsg = '';
  initState();
  // first hurdle after 5s
  warnTimeout = setTimeout(() => {
    if (!gameRunning) return;
    showHurdleWarning();
    setTimeout(dropHurdle, 1200);
  }, 5000);
  animId = requestAnimationFrame(loop);
}

function showStart() {
  gameScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
}

// ─── Background particles ─────────────────────────────────────
function spawnParticles() {
  const container = document.getElementById('bgParticles');
  for (let i = 0; i < 35; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 2 + Math.random() * 4;
    const colors = ['#00ff88', '#00e5ff', '#bf5fff', '#ff0080', '#ffea00'];
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random() * 100}%;
      bottom:${Math.random() * -20}%;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      animation-duration:${8 + Math.random() * 14}s;
      animation-delay:${Math.random() * 12}s;
    `;
    container.appendChild(p);
  }
}

// ─── Input ────────────────────────────────────────────────────
const DIRS = {
  ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 },
};

document.addEventListener('keydown', e => {
  const d = DIRS[e.key] || DIRS[e.key.toLowerCase()];
  if (d) {
    e.preventDefault();
    // prevent 180° reversal
    if (d.x !== -dir.x || d.y !== -dir.y) nextDir = d;
  }
});

// Touch / swipe support
let touchStart = null;
document.addEventListener('touchstart', e => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  const absDx = Math.abs(dx), absDy = Math.abs(dy);
  if (Math.max(absDx, absDy) < 20) return;
  let d;
  if (absDx > absDy) d = dx > 0 ? DIRS.ArrowRight : DIRS.ArrowLeft;
  else d = dy > 0 ? DIRS.ArrowDown : DIRS.ArrowUp;
  if (d.x !== -dir.x || d.y !== -dir.y) nextDir = d;
  touchStart = null;
}, { passive: true });

// Button events
startBtn.addEventListener('click', showGame);
replayBtn.addEventListener('click', showGame);
menuBtn.addEventListener('click', showStart);

// Resize
window.addEventListener('resize', () => {
  if (!gameScreen.classList.contains('hidden')) {
    resizeCanvas();
    // re-clamp snake positions
    snake = snake.map(s => ({
      x: Math.max(0, Math.min(s.x, cols() - 1)),
      y: Math.max(0, Math.min(s.y, rows() - 1)),
    }));
  }
});

// ─── Load high score ─────────────────────────────────────────
highScore = parseInt(localStorage.getItem('neonSnakeHigh') || '0');
window.addEventListener('beforeunload', () => {
  localStorage.setItem('neonSnakeHigh', highScore);
});

// ─── Boot ────────────────────────────────────────────────────
spawnParticles();
highScoreEl.textContent = highScore;
