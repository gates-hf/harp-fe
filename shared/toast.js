// Toast — the design system's .htoast outlet wearing an .alert. Max 8 words.

const ICONS = {
  success: 'check_circle',
  critical: 'warning',
  warning: 'priority_high',
  info: 'info',
};

let timer = null;

export function toast(message, tone = 'success') {
  document.querySelector('.htoast')?.remove();
  clearTimeout(timer);

  const el = document.createElement('div');
  el.className = `htoast alert alert--${tone}`;
  el.setAttribute('role', tone === 'critical' ? 'alert' : 'status');
  el.innerHTML = `<span class="icon">${ICONS[tone] || ICONS.info}</span><div>${message}</div>`;
  document.body.appendChild(el);

  timer = setTimeout(() => el.remove(), 3400);
  return el;
}
