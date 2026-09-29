import { MAPS } from '../sim/maps.js';
import { getMapId, saveMapId } from '../utils/storage.js';
import { biomeIcon } from '../icons/index.js';

export function initMapPicker() {
  const modal = document.getElementById('map-modal');
  const grid = document.getElementById('map-grid');

  document.getElementById('btn-map').onclick = () => {
    renderMaps(grid);
    modal.hidden = false;
  };
  document.getElementById('map-close').onclick = () => {
    modal.hidden = true;
  };
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
  // 首次进入（无存档）时由场景请求弹出
  document.addEventListener('sb-request-map', () => {
    renderMaps(grid);
    modal.hidden = false;
  });
}

function renderMaps(grid) {
  const cur = getMapId();
  grid.innerHTML = MAPS.map(
    (m) => `<button class="map-item ${m.id === cur ? 'cur' : ''}" data-id="${m.id}">
      <span class="map-icon">${biomeIcon(m.icon, 'map-ico')}</span>
      <span class="map-name">${m.name}</span>
      <span class="map-desc">${m.desc}</span>
    </button>`
  ).join('');
  grid.querySelectorAll('.map-item').forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.id;
      saveMapId(id);
      document.dispatchEvent(new CustomEvent('sb-newworld', { detail: id }));
      document.getElementById('map-modal').hidden = true;
    };
  });
}

export function requestMapPick() {
  document.dispatchEvent(new CustomEvent('sb-request-map'));
}
