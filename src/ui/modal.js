import { DISCOVERIES, isKnown } from './discoveries.js';
import { reactionIcon, LOCK_SVG } from '../icons/index.js';

export function initModal() {
  const modal = document.getElementById('modal');
  const grid = document.getElementById('modal-grid');

  document.getElementById('btn-book').onclick = () => {
    renderGrid(grid);
    modal.hidden = false;
  };
  document.getElementById('modal-close').onclick = () => {
    modal.hidden = true;
  };
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
}

function renderGrid(grid) {
  grid.innerHTML = DISCOVERIES.map((d) => {
    const got = isKnown(d.key);
    // 未解锁不画结果态（会剧透），换成线稿问号锁
    const ico = got ? reactionIcon(d.icon, 'disc-ico') : LOCK_SVG('disc-ico');
    return `<div class="disc ${got ? 'got' : ''}">
      <div class="disc-icon">${ico}</div>
      <div class="disc-name">${got ? d.name : '？？？'}</div>
      <div class="disc-formula">${got ? d.formula : '尚未发现'}</div>
      <div class="disc-desc">${got ? d.desc : '在沙盒中探索触发'}</div>
    </div>`;
  }).join('');
}
