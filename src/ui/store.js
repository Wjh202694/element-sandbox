import { E } from '../sim/elements.js';

// 场景与 DOM UI 共享的全局状态
export const state = {
  elem: E.SAND,
  brush: 3,
  paused: false,
  theme: 'classic',
  tdMode: false,
};
