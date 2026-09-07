// Formatting. Currency always carries cents (coders need them). IDs, codes and
// timestamps are mono — wrap them in .t-mono at the call site.

export const LBP_PER_USD = 89500;

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});
const lbpFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const usd = (n) => usdFmt.format(Number(n) || 0);
export const lbp = (n) => `LBP ${lbpFmt.format(Math.round(Number(n) || 0))}`;
export const usdToLbp = (n) => lbp((Number(n) || 0) * LBP_PER_USD);
export const int = (n) => lbpFmt.format(Number(n) || 0);

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });

export function date(iso) {
  if (!iso) return '—';
  return dateFmt.format(new Date(iso));
}

export function dateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${dateFmt.format(d)} · ${timeFmt.format(d)}`;
}

export function age(dob) {
  if (!dob) return '—';
  const born = new Date(dob);
  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) years -= 1;
  return `${years}`;
}

export function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** Escape anything that came from the store before it goes into innerHTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Lebanese mobile or landline: +961 3 214 587, +961 71 902 334, +961 1 385 220. */
export function isPhone(value) {
  return /^\+961\s?\d{1,2}(\s?\d{3}){2}$/.test(String(value).trim());
}
