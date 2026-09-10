// Inline SVG for the payer statistics screen: a sparkline, a rate bar and a
// month column pair. Copied from Pactum's perf-charts.js rather than imported
// — a module never reaches into another module's files — and, like it, SVG
// presentation attributes over design-system colour tokens, so the charts
// follow the theme and the module writes no CSS.

import { CONFIG } from '../../../../data/engines/performance-engine.js';
import { esc } from '../../../../shared/format.js';

export const FILL = {
  success: 'var(--viz-2)',
  warning: 'var(--viz-warning)',
  critical: 'var(--viz-3)',
  accent: 'var(--viz-1)',
  muted: 'var(--viz-info)',
  neutral: 'var(--viz-neutral)',
};

/** Performance's own bands: green under 8%, amber to 15%, red above. */
export function denialTone(rate) {
  const { good, warn } = CONFIG.denialBands;
  if (rate < good) return 'success';
  return rate <= warn ? 'warning' : 'critical';
}

export const pct = (n, digits = 1) => `${((Number(n) || 0) * 100).toFixed(digits)}%`;

/** A rate as figure plus bar on a shared track, so two payers read against each other. */
export function rateBar(rate, { max = 0.3, tone = denialTone(rate), label = 'rate' } = {}) {
  const width = 72;
  const height = 8;
  const w = Math.max(1, Math.round(clamp(rate / (max || 1), 0, 1) * width));
  return `<span class="t-mono-sm">${pct(rate)}</span>
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${label} ${pct(rate)}`)}" style="vertical-align:middle">
      <rect x="0" y="0" width="${width}" height="${height}" rx="4" fill="var(--border-subtle)"></rect>
      <rect x="0" y="0" width="${w}" height="${height}" rx="4" fill="${FILL[tone]}"></rect>
    </svg>`;
}

/** Monthly rates as a line; the last point is coloured by its band. */
export function sparkline(values, { width = 88, height = 22, label = 'Monthly denial rate' } = {}) {
  const rows = values.length ? values : [0];
  const max = Math.max(0.02, ...rows);
  const step = rows.length > 1 ? width / (rows.length - 1) : 0;
  const y = (v) => height - 3 - (clamp(v / max, 0, 1) * (height - 6));
  const points = rows.map((v, i) => `${round(i * step)},${round(y(v))}`).join(' ');
  const last = rows[rows.length - 1];
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"
         aria-label="${esc(label)}" style="vertical-align:middle">
      <polyline points="${points}" fill="none" stroke="${FILL.accent}" stroke-width="1.5"
                stroke-linejoin="round" stroke-linecap="round"></polyline>
      <circle cx="${round((rows.length - 1) * step)}" cy="${round(y(last))}" r="2.2" fill="${FILL[denialTone(last)]}"></circle>
    </svg>`;
}

/**
 * Submitted and denied, one pair of columns per month, with the days to pay
 * written under each — the drill chart for one payer. The denied column sits
 * in front of the submitted one at half its width, so the share is the shape.
 */
export function trendColumns(rows, { height = 190 } = {}) {
  if (!rows.length) return '';
  const width = Math.max(320, rows.length * 64);
  const top = 14;
  const base = height - 36;
  const max = Math.max(1, ...rows.map((r) => r.submitted));
  const slot = width / rows.length;
  const w = Math.min(30, slot * 0.5);
  const cols = rows.map((row, i) => {
    const x = i * slot + (slot - w) / 2;
    const h = (row.submitted / max) * (base - top);
    const hd = (row.denied / max) * (base - top);
    return `
      <g>
        <title>${esc(row.label)} — ${row.submitted} submitted, ${row.denied} denied (${esc(pct(row.denialRate))}), ${Math.round(row.daysToPay)} days to pay</title>
        <rect x="${round(x)}" y="${round(base - h)}" width="${round(w)}" height="${round(h)}" rx="2" fill="${FILL.muted}"></rect>
        <rect x="${round(x + w / 4)}" y="${round(base - hd)}" width="${round(w / 2)}" height="${round(hd)}" rx="2" fill="${FILL[denialTone(row.denialRate)]}"></rect>
        <text x="${round(x + w / 2)}" y="${base + 14}" text-anchor="middle" font-size="10" fill="var(--fg-3)">${esc(row.label)}</text>
        <text x="${round(x + w / 2)}" y="${base + 27}" text-anchor="middle" font-size="10" fill="var(--fg-3)">${row.paid ? `${Math.round(row.daysToPay)} d` : '—'}</text>
      </g>`;
  });
  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" preserveAspectRatio="xMidYMid meet"
         aria-label="Submitted and denied by month, with days to pay">
      <line x1="0" y1="${base}" x2="${width}" y2="${base}" stroke="var(--border-1)" stroke-width="1"></line>
      <text x="0" y="10" font-size="10" fill="var(--fg-3)">Peak ${max} submitted</text>
      ${cols.join('')}
    </svg>`;
}

export function trendLegend() {
  const swatch = (fill, text) =>
    `<span class="t-body-sm"><svg width="9" height="9" viewBox="0 0 9 9" role="presentation" style="vertical-align:baseline">
      <rect width="9" height="9" rx="2" fill="${fill}"></rect></svg> ${text}</span>`;
  return `${swatch(FILL.muted, 'Submitted')} ${swatch(FILL.critical, 'Denied (coloured by the month’s rate)')} <span class="t-body-sm">· days to pay under each month</span>`;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
const round = (n) => Math.round(n * 10) / 10;
