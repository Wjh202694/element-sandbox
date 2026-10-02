// ===== 合成音效：WebAudio 现场合成，零素材 =====
// 倒料白噪（按元素家族换滤波）+ 爆炸闷响 + 成就/发现提示音。开关持久化。
import { systemIcon } from '../icons/index.js';

const KEY = 'sandbox.sound.v1';

let ctx = null;
let master = null;
let noiseBuf = null;
let enabled = true;
let pour = null; // { src, gain }
let pourId = -1; // 当前倒料的元素 id（换元素时重挂滤波）

try {
  enabled = localStorage.getItem(KEY) !== '0';
} catch {
  /* 忽略 */
}

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    // 2 秒白噪循环，倒料/爆炸共用
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

// 元素 → [滤波类型, 频率, 音量]：粉末是沙沙高噪，液体是低柔水声，固体是钝刮擦
function pourProfile(id) {
  if (id === 1 || id === 13 || id === 16) return ['bandpass', 3200, 0.1]; // 沙/盐/雪
  if (id === 15 || id === 12) return ['bandpass', 2100, 0.11]; // 土/火药
  if (id === 2 || id === 14) return ['lowpass', 900, 0.09]; // 水/酸
  if (id === 7 || id === 11) return ['lowpass', 520, 0.1]; // 油/熔岩
  if (id === 4) return ['bandpass', 1400, 0.07]; // 火
  if (id === 0) return ['bandpass', 5200, 0.06]; // 橡皮
  return ['lowpass', 340, 0.09]; // 木/石/植物：钝刮擦
}

export function pourBegin(elemId) {
  if (!enabled || !ensureCtx()) return;
  if (pour && pourId === elemId) return;
  pourEnd();
  pourId = elemId;
  const [type, freq, vol] = pourProfile(elemId);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = 0.9;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.08);
  src.connect(filter).connect(gain).connect(master);
  src.start();
  pour = { src, gain };
}

export function pourEnd() {
  if (!pour || !ctx) return;
  const { src, gain } = pour;
  pour = null;
  pourId = -1;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
  setTimeout(() => src.stop(), 180);
}

// 爆炸：低频正弦下坠 + 噪声冲击
export function boom() {
  if (!enabled || !ensureCtx()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.32);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.5, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  osc.connect(og).connect(master);
  osc.start(t);
  osc.stop(t + 0.42);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 750;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.32, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  src.connect(filter).connect(ng).connect(master);
  src.start(t);
  src.stop(t + 0.24);
}

// 新发现：短促上扬一声
export function blip() {
  if (!enabled || !ensureCtx()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(660, t);
  osc.frequency.exponentialRampToValueAtTime(990, t + 0.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.2);
}

// 成就：上行双音小和弦
export function chime() {
  if (!enabled || !ensureCtx()) return;
  const t = ctx.currentTime;
  [[880, 0], [1318, 0.09]].forEach(([freq, delay]) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.exponentialRampToValueAtTime(0.18, t + delay + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.34);
    osc.connect(g).connect(master);
    osc.start(t + delay);
    osc.stop(t + delay + 0.36);
  });
}

export function soundEnabled() {
  return enabled;
}

export function toggleSound() {
  enabled = !enabled;
  if (!enabled) {
    pourEnd();
    seaAmbientStop(); // 环境音一并停
  }
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {
    /* 忽略 */
  }
  return enabled;
}

// ===== 海岛环境音：低通白噪做涌浪，LFO 缓慢调制音量 =====
let ambient = null; // { src, lfo, gain }

export function seaAmbientStart() {
  if (!enabled || !ensureCtx() || ambient) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 480;
  const gain = ctx.createGain();
  gain.gain.value = 0.05;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.14;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.035;
  lfo.connect(lfoGain).connect(gain.gain);
  src.connect(filter).connect(gain).connect(master);
  src.start();
  lfo.start();
  ambient = { src, lfo, gain };
}

export function seaAmbientStop() {
  if (!ambient || !ctx) return;
  const { src, lfo, gain } = ambient;
  ambient = null;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
  setTimeout(() => {
    try {
      src.stop();
      lfo.stop();
    } catch {
      /* 已停止 */
    }
  }, 900);
}

// 雷声：低通噪声轰鸣，频段滚落 + 慢起快衰包络
export function thunder() {
  if (!enabled || !ensureCtx()) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(420, t);
  filter.frequency.exponentialRampToValueAtTime(90, t + 1.4);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.4, t + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
  src.stop(t + 1.7);
}

// 浪涛拍岸：带通噪声频段下扫，急起缓衰
export function waveCrash() {
  if (!enabled || !ensureCtx()) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(700, t);
  bp.frequency.exponentialRampToValueAtTime(240, t + 1.1);
  bp.Q.value = 0.7;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.42, t + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
  src.connect(bp).connect(gain).connect(master);
  src.start(t);
  src.stop(t + 1.4);
}

// ===== 火山低鸣：常驻低通噪声，音量由 3D 侧按喷发强度调制 =====
let rumble = null; // { src, gain }

export function volcanoRumble(level) {
  if (!enabled || level <= 0) {
    if (rumble && ctx) {
      const { src, gain } = rumble;
      rumble = null;
      gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
      setTimeout(() => {
        try {
          src.stop();
        } catch {
          /* 已停止 */
        }
      }, 1200);
    }
    return;
  }
  if (!ensureCtx()) return;
  if (!rumble) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 130;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(filter).connect(gain).connect(master);
    src.start();
    rumble = { src, gain };
  }
  rumble.gain.gain.setTargetAtTime(level * 0.28, ctx.currentTime, 0.4);
}

// ===== 间歇泉喷汽：带通噪声嘶鸣，音量由 3D 侧按喷发强度调制（与火山低鸣同款调制模式）=====
let hiss = null; // { src, gain }

export function geyserHiss(level) {
  if (!enabled || level <= 0) {
    if (hiss && ctx) {
      const { src, gain } = hiss;
      hiss = null;
      gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
      setTimeout(() => {
        try {
          src.stop();
        } catch {
          /* 已停止 */
        }
      }, 800);
    }
    return;
  }
  if (!ensureCtx()) return;
  if (!hiss) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(filter).connect(gain).connect(master);
    src.start();
    hiss = { src, gain };
  }
  hiss.gain.gain.setTargetAtTime(level * 0.2, ctx.currentTime, 0.25);
}

export function initSound() {
  const btn = document.getElementById('btn-sound');
  if (!btn) return;
  const sync = () => {
    btn.innerHTML =
      (enabled ? systemIcon('sound', 'hd-ico') : systemIcon('mute', 'hd-ico')) +
      '<span class="btn-label">音效</span>';
  };
  sync();
  btn.onclick = () => {
    const on = toggleSound();
    sync();
    if (on) blip(); // 开启即给一声反馈
  };
  // 调试钩子：无头验证用
  window.__sfx = {
    get on() {
      return enabled;
    },
    get ctxState() {
      return ctx ? ctx.state : 'none';
    },
  };
}
