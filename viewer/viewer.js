// 元素沙盒 · 3D 场景查看器（测试版）
// 读取“导出场景”生成的 JSON 快照，把 2D 粒子格转成 1 格厚的体素立体切片。
// 仅依赖本地 three.js（UMD 构建），双击 index.html 离线可用。

/* global THREE, SAMPLE_VOLCANO */

const FORMAT = 'element-sandbox-scene';

// ===== 页面元素 =====
const stage = document.getElementById('stage');
const fileInput = document.getElementById('file-input');
const btnSample = document.getElementById('btn-sample');
const thicknessInput = document.getElementById('thickness');
const thickVal = document.getElementById('thick-val');
const downsampleInput = document.getElementById('downsample');
const instCountEl = document.getElementById('inst-count');
const fpsEl = document.getElementById('fps');

// ===== 三维场景骨架 =====
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d14);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 4000);
camera.position.set(0, -30, 360); // 初始正视角，与 2D 画面方向一致

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(120, 180, 320);
scene.add(sun);

// 3D 背景星空：大球面上随机撒星点（远山剪影属装饰层，不进 3D）
function buildStarfield() {
  const n = 1000;
  const pos = new Float32Array(n * 3);
  const R = 1500;
  for (let i = 0; i < n; i++) {
    // 均匀撒在球面上
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = R * s * Math.cos(phi);
    pos[i * 3 + 1] = R * u;
    pos[i * 3 + 2] = R * s * Math.sin(phi);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xdde6ff, size: 5, sizeAttenuation: false });
  const stars = new THREE.Points(g, m);
  stars.frustumCulled = false;
  scene.add(stars);
}
buildStarfield();

// ===== 体素构建 =====
const geo = new THREE.BoxGeometry(1, 1, 1);
let solidMesh = null; // 不发光材质（Lambert）
let glowMesh = null; // 自发光材质（Basic：火/熔岩）
let glowLights = []; // 熔岩点光源
let currentScene = null;

// 判断是否“地面类”物质：厚度加大时向下延伸成基座
function isGround(id) {
  return id === 3 || id === 1 || id === 5; // 石 / 沙 / 木
}

// 清理旧实例
function clearMeshes() {
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
  glowLights.forEach((l) => scene.remove(l));
  glowLights = [];
}

// 由快照构建体素切片
// thickness: 切片厚度（1=平面切片，加大后地面类物质向下延伸成基座）
// downsample: 2×2 格合并为一格
function buildInstances(snap, thickness, downsample) {
  clearMeshes();
  const step = downsample ? 2 : 1;
  const cell = step; // 每格边长

  const solidItems = [];
  const glowItems = [];
  const lavaPts = [];

  for (let y = 0; y < snap.height; y += step) {
    for (let x = 0; x < snap.width; x += step) {
      let id = 0;
      // 降采样时在 2×2 块内取第一个非空物质
      for (let dy = 0; dy < step && id === 0; dy++) {
        for (let dx = 0; dx < step && id === 0; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px < snap.width && py < snap.height) {
            id = snap.cells[py * snap.width + px];
          }
        }
      }
      if (id === 0) continue;

      // 坐标：以画布中心为原点，Y 轴向上（与 2D 画面方向一致）
      const wx = (x + cell / 2 - snap.width / 2) * cell;
      const wy = (snap.height / 2 - y - cell / 2) * cell;

      const pal = snap.palette.find((p) => p.id === id);
      const base = pal && pal.color ? pal.color : '#888888';
      const item = { wx, wy, id, base, cell };

      if (pal && pal.emissive) {
        glowItems.push(item);
        if (id === 11) lavaPts.push([wx, wy]);
      } else {
        solidItems.push(item);
      }
    }
  }

  const t = thickness;
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();

  // 普通物质：Lambert 受光
  solidMesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), Math.max(1, solidItems.length));
  solidMesh.frustumCulled = false;
  for (let n = 0; n < solidItems.length; n++) {
    const it = solidItems[n];
    const groundExt = isGround(it.id) ? (t - 1) * cell : 0; // 地面类向下延伸成基座
    p.set(it.wx, it.wy - groundExt / 2, 0);
    s.set(cell, cell + groundExt, t * cell);
    m4.compose(p, quat, s);
    solidMesh.setMatrixAt(n, m4);
    col.set(it.base);
    solidMesh.setColorAt(n, col);
  }
  solidMesh.instanceMatrix.needsUpdate = true;
  if (solidMesh.instanceColor) solidMesh.instanceColor.needsUpdate = true;
  scene.add(solidMesh);

  // 高温物质：Basic 自发光（不受光照，暗处发亮）
  glowMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), Math.max(1, glowItems.length));
  glowMesh.frustumCulled = false;
  for (let n = 0; n < glowItems.length; n++) {
    const it = glowItems[n];
    p.set(it.wx, it.wy, 0);
    s.set(cell, cell, t * cell);
    m4.compose(p, quat, s);
    glowMesh.setMatrixAt(n, m4);
    col.set(it.base);
    glowMesh.setColorAt(n, col);
  }
  glowMesh.instanceMatrix.needsUpdate = true;
  if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
  scene.add(glowMesh);

  // 熔岩点光源：取最多 3 个分散的熔岩位置
  for (let i = 0; i < Math.min(3, lavaPts.length); i++) {
    const idx = Math.floor((i * (lavaPts.length - 1)) / Math.max(1, Math.min(3, lavaPts.length) - 1) || 0);
    const [lx, ly] = lavaPts[idx] || lavaPts[0];
    const light = new THREE.PointLight(0xff6a2a, 1.2, Math.max(120, snap.width * 0.6));
    light.position.set(lx, ly, t * cell + 24);
    scene.add(light);
    glowLights.push(light);
  }

  instCountEl.textContent = `${solidItems.length + glowItems.length}`;
}

// ===== 加载入口 =====
function loadSceneObj(obj) {
  if (!obj || obj.format !== FORMAT || !Array.isArray(obj.cells)) {
    alert('文件格式不对：需要“导出场景”生成的元素沙盒快照 JSON');
    return;
  }
  currentScene = obj;
  document.title = `元素沙盒 · 3D 查看器（${obj.width}×${obj.height}）`;
  buildInstances(obj, Number(thicknessInput.value), downsampleInput.checked);
  // 相机对准新场景
  camera.position.set(0, -40, Math.max(300, obj.width * 1.4));
  controls.target.set(0, 0, 0);
  controls.update();
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadSceneObj(JSON.parse(reader.result));
    } catch (e) {
      alert('JSON 解析失败：' + e.message);
    }
  };
  reader.readAsText(f, 'utf-8');
});

btnSample.addEventListener('click', () => {
  if (typeof SAMPLE_VOLCANO === 'undefined') {
    alert('示例文件 samples/volcano.js 缺失');
    return;
  }
  loadSceneObj(SAMPLE_VOLCANO);
});

thicknessInput.addEventListener('input', () => {
  thickVal.textContent = thicknessInput.value;
  if (currentScene) buildInstances(currentScene, Number(thicknessInput.value), downsampleInput.checked);
});

downsampleInput.addEventListener('change', () => {
  if (currentScene) buildInstances(currentScene, Number(thicknessInput.value), downsampleInput.checked);
});

// ===== FPS 统计 =====
let frames = 0;
let fpsClock = performance.now();
(function fpsLoop() {
  requestAnimationFrame(fpsLoop);
  frames++;
  const now = performance.now();
  if (now - fpsClock >= 500) {
    fpsEl.textContent = Math.round((frames * 1000) / (now - fpsClock));
    frames = 0;
    fpsClock = now;
  }
})();

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

// 自动化验证钩子
window.__viewer = {
  camera,
  controls,
  setCam(x, y, z) {
    camera.position.set(x, y, z);
    controls.update();
  },
  loadSceneObj,
};

// 已内置示例则自动加载
if (typeof SAMPLE_VOLCANO !== 'undefined') {
  loadSceneObj(SAMPLE_VOLCANO);
}
