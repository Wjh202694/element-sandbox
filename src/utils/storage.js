import { GRID } from '../sim/elements.js';

const WORLD_KEY = 'sandbox.world.v1';
const DISC_KEY = 'sandbox.disc.v1';
const HINT_KEY = 'sandbox.hinted.v1';
const THEME_KEY = 'sandbox.theme.v1';
const MAP_KEY = 'sandbox.map.v1';

// RLE 压缩成 [数量, 元素id, ...] 存 localStorage
export function saveWorld(world) {
  try {
    const c = world.cells;
    const out = [];
    let i = 0;
    while (i < c.length) {
      const v = c[i];
      let n = 1;
      while (n < 255 && i + n < c.length && c[i + n] === v) n++;
      out.push(n, v);
      i += n;
    }
    localStorage.setItem(WORLD_KEY, JSON.stringify(out));
  } catch {
    /* 存档失败静默忽略（隐私模式等） */
  }
}

export function loadWorld() {
  try {
    const raw = localStorage.getItem(WORLD_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length % 2 !== 0) return null;
    const cells = new Uint8Array(GRID.w * GRID.h);
    let p = 0;
    for (let k = 0; k < arr.length; k += 2) {
      const n = arr[k];
      if (typeof n !== 'number' || n <= 0 || p + n > cells.length) return null;
      cells.fill(arr[k + 1], p, p + n);
      p += n;
    }
    return p === cells.length ? cells : null;
  } catch {
    return null;
  }
}

export function loadDiscovered() {
  try {
    const arr = JSON.parse(localStorage.getItem(DISC_KEY) || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveDiscovered(set) {
  try {
    localStorage.setItem(DISC_KEY, JSON.stringify([...set]));
  } catch {
    /* 忽略 */
  }
}

export function wasHinted() {
  try {
    return !!localStorage.getItem(HINT_KEY);
  } catch {
    return false;
  }
}

export function markHinted() {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* 忽略 */
  }
}

export function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'classic';
  } catch {
    return 'classic';
  }
}

export function saveTheme(id) {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    /* 忽略 */
  }
}

export function getMapId() {
  try {
    return localStorage.getItem(MAP_KEY) || 'forest';
  } catch {
    return 'forest';
  }
}

export function saveMapId(id) {
  try {
    localStorage.setItem(MAP_KEY, id);
  } catch {
    /* 忽略 */
  }
}
