import { E } from '../sim/elements.js';
import stats, { loadStats, saveStats } from '../sim/stats.js';
import { DISCOVERIES, isKnown } from './discoveries.js';
import { chime } from './sound.js';
import { achievementIcon, LOCK_SVG } from '../icons/index.js';

// 我的世界同款三档分级
export const TIERS = [
  { id: 0, name: '常规', color: '#ffd66e' },
  { id: 1, name: '目标', color: '#7ee8a2' },
  { id: 2, name: '挑战', color: '#c792ea' },
];

// icon 为制图平涂成就 key，取值见 src/icons/index.js 的 achievementIcon()
export const ACHIEVEMENTS = [
  // ===== 常规 =====
  { id: 'first_sand', icon: 'world-of-sand', tier: 0, name: '一沙一世界', desc: '涂下第一把沙', cond: (s) => (s.paintById[E.SAND] || 0) >= 1 },
  { id: 'first_water', icon: 'first_water', tier: 0, name: '挖渠引水', desc: '涂下第一滴水', cond: (s) => (s.paintById[E.WATER] || 0) >= 1 },
  { id: 'first_fire', icon: 'spark-wildfire', tier: 0, name: '星火燎原', desc: '点起第一把火', cond: (s) => (s.paintById[E.FIRE] || 0) >= 1 },
  { id: 'beach', icon: 'sand-tower', tier: 0, name: '聚沙成塔', desc: '累计涂抹 300 格沙', cond: (s) => (s.paintById[E.SAND] || 0) >= 300 },
  { id: 'gardener', icon: 'afforest', tier: 0, name: '植树造林', desc: '累计涂抹 200 格植物', cond: (s) => (s.paintById[E.PLANT] || 0) >= 200 },
  { id: 'rainy', icon: 'artificial-rain', tier: 0, name: '人造雨', desc: '蒸汽凝雨 10 次', cond: (s) => (s.rx.rain || 0) >= 10 },
  { id: 'shower', icon: 'misty-rain', tier: 0, name: '烟雨朦胧', desc: '同时存在 200 格烟与蒸汽', cond: (s) => s.maxGas >= 200 },
  { id: 'painter', icon: 'big-stroke', tier: 0, name: '大笔一挥', desc: '累计涂抹 1000 格', cond: (s) => s.paintTotal >= 1000 },
  { id: 'scavenger', icon: 'cleaner', tier: 0, name: '清道夫', desc: '累计擦除 800 格', cond: (s) => (s.paintById[E.EMPTY] || 0) >= 800 },
  { id: 'archaeologist', icon: 'wanderer', tier: 0, name: '游历四方', desc: '尝试 4 种背景主题', cond: (s) => s.themes.length >= 4 },
  { id: 'geologist', icon: 'geologist', tier: 0, name: '地质学家', desc: '生成或恢复 3 次地图', cond: (s) => s.newWorlds >= 3 },
  { id: 'steampunk', icon: 'steam-age', tier: 0, name: '蒸汽时代', desc: '产生蒸汽 30 次', cond: (s) => (s.rx.steam || 0) >= 30 },
  { id: 'plumber', icon: 'plumber', tier: 0, name: '水管工', desc: '累计涂抹 1000 格水', cond: (s) => (s.paintById[E.WATER] || 0) >= 1000 },
  { id: 'excavator', icon: 'excavator', tier: 0, name: '挖掘机', desc: '累计擦除 3000 格', cond: (s) => (s.paintById[E.EMPTY] || 0) >= 3000 },
  // ===== 目标 =====
  { id: 'alchemist', icon: 'alchemist', tier: 1, name: '炼金术士', desc: '解锁 7 条发现', cond: () => DISCOVERIES.filter((d) => isKnown(d.key)).length >= 7 },
  { id: 'glassmaker', icon: 'glass-factory', tier: 1, name: '玻璃工厂', desc: '熔岩烧出 50 格玻璃', cond: (s) => (s.rx.glass || 0) >= 50 },
  { id: 'demoman', icon: 'demolition-expert', tier: 1, name: '爆破专家', desc: '火药殉爆 100 次', cond: (s) => (s.rx.boom || 0) >= 100 },
  { id: 'lava_pool', icon: 'lava_pool', tier: 1, name: '熔岩之湖', desc: '同时存在 300 格熔岩', cond: (s) => s.maxLava >= 300 },
  { id: 'flood', icon: 'great-flood', tier: 1, name: '大洪水', desc: '同时存在 1200 格水', cond: (s) => s.maxWater >= 1200 },
  { id: 'pyromaniac', icon: 'arsonist', tier: 1, name: '放火大师', desc: '累计点燃 300 格燃料', cond: (s) => (s.rx.wood_burn || 0) + (s.rx.oil_burn || 0) + (s.rx.boom || 0) + (s.rx.lava_fire || 0) >= 300 },
  { id: 'chemist', icon: 'corrosion', tier: 1, name: '腐蚀之力', desc: '熔掉 50 格石头', cond: (s) => (s.rx.corrode || 0) >= 50 },
  { id: 'decorator', icon: 'scene-swapper', tier: 1, name: '换景师', desc: '尝试 3 种背景主题', cond: (s) => s.themes.length >= 3 },
  { id: 'architect', icon: 'architect', tier: 1, name: '建筑师', desc: '累计涂抹 300 格木头', cond: (s) => (s.paintById[E.WOOD] || 0) >= 300 },
  { id: 'refiner', icon: 'oil-baron', tier: 1, name: '炼油厂长', desc: '累计涂抹 200 格油', cond: (s) => (s.paintById[E.OIL] || 0) >= 200 },
  { id: 'opposites', icon: 'water-and-fire', tier: 1, name: '水火同源', desc: '同屏 800 格水与 80 格火', cond: (s) => s.maxWater >= 800 && s.maxFire >= 80 },
  { id: 'cubist', icon: 'cubist', tier: 1, name: '立体派', desc: '开启一次 3D 立体模式', cond: (s) => s.td3d >= 1 },
  { id: 'oceanmaker', icon: 'sea-maker', tier: 1, name: '造海者', desc: '同时存在 2500 格水', cond: (s) => s.maxWater >= 2500 },
  { id: 'volcanologist', icon: 'volcanologist', tier: 1, name: '火山学家', desc: '熔岩冷淬 20 次', cond: (s) => (s.rx.lava_stone || 0) >= 20 },
  { id: 'smogmaster', icon: 'smoke-master', tier: 1, name: '烟雾大师', desc: '同时存在 600 格烟与蒸汽', cond: (s) => s.maxGas >= 600 },
  { id: 'gardener_bad', icon: 'gardener-nightmare', tier: 1, name: '园丁噩梦', desc: '枯萎 20 株植物', cond: (s) => (s.rx.wither || 0) >= 20 },
  // ===== 挑战 =====
  { id: 'naturalist', icon: 'naturalist', tier: 2, name: '博物学家', desc: '集齐全部发现', cond: () => DISCOVERIES.every((d) => isKnown(d.key)) },
  { id: 'creator', icon: 'creator-god', tier: 2, name: '创世神', desc: '同时存在 3000 格世界', cond: (s) => s.maxCells >= 3000 },
  { id: 'inferno', icon: 'prairie-fire', tier: 2, name: '燎原之火', desc: '同时存在 150 格火焰', cond: (s) => s.maxFire >= 150 },
  { id: 'smog', icon: 'smoke-eclipse', tier: 2, name: '浓烟蔽日', desc: '同时存在 400 格烟与蒸汽', cond: (s) => s.maxGas >= 400 },
  { id: 'eternal', icon: 'persistent', tier: 2, name: '恒心者', desc: '累计游玩 10 分钟', cond: (s) => s.playFrames >= 36000 },
  { id: 'photographer', icon: 'art-collector', tier: 2, name: '作品收藏家', desc: '导出 3 张快照', cond: (s) => s.exports >= 3 },
  { id: 'demolitionist', icon: 'doomsday', tier: 2, name: '末日爆破', desc: '火药殉爆 300 次', cond: (s) => (s.rx.boom || 0) >= 300 },
  { id: 'demolition_pro', icon: 'volatile', tier: 2, name: '烈性炸药', desc: '火药殉爆 500 次', cond: (s) => (s.rx.boom || 0) >= 500 },
  { id: 'master_painter', icon: 'thousand-strokes', tier: 2, name: '千笔大师', desc: '累计涂抹 10000 格', cond: (s) => s.paintTotal >= 10000 },
  { id: 'survivor', icon: 'storm-rider', tier: 2, name: '惊涛骇浪', desc: '经历 5 次海啸', cond: (s) => s.mapEvents >= 5 },
];

const KEY = 'sandbox.ach.v1';
let unlocked = new Set();

export function initAchievements() {
  try {
    unlocked = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
  } catch {
    unlocked = new Set();
  }
  loadStats();
  updateBadge();
}

export function isUnlocked(id) {
  return unlocked.has(id);
}

export function unlockedCount() {
  return unlocked.size;
}

// 周期调用（约 2 秒一次）：评估条件、弹 MC 式 toast
export function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id)) continue;
    let ok = false;
    try {
      ok = a.cond(stats);
    } catch {
      ok = false;
    }
    if (ok) {
      unlocked.add(a.id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...unlocked]));
      } catch {
        /* 忽略 */
      }
      showAchToast(a);
    }
  }
  updateBadge();
  saveStats();
}

function showAchToast(a) {
  chime();
  const box = document.createElement('div');
  box.className = `ach-toast t${a.tier}`;
  box.innerHTML = `<span class="ach-icon">${achievementIcon(a.icon, 'ach-ico')}</span><div class="ach-lines"><div class="ach-t1">成就已达成！</div><div class="ach-t2">${a.name}</div></div>`;
  const remove = () => box.remove();
  box.addEventListener('animationend', remove);
  setTimeout(remove, 4300); // 兜底：动画事件可能因标签页后台被吞
  const container = document.getElementById('ach-toasts');
  container.appendChild(box);
  // 批量解锁时只保留最新 3 条，防溢出屏幕
  while (container.children.length > 3) container.firstChild.remove();
}

function updateBadge() {
  const el = document.getElementById('ach-badge');
  if (el) el.textContent = `${unlocked.size}/${ACHIEVEMENTS.length}`;
}

// ===== 成就图鉴 =====
export function initAchModal() {
  const modal = document.getElementById('ach-modal');
  const btn = document.getElementById('btn-ach');
  btn.onclick = () => {
    renderAchList();
    modal.hidden = false;
  };
  document.getElementById('ach-close').onclick = () => {
    modal.hidden = true;
  };
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
}

function renderAchList() {
  const list = document.getElementById('ach-list');
  list.innerHTML = TIERS.map((t) => {
    const group = ACHIEVEMENTS.filter((a) => a.tier === t.id);
    const got = group.filter((a) => isUnlocked(a.id)).length;
    const items = group
      .map(
        (a) => `<div class="ach-item ${isUnlocked(a.id) ? 'got' : ''}">
          <div class="ach-item-icon">${isUnlocked(a.id) ? achievementIcon(a.icon, 'ach-item-ico') : LOCK_SVG('ach-item-ico')}</div>
          <div class="ach-item-text">
            <div class="ach-item-name">${a.name}</div>
            <div class="ach-item-desc">${a.desc}</div>
          </div>
        </div>`
      )
      .join('');
    return `<div class="ach-tier" style="--tier-color:${t.color}">
      <div class="ach-tier-head"><b style="color:${t.color}">${t.name}</b><span>${got}/${group.length}</span></div>
      <div class="ach-tier-grid">${items}</div>
    </div>`;
  }).join('');
}
