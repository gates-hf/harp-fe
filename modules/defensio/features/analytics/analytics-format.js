// The small vocabulary every analytics view speaks: a figure with its
// delta, a drill link, the boundary caption, a pending-feature state, the
// CSV helpers. Markup only — the numbers arrive from
// data/engines/denial-analytics.js and nothing here computes one.

import { GOOD_WHEN_UP, formatValue } from '../../../../data/engines/denial-analytics.js';
import { esc, usd } from '../../../../shared/format.js';
import { deltaArrow } from './analytics-charts.js';

export const pct = (n, digits = 1) => (n == null || Number.isNaN(n) ? '—' : `${((Number(n) || 0) * 100).toFixed(digits)}%`);
export const money = (n) => (n == null ? '—' : usd(n));
export const int = (n) => (n == null ? '—' : String(Math.round(n)));
export const fmt = (format, value) => formatValue(format, value);

/** A figure as a link into the worklist holding its records — every figure element carries its drill href. */
export const drill = (href, text, title = 'Open the records behind this figure') =>
  (href ? `<a class="crumb-link" href="${esc(href)}" title="${esc(title)}">${text}</a>` : text);

/** The delta beside a figure: the arrow (green when the move is good) and the change in the metric's own unit. */
export function deltaHtml(fig) {
  if (!fig || fig.delta == null) return fig?.prior ? '<span class="t-body-sm" title="Nothing to compare against in the period before">—</span>' : '';
  return `<span class="t-body-sm" title="${esc(`${fig.prior?.text || '—'} in the period before`)}">${deltaArrow(fig.delta, { goodWhenUp: GOOD_WHEN_UP.has(fig.key) })} ${esc(fig.deltaText)}</span>`;
}

/** The one-line caption under a view naming the date boundary each family is read on. */
export function captionHtml(boundaries = [], extra = '') {
  const parts = boundaries.map((b) => `<strong>${esc(b.label)}</strong> — ${esc(b.caption.toLowerCase())}`);
  return `<p class="t-body-sm" style="margin:8px 0 0">${parts.join(' · ')}${extra ? ` · ${extra}` : ''}</p>`;
}

/** What a panel shows when the register another amendment builds is not on disk yet. Never a made-up number. */
export function pendingHtml(feature, what) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">hourglass_empty</span></div>
      <div class="state-view__title">Pending ${esc(feature)}</div>
      <p class="state-view__body">${esc(what)} is read from a register that amendment has not built yet. Nothing is estimated in its place.</p>
    </div>`;
}

export function emptyHtml(title, body) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">query_stats</span></div>
      <div class="state-view__title">${esc(title)}</div>
      <p class="state-view__body">${esc(body)}</p>
    </div>`;
}

/** A tinted badge. */
export const badge = (text, tone = '') => `<span class="badge${tone ? ` badge--${tone}` : ''}">${esc(text)}</span>`;

/** The "estimate" tag a prevented value wears — it is a model's reading, not a posting. */
export const estimateBadge = () => '<span class="badge badge--info" title="Read from the prevention rules — an estimate of what would have been denied, not money that moved">estimate</span>';

// --- CSV ------------------------------------------------------------------------------------

export const csvLine = (cells) => cells.map((c) => { const s = c == null ? '' : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',');

export function download(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const csvOf = (rows) => rows.map(csvLine).join('\n');
