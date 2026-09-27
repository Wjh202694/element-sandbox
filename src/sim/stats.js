// 成就统计：全局计数器，localStorage 持久化
const KEY = 'sandbox.stats.v1';

const stats = {
  paintById: new Array(16).fill(0), // 按元素 id 的累计涂布格数
  paintTotal: 0,
  rx: {}, // 反应事件计数（key 同发现 id）
  clears: 0,
  exports: 0,
  playFrames: 0,
  themes: [],
  newWorlds: 0,
  td3d: 0,
  mapEvents: 0,
  maxWater: 0,
  maxLava: 0,
  maxFire: 0,
  maxGas: 0,
  maxCells: 0,
};

let dirty = false;

export function loadStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw) return;
    if (Array.isArray(raw.paintById)) stats.paintById = raw.paintById;
    stats.paintTotal = raw.paintTotal || 0;
    stats.rx = raw.rx || {};
    stats.clears = raw.clears || 0;
    stats.exports = raw.exports || 0;
    stats.playFrames = raw.playFrames || 0;
    stats.themes = raw.themes || [];
    stats.newWorlds = raw.newWorlds || 0;
    stats.td3d = raw.td3d || 0;
    stats.mapEvents = raw.mapEvents || 0;
    stats.maxWater = raw.maxWater || 0;
    stats.maxLava = raw.maxLava || 0;
    stats.maxFire = raw.maxFire || 0;
    stats.maxGas = raw.maxGas || 0;
    stats.maxCells = raw.maxCells || 0;
  } catch {
    /* 损坏存档按全新计 */
  }
}

export function saveStats() {
  if (!dirty) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
    dirty = false;
  } catch {
    /* 忽略 */
  }
}

export function statPaint(id, n) {
  if (n <= 0) return;
  stats.paintById[id] = (stats.paintById[id] || 0) + n;
  stats.paintTotal += n;
  dirty = true;
}

export function statRx(key) {
  stats.rx[key] = (stats.rx[key] || 0) + 1;
  dirty = true;
}

export function statClear() {
  stats.clears++;
  dirty = true;
}

export function statExport() {
  stats.exports++;
  dirty = true;
}

export function statTheme(id) {
  if (!stats.themes.includes(id)) {
    stats.themes.push(id);
    dirty = true;
  }
}

export function statWorldGen() {
  stats.newWorlds++;
  dirty = true;
}

export function stat3D() {
  stats.td3d++;
  dirty = true;
}

export function statMapEvent() {
  stats.mapEvents++;
  dirty = true;
}

export function statStep(n = 1) {
  stats.playFrames += n;
  dirty = true;
}

export function statSample(water, lava, fire, gas, cells) {
  let changed = false;
  if (water > stats.maxWater) { stats.maxWater = water; changed = true; }
  if (lava > stats.maxLava) { stats.maxLava = lava; changed = true; }
  if (fire > stats.maxFire) { stats.maxFire = fire; changed = true; }
  if (gas > stats.maxGas) { stats.maxGas = gas; changed = true; }
  if (cells > stats.maxCells) { stats.maxCells = cells; changed = true; }
  if (changed) dirty = true;
}

export default stats;
