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

/** name@domain.tld — enough for a demo, not an RFC. */
export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(value).trim());
}

/** Bytes as KB or MB — document lists never show raw byte counts. */
export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

// --- dates -------------------------------------------------------------------
// Every date in the store is an ISO `YYYY-MM-DD` string. These four are the one
// place that shape is produced and compared, so a screen never invents its own
// parsing and a blank date never reads as "before everything".

/** Today, in the shape every stored date uses. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Anything a form or the store hands over, as ISO `YYYY-MM-DD`, or ''. */
export function iso(value) {
  if (!value) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
}

/** -1, 0 or 1 over two dates of any shape. A blank date compares as blank. */
export function compareDates(a, b) {
  const left = iso(a);
  const right = iso(b);
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * Whether `on` falls inside a term. A blank bound is open-ended in that
 * direction, and a blank `on` is read as today — a half-typed date field
 * should not empty the screen it drives.
 */
export function withinDates(on, from, to) {
  const at = iso(on) || todayIso();
  const start = iso(from);
  const end = iso(to);
  if (start && at < start) return false;
  if (end && at > end) return false;
  return true;
}

/**
 * "2 hours ago", "yesterday", "3 weeks ago" — the reading a feed wants, with
 * the exact stamp kept for the title attribute. Anything older than a year
 * falls back to the date, which is more use than "13 months ago".
 */
export function relativeTime(at) {
  if (!at) return '—';
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return '—';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 0) return date(at);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (days < 31) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (days < 365) return `${months} month${months === 1 ? '' : 's'} ago`;
  return date(at);
}
