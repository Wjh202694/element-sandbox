import { wasHinted, markHinted } from '../utils/storage.js';

export function syncHint(hasSave) {
  const h = document.getElementById('hint');
  h.style.display = !hasSave && !wasHinted() ? '' : 'none';
}

export function hideHint() {
  document.getElementById('hint').style.display = 'none';
  markHinted();
}

export function setPausedChip(on) {
  document.getElementById('paused-chip').hidden = !on;
}
