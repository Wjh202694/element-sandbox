import { statExport } from '../sim/stats.js';

export function exportPNG() {
  const src = document.querySelector('#game-wrap canvas');
  if (!src) return;
  statExport();
  const scale = 4;
  const c = document.createElement('canvas');
  c.width = src.width * scale;
  c.height = src.height * scale;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '元素沙盒.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  });
}
