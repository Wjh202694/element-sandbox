// ===== 网格尺寸（画布逻辑分辨率，放大绘制保持像素感）=====
// 启动时按可用区域长宽比重算（initGrid），恒定约 3 万格，画布铺满游戏区
export const GRID = { w: 150, h: 200 };

export function initGrid(availW, availH) {
  if (availW < 50 || availH < 50) return;
  const aspect = availW / availH;
  const h = Math.round(Math.sqrt(30000 / aspect));
  GRID.h = Math.max(80, Math.min(320, h));
  GRID.w = Math.max(80, Math.min(320, Math.round(GRID.h * aspect)));
}

// ===== 元素 ID =====
export const E = {
  EMPTY: 0,
  SAND: 1,
  WATER: 2,
  STONE: 3,
  FIRE: 4,
  WOOD: 5,
  PLANT: 6,
  OIL: 7,
  STEAM: 8,
  SMOKE: 9,
  GLASS: 10,
  LAVA: 11,
  GUNPOWDER: 12,
  SALT: 13,
  ACID: 14,
  SOIL: 15,
  SNOW: 16,
};

// 密度：数值大者穿过数值小者下沉（液体/粉末/气体适用）
export const DENSITY = {
  [E.STEAM]: 1,
  [E.SMOKE]: 1,
  [E.OIL]: 2,
  [E.WATER]: 3,
  [E.ACID]: 3,
  [E.LAVA]: 6,
  [E.SAND]: 5,
  [E.GUNPOWDER]: 5,
  [E.SALT]: 5,
  [E.SOIL]: 5,
  [E.SNOW]: 3,
};

export const isFluid = (id) => id === E.WATER || id === E.OIL || id === E.LAVA;
export const isGas = (id) => id === E.STEAM || id === E.SMOKE;

// 可燃物 → 点燃概率（每帧）/ 燃烧寿命（帧）；火药近火即爆
export const FLAMMABLE = {
  [E.OIL]: { chance: 0.5, burn: 45 },
  [E.PLANT]: { chance: 0.1, burn: 70 },
  [E.WOOD]: { chance: 0.03, burn: 190 },
  [E.GUNPOWDER]: { chance: 0.9, burn: 25 },
};

// 酸可腐蚀的物质（玻璃抗酸）
export const SOLUBLE = new Set([
  E.STONE,
  E.SAND,
  E.WOOD,
  E.PLANT,
  E.SALT,
  E.GUNPOWDER,
  E.OIL,
  E.SOIL,
]);

// 画笔面板顺序（橡皮擦单独追加）
export const PALETTE = [
  E.SAND,
  E.SOIL,
  E.WATER,
  E.SNOW,
  E.OIL,
  E.FIRE,
  E.PLANT,
  E.WOOD,
  E.STONE,
  E.STEAM,
  E.LAVA,
  E.GUNPOWDER,
  E.SALT,
  E.ACID,
];

export const EL = {
  [E.SAND]: { name: '沙', swatch: '#d9b166' },
  [E.WATER]: { name: '水', swatch: '#3f7fd9' },
  [E.OIL]: { name: '油', swatch: '#58492e' },
  [E.FIRE]: { name: '火', swatch: '#f2542d' },
  [E.PLANT]: { name: '植', swatch: '#3fae4a' },
  [E.WOOD]: { name: '木', swatch: '#7a5230' },
  [E.STONE]: { name: '石', swatch: '#8a8f98' },
  [E.STEAM]: { name: '汽', swatch: '#c9d4e2' },
  [E.SMOKE]: { name: '烟', swatch: '#69707c' },
  [E.GLASS]: { name: '玻璃', swatch: '#b4d2dc' },
  [E.LAVA]: { name: '熔岩', swatch: '#e85a20' },
  [E.GUNPOWDER]: { name: '火药', swatch: '#4a4a4e' },
  [E.SALT]: { name: '盐', swatch: '#e7ebee' },
  [E.ACID]: { name: '酸', swatch: '#6edc3c' },
  [E.SOIL]: { name: '土', swatch: '#8b5e3c' },
  [E.SNOW]: { name: '雪', swatch: '#eef4fb' },
  [E.EMPTY]: { name: '擦', swatch: '' },
};
