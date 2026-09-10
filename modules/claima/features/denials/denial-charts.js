// Inline SVG for the denial analytics — a bar on a track, a sparkline and a
// month column pair — copied from Pactum's perf-charts.js rather than
// imported, since a module never reaches into another module's files. The
// design system ships no chart primitives and the prototype carries no chart
// library; everything is SVG presentation attributes over the design
// system's colour tokens, so the charts follow the theme because the tokens do.

import { esc, usd } from '../../../../shared/format.js';

export const FILL = {
  success: 'var(--viz-2)',
  warning: 'var(--viz-warning)',
  critical: 'var(--viz-3)',
  accent: 'var(--viz-1)',
  muted: 'var(--viz-info)',
  neutral: 'var(--viz-neutral)',
};

export const pct = (n, digits = 0) => `${((Number(n) || 0) * 100).toFixed(digits)}%`;

/** A recovery rate reads the opposite way round to a denial rate: high is good. */
export function recoveryTone(rate) {
  if (rate >= 0.6) return 'success';
  return rate >= 0.3 ? 'warning' : 'critical';
}

/** A horizontal bar on a track; `max` is the value the bar fills at, shared across a column. */
export function bar({ value, max = 1, tone = 'accent', width = 96, height = 8, label = '' }) {
  const w = Math.max(1, Math.round((clamp(value / (max || 1), 0, 1) * width) || 0));
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"
         aria-label="${esc(label || pct(value))}" style="vertical-align:middle">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${height / 2}" fill="var(--border-subtle)"></rect>
      <rect x="0" y="0" width="${w}" height="${height}" rx="${height / 2}" fill="${FILL[tone]}"></rect>
    </svg>`;
}

/** Recovery rate as figure plus bar. */
export function recoveryBar(rate) {
  return `<span class="t-mono-sm">${pct(rate)}</span> ${bar({ value: rate, max: 1, tone: recoveryTone(rate), label: `Recovery rate ${pct(rate)}` })}`;
}

/** Denied value as a bar against the column's largest, the figure beside it. */
export function valueBar(amount, max) {
  return `<span class="t-mono-sm">${esc(usd(amount))}</span> ${bar({ value: amount, max, tone: 'critical', width: 72, label: `${usd(amount)} denied` })}`;
}

/** Monthly counts as a line. A flat run of zeroes still draws its baseline. */
export function sparkline(values, { width = 88, height = 22, label = 'Monthly denials' } = {}) {
  const rows = values.length ? values : [0];
  const max = Math.max(1, ...rows);
  const step = rows.length > 1 ? width / (rows.length - 1) : 0;
  const y = (v) => height - 3 - (clamp(v / max, 0, 1) * (height - 6));
  const points = rows.map((v, i) => `${round(i * step)},${round(y(v))}`).join(' ');
  const last = rows[rows.length - 1];
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"
         aria-label="${esc(label)}" style="vertical-align:middle">
      <polyline points="${points}" fill="none" stroke="${FILL.accent}" stroke-width="1.5"
                stroke-linejoin="round" stroke-linecap="round"></polyline>
      <circle cx="${round((rows.length - 1) * step)}" cy="${round(y(last))}" r="2.2" fill="${last ? FILL.critical : FILL.neutral}"></circle>
    </svg>`;
}

/**
 * Denied and recovered, one pair of columns per month. The recovered column
 * sits in front of the denied one at half its width, so the gap between them
 * is the chart's subject.
 */
export function monthColumns(rows, { height = 170 } = {}) {
  if (!rows.length) return '';
  const width = Math.max(320, rows.length * 46);
  const top = 14;
  const base = height - 24;
  const max = Math.max(1, ...rows.map((r) => r.denied));
  const slot = width / rows.length;
  const w = Math.min(26, slot * 0.56);
  const cols = rows.map((row, i) => {
    const x = i * slot + (slot - w) / 2;
    const h = (row.denied / max) * (base - top);
    const hp = (row.recovered / max) * (base - top);
    return `
      <g>
        <title>${esc(row.label)} — denied ${esc(usd(row.denied))}, recovered ${esc(usd(row.recovered))} (${row.count} denials)</title>
        <rect x="${round(x)}" y="${round(base - h)}" width="${round(w)}" height="${round(h)}" rx="2" fill="${FILL.critical}"></rect>
        <rect x="${round(x + w / 4)}" y="${round(base - hp)}" width="${round(w / 2)}" height="${round(hp)}" rx="2" fill="${FILL.success}"></rect>
        <text x="${round(x + w / 2)}" y="${base + 14}" text-anchor="middle" font-size="10" fill="var(--fg-3)">${esc(row.label)}</text>
      </g>`;
  });
  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" preserveAspectRatio="xMidYMid meet"
         aria-label="Denied and recovered by month">
      <line x1="0" y1="${base}" x2="${width}" y2="${base}" stroke="var(--border-1)" stroke-width="1"></line>
      <text x="0" y="10" font-size="10" fill="var(--fg-3)">Peak ${esc(usd(max))}</text>
      ${cols.join('')}
    </svg>`;
}

/** The key under the column chart — the two fills, named. */
export function columnsLegend() {
  const swatch = (fill, text) =>
    `<span class="t-body-sm"><svg width="9" height="9" viewBox="0 0 9 9" role="presentation" style="vertical-align:baseline">
      <rect width="9" height="9" rx="2" fill="${fill}"></rect></svg> ${text}</span>`;
  return `${swatch(FILL.critical, 'Denied')} ${swatch(FILL.success, 'Recovered')}`;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
const round = (n) => Math.round(n * 10) / 10;
