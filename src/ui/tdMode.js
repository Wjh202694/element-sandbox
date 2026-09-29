import { state } from './store.js';
import { showToast } from './toast.js';
import { stat3D } from '../sim/stats.js';
import { systemIcon } from '../icons/index.js';

// three 体量很大，动态加载：点开 3D 才拉取，首屏不背这个包
let scene3dModule = null;
function loadScene3D() {
  if (!scene3dModule) scene3dModule = import('./scene3d.js');
  return scene3dModule;
}

// 3D 立体观赏模式（测试版）：世界截面变成可拖拽旋转的立体模型，模拟照常运行；该模式暂停作画
export function init3DMode() {
  const btn = document.getElementById('btn-3d');
  const wrap = document.getElementById('game-wrap');
  const getWorld = () => window.__sb?.world;
  let dispose = null;
  let hinted = false;
  let busy = false; // 动态加载期间防双击双开

  btn.onclick = async () => {
    if (busy) return;
    if (!state.tdMode) {
      const world = getWorld();
      if (!world) {
        showToast('场景尚未就绪，稍后再试', systemIcon('alert', 'toast-ico'));
        return;
      }
      busy = true;
      try {
        const { create3DScene } = await loadScene3D();
        dispose = create3DScene(world, wrap, window.__sb.renderer);
      } catch (e) {
        showToast('3D 初始化失败（测试版）：' + e.message, systemIcon('alert', 'toast-ico'))
        busy = false;
        return;
      }
      busy = false;
      state.tdMode = true;
      wrap.classList.add('mode-3d');
      btn.classList.add('sel');
      stat3D();
      if (!hinted) {
        showToast('3D 立体模式（测试版）：拖拽旋转 · 滚轮缩放 · 暂停作画', systemIcon('cube', 'toast-ico'));
        hinted = true;
      }
    } else {
      state.tdMode = false;
      wrap.classList.remove('mode-3d');
      btn.classList.remove('sel');
      if (dispose) {
        dispose();
        dispose = null;
      }
    }
  };
}
