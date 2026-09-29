import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './store.js';
import { E, EL } from '../sim/elements.js';

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
  // 支流：从火山脚向外延伸到主河的 4 条放射小溪
  function inTributary(i, j, ang, r) {
    for (let k = 0; k < 4; k++) {
      const tribAng = veinBase[k] + Math.PI + Math.sin(r * 0.12 + k * 3.1) * 0.18;
      const da = Math.abs(((ang - tribAng + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da < 0.05 && r > Rv * 0.98 && r < riverRadius(ang) - 2) return true;
    }
    return false;
  }

  const cols = new Map(); // key → {h, id}
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
  const items = []; // {x, z, y0, h, sx, sz, rgb, glow}
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

  const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 1, S * 8);
  camera.position.set(0, PEAK * 2.8 + S * 0.3, S * 0.62);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
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
    toggleBtn.textContent = '🏝 返回火山岛';
  }

  function exitLive() {
    mode = 'island';
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
    toggleBtn.textContent = '🖼 实景同步';
  }

  function tickLive() {
    // 建成后 uProgress 继续前进，新格子永远有坠落入场可用
    buildUniform.value = liveProgress();
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
  (function loop() {
    raf = requestAnimationFrame(loop);
    if (mode === 'live') tickLive();
    else tickBuild();
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
  // 观赏对象切换：程序化火山岛 ↔ 2D 世界实景沙盘
  toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'td3d-toggle';
  toggleBtn.textContent = '🖼 实景同步';
  toggleBtn.title = '在程序化火山岛与 2D 世界实景沙盘之间切换（实景实时同步喷发与流动）';
  toggleBtn.onclick = () => (mode === 'island' ? liveStart() : exitLive());
  overlay.appendChild(toggleBtn);
  host.appendChild(overlay);
  // 调试钩子：后台标签 rAF 被节流时可手动渲染一帧（同时推进搭建动画）
  overlay.__renderOnce = () => {
    if (mode === 'live') tickLive();
    else tickBuild();
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
  });

  return function dispose() {
    if (refreshTimer) clearInterval(refreshTimer);
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    controls.dispose();
    toggleBtn.remove();
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
