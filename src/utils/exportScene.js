import pkg from '../../package.json';

// 场景快照导出：把当前世界转成自包含 JSON（含调色板与发光标记）
// 只读操作，不影响玩法与存档

const PALETTE_SOURCE = [
  { id: 0, name: '空', color: null, emissive: false },
  { id: 1, name: '沙', color: '#d9b166', emissive: false },
  { id: 2, name: '水', color: '#3f7fd9', emissive: false },
  { id: 3, name: '石', color: '#8a8f98', emissive: false },
  { id: 4, name: '火', color: '#ff9d3c', emissive: true },
  { id: 5, name: '木', color: '#7a5230', emissive: false },
  { id: 6, name: '植', color: '#3fae4a', emissive: false },
  { id: 7, name: '油', color: '#58492e', emissive: false },
  { id: 8, name: '蒸汽', color: '#c9d4e2', emissive: false },
  { id: 9, name: '烟', color: '#69707c', emissive: false },
  { id: 10, name: '玻璃', color: '#b4d2dc', emissive: false },
  { id: 11, name: '熔岩', color: '#e85a20', emissive: true },
  { id: 12, name: '火药', color: '#4a4a4e', emissive: false },
  { id: 13, name: '盐', color: '#e7ebee', emissive: false },
  { id: 14, name: '酸', color: '#6edc3c', emissive: false },
  { id: 15, name: '土', color: '#8b5e3c', emissive: false },
  { id: 16, name: '雪', color: '#eef4fb', emissive: false },
  { id: 17, name: '电', color: '#ffe95e', emissive: true },
  { id: 18, name: '金属', color: '#a8b6c8', emissive: false },
  { id: 19, name: '氢', color: '#cfe8f8', emissive: false },
  { id: 20, name: '冰', color: '#cfe4f4', emissive: false },
];

export function buildSnapshot(world) {
  return {
    format: 'element-sandbox-scene',
    version: pkg.version,
    exportedAt: new Date().toISOString(),
    width: world.w,
    height: world.h,
    cells: Array.from(world.cells),
    palette: PALETTE_SOURCE,
  };
}

export function downloadScene(world) {
  const json = JSON.stringify(buildSnapshot(world));
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `元素沙盒-场景-${ts}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
