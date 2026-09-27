// ===== 世界分享码：RLE + 自定义头 + base64url，纯文本即可流转整个画面 =====
// 字节布局：'S''B''1' + 宽(2B 大端) + 高(2B 大端) + RLE 对 [数量, 元素id]（数量≤255）
// 导入端尺寸不一致时自动适配：水平居中裁剪 / 垂直底对齐（地形沉底，保留底部）

const MAGIC = [0x53, 0x42, 0x31]; // 'SB1'
const HEAD = 7; // 3 魔数 + 2 宽 + 2 高

function bytesToB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const s = atob(b64 + pad);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export function encodeShareCode(world) {
  const c = world.cells;
  const pairs = [];
  let i = 0;
  while (i < c.length) {
    const v = c[i];
    let n = 1;
    while (n < 255 && i + n < c.length && c[i + n] === v) n++;
    pairs.push(n, v);
    i += n;
  }
  const out = new Uint8Array(HEAD + pairs.length);
  out[0] = MAGIC[0];
  out[1] = MAGIC[1];
  out[2] = MAGIC[2];
  out[3] = (world.w >> 8) & 255;
  out[4] = world.w & 255;
  out[5] = (world.h >> 8) & 255;
  out[6] = world.h & 255;
  for (let k = 0; k < pairs.length; k++) out[HEAD + k] = pairs[k];
  return bytesToB64url(out);
}

export function decodeShareCode(str) {
  const cleaned = String(str || '').replace(/\s+/g, '');
  if (!cleaned) return null;
  let bytes;
  try {
    bytes = b64urlToBytes(cleaned);
  } catch {
    return null;
  }
  if (bytes.length < HEAD + 2) return null;
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2]) return null;
  const w = (bytes[3] << 8) | bytes[4];
  const h = (bytes[5] << 8) | bytes[6];
  const total = w * h;
  if (w < 16 || h < 16 || total > 400000) return null; // 防恶意超大码
  const cells = new Uint8Array(total);
  let p = 0;
  for (let k = HEAD; k + 1 < bytes.length; k += 2) {
    const n = bytes[k];
    if (n === 0 || p + n > total) return null;
    cells.fill(bytes[k + 1], p, p + n);
    p += n;
  }
  if (p !== total) return null;
  return { w, h, cells };
}

// 把解码出的画面铺进目标网格：水平居中、垂直底对齐（放不下裁剪、放得下补空气）
// xOff/yOff = 源图左/上边缘在目标网格里的落点（目标更窄/矮时为负 → 居中裁剪）
export function resampleToGrid(decoded, tw, th) {
  const { w: sw, h: sh, cells } = decoded;
  const out = new Uint8Array(tw * th);
  const xOff = Math.floor((tw - sw) / 2);
  const yOff = th - sh; // 底对齐：目标更高时上方补空
  for (let y = 0; y < th; y++) {
    const sy = y - yOff;
    if (sy < 0 || sy >= sh) continue;
    for (let x = 0; x < tw; x++) {
      const sx = x - xOff;
      if (sx < 0 || sx >= sw) continue;
      out[y * tw + x] = cells[sy * sw + sx];
    }
  }
  return out;
}
