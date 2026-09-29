// 背景主题注册表：渲染器按 id 绘制，UI 菜单读取名称
// icon 为制图平涂缩略图 key，取值见 src/icons/index.js 的 themeIcon()
export const THEMES = [
  { id: 'classic', name: '经典夜空', icon: 'night-classic' },
  { id: 'stars', name: '深夜星空', icon: 'starry-night' },
  { id: 'aurora', name: '极光之夜', icon: 'aurora' },
  { id: 'snowday', name: '白天雪山', icon: 'snow-day' },
  { id: 'daycycle', name: '昼夜循环', icon: 'day-night' },
  { id: 'mountains', name: '远山萤火', icon: 'mountain-firefly' },
  { id: 'underwater', name: '水下光影', icon: 'underwater' },
];
