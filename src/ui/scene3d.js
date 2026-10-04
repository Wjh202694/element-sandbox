import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './store.js';
import { biomeIcon, systemIcon } from '../icons/index.js';
import { E, EL } from '../sim/elements.js';
import { seaAmbientStart, seaAmbientStop, geyserHiss, thunder, volcanoRumble, waveCrash, windHowl } from './sound.js';

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 配色（与 2D 调色板一致）
const C_SOIL = hexRgb('#8b5e3c');
const C_STONE = hexRgb('#8a8f98');
const C_SAND = hexRgb('#d9b166');
const C_WATER = hexRgb('#3f7fd9');
const C_WOOD = hexRgb('#7a5230');
const C_PLANT = hexRgb('#3fae4a');
const C_LAVA = hexRgb('#e85a20');
const C_FIRE = [255, 150, 60];
const C_BEDROCK = hexRgb('#2a303c');

const rand = Math.random;

// 我的世界式俯瞰体素火山岛（程序化生成，与 2D 世界解耦）：
// 圆形地盘中间高四周低：中央高耸火山锥（火口熔岩湖 + 4 道蜿蜒熔岩流 + 流顶火焰），
// 外圈低地泥土森林带：主河蜿蜒 + 4 条支流 + 沙滩 + 60~80 棵随机树（4 种形态）。
// 方块从空中逐个落下自主搭建（GPU 顶点着色器驱动），黑色大圆盘托底。
export function create3DScene(world, host, renderer2d) {
  const frame = () => world.frame;
  const W = world.w;
  const H = world.h;
  const S = Math.max(110, Math.min(240, Math.round(W * 0.6))); // 岛直径（格）
  const R = S / 2;
  const Rv = R * 0.56; // 火山锥半径
  const PEAK = Math.round(R * 0.55); // 火山峰高（约为岛直径的 27%）

  const veinSeed = rand() * Math.PI * 2; // 熔岩流整体朝向（每次进入随机）
  const riverSeed = rand() * Math.PI * 2; // 主河相位

  // ===== 高度场与材质 =====
  // 3 道蜿蜒熔岩流：角向正弦摆动，越向下越宽
  const veinBase = [0.3, 0.3 + 1.9, 0.3 + 3.9].map((a) => a + veinSeed);
  function veinOffset(r, k) {
    return Math.sin(r * 0.09 + k * 2.7 + veinSeed) * 0.3;
  }
  function lavaVeinAt(i, j, ang, r) {
    for (let k = 0; k < 3; k++) {
      const da = Math.abs(
        ((ang - veinBase[k] - veinOffset(r, k) + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      );
      const width = 0.05 + (1 - r / Rv) * 0.16; // 近火口窄、下坡宽
      if (da < width && r > Rv * 0.08) return true;
    }
    return false;
  }

  function coneHeight(r) {
    return PEAK * Math.pow(Math.max(0, 1 - r / Rv), 0.8);
  }

  // 主河：角向正弦蜿蜒的环河 + 支流
  function riverRadius(ang) {
    return (
      R * (0.79 + 0.06 * Math.sin(ang * 3 + riverSeed) + 0.04 * Math.sin(ang * 7 + riverSeed * 2))
    );
  }
  function inRiver(r, ang) {
    return Math.abs(r - riverRadius(ang)) < 2.4;
  }
  // 支流：从火山脚向外延伸到主河的 6 条放射小溪
  const tribBase = [0.55, 1.45, 2.35, 3.25, 4.15, 5.05].map((a) => a + riverSeed);
  function inTributary(i, j, ang, r) {
    for (let k = 0; k < tribBase.length; k++) {
      const tribAng = tribBase[k] + Math.sin(r * 0.12 + k * 3.1) * 0.18;
      const da = Math.abs(((ang - tribAng + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da < 0.05 && r > Rv * 0.98 && r < riverRadius(ang) - 2) return true;
    }
    return false;
  }
  // 出海水道：出海口方向的支流越岛缘把水引上黑底盘（与熔岩道角距拉满，互不相撞）
  const outflowAng = tribBase[3];
  // 熔岩道：接 0 号岩脉出锥，跨环河（接触点白汽+黑曜石）后一路流到盘缘
  const lavaExit = veinBase[0] + veinOffset(Rv, 0);
  const wig = (r, s) => Math.sin(r * 0.13 + s) * 0.05;
  const nearAng = (ang, target, w) =>
    Math.abs(((ang - target + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < w;
  // 熔岩与环河的接触点（世界坐标）：白汽翻涌 + 黑曜石散布的锚点
  const lavaContact = {
    x: Math.cos(lavaExit) * riverRadius(lavaExit) - R + 0.5,
    z: Math.sin(lavaExit) * riverRadius(lavaExit) - R + 0.5,
  };

  const cols = new Map(); // key → {h, id}
  const noTree = new Set(); // 熔岩道/水道/接触点周围禁种树
  for (let i = 0; i < S; i++) {
    for (let j = 0; j < S; j++) {
      const dx = i - R;
      const dz = j - R;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r > R) continue;
      const ang = Math.atan2(dz, dx);
      const key = i * 1000 + j;

      let h = 1;
      let id = 15; // 土

      if (r < Rv) {
        // 火山锥
        h = Math.round(coneHeight(r) + Math.sin(i * 0.21 + j * 0.17) * 2 * (r / Rv));
        id = 3; // 石
        if (r < Rv * 0.16) {
          h = Math.round(PEAK * 0.7); // 火口熔岩湖
          id = 11;
        } else if (r < Rv * 0.3) {
          h = Math.max(h, Math.round(PEAK * 0.8)); // 火口环脊
          id = 3;
        }
        if (lavaVeinAt(i, j, ang, r) && r > Rv * 0.12) {
          h = Math.round(coneHeight(r) * 0.96); // 熔岩嵌入地表
          id = 11;
        }
      } else {
        // 外圈低地：泥土起伏
        h = Math.max(2, Math.round(3 + Math.sin(i * 0.21 + j * 0.17) * 1.6 + Math.sin(i * 0.083 + j * 0.29) * 1.4));
        if (inRiver(r, ang) || inTributary(i, j, ang, r)) {
          h = 1; // 河床下切
          id = 2; // 水
        } else if (r > Rv && nearAng(ang, lavaExit + wig(r, 1), 0.04)) {
          // 熔岩道：接岩脉出锥，贴低地地表流淌；跨环河段让位给水（接触点在两岸）
          h = Math.max(2, h);
          id = 11;
          noTree.add(key);
        } else if (nearAng(ang, outflowAng + wig(r, 0), 0.035) && r > riverRadius(ang) - 1) {
          // 出海水道：自河岸直通岛缘
          h = 1;
          id = 2;
          noTree.add(key);
        } else if (r > R * 0.965) {
          h = Math.max(1, h - 1); // 外缘
        }
      }
      cols.set(key, { h, id });
    }
  }

  // 沙滩：水岸两侧的非水泥土铺沙
  for (const [key, col] of cols) {
    if (col.id !== 2) continue;
    const i = Math.floor(key / 1000);
    const j = key % 1000;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nk = (i + di) * 1000 + (j + dj);
      const nc = cols.get(nk);
      if (nc && nc.id === 15) nc.id = 1; // 沙
    }
  }

  // ===== 组装实例（含树木）=====
  let items = []; // {x, z, y0, h, sx, sz, rgb, glow}；海岛模式会整体换成群岛实例
  for (const [key, col] of cols) {
    const i = Math.floor(key / 1000);
    const j = key % 1000;
    const rgb =
      col.id === 11
        ? C_LAVA
        : col.id === 2
          ? C_WATER
          : col.id === 1
            ? C_SAND
            : col.id === 15
              ? C_SOIL
              : C_STONE;
    items.push({ x: i, z: j, y0: 0, h: col.h, sx: 1, sz: 1, rgb, glow: col.id === 11, id: col.id });
  }
  // 黑底盘上的两条尾流：出海水流与熔岩各自从岛缘延展到盘面深处（角距拉满不相交）
  const discEnd = R * 1.22;
  for (let rr = R + 1; rr <= discEnd; rr++) {
    const wa = outflowAng + wig(rr, 0) * 1.4;
    items.push({
      x: Math.round(R + Math.cos(wa) * rr), z: Math.round(R + Math.sin(wa) * rr),
      y0: -1, h: 1.3, sx: 1, sz: 1, rgb: C_WATER, glow: false,
    });
    const la = lavaExit + wig(rr, 1) * 1.4;
    items.push({
      x: Math.round(R + Math.cos(la) * rr), z: Math.round(R + Math.sin(la) * rr),
      y0: -1, h: 1.3, sx: 1, sz: 1, rgb: C_LAVA, glow: true,
    });
  }
  // 出海跌水：岛缘断崖处的水柱（岛面水流落到底盘）
  const fa = outflowAng + wig(R, 0) * 1.4;
  items.push({
    x: Math.round(R + Math.cos(fa) * (R + 0.5)), z: Math.round(R + Math.sin(fa) * (R + 0.5)),
    y0: -1, h: 3, sx: 1, sz: 1, rgb: C_WATER, glow: false,
  });
  // 黑曜石：熔岩触河接触点四周不规则散布（随机角距独立抖动，不成环）
  const contactR = riverRadius(lavaExit);
  const contactI = Math.round(R + Math.cos(lavaExit) * contactR);
  const contactJ = Math.round(R + Math.sin(lavaExit) * contactR);
  for (let dx = -5; dx <= 5; dx++) {
    for (let dz = -5; dz <= 5; dz++) noTree.add((contactI + dx) * 1000 + (contactJ + dz));
  }
  for (let n = 0; n < 14; n++) {
    const a = lavaExit + (rand() - 0.5) * 0.5;
    const rr = contactR + (rand() - 0.5) * 9;
    const oi = Math.round(R + Math.cos(a) * rr);
    const oj = Math.round(R + Math.sin(a) * rr);
    const c = cols.get(oi * 1000 + oj);
    if (!c) continue;
    items.push({
      x: oi, z: oj, y0: c.h, h: 0.6 + rand() * 0.8,
      sx: 0.7 + rand() * 0.6, sz: 0.7 + rand() * 0.6, rgb: [40, 34, 52], glow: false,
    });
  }

  // 树：4 种形态，随机散布在外圈泥土地上（避开河道）
  function addTree(x, z, ground) {
    const type = rand();
    if (type < 0.2) {
      // 针叶树：三层收分的绿色塔冠
      const trunk = 3 + ((rand() * 3) | 0);
      items.push({ x, z, y0: ground, h: trunk, sx: 0.6, sz: 0.6, rgb: C_WOOD, glow: false });
      for (let l = 0; l < 3; l++) {
        items.push({
          x, z, y0: ground + trunk + l * 1.5, h: 1.4,
          sx: 2.2 - l * 0.6, sz: 2.2 - l * 0.6, rgb: C_PLANT, glow: false,
        });
      }
      items.push({ x, z, y0: ground + trunk + 4.5, h: 1, sx: 0.7, sz: 0.7, rgb: C_PLANT, glow: false });
    } else if (type < 0.45) {
      // 阔叶树：细干 + 十字冠
      const trunk = 3 + ((rand() * 4) | 0);
      items.push({ x, z, y0: ground, h: trunk, sx: 0.6, sz: 0.6, rgb: C_WOOD, glow: false });
      const cy = ground + trunk;
      items.push({ x, z, y0: cy, h: 1, sx: 2, sz: 2, rgb: C_PLANT, glow: false });
      items.push({ x: x - 1, z, y0: cy, h: 1, sx: 1, sz: 1, rgb: C_PLANT, glow: false });
      items.push({ x: x + 1, z, y0: cy, h: 1, sx: 1, sz: 1, rgb: C_PLANT, glow: false });
      items.push({ x, z: z - 1, y0: cy, h: 1, sx: 1, sz: 1, rgb: C_PLANT, glow: false });
      items.push({ x, z: z + 1, y0: cy, h: 1, sx: 1, sz: 1, rgb: C_PLANT, glow: false });
      items.push({ x, z, y0: cy + 1, h: 1, sx: 1.3, sz: 1.3, rgb: C_PLANT, glow: false });
    } else if (type < 0.6) {
      // 枯木
      items.push({ x, z, y0: ground, h: 3 + ((rand() * 3) | 0), sx: 0.5, sz: 0.5, rgb: C_WOOD, glow: false });
    } else {
      // 大树：粗干 + 方块厚冠
      const trunk = 5 + ((rand() * 4) | 0);
      items.push({ x, z, y0: ground, h: trunk, sx: 0.9, sz: 0.9, rgb: C_WOOD, glow: false });
      items.push({ x, z, y0: ground + trunk, h: 2, sx: 2.6, sz: 2.6, rgb: C_PLANT, glow: false });
      items.push({ x, z, y0: ground + trunk + 2, h: 1.5, sx: 1.8, sz: 1.8, rgb: C_PLANT, glow: false });
    }
  }
  let treeCount = 0;
  const soilCols = [];
  for (const it of items) {
    if (it.id === 15 && it.h >= 3) soilCols.push(it);
  }
  for (let tries = 0; tries < 600 && treeCount < 70; tries++) {
    const it = soilCols[(rand() * soilCols.length) | 0];
    if (!it) break;
    if (noTree.has(it.x * 1000 + it.z)) continue; // 避开水道/熔岩道/接触点
    if (items.some((o) => o.tree && Math.abs(o.x - it.x) < 4 && Math.abs(o.z - it.z) < 4)) continue;
    addTree(it.x, it.z, it.h);
    it.tree = true;
    treeCount++;
  }
  // 保底 35 棵
  for (let t = treeCount; t < 35; t++) {
    const ang = rand() * Math.PI * 2;
    const r = Rv * 1.05 + rand() * (R - Rv * 1.15);
    addTree(Math.round(R + Math.cos(ang) * r), Math.round(R + Math.sin(ang) * r), 3);
    treeCount++;
  }
  // 草皮生态：未种树的土柱撒灌木与野花（与海岛同款三色小花）
  let floraCount = 0;
  for (const it of soilCols) {
    if (it.tree || it.h < 3 || floraCount >= 90) continue;
    if (rand() < 0.72) continue;
    if (rand() < 0.4) {
      items.push({ x: it.x, z: it.z, y0: it.h, h: 0.7, sx: 0.75, sz: 0.75, rgb: [44, 126, 54], glow: false });
    } else {
      const fc = [[232, 92, 92], [255, 214, 110], [244, 244, 244]][(rand() * 3) | 0];
      items.push({ x: it.x, z: it.z, y0: it.h, h: 0.35, sx: 0.4, sz: 0.4, rgb: fc, glow: false });
    }
    floraCount++;
  }
  // 焦黑枯树：锥缘外侧土柱上的烧焦树（深炭色光秃主干，火山性格）
  for (let n = 0; n < 3; n++) {
    const near = soilCols.filter(
      (it) => !it.tree && Math.hypot(it.x - R, it.z - R) < Rv * 1.35
    );
    const it = near[(rand() * near.length) | 0];
    if (!it) break;
    const th = 4 + ((rand() * 2) | 0);
    items.push({ x: it.x, z: it.z, y0: it.h, h: th, sx: 0.5, sz: 0.5, rgb: [42, 36, 30], glow: false });
    items.push({ x: it.x, z: it.z, y0: it.h + th - 1, h: 0.5, sx: 1.1, sz: 0.5, rgb: [42, 36, 30], glow: false });
  }

  // ===== 火山地貌静物：火口环脊硫磺晶簇 / 熔岩流口黑曜石 / 河岸浮石堆 / 低地温泉池 =====
  // 直接进 items 走既有实例化渲染：零额外 draw call，自动获得下落入场与明度抖动
  const hotSprings = []; // 温泉池位置，供间歇泉 FX 取用
  for (let n = 0; n < 4; n++) {
    // 硫磺晶簇：火口环脊上 4 簇细高黄晶柱
    const a = veinSeed + 1.1 + n * 1.55 + rand() * 0.5;
    const r = Rv * (0.2 + rand() * 0.08);
    const sx0 = Math.round(R + Math.cos(a) * r);
    const sz0 = Math.round(R + Math.sin(a) * r);
    const c = cols.get(sx0 * 1000 + sz0);
    if (!c || c.id === 11 || c.id === 2) continue;
    const k = 2 + ((rand() * 2) | 0);
    for (let m = 0; m < k; m++) {
      items.push({
        x: sx0 + ((rand() * 3) | 0) - 1,
        z: sz0 + ((rand() * 3) | 0) - 1,
        y0: c.h, h: 1.2 + rand() * 1.4, sx: 0.35, sz: 0.35,
        rgb: [236, 220, 100], glow: false,
      });
    }
  }
  for (let k = 0; k < 3; k++) {
    // 黑曜石碎块：熔岩流冲出锥体的出口外侧，黑紫玻璃碎块散落
    const a = veinBase[k] + veinOffset(Rv * 0.98, k);
    for (let m = 0; m < 3; m++) {
      const r = Rv * (1.05 + rand() * 0.12);
      const x = Math.round(R + Math.cos(a + (rand() - 0.5) * 0.18) * r);
      const z = Math.round(R + Math.sin(a + (rand() - 0.5) * 0.18) * r);
      const c = cols.get(x * 1000 + z);
      if (!c || c.id === 2) continue;
      items.push({
        x, z, y0: c.h, h: 0.6 + rand() * 0.9, sx: 0.5 + rand() * 0.4, sz: 0.5 + rand() * 0.4,
        rgb: [40, 34, 52], glow: false,
      });
    }
  }
  for (let n = 0; n < 6; n++) {
    // 浮石堆：主河岸边的浅灰多孔石块
    const a = rand() * Math.PI * 2;
    const rr = riverRadius(a) + (rand() < 0.5 ? -3.8 : 3.8) + (rand() - 0.5) * 1.6;
    const x = Math.round(R + Math.cos(a) * rr);
    const z = Math.round(R + Math.sin(a) * rr);
    const c = cols.get(x * 1000 + z);
    if (!c || c.id === 2) continue;
    items.push({
      x, z, y0: c.h, h: 0.4 + rand() * 0.5, sx: 0.45 + rand() * 0.3, sz: 0.45 + rand() * 0.3,
      rgb: [188, 186, 178], glow: false,
    });
  }
  for (let n = 0; n < 2; n++) {
    // 温泉池：低地热泉，青蓝发光池面（自发光，夜里也亮），蒸汽归 FX 层
    const a = riverSeed + 2.2 + n * 2.6;
    const rr = Rv * 1.32 + rand() * Math.max(2, R * 0.92 - Rv * 1.42);
    const x = Math.round(R + Math.cos(a) * rr);
    const z = Math.round(R + Math.sin(a) * rr);
    const c = cols.get(x * 1000 + z);
    if (!c || c.id === 2) continue;
    hotSprings.push({ x, z, y: c.h });
    items.push({ x, z, y0: c.h, h: 0.18, sx: 2.3, sz: 2.3, rgb: [64, 208, 224], glow: true });
  }

  // ===== three 场景 =====
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';

  const scene = new THREE.Scene();
  // 背景与 2D 主题一致：同一套主题绘制函数画到纹理上，平铺无立体
  const bgData = new Uint8ClampedArray(W * H * 4);
  for (let i = 3; i < bgData.length; i += 4) bgData[i] = 255;
  const bgTex = new THREE.DataTexture(bgData, W, H);
  bgTex.magFilter = THREE.NearestFilter;
  bgTex.minFilter = THREE.NearestFilter;
  bgTex.colorSpace = THREE.SRGBColorSpace;
  bgTex.needsUpdate = true;
  scene.background = bgTex;
  scene.fog = new THREE.Fog(0x0a0d14, S * 0.9, S * 2.6);

  let maxH = 1;
  for (const it of items) maxH = Math.max(maxH, it.y0 + it.h);
  const islandItems = items; // 火山岛实例集合，切走后由此恢复
  const islandMaxH = maxH;

  const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 1, S * 8);
  camera.position.set(0, PEAK * 2.8 + S * 0.3, S * 0.62);

  const ambLight = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambLight);
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(S * 0.25, PEAK * 2.2, S * 0.5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8fb0ff, 0.4);
  fill.position.set(-S * 0.3, PEAK * 0.8, -S * 0.3);
  scene.add(fill);
  // 熔岩点光源：跟随三道熔岩流的中段
  for (let k = 0; k < 3; k++) {
    const ang = veinBase[k] + veinOffset(Rv * 0.5, k) + 0.6;
    const r = Rv * 0.5;
    const light = new THREE.PointLight(0xff6a2a, 2.5, Rv * 1.6);
    light.position.set(Math.cos(ang) * r, coneHeight(r) * 0.9, Math.sin(ang) * r);
    scene.add(light);
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.45;
  controls.target.set(0, PEAK * 0.22, 0);
  controls.minDistance = PEAK * 0.5;
  controls.maxDistance = S * 2.4;

  const solidMat = new THREE.MeshLambertMaterial();
  const glowMat = new THREE.MeshBasicMaterial();
  let solidMesh = null;
  let glowMesh = null;
  let islandGeoS = null;
  let islandGeoG = null;

  // 自主搭建动画：方块按海拔低→高依次从空中落下归位（GPU 驱动）
  const FALL = Math.round(PEAK * 0.9);
  const buildUniform = { value: 0 };
  const BUILD_MS = 4500;
  let building = true;
  let buildStart = performance.now();
  let lastSolid = 0;
  let lastGlow = 0;

  function injectBuildShader(shader) {
    shader.uniforms.uProgress = buildUniform;
    shader.uniforms.uFall = { value: FALL };
    shader.vertexShader =
      'in float aOrder;\nin float aScaleY;\nuniform float uProgress;\nuniform float uFall;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float buildT = clamp((uProgress - aOrder) * 5.0, 0.0, 1.0);
        transformed *= buildT;
        transformed.y += (1.0 - buildT) * uFall / max(aScaleY, 1.0);`
      );
  }
  solidMat.onBeforeCompile = injectBuildShader;
  glowMat.onBeforeCompile = injectBuildShader;

  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();

  // ===== 底部大黑色圆盘：先撑开，承接落下的方块 =====
  const discR = R * 1.28;
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(discR, discR, 6, 96),
    new THREE.MeshLambertMaterial({ color: 0x1a1f2b })
  );
  disc.position.y = -3;
  disc.scale.setScalar(0.001);
  scene.add(disc);

  function rebuild(animate = false) {
    if (solidMesh) {
      scene.remove(solidMesh);
      solidMesh.dispose();
    }
    if (glowMesh) {
      scene.remove(glowMesh);
      glowMesh.dispose();
    }
    if (islandGeoS) islandGeoS.dispose();
    if (islandGeoG) islandGeoG.dispose();
    const solid = [];
    const glow = [];
    for (const it of items) (it.glow ? glow : solid).push(it);

    // 每 mesh 独立几何体：aOrder/aScaleY 按 mesh 内实例号索引，共享会让 glow 读到 solid 的序号
    const capS = Math.max(1, solid.length);
    const capG = Math.max(1, glow.length);
    islandGeoS = new THREE.BoxGeometry(1, 1, 1);
    islandGeoG = new THREE.BoxGeometry(1, 1, 1);
    islandGeoS.setAttribute('aOrder', new THREE.InstancedBufferAttribute(new Float32Array(capS), 1));
    islandGeoS.setAttribute(
      'aScaleY',
      new THREE.InstancedBufferAttribute(new Float32Array(capS).fill(1), 1)
    );
    islandGeoG.setAttribute('aOrder', new THREE.InstancedBufferAttribute(new Float32Array(capG), 1));
    islandGeoG.setAttribute(
      'aScaleY',
      new THREE.InstancedBufferAttribute(new Float32Array(capG).fill(1), 1)
    );

    solidMesh = new THREE.InstancedMesh(islandGeoS, solidMat, capS);
    solidMesh.frustumCulled = false;
    glowMesh = new THREE.InstancedMesh(islandGeoG, glowMat, capG);
    glowMesh.frustumCulled = false;

    // 搭建顺序与下落距离按实例归属分别编号
    const orderS = islandGeoS.getAttribute('aOrder');
    const scaleS = islandGeoS.getAttribute('aScaleY');
    for (let n = 0; n < solid.length; n++) {
      const it = solid[n];
      orderS.setX(n, Math.min(0.8, (1 - (it.y0 + it.h) / maxH) * 0.72 + Math.random() * 0.1));
      scaleS.setX(n, Math.max(1, it.h));
    }
    const orderG = islandGeoG.getAttribute('aOrder');
    const scaleG = islandGeoG.getAttribute('aScaleY');
    for (let m = 0; m < glow.length; m++) {
      const it = glow[m];
      orderG.setX(m, Math.min(0.8, (1 - (it.y0 + it.h) / maxH) * 0.72 + Math.random() * 0.1));
      scaleG.setX(m, Math.max(1, it.h));
    }

    for (let n = 0; n < solid.length; n++) {
      const it = solid[n];
      pos.set(it.x - R + 0.5, it.y0 + it.h / 2, it.z - R + 0.5);
      scl.set(it.sx, it.h, it.sz);
      m4.compose(pos, quat, scl);
      solidMesh.setMatrixAt(n, m4);
      const base = it.rgb;
      const v = 0.82 + ((it.x * 7 + it.z * 13) % 25) / 100;
      col.setRGB(
        Math.min(1, (base[0] / 255) * v),
        Math.min(1, (base[1] / 255) * v),
        Math.min(1, (base[2] / 255) * v),
        THREE.SRGBColorSpace
      );
      solidMesh.setColorAt(n, col);
    }

    for (let n = 0; n < glow.length; n++) {
      const it = glow[n];
      pos.set(it.x - R + 0.5, it.y0 + it.h / 2, it.z - R + 0.5);
      scl.set(it.sx, it.h, it.sz);
      m4.compose(pos, quat, scl);
      glowMesh.setMatrixAt(n, m4);
      col.setRGB(it.rgb[0] / 255, it.rgb[1] / 255, it.rgb[2] / 255, THREE.SRGBColorSpace);
      glowMesh.setColorAt(n, col);
    }

    solidMesh.instanceMatrix.needsUpdate = true;
    glowMesh.instanceMatrix.needsUpdate = true;
    if (solidMesh.instanceColor) solidMesh.instanceColor.needsUpdate = true;
    if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
    scene.add(solidMesh);
    scene.add(glowMesh);
    lastSolid = solid.length;
    lastGlow = glow.length;
  }
  rebuild(true);

  // ===== 实景同步模式：把 2D 世界逐格挤出成 3D 沙盘 =====
  // 与程序化火山岛并列的第二种观赏对象：2D 的喷发（火山 tick）、流动与反应
  // 每 120ms 差分一次 world.cells，只对变化的格子做槽位分配/回收，
  // 新增格子走搭建着色器从空中坠落入场（uProgress 持续前进驱动）。
  const LIVE_DEPTH = 4; // 纵深层数：太薄像墙纸，太厚像方块海
  const LIVE_BUILD_MS = 2600;
  const LIVE_FALL = 0.04; // 新格子入场与当前进度的落差（×5 速率 ≈ 0.2s 内落定，经 5 倍 clamp 放大）

  let mode = 'island';
  let refreshTimer = 0;
  let live = null;
  let toggleBtn = null;

  // 实景调色板：直接取图鉴色板，保证 3D 与 2D 同色
  const livePalette = new Map();
  for (const key of Object.keys(EL)) {
    const id = Number(key);
    if (id === E.EMPTY) continue;
    livePalette.set(id, hexRgb(EL[key].swatch || '#999999'));
  }
  const isGlowId = (id) => id === E.FIRE || id === E.LAVA || id === E.ELECTRIC;

  const liveBase = new THREE.Mesh(
    new THREE.BoxGeometry(W + 6, 3, LIVE_DEPTH + 6),
    new THREE.MeshLambertMaterial({ color: 0x1a1f2b })
  );
  liveBase.position.y = -H / 2 - 1.5; // 托在沙盘底下
  liveBase.visible = false;
  scene.add(liveBase);

  const liveProgress = () => (performance.now() - live.start) / LIVE_BUILD_MS;

  // 入场顺序：自下而上垒起（底部先落定），带少量随机错峰
  function orderForCell(i) {
    const upFrac = (H - 1 - ((i / W) | 0)) / H; // 0 = 底 1 = 顶
    return Math.min(0.8, upFrac * 0.72 + Math.random() * 0.1);
  }

  // 每个 mesh 独立几何体：aOrder/aScaleY 按 mesh 内实例号索引，绝不能共用
  function liveMakeMesh(kind) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const n = live.cap[kind] * LIVE_DEPTH;
    geo.setAttribute('aOrder', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('aScaleY', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1));
    const mesh = new THREE.InstancedMesh(geo, kind === 'glow' ? glowMat : solidMat, n);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.userData.used = 0;
    return mesh;
  }

  function liveAlloc(kind) {
    const list = live.free[kind];
    if (list.length) return list.pop();
    const base = live.bump[kind];
    if (base + LIVE_DEPTH > live.cap[kind] * LIVE_DEPTH) return -1;
    live.bump[kind] = base + LIVE_DEPTH;
    return base;
  }

  // 写一格 = 纵深 LIVE_DEPTH 个实例（矩阵 + 颜色 + 入场序号）
  function liveWriteCell(i, id, base, order) {
    const x = i % W;
    const y = (i / W) | 0;
    const kind = isGlowId(id) ? 'glow' : 'solid';
    const mesh = live.meshes[kind];
    const rgb = livePalette.get(id) || [153, 153, 153];
    const v = 0.84 + (world.shade[i] / 255) * 0.28; // 明度扰动，呼应 2D 的颗粒感
    for (let d = 0; d < LIVE_DEPTH; d++) {
      pos.set(x - W / 2 + 0.5, H - 1 - y - H / 2 + 0.5, d - LIVE_DEPTH / 2 + 0.5);
      scl.set(1, 1, 1);
      m4.compose(pos, quat, scl);
      mesh.setMatrixAt(base + d, m4);
      col.setRGB(
        Math.min(1, (rgb[0] / 255) * v),
        Math.min(1, (rgb[1] / 255) * v),
        Math.min(1, (rgb[2] / 255) * v),
        THREE.SRGBColorSpace
      );
      mesh.setColorAt(base + d, col);
    }
    const orderAttr = mesh.geometry.getAttribute('aOrder');
    for (let d = 0; d < LIVE_DEPTH; d++) orderAttr.setX(base + d, order);
    orderAttr.needsUpdate = true;
    const end = base + LIVE_DEPTH;
    if (end > mesh.userData.used) {
      mesh.userData.used = end;
      mesh.count = end;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function liveFreeCell(i, id) {
    const base = live.slotOf[i];
    const kind = isGlowId(id) ? 'glow' : 'solid';
    const mesh = live.meshes[kind];
    for (let d = 0; d < LIVE_DEPTH; d++) mesh.setMatrixAt(base + d, m4.makeScale(0, 0, 0));
    mesh.instanceMatrix.needsUpdate = true;
    live.free[kind].push(base);
    live.slotOf[i] = -1;
  }

  // 某类槽位耗尽：扩容该类并按 shadow 整体重铺（其余类不动）
  function liveGrowKind(kind) {
    live.cap[kind] = Math.ceil(live.cap[kind] * 1.8) + 128;
    const old = live.meshes[kind];
    scene.remove(old);
    old.dispose();
    old.geometry.dispose();
    const mesh = liveMakeMesh(kind);
    live.meshes[kind] = mesh;
    scene.add(mesh);
    live.free[kind] = [];
    live.bump[kind] = 0;
    const p = liveProgress();
    for (let i = 0; i < live.slotOf.length; i++) {
      const id = live.shadow[i];
      if (id === E.EMPTY || (isGlowId(id) ? 'glow' : 'solid') !== kind) continue;
      const base = liveAlloc(kind);
      live.slotOf[i] = base;
      liveWriteCell(i, id, base, p - 0.5); // 落差足够大 = 瞬间落位
    }
  }

  // 差分同步：只处理 shadow 与 world.cells 不一致的格子
  function liveSync() {
    if (!live) return;
    const cells = world.cells;
    const shadow = live.shadow;
    for (let i = 0; i < cells.length; i++) {
      const cur = cells[i];
      const old = shadow[i];
      if (cur === old) continue;
      shadow[i] = cur;
      if (old !== E.EMPTY) liveFreeCell(i, old);
      if (cur === E.EMPTY) continue;
      const kind = isGlowId(cur) ? 'glow' : 'solid';
      let base = liveAlloc(kind);
      if (base === -1) {
        liveGrowKind(kind);
        base = liveAlloc(kind);
      }
      live.slotOf[i] = base;
      liveWriteCell(i, cur, base, liveProgress() - LIVE_FALL);
    }
  }

  function liveStart() {
    mode = 'live';
    hideIslandFx(); // 切走前收起火山岛 FX（余烬/汽柱别悬在实景同步里）
    hideSnowFx();
    disposeIslandFauna();
    if (solidMesh) {
      scene.remove(solidMesh);
      solidMesh.dispose();
      solidMesh = null;
    }
    if (glowMesh) {
      scene.remove(glowMesh);
      glowMesh.dispose();
      glowMesh = null;
    }
    disc.visible = false;
    liveBase.visible = true;
    let solidNeed = 0;
    let glowNeed = 0;
    for (let i = 0; i < world.cells.length; i++) {
      const id = world.cells[i];
      if (id === E.EMPTY) continue;
      if (isGlowId(id)) glowNeed++;
      else solidNeed++;
    }
    live = {
      cap: { solid: Math.ceil(solidNeed * 1.5) + 64, glow: Math.ceil(glowNeed * 1.5) + 64 },
      shadow: new Uint8Array(world.cells),
      slotOf: new Int32Array(W * H).fill(-1),
      free: { solid: [], glow: [] },
      bump: { solid: 0, glow: 0 },
      meshes: {},
      start: performance.now(),
    };
    for (const kind of ['solid', 'glow']) {
      const mesh = liveMakeMesh(kind);
      live.meshes[kind] = mesh;
      scene.add(mesh);
    }
    for (let i = 0; i < world.cells.length; i++) {
      const id = world.cells[i];
      if (id === E.EMPTY) continue;
      const kind = isGlowId(id) ? 'glow' : 'solid';
      const base = liveAlloc(kind);
      live.slotOf[i] = base;
      liveWriteCell(i, id, base, orderForCell(i));
    }
    // 相机 / 雾 / 控制范围从火山岛切到沙盘（距离按宽高比自适应，窄屏也能框住全貌）
    const maxDim = Math.max(W, H);
    const halfV = Math.tan(((camera.fov / 2) * Math.PI) / 180);
    const dist =
      Math.max((W / 2 + 4) / (halfV * (camera.aspect || 1.6)), (H / 2 + 4) / halfV) * 1.12;
    camera.position.set(0, H * 0.38, dist);
    controls.target.set(0, 0, 0);
    controls.minDistance = 24;
    controls.maxDistance = maxDim * 2.6;
    scene.fog.near = maxDim * 1.2;
    scene.fog.far = maxDim * 3.4;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(liveSync, 120);
    setModeLabel();
  }

  function disposeLive() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = 0;
    }
    for (const kind of ['solid', 'glow']) {
      const mesh = live.meshes[kind];
      scene.remove(mesh);
      mesh.dispose();
      mesh.geometry.dispose();
    }
    live = null;
    liveBase.visible = false;
  }

  // 任意模式间直达切换：先拆当前观赏对象，再进目标
  function switchTo(target) {
    if (target === mode) return;
    if (mode === 'sea') disposeSea();
    else if (mode === 'live') disposeLive();
    if (target === 'island') enterIsland();
    else if (target === 'sea') seaStart();
    else if (target === 'snow') enterSnow();
    else liveStart();
  }

  function tickLive() {
    // 建成后 uProgress 继续前进，新格子永远有坠落入场可用
    buildUniform.value = liveProgress();
  }

  // ===== 海岛模式：程序化群岛（借鉴火山岛生成器，与 2D 解耦的观赏对象）=====
  // 半透明海面 + 五座沙岛 + 海底礁石藻类 + 棕榈树；海啸与雷暴按 2D 天气节奏在 3D 里动起来。
  const SEA_H = 4; // 海平面高度（格）
  let seaPlane = null;
  let seaTsunami = null; // { mesh, t0, side, dur }
  let seaBolts = []; // { mesh, light, t0 }
  let boltMat = null;
  let seaSurface = null; // 每列地表高度，闪电劈落点用
  let nextTsunami = 0;
  let nextStorm = 0;
  let stormUntil = 0;
  let lastBolt = 0;
  let tsunamiCount = 0;
  let syncLastK = -1; // 已触发的 2D 海啸轮次（真同步模式）
  let activeBoltXs = new Map(); // 已镜像的 2D 落雷列 → 过期帧
  let seaIslandXs = []; // 岛屿世界 x 坐标（浪花炸点）

  // 棕榈：两段外弯细干 + 十字扇形叶冠
  function addPalm(arr, x, z, g) {
    const lean = rand() < 0.5 ? 1 : -1;
    const th = 6 + ((rand() * 3) | 0);
    const lower = Math.ceil(th * 0.6);
    arr.push({ x, z, y0: g, h: lower, sx: 0.5, sz: 0.5, rgb: C_WOOD, glow: false, palm: true });
    arr.push({ x: x + lean, z, y0: g + lower - 1, h: th - lower + 1, sx: 0.5, sz: 0.5, rgb: C_WOOD, glow: false });
    const tx = x + lean;
    const ty = g + th;
    arr.push({ x: tx, z, y0: ty, h: 0.6, sx: 2.6, sz: 0.9, rgb: C_PLANT, glow: false });
    arr.push({ x: tx, z, y0: ty, h: 0.6, sx: 0.9, sz: 2.6, rgb: C_PLANT, glow: false });
    arr.push({ x: tx + lean, z, y0: ty + 0.9, h: 0.5, sx: 1.3, sz: 0.7, rgb: C_PLANT, glow: false });
  }

  function buildSeaItems() {
    const arr = [];
    const cols = new Map(); // key → { h, cap }
    const key = (i, j) => i * 1000 + j;
    // 全幅海床：浅起伏石床
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < S; j++) {
        const h = Math.max(1, Math.round((Math.sin(i * 0.09) + Math.sin(j * 0.12 + 1)) * 0.75 + 1.6));
        cols.set(key(i, j), { h, cap: C_STONE });
      }
    }
    // 五座沙岛：x 沿用 2D 群岛点位比例，纵向固定错开（2D 比例直接换算成圆会互相重叠）
    const islands = [
      [0.2, 0.16, 0.28],
      [0.5, 0.22, 0.5],
      [0.8, 0.14, 0.66],
      [0.36, 0.06, 0.74],
      [0.66, 0.05, 0.3],
    ];
    const tops = [];
    for (const [fx, fr, fz] of islands) {
      const cx = Math.round(S * fx);
      const cz = Math.round(S * fz);
      const R2 = Math.max(3, Math.round(S * fr * 0.85));
      for (let dx = -R2; dx <= R2; dx++) {
        for (let dz = -R2; dz <= R2; dz++) {
          const d2 = (dx / R2) ** 2 + (dz / R2) ** 2;
          if (d2 > 1) continue;
          const i = cx + dx;
          const j = cz + dz;
          if (i < 0 || i >= S || j < 0 || j >= S) continue;
          const mound = Math.round(7 * (1 - d2));
          const h = SEA_H + 1 + mound;
          const cap = mound >= 4 ? C_PLANT : C_SAND; // 高处草皮
          cols.set(key(i, j), { h, cap });
          if (mound >= 4) tops.push({ i, j, g: h });
        }
      }
    }
    // 水下礁石群
    for (const [fx, fz] of [
      [0.33, 0.55],
      [0.62, 0.62],
      [0.9, 0.5],
    ]) {
      const rx = Math.round(S * fx);
      const rz = Math.round(S * fz);
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          if ((dx / 4) ** 2 + (dz / 3) ** 2 > 1) continue;
          const c = cols.get(key(rx + dx, rz + dz));
          if (c && c.h <= SEA_H) cols.set(key(rx + dx, rz + dz), { h: c.h + 2, cap: C_STONE });
        }
      }
    }
    // 海底藻斑：石床表层随机改藻色
    for (let n = 0; n < 110; n++) {
      const c = cols.get(key((rand() * S) | 0, (rand() * S) | 0));
      if (c && c.h <= SEA_H) c.cap = C_PLANT;
    }
    for (const [k, c] of cols) {
      const i = Math.floor(k / 1000);
      const j = k % 1000;
      if (c.h > SEA_H) {
        // 出水岛体：石基 + 沙身 + 顶盖三层
        arr.push({ x: i, z: j, y0: 0, h: 2, sx: 1, sz: 1, rgb: C_STONE, glow: false });
        if (c.h > 3) arr.push({ x: i, z: j, y0: 2, h: c.h - 3, sx: 1, sz: 1, rgb: C_SAND, glow: false });
        arr.push({ x: i, z: j, y0: c.h - 1, h: 1, sx: 1, sz: 1, rgb: c.cap, glow: false });
        if (c.cap === C_PLANT && rand() < 0.14) {
          // 草皮点缀：灌木丛与野花
          if (rand() < 0.4) {
            arr.push({ x: i, z: j, y0: c.h, h: 0.7, sx: 0.75, sz: 0.75, rgb: [44, 126, 54], glow: false });
          } else {
            const fc = [[232, 92, 92], [255, 214, 110], [244, 244, 244]][(rand() * 3) | 0];
            arr.push({ x: i, z: j, y0: c.h, h: 0.35, sx: 0.4, sz: 0.4, rgb: fc, glow: false });
          }
        }
      } else {
        arr.push({ x: i, z: j, y0: 0, h: c.h, sx: 1, sz: 1, rgb: c.cap, glow: false });
      }
    }
    // 棕榈树：岛顶错落散布
    const planted = [];
    for (const t of tops) {
      if (planted.length >= 12) break;
      if (planted.some((p) => Math.abs(p.i - t.i) < 5 && Math.abs(p.j - t.j) < 5)) continue;
      if (rand() < 0.4) continue;
      addPalm(arr, t.i, t.j, t.g);
      planted.push(t);
    }
    // 地表高度图：闪电劈落点
    seaSurface = new Int16Array(S * S).fill(SEA_H);
    for (const [k, c] of cols) {
      if (c.h > SEA_H) seaSurface[(Math.floor(k / 1000)) * S + (k % 1000)] = c.h;
    }
    return arr;
  }

  function disposeTerrainMeshes() {
    if (solidMesh) {
      scene.remove(solidMesh);
      solidMesh.dispose();
      solidMesh = null;
    }
    if (glowMesh) {
      scene.remove(glowMesh);
      glowMesh.dispose();
      glowMesh = null;
    }
  }

  function disposeSea() {
    disposeFauna();
    seaAmbientStop();
    if (seaPlane) {
      scene.remove(seaPlane);
      seaPlane.geometry.dispose();
      seaPlane.material.dispose();
      seaPlane = null;
    }
    if (seaTsunami) {
      if (seaTsunami.segs) {
        for (const m of seaTsunami.segs) {
          scene.remove(m);
          m.geometry.dispose();
          m.material.dispose();
        }
        for (const f of seaTsunami.foam) {
          scene.remove(f);
          f.geometry.dispose();
          f.material.dispose();
        }
      }
      scene.position.set(0, 0, 0);
      seaTsunami = null;
    }
    for (const b of seaBolts) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      scene.remove(b.light);
    }
    seaBolts = [];
    if (boltMat) {
      boltMat.dispose();
      boltMat = null;
    }
    seaSurface = null;
  }

  // ===== 海岛生态：鱼群 / 跃海豚 / 海鸥 / 帆船 / 波光 =====
  let fauna = null;

  function buildFauna() {
    const t0 = performance.now();
    const mats = {
      fishA: new THREE.MeshLambertMaterial({ color: 0xe8923c }),
      fishB: new THREE.MeshLambertMaterial({ color: 0xb9c4cf }),
      dolphin: new THREE.MeshLambertMaterial({ color: 0x7a92a8 }),
      gull: new THREE.MeshLambertMaterial({ color: 0xf2f5f8 }),
      hull: new THREE.MeshLambertMaterial({ color: 0x7a5230 }),
      sail: new THREE.MeshLambertMaterial({ color: 0xf5f2e8 }),
      twinkle: new THREE.MeshBasicMaterial({ color: 0xdff1ff, transparent: true, opacity: 0.9 }),
      spout: new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.55 }),
    };
    // 两个鱼群：半透明水下绕圆游弋
    const fishes = [];
    for (const [cx, cz, r] of [
      [-S * 0.18, S * 0.12, S * 0.1],
      [S * 0.22, -S * 0.14, S * 0.08],
    ]) {
      for (let n = 0; n < 8; n++) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.9), n % 2 ? mats.fishA : mats.fishB);
        scene.add(mesh);
        fishes.push({ mesh, cx, cz, r: r * (0.8 + rand() * 0.4), ph: rand() * Math.PI * 2, sp: 0.5 + rand() * 0.3, y: 3.1 + rand() * 0.5 });
      }
    }
    // 跃海豚：三只轮流表演抛物线跳
    const dolphins = [];
    for (let n = 0; n < 3; n++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.55), mats.dolphin);
      mesh.visible = false;
      scene.add(mesh);
      dolphins.push({ mesh, next: t0 + 5000 + n * 9000, dur: 1700, live: false, x0: 0, z0: 0, dx: 0, dz: 0 });
    }
    // 海鸥：绕主岛盘旋，双翼扑动
    const gulls = [];
    for (let n = 0; n < 3; n++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.8), mats.gull));
      const wl = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.08, 0.3), mats.gull);
      wl.position.x = -0.75;
      const wr = wl.clone();
      wr.position.x = 0.75;
      g.add(wl);
      g.add(wr);
      scene.add(g);
      gulls.push({ g, wl, wr, r: S * (0.16 + rand() * 0.08), ph: rand() * Math.PI * 2, sp: 0.25 + rand() * 0.15, y: SEA_H + 12 + rand() * 4 });
    }
    // 船队：大小帆船 + 渔船 + 货船 + 渔筏，形式大小数量各异；海啸会推船、掀翻小船
    const boats = [];
    const part = (g, w, h, d, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      g.add(m);
      return m;
    };
    const addBoat = (kind, g, r, ph, sp, dir) => {
      scene.add(g);
      boats.push({
        g, kind, r, ph, sp, dir,
        disp: { x: 0, z: 0 },
        rock: 0, state: 'sail', st: 0, hit: false, sinkDir: 1,
      });
    };
    {
      const g = new THREE.Group();
      part(g, 1.2, 0.6, 3.0, mats.hull);
      const mast = part(g, 0.16, 2.6, 0.16, mats.hull);
      mast.position.y = 1.55;
      const sail = part(g, 0.09, 1.9, 1.5, mats.sail);
      sail.position.set(0, 1.7, -0.25);
      addBoat('sailboat', g, S * 0.3, 0.6, 0.033, 1);
    }
    {
      const g = new THREE.Group();
      part(g, 0.9, 0.45, 2.2, mats.hull);
      const mast = part(g, 0.13, 2.0, 0.13, mats.hull);
      mast.position.y = 1.2;
      const sail = part(g, 0.08, 1.4, 1.1, mats.sail);
      sail.position.set(0, 1.35, -0.2);
      addBoat('sailboat', g, S * 0.38, 3.6, 0.045, -1);
    }
    {
      const g = new THREE.Group();
      part(g, 1.3, 0.5, 2.4, mats.hull);
      const cab = part(g, 0.8, 0.7, 0.8, mats.sail);
      cab.position.set(0, 0.55, 0.7);
      const mast = part(g, 0.12, 1.6, 0.12, mats.hull);
      mast.position.set(0, 1.0, -0.6);
      addBoat('fishing', g, S * 0.24, 2.2, 0.04, 1);
    }
    {
      const g = new THREE.Group();
      part(g, 2.1, 0.9, 5.6, new THREE.MeshLambertMaterial({ color: 0x4e5a66 }));
      const bridge = part(g, 1.3, 1.7, 1.2, mats.sail);
      bridge.position.set(0, 1.2, -2.0);
      const boxCols = [0xc9502a, 0x3a7a5a, 0xc9a03c];
      for (let n = 0; n < 3; n++) {
        const c = part(g, 1.5, 0.55, 1.0, new THREE.MeshLambertMaterial({ color: boxCols[n] }));
        c.position.set(0, 0.7, 0.9 - n * 1.15);
      }
      addBoat('cargo', g, S * 0.45, 5.1, 0.02, -1);
    }
    for (const [r, ph] of [
      [S * 0.18, 1.2],
      [S * 0.42, 4.4],
    ]) {
      const g = new THREE.Group();
      part(g, 0.85, 0.22, 1.35, mats.hull);
      const pole = part(g, 0.07, 1.9, 0.07, mats.hull);
      pole.position.set(0.3, 0.9, 0);
      addBoat('raft', g, r, ph, 0.03, 1);
    }
    // 波光：海面随机闪烁的小亮片
    const sparkles = [];
    for (let n = 0; n < 26; n++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), mats.twinkle);
      mesh.position.set((rand() - 0.5) * S * 1.15, SEA_H + 0.06, (rand() - 0.5) * S * 1.15);
      scene.add(mesh);
      sparkles.push({ mesh, ph: rand() * Math.PI * 2, sp: 0.9 + rand() * 1.4 });
    }
    fauna = { fishes, dolphins, gulls, boats, sparkles, mats, t0 };
  }

  // 鲸鱼：深灰巨躯巡游外海，周期拱背出水、气孔喷白水柱
  function buildWhale() {
    if (!fauna) return;
    const whale = new THREE.Group();
    whale.add(new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.6, 2.4), fauna.mats.dolphin));
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.4), fauna.mats.dolphin);
    fin.position.set(2.6, 0.55, 0);
    whale.add(fin);
    const spout = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.6, 0.35), fauna.mats.spout);
    spout.position.set(-2.6, 2.3, 0);
    spout.visible = false;
    whale.add(spout);
    scene.add(whale);
    fauna.whale = whale;
    fauna.spout = spout;
    fauna.whalePh = rand() * Math.PI * 2;
  }

  function disposeFauna() {
    if (!fauna) return;
    const kill = (o) => {
      scene.remove(o);
      o.traverse?.((c) => c.geometry?.dispose());
      o.geometry?.dispose();
    };
    for (const f of fauna.fishes) kill(f.mesh);
    for (const d of fauna.dolphins) kill(d.mesh);
    for (const g of fauna.gulls) kill(g.g);
    for (const b of fauna.boats) kill(b.g);
    if (fauna.whale) kill(fauna.whale);
    for (const s of fauna.sparkles) kill(s.mesh);
    for (const k in fauna.mats) fauna.mats[k].dispose();
    fauna = null;
  }

  function tickFauna(now) {
    if (!fauna) return;
    const t = (now - fauna.t0) / 1000;
    const ready = !building; // 搭建未完成时生态先不上场
    // 鱼群绕圆
    for (const f of fauna.fishes) {
      const a = f.ph + t * f.sp * 0.35;
      f.mesh.position.set(f.cx + Math.cos(a) * f.r, f.y, f.cz + Math.sin(a) * f.r);
      f.mesh.rotation.y = -a;
      f.mesh.visible = ready;
    }
    // 跃海豚：抛物线跃水，落水后随机间隔再来
    for (const d of fauna.dolphins) {
      const p = (now - d.next) / d.dur;
      if (p < 0 || p >= 1) {
        d.mesh.visible = false;
        if (p >= 1) {
          d.next = now + 6000 + rand() * 8000;
          d.live = false;
        }
        continue;
      }
      if (!d.live) {
        d.live = true;
        const a = rand() * Math.PI * 2;
        const rr = S * (0.1 + rand() * 0.3);
        d.x0 = Math.cos(a) * rr;
        d.z0 = Math.sin(a) * rr;
        const dir = a + Math.PI / 2;
        d.dx = Math.cos(dir) * 6;
        d.dz = Math.sin(dir) * 6;
      }
      d.mesh.visible = ready;
      d.mesh.position.set(d.x0 + d.dx * p, SEA_H - 0.4 + Math.sin(p * Math.PI) * 4.2, d.z0 + d.dz * p);
      d.mesh.rotation.y = -Math.atan2(d.dz, d.dx);
      d.mesh.rotation.z = -Math.cos(p * Math.PI) * 0.9;
    }
    // 海鸥盘旋 + 扑翼
    for (const g of fauna.gulls) {
      const a = g.ph + t * g.sp;
      g.g.position.set(Math.cos(a) * g.r, g.y + Math.sin(t * 0.7 + g.ph) * 1.2, Math.sin(a) * g.r);
      g.g.rotation.y = -(a + Math.PI / 2);
      g.g.visible = ready;
      const flap = Math.sin(t * 9 + g.ph) * 0.55;
      g.wl.rotation.z = flap;
      g.wr.rotation.z = -flap;
    }
    // 船队巡游（增量角度，海啸推离后缓缓归位）；小船可能被掀翻沉没，之后重新浮起
    const dt = Math.min(0.1, (now - (fauna.last || now)) / 1000);
    fauna.last = now;
    for (const b of fauna.boats) {
      if (b.state === 'sunk') {
        b.st++;
        if (b.st > 320) {
          b.state = 'rise';
          b.st = 0;
          b.g.visible = true;
        }
        continue;
      }
      if (b.state === 'rise') {
        b.st++;
        const q = Math.min(1, b.st / 90);
        b.g.position.y = SEA_H + 0.25 - (1 - q) * 1.7;
        b.g.rotation.z = (1 - q) * 1.1;
        if (q >= 1) {
          b.state = 'sail';
          b.g.rotation.z = 0;
        }
        continue;
      }
      if (b.state === 'sinking') {
        b.st++;
        const q = Math.min(1, b.st / 110);
        b.g.rotation.z = b.sinkDir * q * 1.45;
        b.g.position.y = SEA_H + 0.25 - q * 1.7;
        if (q >= 1) {
          b.state = 'sunk';
          b.st = 0;
          b.g.visible = false;
          b.disp.x = 0;
          b.disp.z = 0;
        }
        continue;
      }
      b.ph += b.sp * b.dir * dt;
      b.disp.x *= 0.985;
      b.disp.z *= 0.985;
      b.g.position.set(
        Math.cos(b.ph) * b.r + b.disp.x,
        SEA_H + 0.25 + Math.sin(t * 1.3 + b.ph) * 0.12,
        Math.sin(b.ph) * b.r + b.disp.z
      );
      b.g.rotation.y = -(b.ph + (b.dir > 0 ? Math.PI / 2 : -Math.PI / 2));
      b.g.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.05 + b.rock;
      b.rock *= 0.94;
      b.g.visible = ready;
    }
    // 波光闪烁
    for (const s of fauna.sparkles) {
      s.mesh.visible = ready && Math.sin(t * s.sp + s.ph) > 0.55;
    }
    // 鲸鱼：深海巡游，周期拱背喷水
    if (fauna.whale) {
      const wa = fauna.whalePh + t * 0.02;
      const surf = Math.max(0, Math.sin(t * 0.09));
      fauna.whale.position.set(
        Math.cos(wa) * S * 0.42,
        SEA_H - 1.15 + surf * 1.95,
        Math.sin(wa) * S * 0.42
      );
      fauna.whale.rotation.y = -(wa + Math.PI / 2);
      fauna.whale.visible = ready;
      fauna.spout.visible = ready && surf > 0.78;
      fauna.spout.scale.y = 0.55 + Math.sin(now * 0.02) * 0.35;
    }
  }

  function seaStart() {
    mode = 'sea';
    hideIslandFx(); // 切走前收起火山岛 FX
    hideSnowFx();
    disposeTerrainMeshes();
    disposeIslandFauna();
    liveBase.visible = false;
    items = buildSeaItems();
    maxH = 1;
    for (const it of items) maxH = Math.max(maxH, it.y0 + it.h);
    building = true; // 重播自搭建入场：海床先、岛体次、棕榈收尾
    buildStart = performance.now();
    rebuild(true);
    // 半透明海面：随搭建展开，日常微起伏
    seaPlane = new THREE.Mesh(
      new THREE.BoxGeometry(S * 1.3, 1.6, S * 1.3),
      new THREE.MeshLambertMaterial({ color: 0x2f6fbd, transparent: true, opacity: 0.72 })
    );
    seaPlane.position.y = SEA_H - 0.8;
    seaPlane.scale.setScalar(0.001);
    scene.add(seaPlane);
    boltMat = new THREE.MeshBasicMaterial({ color: 0xffe95e, transparent: true, opacity: 0.95 });
    buildFauna();
    buildWhale();
    seaIslandXs = [-S * 0.3, 0, S * 0.3]; // 大岛世界坐标，浪花炸点
    seaAmbientStart(); // 海浪环境音
    syncLastK = Math.floor(world.frame / 3600); // 不重放已过去的事件
    nextTsunami = performance.now() + 9000; // 首场海啸 9 秒后，之后 60 秒一轮
    nextStorm = performance.now() + 15000; // 首轮雷暴 15 秒后，之后 25 秒一轮
    stormUntil = 0;
    lastBolt = 0;
    tsunamiCount = 0;
    // 相机 / 雾：海岛低机位广视野
    camera.position.set(0, SEA_H + S * 0.22, S * 0.85);
    controls.target.set(0, SEA_H * 0.6, 0);
    controls.minDistance = 30;
    controls.maxDistance = S * 2.6;
    scene.fog.near = S * 1.2;
    scene.fog.far = S * 3.2;
    setModeLabel();
  }

  function enterIsland() {
    mode = 'island';
    hideSnowFx(); // 切走雪山时收起飘雪与雪崩
    items = islandItems;
    maxH = islandMaxH;
    disc.visible = true;
    building = true; // 重播火山岛自搭建入场
    buildStart = performance.now();
    rebuild(true);
    camera.position.set(0, PEAK * 2.8 + S * 0.3, S * 0.62);
    controls.target.set(0, PEAK * 0.22, 0);
    controls.minDistance = PEAK * 0.5;
    controls.maxDistance = S * 2.4;
    scene.fog.near = S * 0.9;
    scene.fog.far = S * 2.6;
    setModeLabel();
  }

  function spawnTsunami(side) {
    // 先海退（海面骤降 1.4 秒，真实海啸前兆），再起巨浪
    seaTsunami = { mode: 'drawback', t0: performance.now(), side, dur: 1400 };
    tsunamiCount++;
    if (fauna) for (const b of fauna.boats) b.hit = false;
  }

  function buildWaveWall(side) {
    // 多段波体：整体平移 + 逐段起伏 + 波顶白沫 + 撞击段镜头微震
    const SEGS = 14;
    const segs = [];
    const foam = [];
    for (let n = 0; n < SEGS; n++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(5.5, 1, S * 1.1 / SEGS + 0.4),
        new THREE.MeshLambertMaterial({ color: 0x2e6394, transparent: true, opacity: 0.82 })
      );
      mesh.position.z = -S * 0.55 + (n + 0.5) * (S * 1.1 / SEGS);
      scene.add(mesh);
      segs.push(mesh);
      if (n % 2 === 0) {
        const f = new THREE.Mesh(
          new THREE.BoxGeometry(5.8, 0.5, S * 1.1 / SEGS + 0.2),
          new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.85 })
        );
        scene.add(f);
        foam.push(f);
      }
    }
    seaTsunami = {
      mode: 'sweep', segs, foam, t0: performance.now(), side, dur: 5200, crashed: false,
    };
  }

  function spawnBolt(bx) {
    thunder(); // 雷声（sound.js 内部自检开关）
    const now = performance.now();
    const bz = (rand() - 0.5) * S * 1.05;
    const gi = Math.max(0, Math.min(S - 1, Math.round(bx + R)));
    const gj = Math.max(0, Math.min(S - 1, Math.round(bz + R)));
    const botY = seaSurface[gi * S + gj];
    const topY = maxH + 14;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, topY - botY, 0.7), boltMat);
    mesh.position.set(bx, (topY + botY) / 2, bz);
    scene.add(mesh);
    const light = new THREE.PointLight(0xffe95e, 0, S * 0.5);
    light.position.set(bx, botY + 3, bz);
    scene.add(light);
    seaBolts.push({ mesh, light, t0: now });
  }

  // 海啸撞船：一定会沿波向推走一段；小船有概率被掀翻沉没（之后重新浮起），货船永不沉
  function impactBoats(waveX, side, sweep) {
    if (!fauna || sweep <= 0) return;
    for (const b of fauna.boats) {
      if (b.state !== 'sail' || b.hit) continue;
      const crossed = side === 0 ? b.g.position.x <= waveX : b.g.position.x >= waveX;
      if (!crossed) continue;
      b.hit = true;
      const dir = side === 0 ? 1 : -1;
      b.disp.x += dir * (3.5 + rand() * 3) * (b.kind === 'cargo' ? 0.35 : 1);
      b.rock = 0.5 + rand() * 0.35;
      const sinkP =
        b.kind === 'raft' ? 0.6 : b.kind === 'sailboat' ? 0.35 : b.kind === 'fishing' ? 0.2 : 0;
      if (rand() < sinkP) {
        b.state = 'sinking';
        b.st = 0;
        b.sinkDir = rand() < 0.5 ? 1 : -1;
      }
    }
  }

  // 昼夜光照联动：2D「昼夜循环」主题时，3D 太阳方位/色温/强度随同一时钟转动
  const DAY_CYCLE = 14400;
  let skyLit = false;
  function tickSkyLight() {
    if (state.theme !== 'daycycle') {
      if (skyLit) {
        skyLit = false;
        sun.position.set(S * 0.25, PEAK * 2.2, S * 0.5);
        sun.intensity = 1.5;
        sun.color.setHex(0xffffff);
        ambLight.intensity = 0.55;
      }
      return;
    }
    skyLit = true;
    const phase = (world.frame % DAY_CYCLE) / DAY_CYCLE; // 0 午夜 / 0.25 日出 / 0.5 正午 / 0.75 日落
    const elev = Math.sin((phase - 0.25) * Math.PI * 2);
    const az = (phase - 0.25) * Math.PI * 2;
    sun.position.set(Math.cos(az) * S * 0.6, Math.max(S * 0.05, elev * S * 0.5) + 6, S * 0.25);
    sun.intensity = 0.35 + Math.max(0, elev) * 1.35;
    const warm = Math.max(0, 1 - Math.abs(elev) * 2.2) * (elev > -0.3 ? 1 : 0);
    sun.color.setRGB(1, 1 - warm * 0.35, 1 - warm * 0.62);
    ambLight.intensity = 0.22 + Math.max(0, elev) * 0.4;
  }

  function tickSea() {
    tickBuild(); // 搭建进度 + 底座撑开
    if (!seaPlane) return;
    const now = performance.now();
    tickFauna(now);
    const grow = Math.min(1, buildUniform.value * 2.5 + 0.001);
    seaPlane.scale.set(grow, 1, grow);
    seaPlane.position.y = SEA_H - 0.8 + Math.sin(now * 0.0011) * 0.16; // 潮汐微起伏
    // 天气：2D 群岛图时与真实模拟同帧同步，其余地图走本地演出节奏
    const syncWeather = window.__sb?.mapObj?.id === 'archipelago';
    if (syncWeather) {
      const fr = world.frame;
      // 海啸：与 2D tick 同帧起墙，左右岸一致
      const k = Math.floor(fr / 3600);
      if (fr >= 2400 && k > syncLastK && !seaTsunami) {
        syncLastK = k;
        spawnTsunami(k % 2);
      }
      // 雷暴：镜像 2D 落雷位置（2D 落雷会在天顶写出电火花列）
      if (fr >= 1500 && fr % 1500 < 300) {
        const top = Math.min(24, world.h);
        for (let x = 0; x < world.w; x++) {
          let hit = false;
          for (let y = 0; y < top; y++) {
            if (world.cells[y * world.w + x] === E.ELECTRIC) {
              hit = true;
              break;
            }
          }
          if (hit && !activeBoltXs.has(x)) {
            activeBoltXs.set(x, fr + 45);
            spawnBolt((x / (world.w - 1) - 0.5) * S * 1.05);
          }
        }
        for (const [x, exp] of activeBoltXs) {
          if (fr > exp) activeBoltXs.delete(x);
        }
      } else if (activeBoltXs.size) {
        activeBoltXs.clear();
      }
    } else {
      // 本地演出节奏（非群岛图时兜底）
      if (!seaTsunami && now >= nextTsunami) {
        spawnTsunami(tsunamiCount % 2);
        nextTsunami = now + 60000;
      }
      if (now >= nextStorm) {
        stormUntil = now + 5000;
        nextStorm = now + 25000;
      }
      if (now < stormUntil && now - lastBolt > 830 && seaBolts.length < 3) {
        lastBolt = now;
        spawnBolt((rand() - 0.5) * S * 1.05);
      }
    }
    if (seaTsunami) {
      const T = seaTsunami;
      const p = (now - T.t0) / T.dur;
      const killWave = () => {
        for (const m of T.segs) {
          scene.remove(m);
          m.geometry.dispose();
          m.material.dispose();
        }
        for (const f of T.foam) {
          scene.remove(f);
          f.geometry.dispose();
          f.material.dispose();
        }
        scene.position.set(0, 0, 0);
        seaTsunami = null;
      };
      if (T.mode === 'drawback') {
        // 海退前兆：海面骤降再回位，随后巨浪压境
        if (p >= 1) {
          buildWaveWall(T.side);
        } else {
          seaPlane.position.y = SEA_H - 0.8 - Math.sin(p * Math.PI) * 0.7;
        }
      } else if (p >= 1) {
        killWave();
      } else {
        const x0 = T.side === 0 ? -S * 0.62 : S * 0.62;
        const sweep = Math.max(0, (p - 0.14) / 0.72);
        const ease = sweep < 1 ? sweep * sweep * (3 - 2 * sweep) : 1;
        const waveX = x0 * (1 - ease) - x0 * ease;
        const crash = sweep > 0.05 && sweep < 0.85;
        // 撞击段镜头微震（场景级抖动，controls 不受干扰）
        scene.position.set(
          crash ? (rand() - 0.5) * 0.5 : 0,
          crash ? (rand() - 0.5) * 0.4 : 0,
          0
        );
        if (crash && !T.crashed) {
          T.crashed = true;
          waveCrash();
        }
        // 各段波体：整体推进 + 逐段起伏 + 波顶随涌浪摆动
        for (let n = 0; n < T.segs.length; n++) {
          const m = T.segs[n];
          m.position.x = waveX;
          const wob = Math.sin(now * 0.004 + n * 1.7) * 0.12;
          const base = SEA_H + 9;
          const h =
            base * (1 + wob) * (p < 0.12 ? p / 0.12 : 1) *
            (1 - Math.max(0, (p - 0.82) / 0.18) * 0.5);
          m.scale.y = Math.max(0.05, h);
          m.position.y = m.scale.y * 0.5 - 1.2;
          m.rotation.x = crash ? Math.sin(now * 0.01 + n) * 0.1 : 0;
          m.material.opacity = 0.82 * (1 - Math.max(0, (p - 0.85) / 0.15));
        }
        // 白沫骑在波顶
        for (let n = 0; n < T.foam.length; n++) {
          const f = T.foam[n];
          f.position.x = waveX;
          f.position.y = SEA_H + 8.2 + Math.sin(now * 0.006 + n) * 0.5;
          f.visible = p > 0.12 && p < 0.88;
          f.material.opacity = 0.85 * (1 - Math.max(0, (p - 0.8) / 0.2));
        }
        impactBoats(waveX, T.side, sweep);
        // 波前掠过岛屿：岛缘炸起浪花
        T.splashed = T.splashed || new Set();
        for (const ix of seaIslandXs) {
          const crossed = T.side === 0 ? ix <= waveX : ix >= waveX;
          if (crossed && !T.splashed.has(ix)) {
            T.splashed.add(ix);
            for (let k = 0; k < 4; k++) {
              const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), fauna.mats.spout);
              m.position.set(ix + (rand() - 0.5) * 6, SEA_H + 1, (rand() - 0.5) * S * 0.3);
              scene.add(m);
              seaBolts.push({ mesh: m, light: null, t0: now, splash: true });
            }
          }
        }
      }
    }
    // 雷暴已并入上方天气分派；这里只做本地节奏的窗口推进
    if (!syncWeather && now >= nextStorm) {
      stormUntil = now + 5000;
      nextStorm = now + 25000;
    }
    for (let n = seaBolts.length - 1; n >= 0; n--) {
      const b = seaBolts[n];
      const age = now - b.t0;
      if (age > 900) {
        scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        if (b.light) scene.remove(b.light);
        seaBolts.splice(n, 1);
        continue;
      }
      if (!b.splash) {
        b.mesh.visible = Math.sin(age * 0.045) > -0.4; // 频闪
        if (b.light) b.light.intensity = Math.max(0, 3 * (1 - age / 900));
      }
    }
  }

  function resize() {
    if (!host.isConnected) return;
    renderer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  let raf = 0;
  function tickBuild() {
    if (!building) return;
    const p = (performance.now() - buildStart) / BUILD_MS;
    if (p >= 1) {
      building = false;
      buildUniform.value = 1;
    } else {
      buildUniform.value = p;
    }
    // 圆盘先行撑开，随后方块落下
    disc.scale.setScalar(Math.min(1, buildUniform.value * 2.5 + 0.001));
  }
  // ===== 火山喷发同步：与 2D 火山 tick 同一时钟（VOLCANO_CYCLE=1500）=====
  // phase<200 喷发（熔岩柱冲天+飞溅熔岩滴）→ phase≥1380 青烟前兆 → 余烬火星常飘
  const VOLCANO_CYCLE = 1500;
  let craterFx = null;

  function ensureCraterFx() {
    if (craterFx) return;
    const mats = {
      lava: new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.92 }),
      ember: new THREE.MeshBasicMaterial({ color: 0xffc46a }),
    };
    const light = new THREE.PointLight(0xff6a2a, 1.2, S * 0.45);
    light.position.set(0, PEAK + 3, 0);
    scene.add(light);
    const fountain = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 2.2), mats.lava);
    fountain.position.set(0, PEAK, 0);
    fountain.visible = false;
    scene.add(fountain);
    const blobs = [];
    for (let n = 0; n < 6; n++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mats.lava);
      m.visible = false;
      scene.add(m);
      blobs.push({ mesh: m, t0: 0, dur: 1, x0: 0, z0: 0, dx: 0, dz: 0 });
    }
    const smoke = [];
    for (let n = 0; n < 5; n++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 2.2, 2.2),
        new THREE.MeshLambertMaterial({ color: 0x8a939d, transparent: true, opacity: 0.4 })
      );
      m.visible = false;
      scene.add(m);
      smoke.push({ mesh: m, born: -1 });
    }
    const embers = [];
    for (let n = 0; n < 12; n++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), mats.ember);
      m.visible = false;
      scene.add(m);
      embers.push({ mesh: m, y: -1, vy: 0, x: 0, z: 0, drift: 0 });
    }
    craterFx = { mats, light, fountain, blobs, smoke, embers, erupting: false, phase: 0 };
  }

  function tickVolcanoFx() {
    const active = mode === 'island' && !building;
    if (!active) {
      volcanoRumble(0);
      if (craterFx) {
        craterFx.fountain.visible = false;
        craterFx.light.intensity = 0;
        for (const e of craterFx.embers) e.mesh.visible = false;
        for (const s of craterFx.smoke) s.mesh.visible = false;
        for (const b of craterFx.blobs) b.mesh.visible = false;
      }
      return;
    }
    ensureCraterFx();
    const now = performance.now();
    const phase = world.frame % VOLCANO_CYCLE;
    const erupting = phase < 200;
    craterFx.erupting = erupting;
    craterFx.phase = phase;
    const riseP = Math.min(1, phase / 200 / 0.55);
    // 熔岩柱：高度随喷发段推进（沿用 2D 的缓出公式），火口冲天
    craterFx.fountain.visible = erupting;
    if (erupting) {
      const h = Math.max(1, Math.round(PEAK * 0.9 * (1 - (1 - riseP) ** 2)));
      craterFx.fountain.scale.y = h;
      craterFx.fountain.position.y = PEAK + h / 2;
      craterFx.fountain.rotation.y += 0.04;
    }
    craterFx.light.intensity = erupting ? 3.4 + Math.sin(now * 0.02) * 0.8 : 1.2;
    // 飞溅熔岩滴：喷发段抛物线抛出
    for (const b of craterFx.blobs) {
      if (!b.mesh.visible) {
        if (!erupting || rand() > 0.06) continue;
        const a = rand() * Math.PI * 2;
        b.x0 = 0;
        b.z0 = 0;
        b.dx = Math.cos(a) * (3 + rand() * 5);
        b.dz = Math.sin(a) * (3 + rand() * 5);
        b.t0 = now;
        b.dur = 900 + rand() * 500;
        b.mesh.visible = true;
      }
      const p = (now - b.t0) / b.dur;
      if (p >= 1) {
        b.mesh.visible = false;
        continue;
      }
      b.mesh.position.set(
        b.x0 + b.dx * p,
        PEAK + 2 + Math.sin(p * Math.PI) * PEAK * 0.5,
        b.z0 + b.dz * p
      );
    }
    // 前兆青烟：喷发前 2 秒火口断续冒烟
    const omen = phase >= VOLCANO_CYCLE - 120 && !erupting;
    for (const s of craterFx.smoke) {
      if (s.born < 0) {
        if (!omen || rand() > 0.02) continue;
        s.born = now;
        s.mesh.position.set((rand() - 0.5) * 6, PEAK + 3, (rand() - 0.5) * 6);
        s.mesh.visible = true;
      }
      const p = (now - s.born) / 2200;
      if (p >= 1) {
        s.born = -1;
        s.mesh.visible = false;
        continue;
      }
      s.mesh.position.y += 0.05;
      s.mesh.rotation.y += 0.01;
      s.mesh.material.opacity = 0.4 * (1 - p);
    }
    // 余烬火星：火口常飘，喷发时更密
    for (const e of craterFx.embers) {
      if (e.y < 0 || e.y > PEAK + 12) {
        e.y = PEAK - 2 + rand() * 3;
        e.x = (rand() - 0.5) * Rv * 0.9;
        e.z = (rand() - 0.5) * Rv * 0.9;
        e.vy = (erupting ? 0.1 : 0.06) + rand() * 0.08;
        e.drift = rand() * Math.PI * 2;
      }
      e.y += e.vy;
      e.x += Math.sin(e.y * 0.1 + e.drift) * 0.03;
      e.mesh.position.set(e.x, e.y, e.z);
      e.mesh.visible = true;
    }
    // 低鸣：平时低吟，喷发轰鸣
    volcanoRumble(erupting ? 1 : 0.18);
  }

  // ===== 火山地貌动态景观：喷气孔/熔岩流口蒸汽 + 低地间歇泉 + 火口熔岩气泡 =====
  // 有界实例池：蒸汽一个 InstancedMesh、气泡一个、间歇泉柱一个——新增 draw call ≤ 3
  let ventFx = null;

  function ensureVentFx() {
    if (ventFx) return;
    const mats = {
      steam: new THREE.MeshLambertMaterial({ color: 0xb9c4ce, transparent: true, opacity: 0.38 }),
      bubble: new THREE.MeshBasicMaterial({ color: 0xff9a4d }),
      geyser: new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.5 }),
      pool: new THREE.MeshBasicMaterial({ color: 0x69c8dc, transparent: true, opacity: 0.85 }),
    };
    // 蒸汽点：锥坡喷气孔 5 处 + 熔岩流出口 3 处（熔岩触低地即生白汽）
    const vents = [];
    for (let n = 0; n < 5; n++) {
      const a = veinSeed + 0.75 + n * 1.26 + rand() * 0.4;
      const r = Rv * (0.52 + rand() * 0.2);
      const gx = Math.round(R + Math.cos(a) * r);
      const gz = Math.round(R + Math.sin(a) * r);
      const gr = Math.hypot(gx - R, gz - R);
      const ga = Math.atan2(gz - R, gx - R);
      if (lavaVeinAt(gx - R, gz - R, ga, gr)) continue; // 别压在熔岩纹上
      const c = cols.get(gx * 1000 + gz);
      if (!c || c.id === 11 || c.id === 2) continue;
      vents.push({ x: gx - R + 0.5, z: gz - R + 0.5, y: c.h, big: false, ph: rand() * 3 });
    }
    for (let k = 0; k < 3; k++) {
      const a = veinBase[k] + veinOffset(Rv * 0.98, k);
      const gx = Math.round(R + Math.cos(a) * Rv);
      const gz = Math.round(R + Math.sin(a) * Rv);
      const c = cols.get(gx * 1000 + gz);
      if (!c || c.id === 2) continue;
      vents.push({ x: gx - R + 0.5, z: gz - R + 0.5, y: c.h, big: true, ph: k * 1.1 + rand() });
    }
    const dummy = new THREE.Object3D();
    const steam = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.steam, Math.max(1, vents.length * 3));
    steam.frustumCulled = false;
    const puffs = [];
    for (const v of vents) {
      for (let pn = 0; pn < 3; pn++) {
        puffs.push({ v, off: pn / 3 + rand() * 0.12, sway: rand() * Math.PI * 2, s: (v.big ? 2.6 : 1.6) + rand() });
      }
    }
    steam.count = puffs.length;
    scene.add(steam);
    // 间歇泉 ×4：温泉池上 1 座 + 低地随机 3 座（火山锥外、避开河），各自错峰喷发
    const geysers = [];
    const addGeyser = (wx, wz, gy, off, withPool) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1, 1.7), mats.geyser);
      mesh.visible = false;
      scene.add(mesh);
      let pool = null;
      if (withPool) {
        pool = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 2.6), mats.pool);
        pool.position.set(wx, gy + 0.1, wz);
        scene.add(pool);
      }
      geysers.push({ mesh, pool, x: wx, z: wz, y: gy, off });
    };
    if (hotSprings.length) {
      addGeyser(hotSprings[0].x - R + 0.5, hotSprings[0].z - R + 0.5, hotSprings[0].y, 0, false);
    }
    for (let n = 0; n < 3; n++) {
      for (let tries = 0; tries < 40; tries++) {
        const a = rand() * Math.PI * 2;
        const rr = Rv + 5 + rand() * Math.max(3, R * 0.88 - Rv - 6);
        const gi = Math.round(R + Math.cos(a) * rr);
        const gj = Math.round(R + Math.sin(a) * rr);
        const c = cols.get(gi * 1000 + gj);
        if (!c || c.id === 2) continue; // 河里不放
        const wx = gi - R + 0.5;
        const wz = gj - R + 0.5;
        if (geysers.some((g) => Math.hypot(g.x - wx, g.z - wz) < 9)) continue;
        addGeyser(wx, wz, c.h, 1.6 + n * 0.9 + rand() * 0.5, true);
        break;
      }
    }
    // 火口熔岩湖气泡：湖面鼓包缓慢起伏（呼吸感）
    const bubbles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.bubble, 6);
    bubbles.frustumCulled = false;
    const bub = [];
    for (let n = 0; n < 6; n++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * Rv * 0.14;
      bub.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, ph: rand() * Math.PI * 2, sp: 0.6 + rand() * 0.9, s: 0.7 + rand() * 0.9 });
    }
    scene.add(bubbles);
    // 熔岩触河接触点：白汽大量翻涌（岩浆遇水的生死之交），16 团无缝循环
    const cSteam = [];
    for (let n = 0; n < 16; n++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 3.2, 3.2),
        new THREE.MeshLambertMaterial({ color: 0xe8eef4, transparent: true, opacity: 0.55 })
      );
      m.visible = false;
      scene.add(m);
      cSteam.push({ mesh: m, born: -1, ox: (rand() - 0.5) * 7, oz: (rand() - 0.5) * 7 });
    }
    ventFx = { mats, steam, puffs, dummy, geysers, bubbles, cSteam, contact: lavaContact, bub };
  }

  // 切走观赏对象 / 退出时收起全部火山岛 FX（挂着的余烬汽柱不该飘进别的模式）
  function hideIslandFx() {
    if (craterFx) {
      craterFx.fountain.visible = false;
      craterFx.light.intensity = 0;
      for (const e of craterFx.embers) e.mesh.visible = false;
      for (const s of craterFx.smoke) s.mesh.visible = false;
      for (const b of craterFx.blobs) b.mesh.visible = false;
    }
    if (ventFx) {
      ventFx.steam.visible = false;
      ventFx.bubbles.visible = false;
      for (const g of ventFx.geysers) {
        g.mesh.visible = false;
        if (g.pool) g.pool.visible = false;
      }
      for (const s of ventFx.cSteam) s.mesh.visible = false;
    }
    geyserHiss(0);
  }

  function tickVentFx(now) {
    const active = mode === 'island' && !building;
    if (!active) {
      if (ventFx) {
        ventFx.steam.visible = false;
        ventFx.bubbles.visible = false;
        for (const g of ventFx.geysers) g.mesh.visible = false;
        for (const s of ventFx.cSteam) s.mesh.visible = false;
      }
      geyserHiss(0);
      return;
    }
    ensureVentFx();
    ventFx.steam.visible = true;
    ventFx.bubbles.visible = true;
    const t = now / 1000;
    // 蒸汽团：循环升起、随高度放大再收尾（缩放收尾代替透明度，实例池保持单 draw call）
    for (let n = 0; n < ventFx.puffs.length; n++) {
      const p = ventFx.puffs[n];
      const life = 4.2 + (n % 3) * 0.5;
      const k = (t / life + p.off) % 1;
      const rise = k * (p.v.big ? 11 : 7);
      const sc = Math.max(0.001, p.s * Math.sin(Math.min(1, k * 1.12) * Math.PI) ** 0.7);
      ventFx.dummy.position.set(
        p.v.x + Math.sin(t * 0.7 + p.sway) * 0.7 * k,
        p.v.y + 1 + rise,
        p.v.z + Math.cos(t * 0.6 + p.sway) * 0.7 * k
      );
      ventFx.dummy.rotation.set(0, t * 0.3 + p.sway, 0);
      ventFx.dummy.scale.setScalar(sc);
      ventFx.dummy.updateMatrix();
      ventFx.steam.setMatrixAt(n, ventFx.dummy.matrix);
    }
    ventFx.steam.instanceMatrix.needsUpdate = true;
    // 间歇泉 ×4：各自 7 秒错峰喷发（冲顶→回落），伴嘶鸣
    let erupting = false;
    for (const g of ventFx.geysers) {
      const cyc = ((t + g.off) % 7) / 7;
      erupting = cyc < 0.29;
      g.mesh.visible = erupting;
      if (erupting) {
        const p = cyc / 0.29;
        const h = (g.off === 0 ? 13 : 9 + (g.off % 2)) * Math.sin(p * Math.PI) ** 0.6;
        g.mesh.scale.y = Math.max(0.001, h);
        g.mesh.position.set(g.x, g.y + h / 2, g.z);
        g.mesh.rotation.y += 0.02;
      }
    }
    geyserHiss(erupting ? 0.5 : 0);
    // 熔岩触河接触点：白汽大量翻涌，16 团无缝循环（错峰起步+脉冲缩放+侧摆升腾）
    for (const s of ventFx.cSteam) {
      if (s.born < 0) {
        s.born = now - rand() * 2600; // 错峰起步，开局汽柱即在翻涌
        s.mesh.position.set(ventFx.contact.x + s.ox, 1 + rand() * 2, ventFx.contact.z + s.oz);
        s.mesh.visible = true;
      }
      const q = (now - s.born) / 2600;
      if (q >= 1) {
        s.born = now - rand() * 600; // 无缝续接不断档
        s.mesh.position.set(ventFx.contact.x + s.ox, 1 + rand() * 2, ventFx.contact.z + s.oz);
      }
      s.mesh.position.y += 0.14;
      s.mesh.position.x += Math.sin(now * 0.002 + s.ox) * 0.08;
      s.mesh.rotation.y += 0.015;
      s.mesh.scale.setScalar((1 + Math.sin(now * 0.004 + s.oz) * 0.25) * (1 - q * 0.35));
      s.mesh.material.opacity = 0.55 * (1 - q);
    }
    // 火口熔岩气泡：湖面呼吸式鼓包
    for (let n = 0; n < ventFx.bub.length; n++) {
      const b = ventFx.bub[n];
      const pulse = Math.abs(Math.sin(t * b.sp + b.ph));
      ventFx.dummy.position.set(b.x, PEAK * 0.7 + pulse * b.s * 0.5, b.z);
      ventFx.dummy.scale.set(b.s, 0.3 + pulse * b.s * 1.3, b.s);
      ventFx.dummy.rotation.set(0, t * 0.5 + b.ph, 0);
      ventFx.dummy.updateMatrix();
      ventFx.bubbles.setMatrixAt(n, ventFx.dummy.matrix);
    }
    ventFx.bubbles.instanceMatrix.needsUpdate = true;
  }

  function disposeVentFx() {
    if (!ventFx) return;
    scene.remove(ventFx.steam);
    ventFx.steam.geometry.dispose();
    scene.remove(ventFx.bubbles);
    ventFx.bubbles.geometry.dispose();
    for (const g of ventFx.geysers) {
      scene.remove(g.mesh);
      g.mesh.geometry.dispose();
      if (g.pool) {
        scene.remove(g.pool);
        g.pool.geometry.dispose();
      }
    }
    for (const s of ventFx.cSteam) {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    }
    for (const k in ventFx.mats) ventFx.mats[k].dispose();
    ventFx = null;
  }

  // 补上 craterFx 的释放（原先只建不拆，退出 3D 会泄漏几何与材质）
  function disposeCraterFx() {
    if (!craterFx) return;
    scene.remove(craterFx.light);
    craterFx.light.dispose();
    scene.remove(craterFx.fountain);
    craterFx.fountain.geometry.dispose();
    for (const b of craterFx.blobs) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
    }
    for (const s of craterFx.smoke) {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    }
    for (const e of craterFx.embers) {
      scene.remove(e.mesh);
      e.mesh.geometry.dispose();
    }
    craterFx.mats.lava.dispose();
    craterFx.mats.ember.dispose();
    craterFx = null;
  }

  // ===== 火山岛生态：火山鸦绕火口盘旋 + 森林带萤火虫游弋 =====
  let islandFauna = null;

  function ensureIslandFauna() {
    if (islandFauna) return;
    const mats = {
      crow: new THREE.MeshLambertMaterial({ color: 0x3a3a46 }),
      fly: new THREE.MeshBasicMaterial({ color: 0xd4ff7a }),
      ele: new THREE.MeshLambertMaterial({ color: 0x75757f }),
      tusk: new THREE.MeshLambertMaterial({ color: 0xe6e0d0 }),
    };
    // 火山鸦：深色巨翼，绕火口高空盘旋
    const crows = [];
    for (let n = 0; n < 3; n++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 1.1), mats.crow));
      const wl = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.4), mats.crow);
      wl.position.x = -0.95;
      const wr = wl.clone();
      wr.position.x = 0.95;
      g.add(wl);
      g.add(wr);
      scene.add(g);
      crows.push({
        g, wl, wr,
        r: Rv * (1.05 + rand() * 0.3),
        ph: rand() * Math.PI * 2,
        sp: 0.16 + rand() * 0.08,
        y: PEAK + 11 + rand() * 5,
      });
    }
    // 萤火虫：森林带上空缓慢游弋的自发光点
    const flies = [];
    for (let n = 0; n < 14; n++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), mats.fly);
      const a = rand() * Math.PI * 2;
      const r = Rv * 1.1 + rand() * Math.max(4, R * 0.92 - Rv * 1.1);
      scene.add(mesh);
      flies.push({
        mesh,
        cx: Math.cos(a) * r,
        cz: Math.sin(a) * r,
        cy: 5 + rand() * 4,
        ax: 3 + rand() * 4,
        az: 3 + rand() * 4,
        s1: 0.2 + rand() * 0.3,
        s2: 0.4 + rand() * 0.4,
        s3: 0.25 + rand() * 0.35,
        p1: rand() * Math.PI * 2,
        p2: rand() * Math.PI * 2,
        p3: rand() * Math.PI * 2,
      });
    }
    // 大象：灰色庞然，绕火山脚慢行（4 只错峰错向，鼻甩身晃贴地走）
    const eles = [];
    for (let n = 0; n < 4; n++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.7, 3.8), mats.ele);
      body.position.y = 1.95;
      g.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.4), mats.ele);
      head.position.set(0, 2.15, 2.4);
      g.add(head);
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.6, 0.45), mats.ele);
      trunk.position.set(0, 1.35, 3.15);
      g.add(trunk);
      const el = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.95), mats.ele);
      el.position.set(-0.85, 2.25, 2.1);
      g.add(el);
      const er = el.clone();
      er.position.x = 0.85;
      g.add(er);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.7), mats.tusk);
      tl.position.set(-0.5, 1.55, 2.85);
      g.add(tl);
      const tr = tl.clone();
      tr.position.x = 0.5;
      g.add(tr);
      for (const [lx, lz] of [[-0.9, 1.35], [0.9, 1.35], [-0.9, -1.35], [0.9, -1.35]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.6), mats.ele);
        leg.position.set(lx, 0.7, lz);
        g.add(leg);
      }
      scene.add(g);
      eles.push({
        g, trunk,
        r: Rv * 1.12 + n * 1.6,
        ph: n * 1.7,
        sp: 0.045 + rand() * 0.02,
        dir: n % 2 === 0 ? 1 : -1,
        bob: rand() * 6,
      });
    }
    islandFauna = { crows, flies, eles, mats, t0: performance.now() };
  }

  function disposeIslandFauna() {
    if (!islandFauna) return;
    const kill = (o) => {
      scene.remove(o);
      o.traverse?.((c) => c.geometry?.dispose());
      o.geometry?.dispose();
    };
    for (const c of islandFauna.crows) kill(c.g);
    for (const f of islandFauna.flies) kill(f.mesh);
    for (const e of islandFauna.eles) kill(e.g);
    for (const k in islandFauna.mats) islandFauna.mats[k].dispose();
    islandFauna = null;
  }

  function tickIslandFauna(now) {
    if (mode !== 'island') return;
    if (!islandFauna) ensureIslandFauna();
    const t = (now - islandFauna.t0) / 1000;
    const ready = !building;
    // 火山鸦绕火口
    for (const c of islandFauna.crows) {
      const a = c.ph + t * c.sp;
      c.g.position.set(Math.cos(a) * c.r, c.y + Math.sin(t * 0.6 + c.ph) * 1.4, Math.sin(a) * c.r);
      c.g.rotation.y = -(a + Math.PI / 2);
      c.g.visible = ready;
      const flap = Math.sin(t * 6 + c.ph) * 0.5;
      c.wl.rotation.z = flap;
      c.wr.rotation.z = -flap;
    }
    // 萤火虫游弋 + 明灭
    for (const f of islandFauna.flies) {
      f.mesh.position.set(
        f.cx + Math.sin(t * f.s1 + f.p1) * f.ax,
        f.cy + Math.sin(t * f.s2 + f.p2) * 1.6,
        f.cz + Math.cos(t * f.s3 + f.p3) * f.az
      );
      f.mesh.visible = ready && Math.sin(t * 1.7 + f.p2) > -0.6;
    }
    // 大象绕火山脚慢行（贴地走：高度逐帧查地形，鼻甩身晃）
    for (const e of islandFauna.eles) {
      const a = e.ph + t * e.sp * e.dir;
      const x = Math.cos(a) * e.r;
      const z = Math.sin(a) * e.r;
      const col = cols.get(Math.round(R + x) * 1000 + Math.round(R + z));
      const gy = col ? col.h : 3;
      e.g.position.set(x, gy + Math.abs(Math.sin(t * 2.2 + e.bob)) * 0.12, z);
      e.g.rotation.y = Math.atan2(-Math.sin(a) * e.dir, Math.cos(a) * e.dir);
      e.trunk.rotation.x = Math.sin(t * 1.5 + e.bob) * 0.35;
      e.g.visible = ready;
    }
  }

  // ===== 雪山模式：参考真实雪山图景的体素观赏对象 =====
  // 角峰（平顶雪台+冰岩尖峰）+ 45° 雪裙 + 冰川舌 + 冻湖 + 雾凇松林 + 温泉；
  // 与 2D 雪山 tick 同一时钟（SNOW_CYCLE=2400）：雪崩窗口/玩家引发（avalancheUntil）/暴风雪全同步
  let snowItems = null;
  let snowMeta = null;
  let snowMaxH = 1;
  let snowFx = null;
  const SNOW_CYCLE = 2400;

  function buildSnowItems() {
    const arr = [];
    const cols = new Map();
    const key = (i, j) => i * 1000 + j;
    const C_SNOW = [238, 244, 252];
    const C_ICE = [188, 214, 236];
    const C_PINE = [46, 88, 58];
    const C_SNOWCAP = [255, 255, 255];
    const base = 3; // 雪原地面高
    const spikeH = Math.round(PEAK * 0.5);
    const skirtH = Math.round(PEAK * 0.46);
    const spikeHalf = Math.max(5, Math.round(R * 0.17));
    const skirtHalf = spikeHalf + skirtH; // 45° 裙坡
    const lakeA = rand() * Math.PI * 2;
    // 地形高度场：低地雪原 + 平顶雪台 + 冰岩尖峰 + 45° 雪裙
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < S; j++) {
        const dx = i - R;
        const dz = j - R;
        const ad = Math.sqrt(dx * dx + dz * dz);
        if (ad > R) continue;
        let h = base + Math.round(Math.sin(i * 0.07) + Math.sin(j * 0.11 + 1));
        let cap = C_SNOW;
        if (ad <= spikeHalf * 0.3) {
          h = base + skirtH + spikeH; // 平顶雪台
          cap = C_SNOWCAP;
        } else if (ad <= spikeHalf) {
          h = base + Math.round(skirtH + spikeH * 0.15 + ((spikeHalf - ad) / (spikeHalf * 0.7)) * spikeH * 0.85);
          cap = C_ICE; // 冰岩尖峰
        } else if (ad <= skirtHalf) {
          h = base + Math.round(skirtH + spikeH * 0.15 - (ad - spikeHalf)); // 45° 裙坡
        }
        if (h < 1) h = 1;
        cols.set(key(i, j), { h, cap });
      }
    }
    // 冻湖：山脚一侧的圆湖，冰盖封面，中央一道未冻裂缝（发光水面）
    const lakeCx = Math.round(R + Math.cos(lakeA) * R * 0.42);
    const lakeCz = Math.round(R + Math.sin(lakeA) * R * 0.42);
    const lakeR = Math.max(4, Math.round(R * 0.14));
    for (let dx = -lakeR; dx <= lakeR; dx++) {
      for (let dz = -lakeR; dz <= lakeR; dz++) {
        if ((dx / lakeR) ** 2 + (dz / lakeR) ** 2 > 1) continue;
        const c = cols.get(key(lakeCx + dx, lakeCz + dz));
        if (c && c.h <= base + 3) {
          c.h = base;
          c.cap = C_ICE;
          c.lake = true;
        }
      }
    }
    // 冰川舌：自雪台沿湖向铺蓝冰直抵湖畔，中段留一道冰裂缝
    const startAd = Math.round(spikeHalf * 0.2);
    const gapCol = lakeCx + ((rand() * 3) | 0) - 1;
    for (let t = 0; t <= 1; t += 0.02) {
      const gx = Math.round(R + (lakeCx - R) * t);
      const gz = Math.round(R + (lakeCz - R) * t);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const c = cols.get(key(gx + ox, gz + oz));
          if (c && !c.lake && gx + ox !== gapCol && c.h > base + 1) c.cap = C_ICE;
        }
      }
    }
    // 地热温泉：低地发光水塘（蒸汽 FX 锚点）
    const springA = lakeA + Math.PI * 0.75;
    const springX = Math.round(R + Math.cos(springA) * R * 0.55);
    const springZ = Math.round(R + Math.sin(springA) * R * 0.55);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const c = cols.get(key(springX + dx, springZ + dz));
        if (c && !c.lake) {
          c.h = 4;
          c.cap = C_WATER;
          c.spring = true;
        }
      }
    }
    // 三座次峰：高低不同、形状各异（尖锥/圆顶/方桌），拉远距离与主峰不相连（低地雪原隔开）
    const secPeaks = [
      { az: lakeA + 0.9, dist: R * 0.74, rad: Math.max(7, Math.round(R * 0.14)), h: Math.round(PEAK * 0.62), shape: 'cone' },
      { az: lakeA + 2.6, dist: R * 0.7, rad: Math.max(8, Math.round(R * 0.2)), h: Math.round(PEAK * 0.42), shape: 'dome' },
      { az: lakeA - 1.4, dist: R * 0.73, rad: Math.max(6, Math.round(R * 0.12)), h: Math.round(PEAK * 0.52), shape: 'mesa' },
    ];
    const secSummits = [];
    for (const sp of secPeaks) {
      const px0 = Math.round(R + Math.cos(sp.az) * sp.dist);
      const pz0 = Math.round(R + Math.sin(sp.az) * sp.dist);
      for (let dx = -sp.rad - 1; dx <= sp.rad + 1; dx++) {
        for (let dz = -sp.rad - 1; dz <= sp.rad + 1; dz++) {
          const c = cols.get(key(px0 + dx, pz0 + dz));
          if (!c || c.lake || c.spring) continue;
          const d = Math.sqrt(dx * dx + dz * dz);
          let add = 0;
          if (sp.shape === 'cone') {
            if (d <= sp.rad) add = Math.round(sp.h * (1 - d / sp.rad));
          } else if (sp.shape === 'dome') {
            if (d <= sp.rad) add = Math.round(sp.h * (1 - (d / sp.rad) ** 2));
          } else if (d <= sp.rad * 0.55) {
            add = sp.h; // 方桌：平顶
          } else if (d <= sp.rad) {
            add = Math.round(sp.h * (1 - (d - sp.rad * 0.55) / (sp.rad * 0.45)));
          }
          if (add > 0) {
            c.h = Math.max(c.h, base + add);
            c.cap = d < sp.rad * 0.35 ? C_ICE : C_SNOW;
          }
        }
      }
      secSummits.push({ x: px0, z: pz0, h: base + sp.h });
    }
    // 小雪屋地基：低地平整一块（必须在组装前，否则屋墙悬空/入土）
    const hutA = lakeA + Math.PI * 1.85;
    const hutX = Math.round(R + Math.cos(hutA) * R * 0.5);
    const hutZ = Math.round(R + Math.sin(hutA) * R * 0.5);
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        const c = cols.get(key(hutX + dx, hutZ + dz));
        if (c && !c.lake && !c.spring && c.h <= base + 4) {
          c.h = base;
          c.cap = C_SNOW;
        }
      }
    }
    // 组装实例：石基 + 雪身 + 顶盖
    for (const [k, c] of cols) {
      const i = Math.floor(k / 1000);
      const j = k % 1000;
      if (c.h > 3) {
        arr.push({ x: i, z: j, y0: 0, h: 2, sx: 1, sz: 1, rgb: C_STONE, glow: false });
        arr.push({ x: i, z: j, y0: 2, h: c.h - 3, sx: 1, sz: 1, rgb: C_SNOW, glow: false });
        arr.push({ x: i, z: j, y0: c.h - 1, h: 1, sx: 1, sz: 1, rgb: c.cap, glow: c.spring });
      } else {
        arr.push({ x: i, z: j, y0: 0, h: c.h, sx: 1, sz: 1, rgb: c.cap, glow: c.spring });
      }
    }
    // 木桥：主峰雪台 → 三座次峰山顶；双排桥面板、栏柱成对、暖灯夜照、
    // 积雪不规则覆盖、木板残缺不连续
    const mainTop = base + skirtH + spikeH;
    for (const s of secSummits) {
      const dist = Math.hypot(s.x - R, s.z - R);
      const steps = Math.ceil(dist);
      const ux = (s.x - R) / dist;
      const uz = (s.z - R) / dist;
      const nx = -uz;
      const nz = ux; // 桥面横向单位向量
      for (let k = 0; k <= steps; k++) {
        const f = k / steps;
        if (f > 0.02 && f < 0.98 && rand() < 0.05) continue; // 木板残缺
        const bx = R + (s.x - R) * f;
        const bz = R + (s.z - R) * f;
        const by = Math.round(mainTop + (s.h - mainTop) * f) + 1;
        // 双排桥面板
        for (const side of [-0.55, 0.55]) {
          arr.push({
            x: Math.round(bx + nx * side), z: Math.round(bz + nz * side),
            y0: by, h: 0.4, sx: 1.15, sz: 1.15, rgb: C_WOOD, glow: false,
          });
        }
        // 积雪不规则覆盖（左右随机一侧）
        if (rand() < 0.45) {
          const snowSide = rand() < 0.5 ? -0.55 : 0.55;
          arr.push({
            x: Math.round(bx + nx * snowSide), z: Math.round(bz + nz * snowSide),
            y0: by + 0.4, h: 0.3, sx: 1.1, sz: 1.1, rgb: C_SNOWCAP, glow: false,
          });
        }
        // 栏柱每 3 步一对
        if (k % 3 === 0) {
          for (const side of [-1, 1]) {
            arr.push({
              x: Math.round(bx + nx * side), z: Math.round(bz + nz * side),
              y0: by + 0.4, h: 0.9, sx: 0.3, sz: 0.3, rgb: C_WOOD, glow: false,
            });
          }
        }
        // 暖灯每 12 步一盏（桥心悬照，夜里一点暖光）
        if (k % 12 === 6) {
          arr.push({
            x: Math.round(bx + nx), z: Math.round(bz + nz),
            y0: by + 1.3, h: 0.5, sx: 0.6, sz: 0.6, rgb: [255, 180, 90], glow: true,
          });
        }
      }
    }
    // 木造雪屋：两层木构小楼（原圆顶冰屋放大改建），门口朝主峰、
    // 冰窗暖光、层间雪檐、金字塔雪顶、石烟囱
    const hw = 3; // 墙半宽
    const doorDirX = Math.abs(hutX - R) >= Math.abs(hutZ - R) ? Math.sign(hutX - R) || 1 : 0;
    const doorDirZ = doorDirX === 0 ? Math.sign(hutZ - R) || 1 : 0;
    for (let f = 0; f < 2; f++) {
      const y0 = base + f * 4;
      for (let dx = -hw; dx <= hw; dx++) {
        for (let dz = -hw; dz <= hw; dz++) {
          const edge = Math.abs(dx) === hw || Math.abs(dz) === hw;
          if (!edge) continue;
          // 一层门口（朝主峰面中央，两格高留空）
          const doorFace = (doorDirX !== 0 && dx === -doorDirX * hw) || (doorDirX === 0 && dz === -doorDirZ * hw);
          const doorSpot = doorDirX !== 0 ? dz === 0 : dx === 0;
          if (f === 0 && doorFace && doorSpot && y0 < base + 2) continue;
          // 二层冰窗（门面两肩 + 背面两扇）
          const winFace = f === 1 && ((doorDirX !== 0 && dx === -doorDirX * hw && Math.abs(dz) === 2) || (doorDirX === 0 && dz === -doorDirZ * hw && Math.abs(dx) === 2));
          if (winFace) {
            arr.push({ x: hutX + dx, z: hutZ + dz, y0: y0 + 1, h: 1, sx: 1, sz: 1, rgb: C_ICE, glow: true });
            continue;
          }
          arr.push({ x: hutX + dx, z: hutZ + dz, y0, h: 1, sx: 1, sz: 1, rgb: C_WOOD, glow: false });
        }
      }
      // 层间雪檐：墙面顶一圈外挑 0.5 格
      for (let dx = -hw - 1; dx <= hw + 1; dx++) {
        for (let dz = -hw - 1; dz <= hw + 1; dz++) {
          const rim = Math.abs(dx) === hw + 1 || Math.abs(dz) === hw + 1;
          const edge = Math.abs(dx) === hw || Math.abs(dz) === hw;
          if (!edge && !rim) continue;
          if (edge && rim) continue;
          arr.push({ x: hutX + dx, z: hutZ + dz, y0: y0 + 3, h: 0.3, sx: 1, sz: 1, rgb: C_SNOWCAP, glow: false });
        }
      }
    }
    // 金字塔雪顶（实心堆叠，雪白压顶）
    for (let l = 0; l <= 4; l++) {
      const r = hw + 1 - l;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          arr.push({ x: hutX + dx, z: hutZ + dz, y0: base + 7 + l, h: 0.8, sx: 1, sz: 1, rgb: C_SNOWCAP, glow: false });
        }
      }
    }
    // 石烟囱 + 屋内两层暖光 + 门旁灯
    for (let y = base + 6; y <= base + 11; y++) {
      arr.push({ x: hutX + 1, z: hutZ - 1, y0: y, h: 1, sx: 0.9, sz: 0.9, rgb: C_STONE, glow: false });
    }
    arr.push({ x: hutX + 1, z: hutZ - 1, y0: base + 12, h: 0.4, sx: 1.1, sz: 1.1, rgb: C_SNOWCAP, glow: false });
    arr.push({ x: hutX, z: hutZ, y0: base + 1.2, h: 0.5, sx: 0.8, sz: 0.8, rgb: [255, 190, 110], glow: true });
    arr.push({ x: hutX, z: hutZ, y0: base + 5.2, h: 0.5, sx: 0.8, sz: 0.8, rgb: [255, 190, 110], glow: true });
    // 雪原生态：雾凇松林（低地错落的积雪塔冠松，避开雪屋与桥带）
    const pines = [];
    for (let tries = 0; tries < 700 && pines.length < 40; tries++) {
      const a = rand() * Math.PI * 2;
      const rr = skirtHalf + 3 + rand() * Math.max(3, R * 0.95 - skirtHalf - 4);
      const i = Math.round(R + Math.cos(a) * rr);
      const j = Math.round(R + Math.sin(a) * rr);
      const c = cols.get(key(i, j));
      if (!c || c.lake || c.spring || c.h > base + 5) continue;
      if (Math.hypot(i - hutX, j - hutZ) < 7) continue;
      if (pines.some((p) => Math.abs(p[0] - i) < 4 && Math.abs(p[1] - j) < 4)) continue;
      pines.push([i, j]);
      const trunk = 2 + ((rand() * 2) | 0);
      arr.push({ x: i, z: j, y0: c.h, h: trunk, sx: 0.5, sz: 0.5, rgb: C_WOOD, glow: false });
      for (let l = 0; l < 3; l++) {
        arr.push({
          x: i, z: j, y0: c.h + trunk + l * 1.5, h: 1.3,
          sx: 2.1 - l * 0.6, sz: 2.1 - l * 0.6, rgb: C_PINE, glow: false,
        });
      }
      arr.push({ x: i, z: j, y0: c.h + trunk + 4.5, h: 0.5, sx: 0.8, sz: 0.8, rgb: C_SNOWCAP, glow: false });
    }
    // 冰凌簇：低地零散的透明冰塔
    for (let n = 0; n < 10; n++) {
      const a = rand() * Math.PI * 2;
      const rr = skirtHalf + 4 + rand() * Math.max(3, R * 0.9 - skirtHalf - 5);
      const i = Math.round(R + Math.cos(a) * rr);
      const j = Math.round(R + Math.sin(a) * rr);
      const c = cols.get(key(i, j));
      if (!c || c.lake || c.spring || c.h > base + 5) continue;
      if (Math.hypot(i - hutX, j - hutZ) < 6) continue;
      const hgt = 0.8 + rand() * 1.6;
      arr.push({ x: i, z: j, y0: c.h, h: hgt, sx: 0.4, sz: 0.4, rgb: C_ICE, glow: false });
      if (rand() < 0.5) {
        arr.push({ x: i + 1, z: j, y0: c.h, h: hgt * 0.6, sx: 0.3, sz: 0.3, rgb: C_ICE, glow: false });
      }
    }
    // 雪丘：地面缓起的白色圆包
    for (let n = 0; n < 8; n++) {
      const a = rand() * Math.PI * 2;
      const rr = skirtHalf + 4 + rand() * Math.max(3, R * 0.9 - skirtHalf - 5);
      const i = Math.round(R + Math.cos(a) * rr);
      const j = Math.round(R + Math.sin(a) * rr);
      const c = cols.get(key(i, j));
      if (!c || c.lake || c.spring || c.h > base + 5) continue;
      arr.push({ x: i, z: j, y0: c.h, h: 0.9, sx: 2 + rand() * 1.5, sz: 2 + rand() * 1.5, rgb: C_SNOWCAP, glow: false });
    }
    // 冻枯木：站立的枯树干（雾凇挂枝）
    for (let n = 0; n < 5; n++) {
      const a = rand() * Math.PI * 2;
      const rr = skirtHalf + 4 + rand() * Math.max(3, R * 0.9 - skirtHalf - 5);
      const i = Math.round(R + Math.cos(a) * rr);
      const j = Math.round(R + Math.sin(a) * rr);
      const c = cols.get(key(i, j));
      if (!c || c.lake || c.spring || c.h > base + 5) continue;
      arr.push({ x: i, z: j, y0: c.h, h: 3 + ((rand() * 2) | 0), sx: 0.4, sz: 0.4, rgb: C_WOOD, glow: false });
      arr.push({ x: i, z: j, y0: c.h + 2.5, h: 0.4, sx: 1.2, sz: 0.4, rgb: C_WOOD, glow: false });
      arr.push({ x: i, z: j, y0: c.h + 2.9, h: 0.3, sx: 1.2, sz: 0.4, rgb: C_SNOWCAP, glow: false });
    }
    // 岩石露头：雪坡上探出的裸岩
    for (let n = 0; n < 10; n++) {
      const a = rand() * Math.PI * 2;
      const ad = spikeHalf * 0.6 + rand() * (skirtHalf - spikeHalf) * 0.8;
      const i = Math.round(R + Math.cos(a) * ad);
      const j = Math.round(R + Math.sin(a) * ad);
      const c = cols.get(key(i, j));
      if (!c || c.lake || c.spring) continue;
      arr.push({ x: i, z: j, y0: c.h, h: 0.7, sx: 0.9, sz: 0.9, rgb: C_STONE, glow: false });
    }
    const meta = {
      spikeHalf,
      skirtH,
      base,
      topY: base + skirtH + spikeH,
      spring: { x: springX - R + 0.5, y: 4, z: springZ - R + 0.5 },
      az0: rand() * Math.PI * 2,
    };
    return { arr, meta };
  }

  function enterSnow() {
    mode = 'snow';
    hideIslandFx();
    if (!snowItems) {
      const built = buildSnowItems();
      snowItems = built.arr;
      snowMeta = built.meta;
    }
    items = snowItems;
    maxH = 1;
    for (const it of items) maxH = Math.max(maxH, it.y0 + it.h);
    snowMaxH = maxH;
    disc.visible = true;
    building = true; // 重播自搭建入场
    buildStart = performance.now();
    rebuild(true);
    camera.position.set(0, maxH * 2.3 + S * 0.28, S * 0.6);
    controls.target.set(0, maxH * 0.2, 0);
    controls.minDistance = maxH * 0.5;
    controls.maxDistance = S * 2.4;
    scene.fog.near = S * 0.9;
    scene.fog.far = S * 2.6;
    setModeLabel();
  }

  function ensureSnowFx() {
    if (snowFx) return;
    const mats = {
      flake: new THREE.MeshBasicMaterial({ color: 0xf4f8ff }),
      pour: new THREE.MeshBasicMaterial({ color: 0xeef4fb }),
      steam: new THREE.MeshLambertMaterial({ color: 0xb9c4ce, transparent: true, opacity: 0.4 }),
    };
    const dummy = new THREE.Object3D();
    // 风吹雪：满天飘雪粒子（暴风雪时加速横扫）
    const flakes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mats.flake, 90);
    flakes.frustumCulled = false;
    const fl = [];
    for (let n = 0; n < 90; n++) {
      fl.push({
        x: (rand() - 0.5) * S * 1.1,
        z: (rand() - 0.5) * S * 1.1,
        y: rand() * (snowMeta.topY + 20),
        v: 0.06 + rand() * 0.1,
        sway: rand() * Math.PI * 2,
      });
    }
    scene.add(flakes);
    // 雪崩雪瀑：24 团雪块在雪崩前锋循环翻滚
    const pour = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), mats.pour, 24);
    pour.frustumCulled = false;
    scene.add(pour);
    // 温泉蒸汽
    const steam = [];
    for (let n = 0; n < 4; n++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mats.steam);
      m.visible = false;
      scene.add(m);
      steam.push({ mesh: m, born: -1 });
    }
    snowFx = { mats, flakes, fl, pour, dummy, steam, blizzardNow: false, avalancheNow: false };
  }

  function hideSnowFx() {
    if (snowFx) {
      snowFx.flakes.visible = false;
      snowFx.pour.visible = false;
      for (const s of snowFx.steam) s.mesh.visible = false;
    }
    windHowl(0);
    volcanoRumble(0);
  }

  function tickSnowFx(now) {
    const active = mode === 'snow' && !building;
    if (!active) {
      hideSnowFx();
      return;
    }
    ensureSnowFx();
    const m = snowMeta;
    snowFx.flakes.visible = true;
    snowFx.pour.visible = true;
    const t = now / 1000;
    const phase = world.frame % SNOW_CYCLE;
    const cycleN = Math.floor(world.frame / SNOW_CYCLE);
    const blizzard = cycleN % 2 === 1 && phase >= 900 && phase < 1500;
    snowFx.blizzardNow = blizzard;
    // 飘雪：常态徐落，暴风雪时快而斜
    const speed = blizzard ? 3 : 1;
    for (let n = 0; n < snowFx.fl.length; n++) {
      const f = snowFx.fl[n];
      f.y -= f.v * speed;
      f.x += (blizzard ? 0.35 : 0.05) + Math.sin(t + f.sway) * 0.1;
      if (f.y < 0) {
        f.y = m.topY + 15 + rand() * 10;
        f.x = (rand() - 0.5) * S * 1.1;
        f.z = (rand() - 0.5) * S * 1.1;
      }
      if (f.x > S * 0.6) f.x = -S * 0.6;
      snowFx.dummy.position.set(f.x, f.y, f.z);
      snowFx.dummy.rotation.set(t + f.sway, 0, 0);
      snowFx.dummy.scale.setScalar(blizzard ? 1.5 : 1);
      snowFx.dummy.updateMatrix();
      snowFx.flakes.setMatrixAt(n, snowFx.dummy.matrix);
    }
    snowFx.flakes.instanceMatrix.needsUpdate = true;
    // 雪崩：与 2D 雪山 tick 同帧——周期窗口或玩家引发（avalancheUntil）都倒雪
    const inWindow = phase >= 2100 && phase < 2200;
    const triggered = world.frame < (world.avalancheUntil || 0) && world.avalancheUntil > 0;
    const snowFx$ = snowFx;
    snowFx$.avalancheNow = inWindow || triggered;
    if (snowFx$.avalancheNow) {
      const elapsed = inWindow
        ? phase - 2100
        : 100 - ((world.avalancheUntil || 0) - world.frame);
      const p = 0.1 + 0.85 * Math.max(0, Math.min(1, elapsed / 100));
      const side = (cycleN % 2 === 0) ? 1 : -1;
      const az = m.az0 + (side === 1 ? 0 : Math.PI);
      const d = m.spikeHalf + p * m.skirtH;
      const gy = m.base + m.skirtH * (1 - p);
      for (let n = 0; n < 24; n++) {
        const jx = Math.cos(az) * d + (((rand() - 0.5) * 6) | 0);
        const jz = Math.sin(az) * d + (((rand() - 0.5) * 6) | 0);
        const jy = gy + 1 + (n % 5) * 0.8 + Math.sin(t * 3 + n) * 0.4;
        snowFx.dummy.position.set(jx, jy, jz);
        snowFx.dummy.rotation.set(t * 2 + n, n, 0);
        snowFx.dummy.scale.setScalar(0.6 + (n % 4) * 0.25);
        snowFx.dummy.updateMatrix();
        snowFx.pour.setMatrixAt(n, snowFx.dummy.matrix);
      }
      snowFx.pour.instanceMatrix.needsUpdate = true;
    }
    volcanoRumble(snowFx$.avalancheNow ? 0.7 : 0.1);
    // 温泉蒸汽：泉面缓缓升腾
    for (const s of snowFx.steam) {
      if (s.born < 0) {
        if (rand() > 0.03) continue;
        s.born = now;
        s.mesh.position.set(m.spring.x + (rand() - 0.5) * 1.6, m.spring.y + 1, m.spring.z + (rand() - 0.5) * 1.6);
        s.mesh.visible = true;
      }
      const q = (now - s.born) / 2400;
      if (q >= 1) {
        s.born = -1;
        s.mesh.visible = false;
        continue;
      }
      s.mesh.position.y += 0.06;
      s.mesh.rotation.y += 0.01;
      s.mesh.material.opacity = 0.4 * (1 - q);
    }
    windHowl(blizzard ? 0.5 : 0.06);
  }

  function disposeSnowFx() {
    if (!snowFx) return;
    scene.remove(snowFx.flakes);
    snowFx.flakes.geometry.dispose();
    scene.remove(snowFx.pour);
    snowFx.pour.geometry.dispose();
    for (const s of snowFx.steam) {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose();
    }
    for (const k in snowFx.mats) snowFx.mats[k].dispose();
    snowFx = null;
  }

  (function loop() {
    raf = requestAnimationFrame(loop);
    tickSkyLight();
    if (mode === 'live') tickLive();
    else if (mode === 'sea') tickSea();
    else if (mode === 'snow') {
      tickBuild();
      tickSnowFx(performance.now());
    } else {
      tickBuild();
      tickVolcanoFx();
      tickVentFx(performance.now());
      tickIslandFauna(performance.now());
    }
    if (renderer2d) {
      renderer2d.fillTheme(bgData, state.theme, frame(), W, H);
      bgTex.needsUpdate = true;
    }
    controls.update();
    renderer.render(scene, camera);
  })();

  const overlay = document.createElement('div');
  overlay.className = 'td-overlay';
  overlay.appendChild(renderer.domElement);
  // 观赏对象下拉菜单：火山岛 / 海岛 / 实景同步 三选一
  toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'td3d-toggle';
  toggleBtn.title = '选择 3D 观赏对象';
  const menuList = document.createElement('div');
  menuList.className = 'td3d-menu-list';
  menuList.hidden = true;
  const menuItems = [
    ['island', 'volcano', '火山岛'],
    ['sea', 'archipelago', '海岛'],
    ['snow', 'snow-mountain', '雪山'],
    ['live', 'mirror', '实景同步'],
  ].map(([key, ico, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'td3d-item';
    b.innerHTML =
      (ico === 'mirror' ? systemIcon(ico, 'td-ico') : biomeIcon(ico, 'td-ico')) +
      `<span>${label}</span>`;
    b.onclick = (e) => {
      e.stopPropagation();
      menuList.hidden = true;
      switchTo(key);
    };
    menuList.appendChild(b);
    return { key, b, ico, label };
  });
  const setModeLabel = () => {
    const cur = menuItems.find((i) => i.key === mode);
    if (cur) {
      toggleBtn.innerHTML =
        (cur.ico === 'mirror' ? systemIcon(cur.ico, 'td-ico') : biomeIcon(cur.ico, 'td-ico')) +
        `<span>${cur.label}</span>`;
    }
    for (const i of menuItems) i.b.classList.toggle('on', i.key === mode);
  };
  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    menuList.hidden = !menuList.hidden;
  };
  const closeMenu = (e) => {
    if (!menuList.hidden && !menuList.contains(e.target) && !toggleBtn.contains(e.target)) {
      menuList.hidden = true;
    }
  };
  document.addEventListener('click', closeMenu);
  setModeLabel();
  overlay.appendChild(toggleBtn);
  overlay.appendChild(menuList);
  host.appendChild(overlay);
  // 调试钩子：后台标签 rAF 被节流时可手动渲染一帧（同时推进搭建动画）
  overlay.__renderOnce = () => {
    tickSkyLight();
    if (mode === 'live') tickLive();
    else if (mode === 'sea') tickSea();
    else if (mode === 'snow') {
      tickBuild();
      tickSnowFx(performance.now());
    } else {
      tickBuild();
      tickVolcanoFx();
      tickVentFx(performance.now());
      tickIslandFauna(performance.now());
    }
    if (renderer2d) {
      renderer2d.fillTheme(bgData, state.theme, frame(), W, H);
      bgTex.needsUpdate = true;
    }
    controls.update();
    renderer.render(scene, camera);
  };
  overlay.__liveSync = () => liveSync();
  overlay.__stats = () => ({
    mode,
    solidCount: lastSolid,
    glowCount: lastGlow,
    trees: treeCount,
    progress: buildUniform.value,
    building,
    live: live
      ? {
          solid: live.meshes.solid?.count ?? 0,
          glow: live.meshes.glow?.count ?? 0,
          capSolid: live.cap.solid,
          capGlow: live.cap.glow,
        }
      : null,
    sea:
      mode === 'sea'
        ? {
            tsunami: !!seaTsunami,
            bolts: seaBolts.length,
            items: items.length,
            fish: fauna?.fishes.length ?? 0,
            gulls: fauna?.gulls.length ?? 0,
            boats: fauna?.boats.length ?? 0,
            sunk: fauna ? fauna.boats.filter((b) => b.state === 'sunk').length : 0,
            syncK: syncLastK,
            frame: world.frame,
          }
        : null,
    volcano:
      mode === 'island' && craterFx
        ? { eruption: craterFx.erupting, phase: craterFx.phase }
        : null,
    vents: mode === 'island' && ventFx ? { puffs: ventFx.puffs.length, geysers: ventFx.geysers.length } : null,
    snow:
      mode === 'snow' && snowFx
        ? { blizzard: snowFx.blizzardNow, avalanche: snowFx.avalancheNow }
        : null,
  });

  return function dispose() {
    if (refreshTimer) clearInterval(refreshTimer);
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    controls.dispose();
    toggleBtn.remove();
    if (mode === 'sea') disposeSea();
    volcanoRumble(0);
    disposeCraterFx();
    disposeVentFx();
    disposeSnowFx();
    disposeIslandFauna();
    document.removeEventListener('click', closeMenu);
    if (live) {
      for (const kind of ['solid', 'glow']) {
        const mesh = live.meshes[kind];
        scene.remove(mesh);
        mesh.dispose();
        mesh.geometry.dispose();
      }
      live = null;
    }
    if (solidMesh) {
      scene.remove(solidMesh);
      solidMesh.dispose();
    }
    if (glowMesh) {
      scene.remove(glowMesh);
      glowMesh.dispose();
    }
    disc.geometry.dispose();
    disc.material.dispose();
    scene.remove(disc);
    liveBase.geometry.dispose();
    liveBase.material.dispose();
    scene.remove(liveBase);
    if (islandGeoS) islandGeoS.dispose();
    if (islandGeoG) islandGeoG.dispose();
    solidMat.dispose();
    glowMat.dispose();
    renderer.dispose();
    overlay.remove();
  };
}
