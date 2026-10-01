import { E } from './elements.js';

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const lerp = (a, b, t) => a + (b - a) * t;

// 每元素 16 档明度查找表，渲染时按 shade 取色，零运算开销
function makeShadeLut([r, g, b], spread) {
  const lut = new Uint8Array(48);
  for (let i = 0; i < 16; i++) {
    const f = 1 + ((i / 15) * 2 - 1) * spread;
    lut[i * 3] = clamp255(r * f);
    lut[i * 3 + 1] = clamp255(g * f);
    lut[i * 3 + 2] = clamp255(b * f);
  }
  return lut;
}

// 火焰按剩余寿命从亮黄渐变到暗红余烬
function makeFireLut() {
  const stops = [
    [110, 30, 16],
    [214, 84, 28],
    [255, 152, 44],
    [255, 228, 130],
  ];
  const lut = new Uint8Array(48);
  for (let i = 0; i < 16; i++) {
    const t = (i / 15) * (stops.length - 1);
    const s = Math.min(stops.length - 2, Math.floor(t));
    const f = t - s;
    const a = stops[s];
    const b = stops[s + 1];
    lut[i * 3] = clamp255(a[0] + (b[0] - a[0]) * f);
    lut[i * 3 + 1] = clamp255(a[1] + (b[1] - a[1]) * f);
    lut[i * 3 + 2] = clamp255(a[2] + (b[2] - a[2]) * f);
  }
  return lut;
}

// 电火花按剩余寿命从暗金闪到白热（新火花最亮）
function makeElectricLut() {
  const stops = [
    [150, 110, 20],
    [255, 200, 40],
    [255, 240, 140],
    [255, 253, 230],
  ];
  const lut = new Uint8Array(48);
  for (let i = 0; i < 16; i++) {
    const t = (i / 15) * (stops.length - 1);
    const s = Math.min(stops.length - 2, Math.floor(t));
    const f = t - s;
    const a = stops[s];
    const b = stops[s + 1];
    lut[i * 3] = clamp255(a[0] + (b[0] - a[0]) * f);
    lut[i * 3 + 1] = clamp255(a[1] + (b[1] - a[1]) * f);
    lut[i * 3 + 2] = clamp255(a[2] + (b[2] - a[2]) * f);
  }
  return lut;
}

// 正弦查找表：星点闪烁 / 水下光影 / 萤火虫呼吸共用
const LUT_N = 2048;
const SIN_LUT = new Float32Array(LUT_N);
for (let i = 0; i < LUT_N; i++) SIN_LUT[i] = Math.sin((i / LUT_N) * Math.PI * 2);
const lutSin = (idx) => SIN_LUT[idx & (LUT_N - 1)];

const STAR_COLOR = [215, 228, 255];
const FIREFLY_COLOR = [190, 255, 130];

export class Renderer {
  constructor(ctx, tex, w, h) {
    this.ctx = ctx;
    this.tex = tex;
    this.w = w;
    this.h = h;
    this.img = ctx.createImageData(w, h);
    // 透明通道一次性置满，后续只写 RGB
    const d = this.img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = 255;

    this.luts = {
      [E.SAND]: makeShadeLut([217, 177, 102], 0.13),
      [E.STONE]: makeShadeLut([134, 140, 150], 0.1),
      [E.WOOD]: makeShadeLut([122, 82, 48], 0.16),
      [E.PLANT]: makeShadeLut([63, 174, 74], 0.22),
      [E.OIL]: makeShadeLut([88, 74, 46], 0.14),
      [E.STEAM]: makeShadeLut([205, 214, 226], 0.07),
      [E.SMOKE]: makeShadeLut([104, 110, 120], 0.12),
      [E.GLASS]: makeShadeLut([176, 214, 224], 0.05),
      [E.LAVA]: makeShadeLut([235, 92, 30], 0.15),
      [E.GUNPOWDER]: makeShadeLut([58, 58, 62], 0.3),
      [E.SALT]: makeShadeLut([226, 229, 234], 0.06),
      [E.ACID]: makeShadeLut([96, 200, 52], 0.18),
      [E.SOIL]: makeShadeLut([139, 94, 60], 0.18),
      [E.SNOW]: makeShadeLut([238, 244, 252], 0.04),
      [E.METAL]: makeShadeLut([168, 182, 200], 0.08),
      [E.H2]: makeShadeLut([207, 232, 248], 0.06),
    };
    this.waterLut = makeShadeLut([52, 112, 210], 0.2);
    this.fireLut = makeFireLut();
    this.electricLut = makeElectricLut();
    // 经典主题：深夜蓝到暖黑纵向渐变
    this.rowBg = [];
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1);
      this.rowBg.push([13 + 9 * t, 16 + 11 * t, 25 + 14 * t]);
    }
    // 星空：位置固定、相位随机的星点 + 流星状态机
    this.stars = Array.from({ length: 42 }, () => ({
      x: 1 + ((Math.random() * (w - 2)) | 0),
      y: (Math.random() * h * 0.62) | 0,
      phaseIdx: ((Math.random() * LUT_N) | 0),
      speed: 0.5 + Math.random(),
      bright: 0.35 + Math.random() * 0.65,
      big: Math.random() < 0.2,
    }));
    this.meteor = { on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, next: 500 + Math.random() * 800 };
    // 昼夜循环：午夜→黎明→白昼→黄昏 的天顶/地平线关键帧
    this.dayKeys = [
      { top: [10, 12, 24], hor: [21, 27, 43] },
      { top: [28, 26, 52], hor: [188, 98, 66] },
      { top: [62, 102, 156], hor: [148, 180, 204] },
      { top: [36, 27, 58], hor: [226, 124, 74] },
    ];
    // 远山两层剪影的每列山脊线
    this.mtnFar = new Int16Array(w);
    this.mtnNear = new Int16Array(w);
    for (let x = 0; x < w; x++) {
      this.mtnFar[x] = (h - 42 - (Math.sin(x * 0.045) * 9 + Math.sin(x * 0.11 + 2) * 6 + Math.sin(x * 0.023 + 1) * 7)) | 0;
      this.mtnNear[x] = (h - 24 - (Math.sin(x * 0.035 + 5) * 7 + Math.sin(x * 0.09 + 1) * 4)) | 0;
    }
    this.fireflies = Array.from({ length: 6 }, () => ({
      x: 8 + Math.random() * (w - 16),
      y: 10 + Math.random() * (h - 60),
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.2,
      phaseIdx: (Math.random() * LUT_N) | 0,
    }));
    // 雪山晴昼：双层雪山山脊线 + 飘雪
    this.snowFar = new Int16Array(w);
    this.snowNear = new Int16Array(w);
    for (let x = 0; x < w; x++) {
      this.snowFar[x] = Math.round(
        h * 0.58 + Math.sin(x * 0.05) * h * 0.055 + Math.sin(x * 0.13 + 2) * h * 0.03
      );
      this.snowNear[x] = Math.round(
        h * 0.74 + Math.sin(x * 0.037 + 4) * h * 0.04 + Math.sin(x * 0.09 + 1) * h * 0.022
      );
    }
    this.flakes = Array.from({ length: 70 }, () => ({
      bx: Math.random() * w,
      by: Math.random() * h,
      vy: 0.15 + Math.random() * 0.3,
      ph: Math.random() * Math.PI * 2,
      big: Math.random() < 0.3,
    }));
  }

  draw(world, themeId = 'classic') {
    const d = this.img.data;
    this.fillTheme(d, themeId, world.frame, world.w, world.h);
    this.drawElements(world);
    this.ctx.putImageData(this.img, 0, 0);
    this.tex.refresh();
  }

  fillTheme(d, themeId, frame, w, h) {
    if (themeId === 'stars') {
      this.fillClassic(d, w, h);
      this.stampStars(d, frame, w, 1);
      this.stampMeteor(d, frame, w, h, 1);
    } else if (themeId === 'aurora') {
      this.fillAurora(d, frame, w, h);
    } else if (themeId === 'snowday') {
      this.fillSnowDay(d, frame, w, h);
    } else if (themeId === 'daycycle') {
      this.fillDayCycle(d, frame, w, h);
    } else if (themeId === 'underwater') {
      this.fillUnderwater(d, frame, w, h);
    } else if (themeId === 'mountains') {
      this.fillMountains(d, frame, w, h);
    } else {
      this.fillClassic(d, w, h);
    }
  }

  // 极光之夜：波动光幕自上而下渐隐，色相沿水平流动（绿→青→紫）
  fillAurora(d, frame, w, h) {
    const g1 = [96, 255, 160];
    const g2 = [150, 120, 255];
    const g3 = [80, 220, 220];
    for (let x = 0; x < w; x++) {
      // 光幕竖条强度 + 帘底高度都随时间缓慢波动
      const band = lutSin(x * 9 + frame * 0.5 + 6 * lutSin(x * 4 - frame * 0.33));
      const strip = Math.max(0, band - 0.3);
      const baseY = h * 0.2 + lutSin(x * 5 - frame * 0.2) * h * 0.08;
      const hue = lutSin(x * 3 + frame * 0.1);
      const cr = hue < 0 ? lerp(g1[0], g2[0], -hue) : lerp(g1[0], g3[0], hue);
      const cg = hue < 0 ? lerp(g1[1], g2[1], -hue) : lerp(g1[1], g3[1], hue);
      const cb = hue < 0 ? lerp(g1[2], g2[2], -hue) : lerp(g1[2], g3[2], hue);
      const invFall = 1 / (h * 0.17);
      for (let y = 0; y < h; y++) {
        const t = y / (h - 1);
        let p = (y * w + x) * 4;
        const env = Math.max(0, 1 - Math.abs(y - baseY) * invFall);
        const a = strip * env * env * 0.9;
        const r0 = 8 + 8 * t;
        const g0 = 10 + 10 * t;
        const b0 = 20 + 14 * t;
        d[p] = r0 + (cr - r0) * a;
        d[p + 1] = g0 + (cg - g0) * a;
        d[p + 2] = b0 + (cb - b0) * a;
      }
    }
    this.stampStars(d, frame, w, 0.9);
  }

  fillClassic(d, w, h) {
    let p = 0;
    for (let y = 0; y < h; y++) {
      const bg = this.rowBg[y];
      for (let x = 0; x < w; x++) {
        d[p] = bg[0];
        d[p + 1] = bg[1];
        d[p + 2] = bg[2];
        p += 4;
      }
    }
  }

  // 把星点向当前底色叠加（乘 alphaMul 可用于昼夜主题的夜间淡入）
  stampStars(d, frame, w, alphaMul) {
    for (const s of this.stars) {
      const v = lutSin(frame * s.speed * 5 + s.phaseIdx);
      if (v <= 0.05) continue;
      const a = v * v * s.bright * alphaMul;
      this.stampPx(d, w, s.x, s.y, STAR_COLOR, a);
      if (s.big) this.stampPx(d, w, s.x + 1, s.y, STAR_COLOR, a * 0.6);
    }
  }

  stampMeteor(d, frame, w, h, alphaMul) {
    const m = this.meteor;
    if (!m.on) {
      if (frame >= m.next) {
        m.on = true;
        m.t = 0;
        m.x = w * 0.15 + Math.random() * w * 0.7;
        m.y = 8 + Math.random() * 30;
        m.vx = (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random());
        m.vy = 0.8 + Math.random() * 0.6;
      }
      return;
    }
    m.t++;
    m.x += m.vx;
    m.y += m.vy;
    const fade = 1 - m.t / 50;
    for (let k = 0; k < 7; k++) {
      const px = Math.round(m.x - m.vx * k);
      const py = Math.round(m.y - m.vy * k);
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const a = Math.max(0, fade * (1 - k / 7)) * 0.85 * alphaMul;
      this.stampPx(d, w, px, py, [235, 240, 255], a);
    }
    if (m.t > 50) {
      m.on = false;
      m.next = frame + 700 + Math.random() * 1400;
    }
  }

  fillDayCycle(d, frame, w, h) {
    const CYCLE = 14400; // 60fps 下约 4 分钟一昼夜，phase 0 = 午夜
    const phase = (frame % CYCLE) / CYCLE;
    const segF = phase * 4;
    const seg = segF | 0;
    const f = segF - seg;
    const a = this.dayKeys[seg];
    const b = this.dayKeys[(seg + 1) & 3];
    const top = [lerp(a.top[0], b.top[0], f), lerp(a.top[1], b.top[1], f), lerp(a.top[2], b.top[2], f)];
    const hor = [lerp(a.hor[0], b.hor[0], f), lerp(a.hor[1], b.hor[1], f), lerp(a.hor[2], b.hor[2], f)];
    let p = 0;
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1);
      const r = lerp(top[0], hor[0], t);
      const g = lerp(top[1], hor[1], t);
      const bl = lerp(top[2], hor[2], t);
      for (let x = 0; x < w; x++) {
        d[p] = r;
        d[p + 1] = g;
        d[p + 2] = bl;
        p += 4;
      }
    }
    // 夜幕系数：午夜最亮、正午归零，控制星点流星淡入淡出
    let night = Math.max(0, Math.cos(phase * Math.PI * 2));
    night *= night;
    if (night > 0.02) this.stampStars(d, frame, w, night);
    if (night > 0.3) this.stampMeteor(d, frame, w, h, night);
  }

  fillUnderwater(d, frame, w, h) {
    const top = [14, 42, 64];
    const hor = [7, 18, 32];
    const glowC = [110, 175, 185];
    let p = 0;
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1);
      const r0 = lerp(top[0], hor[0], t);
      const g0 = lerp(top[1], hor[1], t);
      const b0 = lerp(top[2], hor[2], t);
      const depth = 1 - t * 0.7; // 光柱靠上更强
      for (let x = 0; x < w; x++) {
        const g =
          (lutSin(x * 21 + frame * 2) + lutSin((x + y) * 13 - frame * 3)) * 0.5;
        const a = Math.max(0, g) * 0.38 * depth;
        d[p] = clamp255(r0 + (glowC[0] - r0) * a);
        d[p + 1] = clamp255(g0 + (glowC[1] - g0) * a);
        d[p + 2] = clamp255(b0 + (glowC[2] - b0) * a);
        p += 4;
      }
    }
  }

  fillMountains(d, frame, w, h) {
    let p = 0;
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1);
      const sr = 11 + 8 * t;
      const sg = 13 + 10 * t;
      const sb = 20 + 13 * t;
      for (let x = 0; x < w; x++) {
        if (y >= this.mtnNear[x]) {
          d[p] = 15;
          d[p + 1] = 18;
          d[p + 2] = 30;
        } else if (y >= this.mtnFar[x]) {
          d[p] = 27;
          d[p + 1] = 33;
          d[p + 2] = 50;
        } else {
          d[p] = sr;
          d[p + 1] = sg;
          d[p + 2] = sb;
        }
        p += 4;
      }
    }
    this.stampStars(d, frame, w, 0.5);
    this.updateFireflies(d, frame, w, h);
  }

  // 白天雪山：亮白天光 + 两层积雪远山 + 飘雪
  fillSnowDay(d, frame, w, h) {
    const top = [104, 158, 222];
    const hor = [206, 228, 246];
    for (let x = 0; x < w; x++) {
      const nearY = this.snowNear[x];
      const farY = this.snowFar[x];
      // 近山脊的棱线明暗交替，做出雪坡受光面
      const facet = Math.sin(x * 0.21 + 1) > 0.2 ? 1 : 0;
      for (let y = 0; y < h; y++) {
        const p = (y * w + x) * 4;
        const t = y / (h - 1);
        if (y >= nearY) {
          d[p] = 176 - facet * 12;
          d[p + 1] = 196 - facet * 10;
          d[p + 2] = 222 - facet * 8;
        } else if (y >= farY) {
          d[p] = 214 + facet * 14;
          d[p + 1] = 227 + facet * 12;
          d[p + 2] = 242;
        } else {
          d[p] = lerp(top[0], hor[0], t);
          d[p + 1] = lerp(top[1], hor[1], t);
          d[p + 2] = lerp(top[2], hor[2], t);
        }
      }
    }
    // 飘雪
    for (const f of this.flakes) {
      const y = (f.by + frame * f.vy) % (h + 8);
      const x = (f.bx + Math.sin(frame * 0.015 + f.ph) * 12 + w) % w;
      this.stampPx(d, w, Math.round(x), Math.round(y), [255, 255, 255], 0.9);
      if (f.big) this.stampPx(d, w, Math.round(x) + 1, Math.round(y), [255, 255, 255], 0.55);
    }
  }

  updateFireflies(d, frame, w, h) {
    for (const f of this.fireflies) {
      f.vx += (Math.random() - 0.5) * 0.04;
      f.vy += (Math.random() - 0.5) * 0.03;
      f.vx = Math.max(-0.4, Math.min(0.4, f.vx));
      f.vy = Math.max(-0.3, Math.min(0.3, f.vy));
      f.x += f.vx;
      f.y += f.vy;
      if (f.x < 4) { f.x = 4; f.vx = Math.abs(f.vx); }
      if (f.x > w - 4) { f.x = w - 4; f.vx = -Math.abs(f.vx); }
      if (f.y < 8) { f.y = 8; f.vy = Math.abs(f.vy); }
      if (f.y > h - 46) { f.y = h - 46; f.vy = -Math.abs(f.vy); }
      const glow = lutSin(frame * 12 + f.phaseIdx);
      if (glow <= 0.08) continue;
      const px = Math.round(f.x);
      const py = Math.round(f.y);
      this.stampPx(d, w, px, py, FIREFLY_COLOR, glow * 0.85);
      this.stampPx(d, w, px + 1, py, FIREFLY_COLOR, glow * 0.25);
      this.stampPx(d, w, px - 1, py, FIREFLY_COLOR, glow * 0.25);
      this.stampPx(d, w, px, py + 1, FIREFLY_COLOR, glow * 0.25);
      this.stampPx(d, w, px, py - 1, FIREFLY_COLOR, glow * 0.25);
    }
  }

  stampPx(d, w, x, y, [r, g, b], a) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const p = (y * this.w + x) * 4;
    d[p] = clamp255(d[p] + (r - d[p]) * a);
    d[p + 1] = clamp255(d[p + 1] + (g - d[p + 1]) * a);
    d[p + 2] = clamp255(d[p + 2] + (b - d[p + 2]) * a);
  }

  // 元素叠加：背景已铺满，只写非空格子
  drawElements(world) {
    const { cells, life, shade, frame } = world;
    const d = this.img.data;
    let p = 0;
    for (let i = 0; i < cells.length; i++, p += 4) {
      const id = cells[i];
      if (id === E.EMPTY) continue;
      if (id === E.FIRE) {
        const o = Math.min(15, life[i] >> 3) * 3;
        d[p] = this.fireLut[o];
        d[p + 1] = this.fireLut[o + 1];
        d[p + 2] = this.fireLut[o + 2];
      } else if (id === E.ELECTRIC) {
        // 电火花：寿命越长越白热，临近消散转暗金
        const o = Math.min(15, life[i] << 1) * 3;
        d[p] = this.electricLut[o];
        d[p + 1] = this.electricLut[o + 1];
        d[p + 2] = this.electricLut[o + 2];
      } else if (id === E.METAL && life[i] > 0) {
        // 通电金属：高频亮黄频闪（与通电水同款电光）
        const o = (((shade[i] >> 4) + (frame << 1)) & 15) * 3;
        d[p] = this.electricLut[o];
        d[p + 1] = this.electricLut[o + 1];
        d[p + 2] = this.electricLut[o + 2];
      } else if (id === E.WATER || id === E.LAVA || id === E.ACID) {
        // 液体用时间项叠加制造微光流动感
        if (id === E.WATER && life[i] > 0) {
          // 通电水：高频亮黄频闪
          const o = (((shade[i] >> 4) + (frame << 1)) & 15) * 3;
          d[p] = this.electricLut[o];
          d[p + 1] = this.electricLut[o + 1];
          d[p + 2] = this.electricLut[o + 2];
        } else {
          const o = (((shade[i] >> 4) + (frame >> 2)) & 15) * 3;
          const lut = id === E.WATER ? this.waterLut : this.luts[id];
          d[p] = lut[o];
          d[p + 1] = lut[o + 1];
          d[p + 2] = lut[o + 2];
        }
      } else {
        const o = (shade[i] >> 4) * 3;
        const lut = this.luts[id];
        d[p] = lut[o];
        d[p + 1] = lut[o + 1];
        d[p + 2] = lut[o + 2];
      }
    }
  }
}
