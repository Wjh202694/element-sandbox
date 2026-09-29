import { E } from './elements.js';

// ===== 生成辅助 =====
function put(w, x, y, id) {
  if (x >= 0 && x < w.w && y >= 0 && y < w.h) w.set(y * w.w + x, id);
}

function fillRect(w, x0, y0, x1, y1, id) {
  for (let y = Math.max(0, y0); y <= Math.min(w.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(w.w - 1, x1); x++) {
      w.set(y * w.w + x, id);
    }
  }
}

function blob(w, cx, cy, rx, ry, id) {
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1) put(w, cx + dx, cy + dy, id);
    }
  }
}

function tree(w, x, groundY, trunkH, canopyR = 3) {
  const trunkW = trunkH > 10 ? 3 : 2;
  // 主干
  for (let k = 1; k <= trunkH; k++) {
    for (let dx = 0; dx < trunkW; dx++) put(w, x + dx, groundY - k, E.WOOD);
  }
  // 分支：中上部左右斜出，枝端带小叶簇
  if (trunkH >= 6) {
    const branchStart = Math.max(2, Math.round(trunkH * 0.45));
    const branchGap = Math.max(2, Math.round((trunkH - branchStart) / 2));
    for (let b = 0; b < 2; b++) {
      const by = groundY - branchStart - b * branchGap;
      const len = Math.max(2, Math.round((trunkH - branchStart) * 0.5) - b);
      for (const dir of [-1, 1]) {
        let bx = x + (dir === 1 ? trunkW - 1 : 0);
        let byy = by;
        for (let s = 0; s < len; s++) {
          bx += dir;
          byy -= 1;
          put(w, bx, byy, E.WOOD);
          if (s < len / 2) put(w, bx, byy - 1, E.WOOD);
        }
        blob(w, bx, byy - 1, Math.max(1, canopyR - 2), Math.max(1, canopyR - 2), E.PLANT);
      }
    }
  }
  // 顶冠
  blob(w, x + 1, groundY - trunkH - 2, canopyR, Math.round(canopyR * 0.75), E.PLANT);
}

// 巨树：可配置粗细/高度/弯曲/分支/多层树冠，千树千面
function giantTree(w, gx, surf, cfg) {
  const trunkH = Math.round(w.h * cfg.trunkHFrac);
  let baseX = gx;
  if (cfg.drift) baseX += cfg.drift * Math.floor(trunkH / 5);
  baseX = Math.max(1, Math.min(w.w - 1 - cfg.trunkW, baseX));
  const gy = surf[baseX];
  // 主干
  for (let k = 1; k <= trunkH; k++) {
    for (let dx = 0; dx < cfg.trunkW; dx++) put(w, baseX + dx, gy - k, E.WOOD);
  }
  // 根部接地：树干顺坡插到各自列的地面
  for (let dx = 0; dx < cfg.trunkW; dx++) {
    const cx = baseX + dx;
    if (cx < 0 || cx >= w.w) continue;
    for (let y = gy; y < surf[cx]; y++) put(w, cx, y, E.WOOD);
  }
  // 分支
  for (const br of cfg.branches) {
    const by = gy - Math.round(trunkH * br.t);
    let bx = baseX + (br.dir === 1 ? cfg.trunkW - 1 : 0);
    let byy = by;
    const len = Math.max(2, Math.round(w.w * br.lenFrac));
    for (let s = 0; s < len; s++) {
      bx += br.dir;
      byy -= 1;
      put(w, bx, byy, E.WOOD);
      if (s < len * 0.4) put(w, bx, byy - 1, E.WOOD);
    }
    if (br.leaf) blob(w, bx, byy - 2, br.leaf, Math.max(1, br.leaf - 1), E.PLANT);
  }
  // 多层树冠
  const crownY = gy - trunkH;
  for (const c of cfg.canopy) {
    blob(
      w,
      baseX + Math.round(cfg.trunkW / 2) + (c.ox || 0),
      crownY - c.dy,
      Math.max(3, Math.round(w.w * c.rx)),
      Math.max(2, Math.round(w.h * c.ry)),
      E.PLANT
    );
  }
}

// ===== 五张初始地图（按世界比例生成，横竖屏通用）=====

// 群岛：海面沙岛群 + 礁石珊瑚 + 每分钟交替海啸 + 周期雷暴
const TSUNAMI_CYCLE = 3600; // 约 60 秒一次，左右岸交替
const STORM_CYCLE = 1500; // 约 25 秒一轮雷暴
const STORM_WINDOW = 300; // 雷暴窗口 5 秒，窗内每 50 帧一道雷

// 闪电：纵列电火花从天顶落到该列首个非空格，只写空格不覆盖地形。
// 落海触发波前导电、落沙滩烧出闪玻璃、落树焦枯起火——全部复用电元素既有反应。
function lightningBolt(w, x) {
  for (let y = 0; y < w.h; y++) {
    const i = y * w.w + x;
    if (w.cells[i] !== E.EMPTY) break;
    w.set(i, E.ELECTRIC, w.spawnLife(E.ELECTRIC));
  }
}

function archipelagoGen(w) {
  const { w: W, h: H } = w;
  const sea = Math.round(H * 0.52);
  for (let y = sea; y < H; y++) {
    for (let x = 0; x < W; x++) w.set(y * W + x, E.WATER);
  }
  const islands = [
    [0.2, 0.16],
    [0.5, 0.22],
    [0.8, 0.14],
    [0.36, 0.06],
    [0.66, 0.05],
  ];
  for (const [fx, fr] of islands) {
    const cx = Math.round(W * fx);
    const R = Math.max(3, Math.round(W * fr));
    for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= W) continue;
      const hgt = Math.round((H - sea + 2) * (1 - (dx / R) ** 2) + 2);
      for (let k = 0; k <= hgt; k++) {
        const y = H - 1 - k;
        const i = y * W + x;
        const c = w.cells[i];
        // 海面以上的部分是空气格，同样要填成岛体
        if (c === E.WATER || c === E.EMPTY) w.set(i, k < 2 ? E.STONE : E.SAND);
      }
    }
  }
  // 水下礁石
  blob(w, Math.round(W * 0.33), sea + 3, 4, 2, E.STONE);
  blob(w, Math.round(W * 0.62), sea + 5, 5, 3, E.STONE);
  blob(w, Math.round(W * 0.9), sea + 2, 3, 2, E.STONE);
  // 海床珊瑚与海藻（会随水缓慢蔓延，海是活的）
  const weeds = [0.29, 0.44, 0.57, 0.72, 0.94];
  for (const fx of weeds) {
    const x = Math.round(W * fx);
    blob(w, x, H - 2, 3, 2, E.PLANT);
    for (let k = 1; k <= 3; k++) put(w, x, H - 2 - k, E.PLANT);
  }
  // 主岛：埋藏油穴 + 草皮
  const mx = Math.round(W * 0.5);
  blob(w, mx, H - Math.round(H * 0.28), 4, 2, E.OIL);
  for (let dx = -8; dx <= 8; dx += 4) {
    const x = mx + dx;
    if (w.cells[(sea - 4) * W + x] === E.EMPTY && w.cells[(sea - 5) * W + x] === E.SAND) {
      put(w, x, sea - 5, E.PLANT);
    }
  }
  // 棕榈树：基座精确落在岛面
  const peakY = sea - 5;
  tree(w, mx - 3, peakY, 5, 3);
  tree(w, Math.round(W * 0.2) + 3, sea - 3, 4, 2);
  tree(w, Math.round(W * 0.8), sea - 3, 4, 2);
}

// 海啸：周期性在岸侧竖起水墙，塌落成巨浪横扫群岛；雷暴窗口随机落雷
function archipelagoTick(w, frame) {
  if (frame % STORM_CYCLE < STORM_WINDOW && frame % 50 === 0) {
    lightningBolt(w, (Math.random() * w.w) | 0);
    if (frame % STORM_CYCLE === 0 && typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('sb-map-event', { detail: '⚡ 雷暴来袭！' }));
    }
  }
  if (frame < 2400) return;
  if (frame % TSUNAMI_CYCLE !== 0) return;
  const side = ((frame / TSUNAMI_CYCLE) | 0) % 2;
  const sea = Math.round(w.h * 0.52);
  const topY = sea - Math.round(w.h * 0.13);
  const x0 = side === 0 ? 0 : w.w - 3;
  for (let y = topY; y < sea; y++) {
    for (let x = x0; x < x0 + 3; x++) {
      const i = y * w.w + x;
      if (w.cells[i] === E.EMPTY) w.set(i, E.WATER);
    }
  }
  // UI 事件可选（node 无头环境下无 document）
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('sb-map-event', { detail: '🌊 海啸来了！' }));
  }
}

// 火山：中央火山锥 + 火口熔岩湖 + 下行熔岩流 + 周期喷发
const VOLCANO_CYCLE = 1500; // 约 25 秒一轮：冒烟前兆 → 喷发

function volcanoGeometry(w) {
  return {
    cx: Math.round(w.w * 0.5),
    baseY: w.h - Math.round(w.h * 0.16),
    coneH: Math.round(w.h * 0.36),
    halfW: Math.max(8, Math.round(w.w * 0.18)),
  };
}

function volcanoGen(w) {
  const { w: W, h: H } = w;
  const base = H - Math.round(H * 0.16);
  for (let x = 0; x < W; x++) {
    const g = base + Math.round(2 * Math.sin(x * 0.08) + 2 * Math.sin(x * 0.021 + 1));
    for (let y = g; y < H; y++) put(w, x, y, y < g + 2 ? E.SAND : E.STONE);
  }
  const { cx, baseY, coneH, halfW } = volcanoGeometry(w);
  for (let dx = -halfW; dx <= halfW; dx++) {
    const colH = Math.round(coneH * (1 - Math.abs(dx) / halfW));
    for (let k = 0; k <= colH; k++) put(w, cx + dx, baseY - k, E.STONE);
  }
  blob(w, cx, baseY - coneH + 3, Math.max(3, Math.round(halfW * 0.2)), 3, E.LAVA);
  // 熔岩沿右侧山坡流下
  for (let t = 0.15; t <= 0.95; t += 0.02) {
    const x = cx + Math.round(halfW * t);
    const y = baseY - Math.round(coneH * (1 - t));
    put(w, x, y, E.LAVA);
    put(w, x, y - 1, E.LAVA);
  }
  // 岩浆纹路：随机数量、随机起点与蜿蜒度的表面熔岩缝（每次生成不同）
  const veinCount = 2 + ((Math.random() * 3) | 0);
  for (let v = 0; v < veinCount; v++) {
    const side = Math.random() < 0.5 ? 1 : -1;
    const startT = 0.2 + Math.random() * 0.5;
    let x = cx + side * Math.round(halfW * startT);
    let y = baseY - Math.round(coneH * (1 - startT));
    const steps = Math.round(coneH * (1 - startT) + H * (0.04 + Math.random() * 0.05));
    const wide = Math.random() < 0.5;
    for (let s = 0; s < steps; s++) {
      put(w, x, y, E.LAVA);
      if (wide) put(w, x + side, y, E.LAVA);
      y += 1;
      // 大体沿坡向外，带随机蜿蜒
      x += Math.random() < 0.6 ? side : Math.random() < 0.5 ? 1 : -1;
      if (y >= H - 1) break;
    }
  }
  // 山体内部发光裂隙：1~2 条，位置随机
  const fisCount = 1 + ((Math.random() * 2) | 0);
  for (let v = 0; v < fisCount; v++) {
    const fx = cx + (Math.random() < 0.5 ? -1 : 1) * (2 + ((Math.random() * 6) | 0));
    const top = baseY - Math.round(coneH * (0.55 + Math.random() * 0.3));
    for (let y = top; y < baseY; y++) put(w, fx, y, E.LAVA);
  }
  // 地面放射状岩浆裂纹：1~3 条，长度随机
  const crackCount = 1 + ((Math.random() * 3) | 0);
  for (let v = 0; v < crackCount; v++) {
    const side = Math.random() < 0.5 ? 1 : -1;
    let x = cx + side * (halfW + 2 + ((Math.random() * 6) | 0));
    const y = baseY + 1 + ((Math.random() * 2) | 0);
    const len = Math.round(W * (0.05 + Math.random() * 0.08));
    for (let s = 0; s < len; s++) {
      put(w, x, y, E.LAVA);
      x += side;
      if (x < 0 || x >= W) break;
    }
  }
  // 远处零星植被
  tree(w, Math.round(W * 0.1), base + 1, 5, 2);
  tree(w, Math.round(W * 0.88), base + 1, 4, 2);
}

// 周期喷发：末段火口冒烟前兆，循环起点抛射熔岩
function volcanoTick(w, frame) {
  if (frame < 300) return;
  const phase = frame % VOLCANO_CYCLE;
  const { cx, baseY, coneH, halfW } = volcanoGeometry(w);
  const top = baseY - coneH;
  if (phase >= VOLCANO_CYCLE - 120) {
    // 前兆：断续青烟
    if (frame % 9 === 0) {
      const x = cx + ((Math.random() - 0.5) * halfW * 0.4) | 0;
      const i = (top - 4 - ((Math.random() * 3) | 0)) * w.w + x;
      w.set(i, E.SMOKE, 50 + Math.random() * 60);
    }
  } else if (phase < 200) {
    // 喷发：熔岩柱从火口逐节向上生长（从下往上），长到近天顶维持片刻后熄火回落
    if (phase % 2 === 0) {
      const prog = phase / 200;
      const riseP = Math.min(1, prog / 0.55); // 前 55% 时间长到顶
      const h = Math.round(w.h * 0.42 * (1 - (1 - riseP) ** 2));
      const y = top - h;
      if (y >= 1) {
        const jx = ((Math.random() - 0.5) * 5) | 0;
        for (let dx = -1; dx <= 1; dx++) {
          const i = y * w.w + (cx + jx + dx);
          if (w.cells[i] === E.EMPTY) w.set(i, E.LAVA);
        }
      }
      if (frame % 10 === 0) {
        const x = cx + ((Math.random() - 0.5) * halfW * 0.8) | 0;
        const sy = y - 4 - ((Math.random() * 5) | 0);
        if (sy >= 0 && w.cells[sy * w.w + x] === E.EMPTY) {
          w.set(sy * w.w + x, E.SMOKE, 60 + Math.random() * 80);
        }
      }
    }
  }
}

// 青山林：起伏丘陵 + 池塘 + 密林 + 一株参天大树
function forest(w) {
  const { w: W, h: H } = w;
  const waterLine = H - Math.round(H * 0.24);
  const surf = new Array(W);
  for (let x = 0; x < W; x++) {
    let g = waterLine + Math.round(2 * Math.sin(x * 0.05) + 2 * Math.sin(x * 0.017 + 1.5));
    const t = (x - W * 0.38) / (W * 0.11);
    if (Math.abs(t) < 1) g = Math.max(g, waterLine + Math.round(6 * (1 - t * t)));
    surf[x] = g;
    const top = Math.min(g, waterLine);
    for (let y = top; y < H; y++) {
      if (y < g) put(w, x, y, E.WATER);
      else if (y < g + 3) put(w, x, y, E.SAND);
      else put(w, x, y, E.STONE);
    }
  }
  // 密林小树
  const spots = [0.04, 0.08, 0.22, 0.57, 0.7, 0.91, 0.96];
  for (const fx of spots) {
    const x = Math.round(W * fx);
    tree(w, x, surf[x] - 1, 6 + (x % 5), 2 + (x % 2));
  }
  blob(w, Math.round(W * 0.8), surf[Math.round(W * 0.8)] - 2, 4, 2, E.PLANT);
  blob(w, Math.round(W * 0.31), surf[Math.round(W * 0.31)] - 2, 3, 2, E.PLANT);
  // 五棵巨树：形态大小各不相同
  giantTree(w, Math.round(W * 0.78), surf, {
    trunkW: 3,
    trunkHFrac: 0.3,
    branches: [
      { t: 0.4, dir: -1, lenFrac: 0.035, leaf: 3 },
      { t: 0.55, dir: 1, lenFrac: 0.03, leaf: 2 },
      { t: 0.75, dir: -1, lenFrac: 0.025, leaf: 2 },
    ],
    canopy: [
      { dy: 6, rx: 0.06, ry: 0.05 },
      { dy: 14, rx: 0.045, ry: 0.045 },
      { dy: 20, rx: 0.03, ry: 0.035 },
      { dy: 1, rx: 0.05, ry: 0.03 },
    ],
  });
  // 细高塔型：无分支，树冠叠成细塔
  giantTree(w, Math.round(W * 0.15), surf, {
    trunkW: 2,
    trunkHFrac: 0.26,
    branches: [],
    canopy: [
      { dy: 3, rx: 0.035, ry: 0.06 },
      { dy: 9, rx: 0.025, ry: 0.05 },
      { dy: 14, rx: 0.015, ry: 0.03 },
    ],
  });
  // 阔冠矮胖型
  giantTree(w, Math.round(W * 0.26), surf, {
    trunkW: 4,
    trunkHFrac: 0.14,
    branches: [
      { t: 0.5, dir: 1, lenFrac: 0.028, leaf: 3 },
      { t: 0.75, dir: -1, lenFrac: 0.025, leaf: 3 },
    ],
    canopy: [
      { dy: 2, rx: 0.075, ry: 0.04 },
      { dy: 7, rx: 0.05, ry: 0.035 },
    ],
  });
  // 弯杆斜出型：树干随高度侧弯
  giantTree(w, Math.round(W * 0.52), surf, {
    trunkW: 3,
    trunkHFrac: 0.24,
    drift: 1,
    branches: [{ t: 0.65, dir: -1, lenFrac: 0.03, leaf: 3 }],
    canopy: [
      { dy: 4, rx: 0.05, ry: 0.04, ox: 3 },
      { dy: 9, rx: 0.035, ry: 0.03, ox: 4 },
    ],
  });
  // 矮胖巨伞型
  giantTree(w, Math.round(W * 0.63), surf, {
    trunkW: 4,
    trunkHFrac: 0.1,
    branches: [],
    canopy: [
      { dy: 1, rx: 0.08, ry: 0.035 },
      { dy: 5, rx: 0.055, ry: 0.03 },
    ],
  });
}

// 空白画布：什么都不给，自由创作
function blank() {}

// 峡谷：两岸石壁夹一河
function canyon(w) {
  const { w: W, h: H } = w;
  const plateau = H - Math.round(H * 0.42);
  const riverLine = plateau + 4;
  for (let x = 0; x < W; x++) {
    const isLeft = x < W * 0.34;
    const isRight = x > W * 0.66;
    const lip = plateau + Math.round(2 * Math.sin(x * 0.09));
    if (isLeft || isRight) {
      for (let y = lip; y < H; y++) put(w, x, y, y < lip + 2 ? E.SAND : E.STONE);
      continue;
    }
    // 河道：水 + 沙床
    fillRect(w, x, riverLine, x, H - 3, E.WATER);
    fillRect(w, x, H - 2, x, H - 1, E.STONE);
    fillRect(w, x, H - 5, x, H - 3, E.SAND);
  }
  // 壁顶植被
  blob(w, Math.round(W * 0.12), plateau - 2, 4, 2, E.PLANT);
  blob(w, Math.round(W * 0.86), plateau - 2, 4, 2, E.PLANT);
  tree(w, Math.round(W * 0.2), plateau - 1, 5, 2);
  tree(w, Math.round(W * 0.78), plateau - 1, 5, 2);
}

// 沙漠：连绵沙丘 + 地下油穴 + 小绿洲
function desert(w) {
  const { w: W, h: H } = w;
  for (let x = 0; x < W; x++) {
    const duneTop =
      H -
      Math.round(
        H * 0.24 + Math.sin(x * 0.03) * H * 0.1 + Math.sin(x * 0.011 + 2) * H * 0.06
      );
    for (let y = duneTop; y < H; y++) put(w, x, y, y > H * 0.8 ? E.STONE : E.SAND);
  }
  // 地下油穴
  blob(w, Math.round(W * 0.6), Math.round(H * 0.88), Math.max(6, Math.round(W * 0.07)), Math.round(H * 0.05), E.OIL);
  // 小绿洲
  const ox = Math.round(W * 0.16);
  const oy = Math.round(H * 0.8);
  blob(w, ox, oy, Math.max(4, Math.round(W * 0.04)), 3, E.EMPTY);
  blob(w, ox, oy + 2, Math.max(3, Math.round(W * 0.03)), 2, E.WATER);
  tree(w, ox + Math.round(W * 0.05), oy - 3, 6, 3);
  blob(w, ox - Math.round(W * 0.04), oy - 2, 2, 2, E.PLANT);
  // 干枯树干
  tree(w, Math.round(W * 0.45), Math.round(H * 0.74), 7, 0);
}

// 玻璃之城：木板街道地基 + 石框玻璃带高楼 + 玻璃塔 + 中央公园
function building(w, x0, wd, top, groundY, glassy) {
  const roofId = glassy ? E.GLASS : E.STONE;
  for (let y = top; y < groundY; y++) {
    const m = (groundY - y) % 5;
    for (let x = x0; x < x0 + wd; x++) {
      const edge = x === x0 || x === x0 + wd - 1;
      let id;
      if (glassy) id = edge ? E.STONE : E.GLASS;
      else id = m >= 2 && m <= 3 && !edge ? E.GLASS : E.STONE;
      put(w, x, y, id);
    }
  }
  fillRect(w, x0 - 1, top - 1, x0 + wd, top, roofId); // 天台
}

function cityGen(w) {
  const { w: W, h: H } = w;
  const groundY = H - Math.round(H * 0.14);
  fillRect(w, 0, groundY, W - 1, H - 1, E.WOOD); // 木板街道地基
  // 高低错落：fh 0.12~0.45，高楼带退台二层
  const lots = [
    [0.02, 0.07, 0.18, true],
    [0.115, 0.055, 0.45, true],
    [0.2, 0.085, 0.24, false],
    [0.32, 0.06, 0.12, false],
    [0.42, 0.1, 0.34, true],
    [0.56, 0.07, 0.16, false],
    [0.675, 0.085, 0.42, true],
    [0.8, 0.07, 0.2, false],
    [0.9, 0.075, 0.28, true],
  ];
  for (const [fx, fw, fh, glassy] of lots) {
    const x0 = Math.round(W * fx);
    const wd = Math.max(3, Math.round(W * fw));
    const top = groundY - Math.round(H * fh);
    building(w, x0, wd, top, groundY, glassy);
    // 高楼加退台二层，天际线错落
    if (fh >= 0.3 && wd >= 5) {
      const x1 = x0 + Math.round(wd * 0.2);
      const wd1 = Math.max(3, Math.round(wd * 0.6));
      const top1 = top - Math.round(H * 0.07);
      building(w, x1, wd1, top1, groundY, glassy);
    }
  }
  // 街道绿荫
  const streets = [0.1, 0.185, 0.315, 0.41, 0.565, 0.7, 0.825, 0.94];
  for (const fx of streets) {
    const x = Math.round(W * fx);
    tree(w, x, groundY - 1, 4, 2);
    blob(w, x - 2, groundY - 2, 2, 1, E.PLANT);
  }
  // 中央公园：水景 + 树丛
  const px = Math.round(W * 0.52);
  blob(w, px, groundY - 1, 5, 2, E.EMPTY);
  blob(w, px, groundY, 4, 2, E.WATER);
  tree(w, px - 7, groundY - 1, 6, 3);
  tree(w, px + 7, groundY - 1, 6, 3);
  blob(w, px + 4, groundY - 3, 3, 2, E.PLANT);
}

export const MAPS = [
  { id: 'blank', name: '空白画布', icon: '⬜', desc: '一张白纸，随心创作', gen: blank },
  { id: 'forest', name: '青山林', icon: '🌲', desc: '密林环绕一株参天大树', gen: forest },
  { id: 'archipelago', name: '群岛', icon: '🏝️', desc: '沙岛礁石珊瑚，每分钟交替海啸，偶有雷暴', gen: archipelagoGen, tick: archipelagoTick },
  { id: 'volcano', name: '火山', icon: '🌋', desc: '岩浆纹路布满山体，周期喷发', gen: volcanoGen, tick: volcanoTick },
  { id: 'canyon', name: '峡谷', icon: '🏔️', desc: '峭壁之间一条河', gen: canyon },
  { id: 'desert', name: '沙漠', icon: '🏜️', desc: '沙丘下埋着石油，角落有绿洲', gen: desert },
  { id: 'city', name: '玻璃之城', icon: '🏙️', desc: '高楼林立的方块都市', gen: cityGen },
];

export function generateMap(world, id) {
  const map = MAPS.find((m) => m.id === id) || MAPS[0];
  map.gen(world);
  return map;
}
