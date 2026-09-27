import { GRID } from '../sim/elements.js';
import { showToast } from './toast.js';
import { encodeShareCode, decodeShareCode, resampleToGrid } from '../utils/shareCode.js';

// 分享 / 导入世界：一串 base64url 文本即可把整个画面发给朋友
export function initShare() {
  const modal = document.getElementById('share-modal');
  const out = document.getElementById('share-out');
  const input = document.getElementById('share-in');

  document.getElementById('btn-share').onclick = () => {
    const world = window.__sb?.world;
    if (!world) {
      showToast('⚠️ 场景尚未就绪，稍后再试');
      return;
    }
    try {
      out.value = encodeShareCode(world);
    } catch {
      out.value = '';
      showToast('⚠️ 分享码生成失败');
    }
    input.value = '';
    modal.hidden = false;
  };
  document.getElementById('share-close').onclick = () => {
    modal.hidden = true;
  };
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });

  document.getElementById('share-copy').onclick = async () => {
    if (!out.value) return;
    try {
      await navigator.clipboard.writeText(out.value);
      showToast('📋 分享码已复制，去粘贴给朋友吧');
    } catch {
      // 剪贴板权限受限（file:// 等）：退化为选中文本让用户手动 Ctrl+C
      out.focus();
      out.select();
      showToast('📋 已选中分享码，请按 Ctrl+C 复制');
    }
  };

  document.getElementById('share-import').onclick = () => {
    const decoded = decodeShareCode(input.value);
    if (!decoded) {
      showToast('⚠️ 分享码无效或已损坏');
      return;
    }
    const cells = resampleToGrid(decoded, GRID.w, GRID.h);
    const fit =
      decoded.w === GRID.w && decoded.h === GRID.h
        ? '原样复现'
        : `已按当前画布适配（原 ${decoded.w}×${decoded.h}）`;
    document.dispatchEvent(new CustomEvent('sb-import-world', { detail: { cells, fit } }));
    modal.hidden = true;
  };
}
