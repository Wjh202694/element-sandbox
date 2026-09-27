import Phaser from 'phaser';
import './style.css';
import SimScene from './scenes/SimScene.js';
import { GRID, initGrid } from './sim/elements.js';
import { initToolbar } from './ui/toolbar.js';
import { initModal } from './ui/modal.js';
import { initBgMenu } from './ui/bgMenu.js';
import { initMapPicker } from './ui/mapPicker.js';
import { init3DMode } from './ui/tdMode.js';
import { initToast } from './ui/toast.js';
import { initSound } from './ui/sound.js';
import { initShare } from './ui/share.js';
import { updateBadge } from './ui/discoveries.js';
import { initAchievements, initAchModal } from './ui/achievements.js';

function boot() {
  initToast();
  initToolbar();
  initModal();
  initBgMenu();
  initMapPicker();
  init3DMode();
  initSound();
  initShare();
  initAchievements();
  initAchModal();
  updateBadge();

  // 网格长宽比贴合游戏区，画布无黑边铺满
  const wrap = document.getElementById('game-wrap');
  initGrid(wrap.clientWidth, wrap.clientHeight);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-wrap',
    width: GRID.w,
    height: GRID.h,
    backgroundColor: '#0d1017',
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [SimScene],
  });

  window.addEventListener('resize', () => game.scale.refresh());
  window.__sbBooted?.(); // 告诉 index.html 的看门狗：启动成功
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
