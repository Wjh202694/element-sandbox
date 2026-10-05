import { E } from './elements.js';

const rand = Math.random;

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

// 柱面地表行：自上而下首个非空格（风景建筑落地用）
function surfaceY(w, x) {
  for (let y = 0; y < w.h; y++) {
    if (w.cells[y * w.w + x] !== E.EMPTY) return y;
  }
  return w.h;
}

// ===== 五张初始地图（按世界比例生成，横竖屏通用）=====

// 群岛：海面沙岛群 + 礁石珊瑚 + 每分钟交替海啸 + 周期雷暴
const TSUNAMI_CYCLE = 3600; // 约 60 秒一次，左右岸交替
const STORM_CYCLE = 1500; // 约 25 秒一轮雷暴
const STORM_WINDOW = 300; // 雷暴窗口 5 秒，窗内每 50 帧一道雷

// 闪电：纵列电火花从天顶落到该列首个实体格，只写空格不覆盖地形。
// 烟/汽不算实体（闪电电离雾气穿过去）——否则晨雾飘上天会挡住所有雷击。
// 落海触发波前导电、落沙滩烧出闪玻璃、落树焦枯起火——全部复用电元素既有反应。
function lightningBolt(w, x) {
  for (let y = 0; y < w.h; y++) {
    const i = y * w.w + x;
    const c = w.cells[i];
    if (c !== E.EMPTY && c !== E.SMOKE && c !== E.STEAM) break;
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
  // 潮间礁石：岛脚外的零星石礁
  for (const [fx, fr] of islands) {
    const cx0 = Math.round(W * fx);
    const a = Math.random() * Math.PI * 2;
    const rr = Math.max(3, Math.round(W * fr)) + 3;
    blob(w, cx0 + Math.round(Math.cos(a) * rr), H - 3, 2, 1, E.STONE);
  }
  // 漂流浮木：海面零散木段（静态，浮在水面）
  for (let n = 0; n < 4; n++) {
    const x = 2 + ((Math.random() * (W - 8)) | 0);
    const y = sea;
    if (w.cells[y * W + x] === E.WATER && w.cells[y * W + x + 1] === E.WATER) {
      fillRect(w, x, y, x + 1, y, E.WOOD);
    }
  }
  // 灯塔：主岛上条纹石塔（石沙相间）+ 玻璃灯室 + 瞭望台
  const lhx = Math.round(W * 0.5) + 6;
  const lhy = surfaceY(w, lhx);
  fillRect(w, lhx - 1, lhy - 8, lhx + 1, lhy - 1, E.STONE);
  fillRect(w, lhx - 1, lhy - 6, lhx + 1, lhy - 5, E.SAND);
  fillRect(w, lhx - 1, lhy - 3, lhx + 1, lhy - 2, E.SAND);
  fillRect(w, lhx - 1, lhy - 10, lhx + 1, lhy - 9, E.GLASS);
  fillRect(w, lhx - 2, lhy - 11, lhx + 2, lhy - 10, E.STONE);
  // 栈桥码头：双排宽桥深入海面（桩入水）
  let pierX = -1;
  for (let x = 4; x < W - 4; x++) {
    const a = surfaceY(w, x);
    const topC = w.cells[a * W + x];
    const b = surfaceY(w, x + 1);
    const botC = w.cells[b * W + x + 1];
    if ((topC === E.SAND || topC === E.PLANT) && b === sea && botC === E.WATER) {
      pierX = x + 1;
      break;
    }
  }
  if (pierX > 0) {
    for (let x = pierX - 1; x <= pierX + 9; x++) {
      put(w, x, sea - 1, E.WOOD);
      put(w, x, sea - 2, E.WOOD);
    }
    for (let x = pierX + 1; x <= pierX + 9; x += 3) fillRect(w, x, sea, x, sea + 3, E.WOOD);
  }
  // 高脚渔屋：开阔海面上五宽桩基两层小屋（叶顶）
  let fhx = -1;
  for (let tries = 0; tries < 60 && fhx < 0; tries++) {
    const x = 2 + ((Math.random() * (W - 4)) | 0);
    let top = 0;
    for (let y = 0; y < H; y++) {
      const c = w.cells[y * W + x];
      if (c !== E.EMPTY) {
        top = c;
        break;
      }
    }
    if (top === E.WATER && w.cells[sea * W + x] === E.WATER) fhx = x;
  }
  if (fhx > 0) {
    for (const dx of [-2, 0, 2]) fillRect(w, fhx + dx, sea + 1, fhx + dx, sea + 4, E.WOOD);
    fillRect(w, fhx - 2, sea, fhx + 2, sea, E.WOOD);
    fillRect(w, fhx - 2, sea - 3, fhx + 2, sea - 1, E.WOOD);
    fillRect(w, fhx - 1, sea - 4, fhx, sea - 4, E.EMPTY);
    fillRect(w, fhx - 3, sea - 5, fhx + 3, sea - 5, E.PLANT);
    fillRect(w, fhx - 2, sea - 6, fhx + 2, sea - 6, E.PLANT);
  }
}

// 海啸：周期性在岸侧竖起水墙，塌落成巨浪横扫群岛；雷暴窗口随机落雷
function archipelagoTick(w, frame) {
  if (frame % STORM_CYCLE < STORM_WINDOW && frame % 50 === 0) {
    lightningBolt(w, (Math.random() * w.w) | 0);
    if (frame % STORM_CYCLE === 0 && typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('sb-map-event', { detail: { text: '雷暴来袭！', icon: 'electric' } }));
    }
  }
  // 鲸群：海啸半程时找开阔海面喷潮（水柱落回海里，零净水量；落点避开岛屿）
  if (frame > 2400 && frame % TSUNAMI_CYCLE === TSUNAMI_CYCLE / 2) {
    const sea = Math.round(w.h * 0.52);
    for (let tries = 0; tries < 6; tries++) {
      const x = 6 + ((Math.random() * (w.w - 12)) | 0);
      if (w.cells[(sea - 1) * w.w + x] !== E.EMPTY) continue;
      for (let k = 1; k <= 4; k++) {
        const i = (sea - k) * w.w + x;
        if (w.cells[i] === E.EMPTY) w.set(i, E.WATER);
      }
      if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('sb-map-event', { detail: { text: '鲸群跃出了海面！', icon: 'water' } }));
      }
      break;
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
    document.dispatchEvent(new CustomEvent('sb-map-event', { detail: { text: '海啸来了！', icon: 'water' } }));
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
  // 火山弹：锥脚散落的圆润岩块
  for (let n = 0; n < 3; n++) {
    const a = Math.random() * Math.PI * 2;
    const r = halfW * (1.02 + Math.random() * 0.15);
    const x = Math.round(cx + Math.cos(a) * r);
    const y = baseY + 1 + ((Math.random() * 2) | 0);
    blob(w, x, y, 2, 1, E.STONE);
  }
  // 玄武岩石柱群：五根双宽棱柱（高低错落）
  const bxx = cx + Math.round(halfW * 0.72);
  for (const [ox, hgt] of [[-3, 5], [-1, 9], [1, 11], [3, 7], [5, 4]]) {
    const cxn = bxx + ox;
    const cyn = surfaceY(w, cxn);
    if (w.cells[cyn * W + cxn] === E.LAVA) continue;
    fillRect(w, cxn, cyn - hgt, cxn + 1, cyn - 1, E.STONE);
  }
  // 石砌瞭望塔：左肩坡上的五宽岗哨（垛口+玻璃瞭望口）
  const wtx = cx - Math.round(halfW * 0.55);
  const wty = surfaceY(w, wtx);
  if (w.cells[wty * W + wtx] !== E.LAVA) {
    fillRect(w, wtx - 2, wty - 6, wtx + 2, wty - 1, E.STONE);
    fillRect(w, wtx - 2, wty - 7, wtx + 2, wty - 7, E.STONE);
    put(w, wtx - 1, wty - 7, E.EMPTY);
    put(w, wtx + 1, wty - 7, E.EMPTY);
    put(w, wtx, wty - 8, E.GLASS);
  }
  // 环形熔岩石祭坛：石环环抱中央熔岩池（长明圣火）
  const axx = cx - Math.round(halfW * 1.5);
  const ayy = surfaceY(w, axx);
  for (let a2 = 0; a2 < 16; a2++) {
    const aa = (a2 / 16) * Math.PI * 2;
    const sx0 = axx + Math.round(Math.cos(aa) * 6);
    const sy0 = ayy - 1 + Math.round(Math.sin(aa) * 3);
    fillRect(w, sx0, sy0 - 1, sx0, sy0, E.STONE);
  }
  fillRect(w, axx - 1, ayy - 1, axx + 1, ayy, E.LAVA);
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
    // 岩屑滚落：锥坡撒沙，喷发前的震颤剥蚀（沙顺坡滑进火口或山脚）
    if (frame % 25 === 0) {
      for (let a2 = 0; a2 < 3; a2++) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const t = 0.3 + Math.random() * 0.4;
        const x = cx + side * Math.round(halfW * t);
        const y = baseY - Math.round(coneH * (1 - t)) - 1;
        if (y >= 0 && w.cells[y * w.w + x] === E.EMPTY) {
          w.set(y * w.w + x, E.SAND);
          break;
        }
      }
    }
  } else if (phase >= 260 && phase < VOLCANO_CYCLE - 200) {
    // 火口熔岩鼓泡：湖面上方鼓起一撮熔岩又落回（呼吸感，零净量）
    if (frame % 40 === 0) {
      const bx = cx + ((Math.random() - 0.5) * Math.max(2, Math.round(halfW * 0.15)) | 0);
      const by = top - 1 - ((Math.random() * 2) | 0);
      if (by >= 0 && w.cells[by * w.w + bx] === E.EMPTY) w.set(by * w.w + bx, E.LAVA);
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
  // 林间苔石与池塘莲叶（静物点缀）
  for (let n = 0; n < 3; n++) {
    const x = Math.round(W * (0.1 + Math.random() * 0.8));
    blob(w, x, surf[x] - 1, 1 + ((Math.random() * 2) | 0), 1, E.STONE);
  }
  for (const fx of [0.44, 0.47, 0.5]) {
    const x = Math.round(W * fx);
    for (let y = 0; y < H; y++) {
      if (w.cells[y * W + x] === E.WATER) {
        put(w, x, y, E.PLANT);
        break;
      }
    }
  }
  // 观景木亭：双层草顶大亭（宽平台+四粗柱+石凳）
  const gx = Math.round(W * 0.63);
  const gy = surf[gx];
  fillRect(w, gx - 4, gy - 1, gx + 4, gy - 1, E.WOOD);
  for (const dx of [-3, 3]) {
    fillRect(w, gx + dx, gy - 4, gx + dx, gy - 2, E.WOOD);
    put(w, gx + dx + (dx > 0 ? -1 : 1), gy - 1, E.STONE);
  }
  fillRect(w, gx - 4, gy - 5, gx + 4, gy - 5, E.PLANT);
  fillRect(w, gx - 2, gy - 6, gx + 2, gy - 6, E.PLANT);
  fillRect(w, gx - 1, gy - 2, gx + 1, gy - 2, E.STONE);
  // 池上拱桥：找最长连片水面，宽度适中（4~22 格）才搭桥——海岸长水带不搭
  let bestA = -1;
  let bestB = -1;
  let bestTop = H;
  let bestLen = 0;
  {
    let pxA = -1;
    let pxB = -1;
    let pyTop = H;
    for (let x = 2; x < W - 2; x++) {
      let wat = false;
      let top = H;
      for (let y = 0; y < H; y++) {
        if (w.cells[y * W + x] === E.WATER) {
          wat = true;
          top = Math.min(top, y);
          break;
        }
      }
      if (wat) {
        if (pxA < 0) pxA = x;
        pxB = x;
        pyTop = Math.min(pyTop, top);
      } else if (pxA >= 0) {
        if (pxB - pxA > bestLen) {
          bestLen = pxB - pxA;
          bestA = pxA;
          bestB = pxB;
          bestTop = pyTop;
        }
        pxA = -1;
        pxB = -1;
        pyTop = H;
      }
    }
    if (pxA >= 0 && pxB - pxA > bestLen) {
      bestA = pxA;
      bestB = pxB;
      bestTop = pyTop;
    }
  }
  if (bestA > 0 && bestLen >= 4 && bestLen <= 30) {
    for (let x = bestA - 2; x <= bestB + 2; x++) {
      const t = (x - bestA + 2) / (bestLen + 4);
      const arch = Math.round(Math.sin(t * Math.PI) * 3);
      fillRect(w, x, bestTop - 2 - arch, x, bestTop - arch, E.WOOD);
    }
  }
  // 树屋：参天大树腰间的两层木屋（宽平台+双层墙+叶顶+爬梯）
  const htx = Math.round(W * 0.78);
  const hty = surf[htx] - Math.round(H * 0.3 * 0.55);
  fillRect(w, htx - 2, hty, htx + 4, hty, E.WOOD);
  fillRect(w, htx, hty - 1, htx + 3, hty - 1, E.WOOD);
  fillRect(w, htx, hty - 2, htx + 3, hty - 2, E.WOOD);
  fillRect(w, htx - 1, hty - 3, htx + 4, hty - 3, E.PLANT);
  fillRect(w, htx + 1, hty + 1, htx + 2, hty + 3, E.WOOD);
  // 篱笆小径：木桩顶绿叶夹出园径
  for (let x = Math.round(W * 0.03); x < Math.round(W * 0.3); x += 2) {
    put(w, x, surf[x] - 1, E.WOOD);
    put(w, x, surf[x] - 2, E.PLANT);
  }
}

// 青山林事件：晨雾漫林（无水净量的烟）+ 稀疏雷击起火（每 4 轮一道，烧出林窗）
const FOREST_CYCLE = 3600; // 约 60 秒一轮
function forestTick(w, frame) {
  if (frame < 400) return;
  const phase = frame % FOREST_CYCLE;
  // 晨雾：贴地表起烟，缓缓上升消散
  if (phase < 900 && frame % 14 === 0) {
    const x = 1 + ((Math.random() * (w.w - 2)) | 0);
    for (let y = 0; y < w.h; y++) {
      const i = y * w.w + x;
      if (w.cells[i] !== E.EMPTY) {
        if (y > 0 && w.cells[i - w.w] === E.EMPTY) w.set(i - w.w, E.SMOKE, 60 + Math.random() * 60);
        break;
      }
    }
  }
  // 阵雨过林：每 4 轮一场短促阵雨（水从天降，林子喝饱长更密）。
  // 森林不放闪电——植物点燃概率是全局设定，密林链燃一场雷击=灭图；
  // 水被植物吸收自限，雨停水尽
  if (frame % (FOREST_CYCLE * 4) === FOREST_CYCLE * 3 && frame > 400) {
    w.forestRainUntil = frame + 400;
    w.forestRainAt = 8 + ((Math.random() * (w.w - 16)) | 0);
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('sb-map-event', { detail: { text: '阵雨过林！', icon: 'water' } }));
    }
  }
  // 阵雨：雨带中心的短促降雨
  if (w.forestRainUntil && frame <= w.forestRainUntil && frame % 4 === 0) {
    const x = ((w.forestRainAt + (((Math.random() - 0.5) * 24) | 0)) % w.w + w.w) % w.w;
    if (w.cells[2 * w.w + x] === E.EMPTY) w.set(2 * w.w + x, E.WATER);
  }
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
  // 悬壁栈道：右壁半腰的木板道 + 撑柱
  const plankY = plateau + 6;
  fillRect(w, Math.round(W * 0.58), plankY, Math.round(W * 0.655), plankY, E.WOOD);
  for (const fx of [0.6, 0.645]) {
    const px = Math.round(W * fx);
    fillRect(w, px, plankY + 1, px, plankY + 2, E.WOOD);
  }
  // 跨谷吊桥：双沿厚桥 + 高栏 + 垂索吊件
  const bx0 = Math.round(W * 0.3);
  const bx1 = Math.round(W * 0.7);
  for (let x = bx0; x <= bx1; x++) {
    fillRect(w, x, plateau - 2, x, plateau - 1, E.WOOD);
    if (x % 3 === 0) {
      put(w, x, plateau - 3, E.WOOD);
      put(w, x, plateau - 4, E.WOOD);
    }
    if (x % 6 === 3) fillRect(w, x, plateau, x, plateau + 3, E.WOOD);
  }
  // 天然石拱：加厚大跨石拱门
  const ax0 = Math.round(W * 0.335);
  const ax1 = Math.round(W * 0.665);
  for (let x = ax0; x <= ax1; x++) {
    const t = (x - ax0) / (ax1 - ax0);
    const ay = plateau - Math.round(Math.sin(t * Math.PI) * 5);
    fillRect(w, x, ay, x, ay + 2, E.STONE);
  }
  // 崖壁洞穴：右壁大洞 + 木梁框
  const cvx = Math.round(W * 0.9);
  for (let dx = 0; dx < 4; dx++) {
    for (let dy = 0; dy < 3; dy++) {
      put(w, cvx - dx, plateau + 5 + dy, E.EMPTY);
    }
  }
  put(w, cvx, plateau + 4, E.WOOD);
  put(w, cvx - 1, plateau + 4, E.WOOD);
  put(w, cvx - 2, plateau + 4, E.WOOD);
  put(w, cvx - 3, plateau + 8, E.WOOD);
}

// 峡谷事件：谷雾 + 岩壁剥落坠河（沙沉河床，量小有界）
const CANYON_CYCLE = 2400; // 约 40 秒一轮
function canyonTick(w, frame) {
  if (frame < 600) return;
  const phase = frame % CANYON_CYCLE;
  // 谷雾：谷底贴水起烟
  if (phase < 700 && frame % 16 === 0) {
    const x = Math.round(w.w * (0.38 + Math.random() * 0.24));
    for (let y = Math.round(w.h * 0.4); y < w.h; y++) {
      const i = y * w.w + x;
      if (w.cells[i] !== E.EMPTY) {
        if (y > 0 && w.cells[i - w.w] === E.EMPTY) w.set(i - w.w, E.SMOKE, 60 + Math.random() * 60);
        break;
      }
    }
  }
  // 岩壁剥落：左壁撒沙坠河
  if (phase >= 1200 && phase < 1400 && frame % 12 === 0) {
    const x = Math.round(w.w * (0.3 + Math.random() * 0.05));
    for (let y = Math.round(w.h * 0.42); y < w.h; y++) {
      const i = y * w.w + x;
      const c = w.cells[i];
      if (c !== E.EMPTY && c !== E.WATER) {
        if (y > 0 && w.cells[i - w.w] === E.EMPTY) w.set(i - w.w, E.SAND);
        break;
      }
    }
    if (phase === 1200 && typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('sb-map-event', { detail: { text: '岩壁剥落，碎石坠河！', icon: 'sand' } }));
    }
  }
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
  // 仙人掌：远离绿洲的肉质柱（不近水不蔓延；ox 为上方绿洲横坐标）
  for (let n = 0; n < 5; n++) {
    const x = Math.round(W * (0.3 + Math.random() * 0.6));
    if (x < 2 || x > W - 3 || Math.abs(x - ox) < W * 0.08) continue;
    let y0 = 0;
    while (y0 < H && w.cells[y0 * W + x] === E.EMPTY) y0++;
    if (y0 >= H) continue;
    const ch = 2 + ((Math.random() * 3) | 0);
    fillRect(w, x, y0 - ch, x, y0 - 1, E.PLANT);
    fillRect(w, x - 1, y0 - ch, x - 1, y0 - ch, E.PLANT);
    fillRect(w, x + 1, y0 - ch + 2, x + 1, y0 - ch + 2, E.PLANT);
  }
  // 油泉露头：沙面油坑（tick 缓慢渗涨，满则止）
  const spx = Math.round(W * 0.62);
  let sy0 = 0;
  while (sy0 < H && w.cells[sy0 * W + spx] === E.EMPTY) sy0++;
  if (spx > 3 && spx < W - 4 && sy0 < H - 4) {
    fillRect(w, spx - 2, sy0, spx + 2, sy0 + 2, E.EMPTY);
    fillRect(w, spx - 2, sy0 + 3, spx + 2, sy0 + 3, E.SAND);
    fillRect(w, spx - 1, sy0 + 2, spx + 1, sy0 + 2, E.OIL);
  }
  // 石砌金字塔：十二层二十九宽大地标（基座取两侧地表较低者，防悬空）
  const pxx = Math.round(W * 0.8);
  if (pxx > 16 && pxx < W - 16) {
    const gL = surfaceY(w, pxx - 14);
    const gR = surfaceY(w, pxx + 14);
    const pBase = Math.max(gL, gR);
    for (let l = 0; l < 12; l++) {
      const r = 14 - l;
      fillRect(w, pxx - r, pBase - 1 - l, pxx + r, pBase - 1 - l, E.STONE);
    }
  }
  // 石雕巨像：四宽坐像（身+头+前臂+GLASS 眼）
  const sxx = Math.round(W * 0.35);
  const syy = surfaceY(w, sxx);
  fillRect(w, sxx, syy - 6, sxx + 2, syy - 1, E.STONE);
  fillRect(w, sxx, syy - 9, sxx + 2, syy - 6, E.STONE);
  fillRect(w, sxx - 2, syy - 4, sxx - 1, syy - 2, E.STONE);
  put(w, sxx, syy - 8, E.GLASS);
  put(w, sxx + 2, syy - 8, E.GLASS);
  // 绿洲棕榈棚：四柱大凉棚 + 木桌
  const phx = Math.round(W * 0.16) + 8;
  const phy = surfaceY(w, phx);
  for (const dx of [-2, 2]) fillRect(w, phx + dx, phy - 4, phx + dx, phy - 1, E.WOOD);
  fillRect(w, phx - 3, phy - 5, phx + 3, phy - 5, E.PLANT);
  fillRect(w, phx - 1, phy - 1, phx + 1, phy - 1, E.WOOD);
}

// 沙漠事件：沙暴横扫 + 绿洲蒸腾（无水净量）+ 油泉渗涨（有界）
const DESERT_CYCLE = 3000; // 约 50 秒一轮
function desertTick(w, frame) {
  if (frame < 600) return;
  const phase = frame % DESERT_CYCLE;
  const storm = Math.floor(frame / DESERT_CYCLE) % 2 === 1;
  // 沙暴：单数轮中段沙墙自左向右横扫（沙归沙丘，缓慢改地形）
  if (storm && phase >= 700 && phase < 1500) {
    if (phase === 700 && typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('sb-map-event', { detail: { text: '沙暴来袭！', icon: 'sand' } }));
    }
    if (frame % 8 === 0) {
      const x = Math.round(((phase - 700) / 800) * (w.w - 12)) + 6 + (((Math.random() - 0.5) * 10) | 0);
      if (x >= 0 && x < w.w && w.cells[x] === E.EMPTY) w.set(x, E.SAND);
    }
  }
  // 绿洲蒸腾：泉面起烟
  if (frame % 40 === 0) {
    const ox = Math.round(w.w * 0.16);
    for (let y = Math.round(w.h * 0.5); y < w.h; y++) {
      const i = y * w.w + ox;
      if (w.cells[i] === E.WATER) {
        let yy = y - 1;
        while (yy >= 0 && w.cells[yy * w.w + ox] !== E.EMPTY) yy--;
        if (yy >= 0) w.set(yy * w.w + ox, E.SMOKE, 50 + Math.random() * 50);
        break;
      }
      if (w.cells[i] !== E.EMPTY && w.cells[i] !== E.SAND && w.cells[i] !== E.PLANT) break;
    }
  }
  // 油泉渗涨：油坑缓慢蓄油（找最顶油格上方的空格生长），满则止
  if (frame % 240 === 0) {
    const spx = Math.round(w.w * 0.62);
    let firstOilY = -1;
    let oilN = 0;
    for (let y = Math.round(w.h * 0.5); y < w.h; y++) {
      const c = w.cells[y * w.w + spx];
      if (c === E.OIL) {
        if (firstOilY < 0) firstOilY = y;
        oilN++;
      } else if (c !== E.EMPTY && c !== E.SAND) {
        break;
      }
    }
    if (firstOilY > 0 && oilN < 6) {
      const j = (firstOilY - 1) * w.w + spx;
      const above = w.cells[j];
      if (above === E.EMPTY || above === E.SAND) w.set(j, E.OIL); // 顶开浮沙上渗
    }
  }
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
  // 天台花园：高楼顶上的绿植
  for (const [fx, fw, fh] of lots) {
    if (fh < 0.2) continue;
    const gx0 = Math.round(W * fx) + 1;
    const top = groundY - Math.round(H * fh) - 2;
    put(w, gx0, top, E.PLANT);
    put(w, gx0 + 1, top, E.PLANT);
  }
  // 金属天线：高楼避雷针（雷暴夜引雷入地）
  for (const [fx, fw, fh] of lots) {
    if (fh < 0.3) continue;
    const sx = Math.round(W * fx) + Math.max(1, Math.round(W * fw) >> 1);
    const top = groundY - Math.round(H * fh) - 2;
    fillRect(w, sx, top - 3, sx, top, E.METAL);
  }
  // 钟塔：六宽基座 + 四宽塔身 + 玻璃大钟 + 金属尖塔
  const ctx0 = Math.round(W * 0.535) - 1;
  fillRect(w, ctx0 - 1, groundY - 2, ctx0 + 4, groundY - 1, E.STONE);
  fillRect(w, ctx0, groundY - 10, ctx0 + 3, groundY - 2, E.STONE);
  fillRect(w, ctx0 + 1, groundY - 9, ctx0 + 2, groundY - 8, E.GLASS);
  put(w, ctx0, groundY - 9, E.GLASS);
  put(w, ctx0 + 3, groundY - 9, E.GLASS);
  fillRect(w, ctx0 + 1, groundY - 13, ctx0 + 2, groundY - 10, E.METAL);
  // 高楼天桥：双排桥面 + 玻璃栏 + 吊件
  const bb0 = Math.round(W * 0.76);
  const bb1 = Math.round(W * 0.8);
  const bby = groundY - Math.round(H * 0.2);
  for (let x = bb0; x <= bb1; x++) {
    fillRect(w, x, bby, x, bby + 1, E.WOOD);
    put(w, x, bby - 1, E.GLASS);
    if (x % 3 === 0) put(w, x, bby + 2, E.WOOD);
  }
  // 环形喷泉广场：双石环 + 中央玻璃水柱
  const fqx = Math.round(W * 0.3);
  for (let a2 = 0; a2 < 18; a2++) {
    const aa = (a2 / 18) * Math.PI * 2;
    put(w, fqx + Math.round(Math.cos(aa) * 4), groundY - 1, E.STONE);
  }
  for (let a2 = 0; a2 < 10; a2++) {
    const aa = (a2 / 10) * Math.PI * 2;
    put(w, fqx + Math.round(Math.cos(aa) * 2), groundY - 1, E.STONE);
  }
  fillRect(w, fqx, groundY - 3, fqx, groundY - 1, E.GLASS);
}

// 玻璃之城事件：街雾 + 雷暴夜天线引雷（金属导电的活演示）
const CITY_CYCLE = 2700; // 约 45 秒一轮
function cityTick(w, frame) {
  if (frame < 600) return;
  const phase = frame % CITY_CYCLE;
  // 街雾：贴街起烟
  if (phase < 600 && frame % 18 === 0) {
    const x = 1 + ((Math.random() * (w.w - 2)) | 0);
    for (let y = 0; y < w.h; y++) {
      const i = y * w.w + x;
      if (w.cells[i] !== E.EMPTY) {
        if (y > 0 && w.cells[i - w.w] === E.EMPTY) w.set(i - w.w, E.SMOKE, 50 + Math.random() * 50);
        break;
      }
    }
  }
  // 雷暴夜：闪电找金属天线尖劈下（尖 = 上方两格空的金属），能量沿金属传导
  if (phase === 900 || phase === 1300) {
    const tips = [];
    for (let i = w.w * 2; i < w.cells.length; i++) {
      if (w.cells[i] === E.METAL && w.cells[i - w.w] === E.EMPTY && w.cells[i - 2 * w.w] === E.EMPTY) {
        tips.push(i % w.w);
      }
    }
    if (tips.length) {
      lightningBolt(w, tips[(Math.random() * tips.length) | 0]);
      if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('sb-map-event', { detail: { text: '闪电劈上天线，电流沿金属奔流！', icon: 'electric' } }));
      }
    }
  }
}

// 雪山：冰岩尖峰 + 45° 雪裙 + 冰湖 + 周期雪崩
// 地形关键约束：雪是粉末，坡度 >1 行/列站不住会整体滑塌——
// 陡峭尖峰覆静态冰壳（ICE 不坠落），松雪只铺在坡度 ≤1 的裙坡与平顶雪台上
const SNOW_CYCLE = 2400; // 约 40 秒一轮
const AVALANCHE_START = 2100; // 雪崩窗口起点相位
const AVALANCHE_LEN = 100; // 雪崩倾泻时长（帧）

function snowMountainGeometry(w) {
  const spikeH = Math.round(w.h * 0.14);
  const skirtH = Math.round(w.h * 0.14);
  const spikeHalf = Math.max(3, Math.round(w.w * 0.07));
  return {
    cx: Math.round(w.w * 0.34),
    baseY: w.h - Math.round(w.h * 0.13),
    spikeH,
    skirtH,
    spikeHalf,
    skirtHalf: spikeHalf + skirtH, // 裙坡 45°：水平跨距 = 垂直落差
    cx2: Math.round(w.w * 0.85),
    coneH2: Math.round(w.h * 0.22),
    halfW2: Math.max(6, Math.round(w.w * 0.11)),
    lakeX: Math.round(w.w * 0.66),
    lakeW: Math.max(8, Math.round(w.w * 0.14)),
    lakeFloor: w.h - Math.round(w.h * 0.05),
  };
}

function snowMountainGen(w) {
  const { w: W, h: H } = w;
  const g = snowMountainGeometry(w);
  const base = g.baseY;
  // 起伏地基（雪原平缓：起伏压到 ±1 行，保证坡度感知覆雪全覆盖）
  for (let x = 0; x < W; x++) {
    const ground = base + Math.round(Math.sin(x * 0.06) + Math.sin(x * 0.017 + 1));
    for (let y = ground; y < H; y++) put(w, x, y, E.STONE);
  }
  // 主峰：平顶雪台 + 陡峭冰岩尖峰 + 45° 雪裙
  for (let dx = -g.skirtHalf; dx <= g.skirtHalf; dx++) {
    const x = g.cx + dx;
    if (x < 0 || x >= W) continue;
    const ad = Math.abs(dx);
    let colH = 0;
    let icy = false;
    if (ad <= g.spikeHalf * 0.3) {
      colH = g.skirtH + g.spikeH; // 峰顶雪台（平顶，积雪稳定）
    } else if (ad <= g.spikeHalf) {
      colH = Math.round(g.skirtH + g.spikeH * 0.15 + ((g.spikeHalf - ad) / (g.spikeHalf * 0.7)) * g.spikeH * 0.85);
      icy = true; // 陡坡段：覆静态冰壳
    } else if (ad <= g.skirtHalf) {
      colH = Math.round(g.skirtH + g.spikeH * 0.15 - (ad - g.spikeHalf)); // 45° 裙坡
    }
    for (let k = 0; k < colH; k++) put(w, x, base - 1 - k, icy && k >= colH - 2 ? E.ICE : E.STONE);
  }
  // 次峰：陡峭三角锥，表面结冰壳（colH=0 的坡脚列不塞冰）
  for (let dx = -g.halfW2; dx <= g.halfW2; dx++) {
    const x = g.cx2 + dx;
    if (x < 0 || x >= W) continue;
    const colH = Math.round(g.coneH2 * (1 - Math.abs(dx) / g.halfW2));
    if (colH <= 0) continue;
    for (let k = 0; k <= colH; k++) put(w, x, base - k, k >= colH - 1 ? E.ICE : E.STONE);
  }
  // 冰湖：地基里凿盆（留天然石岸），盆底垫回石，水面结双层冰壳，中央留一道裂缝露水
  const x0 = g.lakeX - (g.lakeW >> 1) + 1;
  const x1 = x0 + g.lakeW - 2;
  const surfY = base + 1;
  const crackX = (x0 + x1) >> 1;
  fillRect(w, x0, surfY, x1, H - 1, E.EMPTY);
  fillRect(w, x0, g.lakeFloor, x1, H - 1, E.STONE);
  fillRect(w, x0, surfY + 2, x1, g.lakeFloor - 1, E.WATER);
  fillRect(w, x0, surfY, x1, surfY + 1, E.ICE);
  put(w, crackX, surfY, E.WATER);
  put(w, crackX, surfY + 1, E.WATER);
  // 坡度感知覆雪：只把雪铺在稳定地表（相邻列落差 ≤1），越接近峰顶越厚；
  // 陡坡露岩/冰壳，冰壳水体树木不受影响
  const surf = new Array(W).fill(H);
  for (let x = 0; x < W; x++) {
    let y0 = 0;
    while (y0 < H && w.cells[y0 * W + x] === E.EMPTY) y0++;
    surf[x] = y0;
  }
  for (let x = 1; x < W - 1; x++) {
    const drop = Math.max(Math.abs(surf[x] - surf[x - 1]), Math.abs(surf[x] - surf[x + 1]));
    if (drop > 1) continue;
    const depth = Math.min(7, 3 + Math.round((base + 2 - surf[x]) / (H * 0.045)));
    for (let k = 0; k < depth; k++) {
      const i = (surf[x] + k) * W + x;
      if (w.cells[i] === E.STONE) w.set(i, E.SNOW);
    }
  }
  // ===== 雪原地貌：温泉 / 岩石露头 / 冰川舌 / 松林带（均在覆雪之后放置）=====
  // 地热温泉：主峰左麓平地的岩窝热水池（石沿封口，池面与地表齐平），
  // tick 持续冒蒸汽——蒸汽凝雨融雪，泉边四季不冻
  const spaX = Math.max(4, g.cx - g.skirtHalf - 6);
  if (spaX >= 4 && spaX < W - 4) {
    const spaY0 = surf[spaX];
    fillRect(w, spaX - 2, spaY0, spaX + 2, spaY0 + 2, E.EMPTY);
    fillRect(w, spaX - 2, spaY0 + 3, spaX + 2, spaY0 + 3, E.STONE);
    fillRect(w, spaX - 1, spaY0, spaX + 1, spaY0 + 2, E.WATER);
    fillRect(w, spaX - 3, spaY0, spaX - 2, spaY0 + 2, E.STONE);
    fillRect(w, spaX + 2, spaY0, spaX + 3, spaY0 + 2, E.STONE);
  }
  // 岩石露头：雪坡上探出的裸岩（覆雪之后放置，保持裸露）
  for (let n = 0; n < 3; n++) {
    const ad = Math.round(g.spikeHalf * 0.55 + rand() * (g.skirtHalf - g.spikeHalf) * 0.8);
    const x = g.cx + ad * (rand() < 0.5 ? 1 : -1);
    if (x < 1 || x >= W - 1) continue;
    let y0 = 0;
    while (y0 < H && w.cells[y0 * W + x] === E.EMPTY) y0++;
    blob(w, x, y0 + 1, 1 + ((rand() * 2) | 0), 1, E.STONE);
  }
  // 冰川舌：沿右裙坡雪面铺蓝冰直下山脚（覆一道冰裂缝），终端堆冰碛
  {
    const startAd = Math.round(g.spikeHalf * 0.5);
    const gapAd = Math.round(startAd + (g.skirtHalf - startAd) * 0.55);
    for (let ad = startAd; ad <= g.skirtHalf; ad++) {
      if (ad === gapAd) continue; // 冰裂缝
      const x = g.cx + ad;
      if (x < 1 || x >= W - 1) continue;
      let y0 = 0;
      while (y0 < H && w.cells[y0 * W + x] === E.EMPTY) y0++;
      if (y0 >= H) continue;
      for (let k = 0; k < 2 + (ad <= g.spikeHalf ? 1 : 0); k++) {
        const i = (y0 + k) * W + x;
        if (w.cells[i] !== E.EMPTY) w.set(i, E.ICE);
      }
      const j = y0 * W + x + 1;
      if (rand() < 0.7 && w.cells[j] !== E.EMPTY) w.set(j, E.ICE);
    }
    const fx = Math.min(W - 3, g.cx + g.skirtHalf);
    if (fx > 1) {
      let fy = 0;
      while (fy < H && w.cells[fy * W + fx] === E.EMPTY) fy++;
      blob(w, fx, fy + 1, 3, 2, E.ICE);
    }
  }
  // 坡脚雪堆（右侧一处即可，别压泉眼）
  blob(w, Math.min(W - 5, g.cx2 + g.halfW2 + 3), base - 1, 3, 2, E.SNOW);
  // 松林带：老树两株 + 低地补三株（几何定位避 开雪崩雪街），冠顶撒雪（覆雪只认石头，树冠雪手动点缀）
  const crownSnow = [];
  const plant = (x, gy, th, cr) => {
    if (x < 2 || x > W - 3) return;
    tree(w, x, gy, th, cr);
    crownSnow.push({ x, gy, th, cr });
  };
  const groundAt = (x) => {
    const s = surf[Math.max(0, Math.min(W - 1, x))];
    return s && s < H ? s : base + 1;
  };
  if (Math.abs(Math.round(W * 0.06) - spaX) >= 6) plant(Math.round(W * 0.06), base + 1, 6, 3);
  plant(Math.min(W - 3, Math.round(W * 0.97)), base + 1, 5, 2);
  for (const px of [g.cx - g.skirtHalf - 7, Math.round((g.cx + g.skirtHalf + g.lakeX) / 2), g.cx2 + g.halfW2 + 7]) {
    const x = Math.max(2, Math.min(W - 3, Math.round(px)));
    if (Math.abs(x - spaX) < 6) continue; // 别把树种到泉眼上
    if (crownSnow.some((c) => Math.abs(c.x - x) < 5)) continue;
    plant(x, groundAt(x), 5 + (x % 3), 2 + (x % 2));
  }
  for (const c of crownSnow) {
    const cy = c.gy - c.th - 2 - Math.max(1, Math.round(c.cr * 0.75));
    for (let dx = -c.cr; dx <= c.cr; dx++) {
      const i = cy * W + c.x + dx;
      if (w.cells[i] === E.PLANT && rand() < 0.75) w.set(i, E.SNOW);
    }
  }
  // 两层木屋：七宽双层木墙 + 门洞 + 冰窗×4 + 雪顶 + 石烟囱
  const hx0 = Math.round(W * 0.45);
  const hy0 = surf[hx0];
  fillRect(w, hx0 - 3, hy0 - 6, hx0 + 3, hy0 - 1, E.WOOD);
  fillRect(w, hx0 - 4, hy0 - 7, hx0 + 4, hy0 - 7, E.WOOD);
  fillRect(w, hx0 - 3, hy0 - 8, hx0 + 3, hy0 - 8, E.SNOW);
  fillRect(w, hx0 - 2, hy0 - 9, hx0 + 2, hy0 - 9, E.SNOW);
  put(w, hx0 + 3, hy0 - 1, E.EMPTY);
  put(w, hx0 + 3, hy0 - 2, E.EMPTY);
  put(w, hx0 - 3, hy0 - 3, E.ICE);
  put(w, hx0 - 3, hy0 - 5, E.ICE);
  put(w, hx0 + 3, hy0 - 3, E.ICE);
  put(w, hx0 + 3, hy0 - 5, E.ICE);
  fillRect(w, hx0 - 2, hy0 - 12, hx0 - 1, hy0 - 8, E.STONE);
  // 雪人 ×3：三层堆叠（宽底防滑塌，冰晶头）
  for (const fx of [0.28, 0.56, 0.68]) {
    const sx0 = Math.round(W * fx);
    const sy0 = surfaceY(w, sx0);
    for (const dx of [-1, 0, 1]) put(w, sx0 + dx, sy0 - 1, E.SNOW);
    for (const dx of [0, 1]) put(w, sx0 + dx, sy0 - 2, E.SNOW);
    put(w, sx0, sy0 - 3, E.ICE);
  }
  // 冰雕拱门：十宽双排透光冰拱
  const ia0 = Math.round(W * 0.17);
  for (let x = ia0; x <= ia0 + 9; x++) {
    const t = (x - ia0) / 9;
    const ay = surfaceY(w, x) - Math.round(Math.sin(t * Math.PI) * 4) - 1;
    fillRect(w, x, ay, x, ay + 1, E.ICE);
  }
}

// 周期雪崩：前兆闷响 → 雪瀑沿 45° 裙坡自上而下扫过（坡度 ≤1，落雪站得住形成雪街）；
// 峰顶区出现明火/熔岩/雷电会提前引发。纯帧相位驱动，无定时器。
function snowMountainTick(w, frame) {
  if (frame < 600) return;
  const phase = frame % SNOW_CYCLE;
  const g = snowMountainGeometry(w);
  const inWindow = phase >= AVALANCHE_START && phase < AVALANCHE_START + AVALANCHE_LEN;
  // 积雪期：常态缓落新雪；每逢单数轮中段刮暴风雪——雪墙横扫全图
  const cycleN = Math.floor(frame / SNOW_CYCLE);
  const blizzard = cycleN % 2 === 1 && phase >= 900 && phase < 1500;
  if (!inWindow && phase < AVALANCHE_START - 300) {
    if (blizzard) {
      if (phase === 900) {
        w.discover('blizzard');
        if (typeof document !== 'undefined') {
          document.dispatchEvent(new CustomEvent('sb-map-event', { detail: { text: '暴风雪横扫群山！', icon: 'snow' } }));
        }
      }
      if (frame % 8 === 0) {
        const x = Math.round(((phase - 900) / 600) * (w.w - 12)) + 6 + (((Math.random() - 0.5) * 12) | 0);
        if (x >= 0 && x < w.w && w.cells[x] === E.EMPTY) w.set(x, E.SNOW);
      }
    } else if (frame % 24 === 0) {
      const x = g.cx + (((Math.random() - 0.5) * g.skirtHalf * 2.2) | 0);
      if (x >= 0 && x < w.w && w.cells[x] === E.EMPTY) w.set(x, E.SNOW);
    }
  }
  // 地热温泉：泉眼持续冒蒸汽——蒸汽凝雨融雪，泉边四季不冻（泉眼被掩埋/拆改则罢工）
  if (!inWindow && frame % 26 === 0) {
    const spaX = Math.max(4, g.cx - g.skirtHalf - 6);
    if (spaX < w.w - 4) {
      for (let y = 0; y < w.h; y++) {
        const i = y * w.w + spaX;
        const c = w.cells[i];
        if (c === E.WATER) {
          // 从水面上方最近的空格冒汽（雪盖泉眼时从雪顶冒出）。
          // 主体用烟：消散不留水，否则蒸汽凝雨会在低地无限积水成灾；
          // 每六缕夹一缕真蒸汽——凝雨融雪，泉边的"四季不冻"点缀
          let yy = y - 1;
          while (yy >= 0 && w.cells[yy * w.w + spaX] !== E.EMPTY) yy--;
          if (yy >= 0) {
            // 真蒸汽每 600 帧一缕：凝雨有净水量，太频繁会在低地积出连通水膜，
            // 让植物沿水膜蔓延吞掉湖（实测教训）；观感主要由上面的无水烟承担
            if (frame % 600 === 0) w.set(yy * w.w + spaX, E.STEAM, 130 + rand() * 80);
            else w.set(yy * w.w + spaX, E.SMOKE, 60 + rand() * 60);
          }
          break;
        }
        if (c !== E.EMPTY && c !== E.SNOW && c !== E.STONE && c !== E.ICE && c !== E.SMOKE && c !== E.STEAM) break;
      }
    }
  }
  // 前兆：山体闷响
  if (phase === AVALANCHE_START - 300 && typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('sb-map-event', { detail: { text: '山体深处传来闷响…', icon: 'snow' } }));
  }
  // 触发检测（每 15 帧）：主峰上空整列扫描明火/熔岩/电 → 立即引发雪崩。
  // 整列而非固定带：峰顶积雪会高出几何山顶，点火点随之水涨船高
  if (frame % 15 === 0 && !inWindow) {
    const topY = Math.max(0, g.baseY - g.skirtH - g.spikeH);
    const bandH = Math.round(g.spikeH * 0.6);
    const x0 = Math.max(0, g.cx - g.spikeHalf * 2);
    const x1 = Math.min(w.w - 1, g.cx + g.spikeHalf * 2);
    let hot = false;
    for (let x = x0; x <= x1 && !hot; x++) {
      for (let y = 0; y <= topY + bandH; y++) {
        const c = w.cells[y * w.w + x];
        if (c === E.FIRE || c === E.LAVA || c === E.ELECTRIC) {
          hot = true;
          break;
        }
      }
    }
    if (hot) {
      w.avalancheUntil = frame + AVALANCHE_LEN;
      w.discover('avalanche');
      if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('sb-map-event', { detail: { text: '轰隆——雪崩被引发了！', icon: 'snow' } }));
      }
    }
  }
  // 低地残水速冻：溢出湖盆的融水落在冻土上即冻成薄冰（45 帧一扫）。
  // 不留连片水膜——否则植物沿水膜蔓延吞湖成沼（实测教训）；湖盆与温泉池豁免
  if (frame % 45 === 0) {
    const lx0 = Math.max(1, g.lakeX - (g.lakeW >> 1) - 2);
    const lx1 = Math.min(w.w - 2, lx0 + g.lakeW + 4);
    const spaL = Math.max(4, g.cx - g.skirtHalf - 6);
    for (let y = Math.round(w.h * 0.6); y < w.h; y++) {
      for (let x = 1; x < w.w - 1; x++) {
        if (x >= lx0 && x <= lx1) continue;
        if (Math.abs(x - spaL) <= 3 && y > Math.round(w.h * 0.8)) continue;
        const i = y * w.w + x;
        if (w.cells[i] === E.WATER) w.set(i, E.ICE);
      }
    }
  }
  // 融水排走：边界积水视为流出手图（暴风雪融水持续入湖，没有出口迟早淹山成沼）
  if (frame % 30 === 0) {
    for (let y = 0; y < w.h; y++) {
      if (w.cells[y * w.w] === E.WATER) w.set(y * w.w, E.EMPTY);
      const xr = y * w.w + w.w - 1;
      if (w.cells[xr] === E.WATER) w.set(xr, E.EMPTY);
    }
  }
  const pouring = inWindow || frame < (w.avalancheUntil || 0);
  if (!pouring) return;
  if (phase === AVALANCHE_START) w.discover('avalanche');
  // 倾泻进度决定前锋位置（自裙坡顶扫到坡脚），左右坡逐轮交替
  const elapsed = inWindow ? phase - AVALANCHE_START : AVALANCHE_LEN - (w.avalancheUntil - frame);
  const p = 0.1 + 0.85 * Math.max(0, Math.min(1, elapsed / AVALANCHE_LEN));
  const side = ((frame / SNOW_CYCLE) | 0) % 2 === 0 ? 1 : -1;
  const gx = g.cx + side * Math.round(g.spikeHalf + p * g.skirtH);
  const gy = g.baseY - Math.round(g.skirtH * (1 - p));
  // 释放：从雪街雪毯里取走一格雪——雪崩搬运积雪而非凭空造雪，总量守恒不埋山
  const rx = gx + (((Math.random() - 0.5) * 13) | 0);
  if (rx >= 0 && rx < w.w) {
    const scanTop = Math.max(0, gy - Math.round(g.skirtH * 1.2));
    for (let y = scanTop; y < g.baseY; y++) {
      const j = y * w.w + rx;
      if (w.cells[j] === E.SNOW) {
        w.set(j, E.EMPTY);
        break;
      }
    }
  }
  // 落雪：每帧一粒落在前锋上空（与释放相抵，雪街总量稳定）
  const x = gx + (((Math.random() - 0.5) * 9) | 0);
  const y = gy - 2 - ((Math.random() * 4) | 0);
  if (x >= 0 && x < w.w && y >= 0 && w.cells[y * w.w + x] === E.EMPTY) w.set(y * w.w + x, E.SNOW);
}

// icon 为制图平涂场景缩略图 key，取值见 src/icons/index.js 的 biomeIcon()
export const MAPS = [
  { id: 'blank', name: '空白画布', icon: 'blank', desc: '一张白纸，随心创作', gen: blank },
  { id: 'forest', name: '青山林', icon: 'green-forest', desc: '密林参天大树，晨雾漫林，阵雨润泽', gen: forest, tick: forestTick },
  { id: 'archipelago', name: '群岛', icon: 'archipelago', desc: '沙岛礁石珊瑚，每分钟交替海啸，偶有雷暴', gen: archipelagoGen, tick: archipelagoTick },
  { id: 'volcano', name: '火山', icon: 'volcano', desc: '岩浆纹路布满山体，周期喷发', gen: volcanoGen, tick: volcanoTick },
  { id: 'canyon', name: '峡谷', icon: 'canyon', desc: '峭壁夹河，悬壁栈道，偶有岩崩', gen: canyon, tick: canyonTick },
  { id: 'desert', name: '沙漠', icon: 'desert', desc: '沙丘埋油绿洲，沙暴频起，油泉渗漏', gen: desert, tick: desertTick },
  { id: 'city', name: '玻璃之城', icon: 'glass-city', desc: '高楼林立，雷暴夜天线引雷', gen: cityGen, tick: cityTick },
  { id: 'snow-mountain', name: '雪山', icon: 'snow-mountain', desc: '冰川入谷温泉冒汽，周期暴风雪与雪崩；山火雷鸣提前引发', gen: snowMountainGen, tick: snowMountainTick },
];

export function generateMap(world, id) {
  const map = MAPS.find((m) => m.id === id) || MAPS[0];
  map.gen(world);
  return map;
}
