import { THEMES } from '../sim/backgrounds.js';
import { state } from './store.js';
import { statTheme } from '../sim/stats.js';
import { loadTheme, saveTheme } from '../utils/storage.js';

export function initBgMenu() {
  const btn = document.getElementById('btn-bg');
  const menu = document.getElementById('bg-menu');

  const saved = loadTheme();
  if (THEMES.some((t) => t.id === saved)) state.theme = saved;

  for (const t of THEMES) {
    const item = document.createElement('button');
    item.className = 'bg-item';
    item.dataset.id = t.id;
    item.innerHTML = `<span class="bg-icon">${t.icon}</span><span>${t.name}</span><i class="bg-check"></i>`;
    item.onclick = () => {
      state.theme = t.id;
      saveTheme(t.id);
      statTheme(t.id);
      sync();
      menu.hidden = true;
    };
    menu.appendChild(item);
  }

  function sync() {
    menu.querySelectorAll('.bg-item').forEach((el) => {
      el.classList.toggle('sel', el.dataset.id === state.theme);
    });
  }
  sync();

  btn.onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  };
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
  });
}
