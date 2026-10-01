import { loadDiscovered, saveDiscovered } from '../utils/storage.js';
import { reactionIcon } from '../icons/index.js';
import { showToast } from './toast.js';
import { blip } from './sound.js';
// icon 为制图平涂结果态 key，取值见 src/icons/index.js 的 reactionIcon()
// 未解锁时也用同一个图标（配合灰度/暗化样式），保证列表高度不跳。
export const DISCOVERIES = [
  { key: 'steam', icon: 'steam', name: '水蒸气', formula: '火 × 水', desc: '高温相遇，升腾为汽' },
  { key: 'growth', icon: 'spread', name: '蔓延', formula: '水 × 植物', desc: '得水的植物开始生长' },
  { key: 'sink', icon: 'settle', name: '沉降', formula: '沙 × 水', desc: '泥沙穿过水体沉入水底' },
  { key: 'float', icon: 'oil-film', name: '浮油', formula: '油 × 水', desc: '油比水轻，浮于水面' },
  { key: 'wood_burn', icon: 'charcoal', name: '炭火', formula: '火 × 木', desc: '木头被点燃，火势绵长' },
  { key: 'oil_burn', icon: 'blaze', name: '烈焰', formula: '火 × 油', desc: '油遇明火，轰然燃烧' },
  { key: 'rain', icon: 'rain', name: '凝结成雨', formula: '蒸汽 × 时间', desc: '蒸汽冷却，凝回水滴' },
  { key: 'smoke', icon: 'blue-smoke', name: '青烟', formula: '火 × 燃尽', desc: '火焰熄灭，化作青烟' },
  { key: 'lava_stone', icon: 'petrify', name: '岩化', formula: '熔岩 × 水', desc: '冷淬成石，水汽升腾' },
  { key: 'glass', icon: 'glass', name: '玻璃', formula: '沙 × 熔岩', desc: '高温烧灼，沙化琉璃' },
  { key: 'lava_fire', icon: 'ignite', name: '引燃', formula: '熔岩 × 可燃物', desc: '大地之火，万物自燃' },
  { key: 'boom', icon: 'explosion', name: '爆炸', formula: '火 × 火药', desc: '轰然殉爆，火光冲天' },
  { key: 'dissolve', icon: 'dissolve', name: '溶解', formula: '盐 × 水', desc: '白盐入水，悄然消散' },
  { key: 'corrode', icon: 'corrode', name: '腐蚀', formula: '酸 × 石', desc: '坚石逢酸，寸寸消融' },
  { key: 'damp', icon: 'dampened', name: '受潮', formula: '火药 × 水', desc: '火药遇水成哑火' },
  { key: 'acid_oil', icon: 'acid_oil', name: '皂化', formula: '酸 × 油', desc: '酸液分解油脂' },
  { key: 'acid_salt', icon: 'acid_salt', name: '盐卤', formula: '酸 × 盐', desc: '酸蚀盐粒化卤水' },
  { key: 'glass_melt', icon: 'remelt', name: '重熔', formula: '熔岩 × 玻璃', desc: '玻璃复熔成岩浆' },
  { key: 'acid_boil', icon: 'acid_boil', name: '毒雾', formula: '酸 × 熔岩', desc: '酸遇熔岩沸腾成毒烟' },
  { key: 'wither', icon: 'wither', name: '枯萎', formula: '盐 × 植物', desc: '盐分让植物枯死' },
  { key: 'soil_grow', icon: 'soil_grow', name: '栽培', formula: '土 × 植物', desc: '沃土让植物扎根蔓延' },
  { key: 'soil_brick', icon: 'soil_brick', name: '土陶', formula: '熔岩 × 土', desc: '烈火烧土成陶' },
  { key: 'snow_melt', icon: 'snow_melt', name: '融雪', formula: '雪 × 高温/盐', desc: '雪遇热与盐化作春水' },
  { key: 'conduct', icon: 'conduct', name: '导电', formula: '电 × 水', desc: '电弧沿水面炸裂传播' },
  { key: 'fulgurite', icon: 'fulgurite', name: '闪玻璃', formula: '电 × 沙', desc: '雷霆熔沙，瞬时成琉璃' },
  { key: 'scorch', icon: 'scorch', name: '焦枯', formula: '电 × 植物', desc: '草木经电，焦烟四起' },
  { key: 'electrolysis', icon: 'conduct', name: '电解', formula: '通电水 × 时间', desc: '水体噼啪作响，汽泡升腾' },
  { key: 'wire', icon: 'conduct', name: '金属导体', formula: '电 × 金属', desc: '电弧沿金属奔流不息' },
  { key: 'etch', icon: 'corrode', name: '蚀刻', formula: '酸 × 金属', desc: '强酸蚀金，气泡翻涌' },
  { key: 'melt_metal', icon: 'remelt', name: '金属熔化', formula: '熔岩 × 金属', desc: '烈焰熔金，化作岩浆' },
  { key: 'hydrogen', icon: 'steam', name: '电解得氢', formula: '通电水 × 时间', desc: '水中冒出轻灵的氢气泡' },
  { key: 'detonate', icon: 'explosion', name: '氢爆', formula: '火 × 氢', desc: '氢氧相激，轰然成水' },
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
  showToast(`新发现：${d.formula} → ${d.name}`, reactionIcon(d.icon, 'toast-ico'));
  updateBadge();
}

export function isKnown(key) {
  return known.has(key);
}

export function updateBadge() {
  const el = document.getElementById('disc-badge');
  if (el) el.textContent = `${known.size}/${DISCOVERIES.length}`;
}
