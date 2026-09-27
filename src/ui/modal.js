import { DISCOVERIES, isKnown } from './discoveries.js';

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
    return `<div class="disc ${got ? 'got' : ''}">
      <div class="disc-icon">${got ? d.icon : '❔'}</div>
      <div class="disc-name">${got ? d.name : '？？？'}</div>
      <div class="disc-formula">${got ? d.formula : '尚未发现'}</div>
      <div class="disc-desc">${got ? d.desc : '在沙盒中探索触发'}</div>
    </div>`;
  }).join('');
}
