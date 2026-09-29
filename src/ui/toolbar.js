import { E, PALETTE, EL } from '../sim/elements.js';
import { state } from './store.js';
import { setPausedChip } from './overlay.js';
import { getMapId } from '../utils/storage.js';
import { exportPNG } from '../utils/export.js';
import { elementIcon, systemIcon } from '../icons/index.js';

export function initToolbar() {
  const row = document.getElementById('elem-row');

  const mk = (id, label, ico) => {
    const b = document.createElement('button');
    b.className = 'elem';
    b.title = label;
    b.innerHTML = `${elementIcon(ico, 'elem-ico')}<span>${label}</span>`;
    b.onclick = () => {
      state.elem = id;
      row.querySelectorAll('.elem').forEach((x) => x.classList.toggle('sel', x === b));
    };
    row.appendChild(b);
  };

  for (const id of PALETTE) mk(id, EL[id].name, EL[id].ico);
  mk(E.EMPTY, '擦', EL[E.EMPTY].ico);
  row.firstChild.classList.add('sel');

  // 笔刷大小
  const dot = document.getElementById('brush-dot');
  const syncDot = () => {
    const s = state.brush * 2 + 4;
    dot.style.width = `${s}px`;
    dot.style.height = `${s}px`;
  };
  document.getElementById('brush-minus').onclick = () => {
    state.brush = Math.max(1, state.brush - 1);
    syncDot();
  };
  document.getElementById('brush-plus').onclick = () => {
    state.brush = Math.min(8, state.brush + 1);
    syncDot();
  };
  syncDot();

  // 暂停
  const pauseBtn = document.getElementById('btn-pause');
  pauseBtn.onclick = () => {
    state.paused = !state.paused;
    pauseBtn.innerHTML = systemIcon(state.paused ? 'play' : 'pause', 'tool-ico');
    setPausedChip(state.paused);
  };

  // 清空（两步确认，防误触）
  const clearBtn = document.getElementById('btn-clear');
  let armTimer = null;
  const clearIdle = () => { clearBtn.innerHTML = systemIcon('cleaner', 'tool-ico'); };
  clearBtn.onclick = () => {
    if (clearBtn.dataset.arm) {
      clearTimeout(armTimer);
      delete clearBtn.dataset.arm;
      clearIdle();
      document.dispatchEvent(new CustomEvent('sb-clear'));
    } else {
      clearBtn.dataset.arm = '1';
      clearBtn.textContent = '确认？';
      armTimer = setTimeout(() => {
        delete clearBtn.dataset.arm;
        clearIdle();
      }, 2000);
    }
  };

  // 导出
  document.getElementById('btn-export').onclick = () => exportPNG();

  // 一键恢复当前地图初始地形
  document.getElementById('btn-restore').onclick = () => {
    document.dispatchEvent(new CustomEvent('sb-newworld', { detail: getMapId() }));
  };

  // 导出当前场景快照 JSON
  document.getElementById('btn-snapshot').onclick = () => {
    document.dispatchEvent(new CustomEvent('sb-export-scene'));
  };
}
