let el = null;

export function initToast() {
  el = document.getElementById('toast');
}

export function showToast(msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('show');
  void el.offsetWidth; // 重置动画
  el.classList.add('show');
}
