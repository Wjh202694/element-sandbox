let el = null;

export function initToast() {
  el = document.getElementById('toast');
}

// icon 传入内联 SVG 字符串时，插到文字前作为提示图形
export function showToast(msg, icon) {
  if (!el) return;
  if (icon) {
    el.innerHTML = `${icon}<span>${msg}</span>`;
  } else {
    el.textContent = msg;
  }
  el.classList.remove('show');
  void el.offsetWidth; // 重置动画
  el.classList.add('show');
}
