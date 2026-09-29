import Phaser from 'phaser';
import { World } from '../sim/world.js';
import { Renderer } from '../sim/render.js';
import { GRID } from '../sim/elements.js';
import { state } from '../ui/store.js';
import { handleDiscover } from '../ui/discoveries.js';
import { checkAchievements } from '../ui/achievements.js';
import { statPaint, statRx, statClear, statStep, statSample, statWorldGen, statMapEvent } from '../sim/stats.js';
import { showToast } from '../ui/toast.js';
import { requestMapPick } from '../ui/mapPicker.js';
import { MAPS, generateMap } from '../sim/maps.js';
import { syncHint, hideHint } from '../ui/overlay.js';
import { loadWorld, saveWorld, getMapId, saveMapId } from '../utils/storage.js';
import { buildSnapshot, downloadScene } from '../utils/exportScene.js';
import { pourBegin, pourEnd, boom } from '../ui/sound.js';
import { elementIcon, biomeIcon, systemIcon } from '../icons/index.js';

export default class SimScene extends Phaser.Scene {
  constructor() {
    super('sim');
  }

  create() {
    // 反应事件：进统计 + 走发现去重弹 toast
    this.world = new World(GRID.w, GRID.h, (k) => {
      statRx(k);
      handleDiscover(k);
    });
    const saved = loadWorld();
    if (saved) {
      this.world.load(saved);
    } else {
      generateMap(this.world, getMapId());
      this.world.dirty = true;
    }
    syncHint(!!saved);
    if (!saved) requestMapPick(); // 首次进入展示地图选择

    this.mapObj = MAPS.find((m) => m.id === getMapId());
    document.addEventListener('sb-map-event', (e) => {
      statMapEvent();
      showToast(e.detail.text, elementIcon(e.detail.icon, 'toast-ico'));
    });
    document.addEventListener('sb-newworld', (e) => {
      const map = MAPS.find((m) => m.id === e.detail);
      if (!map) return;
      statWorldGen();
      this.world.clear();
      map.gen(this.world);
      saveMapId(map.id);
      saveWorld(this.world);
      this.world.dirty = false;
      this.mapObj = map;
      showToast(`已生成：${map.name}`, biomeIcon(map.icon, 'toast-ico'));
    });

    const tex = this.textures.createCanvas('world', GRID.w, GRID.h);
    this.renderer = new Renderer(tex.getContext(), tex, GRID.w, GRID.h);
    this.add.image(0, 0, 'world').setOrigin(0, 0);

    this.painting = false;
    this.lastCell = null;
    this.saveTimer = 0;
    this.tickTimer = 0;
    this.lastShake = 0;
    this.lastFx = 0;

    // 爆破特效：闪光 + 冲击波 + 火花粒子（触发点见 world.blast 回调）
    this.world.onBlast = (x, y) => this.spawnBlastFx(x, y);
    const g = this.make.graphics({ add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(5, 5, 5);
    g.generateTexture('blast-flash', 10, 10);
    g.clear();
    g.lineStyle(2, 0xffffff, 1);
    g.strokeCircle(9, 9, 8);
    g.generateTexture('blast-ring', 18, 18);
    g.destroy();

    this.sparks = this.add.particles(0, 0, 'blast-flash', {
      speed: { min: 25, max: 95 },
      lifespan: { min: 400, max: 900 },
      gravityY: 90,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xffe28a, 0xff9d3c, 0xf2542d, 0xffffff],
      blendMode: 'ADD',
      emitting: false,
    });

    this.input.on('pointerdown', (p) => {
      this.painting = true;
      this.lastCell = null;
      this.paintAt(p);
      hideHint();
      pourBegin(state.elem); // 倒料声随元素换滤波
    });
    this.input.on('pointermove', (p) => {
      if (this.painting) this.paintAt(p);
    });
    this.input.on('pointerup', () => {
      this.painting = false;
      this.lastCell = null;
      pourEnd();
    });
    this.input.on('pointerupoutside', () => {
      this.painting = false;
      this.lastCell = null;
      pourEnd();
    });

    document.addEventListener('sb-clear', () => {
      this.world.clear();
      statClear();
    });
    document.addEventListener('sb-export-scene', () => downloadScene(this.world));
    // 导入世界分享码：cells 已按当前网格适配好，直接铺入并存档
    document.addEventListener('sb-import-world', (e) => {
      this.world.load(e.detail.cells);
      saveWorld(this.world);
      this.world.dirty = false;
      statWorldGen();
      hideHint();
      showToast(`世界已导入（${e.detail.fit}）`, systemIcon('import', 'toast-ico'));
    });
    // 调试钩子：控制台可经 window.__sb 访问场景（跳时间、检查世界）
    window.__sb = this;
    window.__sb.exportSceneJSON = () => JSON.stringify(buildSnapshot(this.world));
  }

  paintAt(p) {
    if (state.tdMode) return; // 3D 观赏模式下变换矩阵会干扰坐标映射，暂停作画
    const cx = Phaser.Math.Clamp(Math.floor(p.x), 0, GRID.w - 1);
    const cy = Phaser.Math.Clamp(Math.floor(p.y), 0, GRID.h - 1);
    const r = state.brush;
    let painted = 0;
    if (this.lastCell) {
      const [lx, ly] = this.lastCell;
      const steps = Math.max(Math.abs(cx - lx), Math.abs(cy - ly), 1);
      for (let s = 1; s <= steps; s++) {
        painted += this.world.paint(
          Math.round(lx + ((cx - lx) * s) / steps),
          Math.round(ly + ((cy - ly) * s) / steps),
          r,
          state.elem
        );
      }
    } else {
      painted = this.world.paint(cx, cy, r, state.elem);
    }
    statPaint(state.elem, painted);
    this.lastCell = [cx, cy];
  }

  update(_time, delta) {
    if (!state.paused) {
      // 网格分辨率按屏高比例折算每帧步数，保持原有运动速度感
      this.stepAcc = (this.stepAcc || 0) + GRID.h / 115;
      while (this.stepAcc >= 1) {
        this.stepAcc -= 1;
        this.world.step();
        statStep();
        // 地图周期行为（如火山喷发）
        this.mapObj?.tick?.(this.world, this.world.frame);
      }
    }
    this.renderer.draw(this.world, state.theme);

    this.tickTimer += delta;
    if (this.tickTimer > 500) {
      this.tickTimer = 0;
      this.sampleWorld();
      checkAchievements();
    }

    this.saveTimer += delta;
    if (this.saveTimer > 4000) {
      this.saveTimer = 0;
      if (this.world.dirty) {
        saveWorld(this.world);
        this.world.dirty = false;
      }
    }
  }

  // 爆破视觉反馈：闪光/冲击波/火花按节流播放，震屏单独限频
  spawnBlastFx(cx, cy) {
    const now = this.time.now;
    if (now - this.lastFx > 70) {
      this.lastFx = now;
      boom();
      const flash = this.add.image(cx, cy, 'blast-flash').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.95);
      this.tweens.add({
        targets: flash,
        scale: 9,
        alpha: 0,
        duration: 260,
        ease: 'Cubic.Out',
        onComplete: () => flash.destroy(),
      });
      const ring = this.add.image(cx, cy, 'blast-ring').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9);
      this.tweens.add({
        targets: ring,
        scale: 8,
        alpha: 0,
        duration: 430,
        ease: 'Cubic.Out',
        onComplete: () => ring.destroy(),
      });
      this.sparks.explode(20, cx, cy);
    } else {
      this.sparks.explode(5, cx, cy);
    }
    if (now - this.lastShake > 300) {
      this.lastShake = now;
      this.cameras.main.shake(200, 0.01);
    }
  }

  // 每 0.5 秒采样各类元素规模，供成就判定
  sampleWorld() {
    let water = 0;
    let lava = 0;
    let fire = 0;
    let gas = 0;
    let cells = 0;
    const c = this.world.cells;
    for (let i = 0; i < c.length; i++) {
      const id = c[i];
      if (id === 0) continue;
      cells++;
      if (id === 2) water++;
      else if (id === 11) lava++;
      else if (id === 4) fire++;
      else if (id === 8 || id === 9) gas++;
    }
    statSample(water, lava, fire, gas, cells);
  }
}
