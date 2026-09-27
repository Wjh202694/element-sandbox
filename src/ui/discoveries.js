import { loadDiscovered, saveDiscovered } from '../utils/storage.js';
import { showToast } from './toast.js';
import { blip } from './sound.js';

export const DISCOVERIES = [
  { key: 'steam', icon: '💧', name: '水蒸气', formula: '火 × 水', desc: '高温相遇，升腾为汽' },
  { key: 'growth', icon: '🌿', name: '蔓延', formula: '水 × 植物', desc: '得水的植物开始生长' },
  { key: 'sink', icon: '🏖️', name: '沉降', formula: '沙 × 水', desc: '泥沙穿过水体沉入水底' },
  { key: 'float', icon: '🛢️', name: '浮油', formula: '油 × 水', desc: '油比水轻，浮于水面' },
  { key: 'wood_burn', icon: '🔥', name: '炭火', formula: '火 × 木', desc: '木头被点燃，火势绵长' },
  { key: 'oil_burn', icon: '💥', name: '烈焰', formula: '火 × 油', desc: '油遇明火，轰然燃烧' },
  { key: 'rain', icon: '🌧️', name: '凝结成雨', formula: '蒸汽 × 时间', desc: '蒸汽冷却，凝回水滴' },
  { key: 'smoke', icon: '💨', name: '青烟', formula: '火 × 燃尽', desc: '火焰熄灭，化作青烟' },
  { key: 'lava_stone', icon: '🪨', name: '岩化', formula: '熔岩 × 水', desc: '冷淬成石，水汽升腾' },
  { key: 'glass', icon: '🪟', name: '玻璃', formula: '沙 × 熔岩', desc: '高温烧灼，沙化琉璃' },
  { key: 'lava_fire', icon: '🌋', name: '引燃', formula: '熔岩 × 可燃物', desc: '大地之火，万物自燃' },
  { key: 'boom', icon: '💥', name: '爆炸', formula: '火 × 火药', desc: '轰然殉爆，火光冲天' },
  { key: 'dissolve', icon: '🧂', name: '溶解', formula: '盐 × 水', desc: '白盐入水，悄然消散' },
  { key: 'corrode', icon: '🧪', name: '腐蚀', formula: '酸 × 石', desc: '坚石逢酸，寸寸消融' },
  { key: 'damp', icon: '🧯', name: '受潮', formula: '火药 × 水', desc: '火药遇水成哑火' },
  { key: 'acid_oil', icon: '🧴', name: '皂化', formula: '酸 × 油', desc: '酸液分解油脂' },
  { key: 'acid_salt', icon: '🧫', name: '盐卤', formula: '酸 × 盐', desc: '酸蚀盐粒化卤水' },
  { key: 'glass_melt', icon: '🔮', name: '重熔', formula: '熔岩 × 玻璃', desc: '玻璃复熔成岩浆' },
  { key: 'acid_boil', icon: '♨️', name: '毒雾', formula: '酸 × 熔岩', desc: '酸遇熔岩沸腾成毒烟' },
  { key: 'wither', icon: '🥀', name: '枯萎', formula: '盐 × 植物', desc: '盐分让植物枯死' },
  { key: 'soil_grow', icon: '🪴', name: '栽培', formula: '土 × 植物', desc: '沃土让植物扎根蔓延' },
  { key: 'soil_brick', icon: '🏺', name: '土陶', formula: '熔岩 × 土', desc: '烈火烧土成陶' },
  { key: 'snow_melt', icon: '🫠', name: '融雪', formula: '雪 × 高温/盐', desc: '雪遇热与盐化作春水' },
];

let known = loadDiscovered();

// 模拟层回调：去重后弹 toast + 记录
export function handleDiscover(key) {
  if (known.has(key)) return;
  const d = DISCOVERIES.find((x) => x.key === key);
  if (!d) return;
  known.add(key);
  saveDiscovered(known);
  blip();
  showToast(`🧪 新发现：${d.formula} → ${d.name} ${d.icon}`);
  updateBadge();
}

export function isKnown(key) {
  return known.has(key);
}

export function updateBadge() {
  const el = document.getElementById('disc-badge');
  if (el) el.textContent = `${known.size}/${DISCOVERIES.length}`;
}
