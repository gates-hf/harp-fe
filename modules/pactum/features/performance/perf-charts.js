// Inline SVG for the two Performance screens. The design system ships no chart
// primitives and the prototype carries no chart library, so these draw the four
// shapes the screens need: a colour-coded bar, a delta arrow, a sparkline and a
// month column pair.
//
// Everything is SVG presentation attributes over design-system colour tokens —
// a module writes no CSS, and the charts follow the theme because the tokens do.

import { CONFIG } from '../../../../data/engines/performance-engine.js';
import { esc, usd } from '../../../../shared/format.js';

export const FILL = {
  success: 'var(--viz-2)',
  warning: 'var(--viz-warning)',
  critical: 'var(--viz-3)',
  accent: 'var(--viz-1)',
  muted: 'var(--viz-info)',
  neutral: 'var(--viz-neutral)',
};

/** The bands the amendment names: green under 8%, amber to 15%, red above. */
export function denialTone(rate) {
  const { good, warn } = CONFIG.denialBands;
  if (rate < good) return 'success';
  return rate <= warn ? 'warning' : 'critical';
}

/** A score reads the same way round as a denial rate, upside down. */
export function scoreTone(score) {
  if (score >= 75) return 'success';
  return score >= 50 ? 'warning' : 'critical';
}

export const pct = (n, digits = 1) => `${((Number(n) || 0) * 100).toFixed(digits)}%`;

/**
 * A horizontal bar on a track. `max` is the value the bar fills at — the denial
 * bars share one, so two payers are read against each other and not each
 * against itself.
 */
export function bar({ value, max = 1, tone = 'accent', width = 96, height = 8, label = '' }) {
  const w = Math.max(1, Math.round((clamp(value / (max || 1), 0, 1) * width) || 0));
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"
         aria-label="${esc(label || pct(value))}" style="vertical-align:middle">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${height / 2}" fill="var(--border-subtle)"></rect>
      <rect x="0" y="0" width="${w}" height="${height}" rx="${height / 2}" fill="${FILL[tone]}"></rect>
    </svg>`;
}

/** Denial rate as figure plus bar, the pairing both tables use. */
export function denialBar(rate, { max = 0.3 } = {}) {
  const tone = denialTone(rate);
  return `<span class="t-mono-sm">${pct(rate)}</span> ${bar({ value: rate, max, tone, label: `Denial rate ${pct(rate)}` })}`;
}

/**
 * The change since last quarter. Down is good on a denial rate, so the caller
 * says which direction earns green; the other direction is amber, never red —
 * a delta is a direction of travel, not a breach.
 */
export function deltaArrow(delta, { goodWhenDown = true } = {}) {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0005) {
    return `<svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label="unchanged" style="vertical-align:baseline">
      <rect x="1" y="5" width="10" height="2" rx="1" fill="${FILL.neutral}"></rect></svg>`;
  }
  const down = delta < 0;
  const good = down === goodWhenDown;
  const path = down ? 'M6 11 L1 4 h10 Z' : 'M6 1 L11 8 H1 Z';
  return `<svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label="${down ? 'down' : 'up'}" style="vertical-align:baseline">
    <path d="${path}" fill="${good ? FILL.success : FILL.warning}"></path></svg>`;
}

/** Monthly rates as a line. A flat run of zeroes still draws its baseline. */
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
 * Charged and paid, one pair of columns per month. The paid column sits in
 * front of the charged one at half its width, so the gap between them is the
 * chart's subject rather than something the reader has to compute.
 */
export function monthColumns(rows, { height = 190 } = {}) {
  if (!rows.length) return '';
  const width = Math.max(320, rows.length * 46);
  const top = 14;
  const base = height - 24;
  const max = Math.max(1, ...rows.map((r) => r.grossBilled));
  const slot = width / rows.length;
  const w = Math.min(26, slot * 0.56);

  const cols = rows.map((row, i) => {
    const x = i * slot + (slot - w) / 2;
    const h = (row.grossBilled / max) * (base - top);
    const hp = (row.allowedPaid / max) * (base - top);
    return `
      <g>
        <title>${esc(row.label)} — charged ${esc(usd(row.grossBilled))}, paid ${esc(usd(row.allowedPaid))} (${row.claims} claims)</title>
        <rect x="${round(x)}" y="${round(base - h)}" width="${round(w)}" height="${round(h)}" rx="2" fill="${FILL.muted}"></rect>
        <rect x="${round(x + w / 4)}" y="${round(base - hp)}" width="${round(w / 2)}" height="${round(hp)}" rx="2" fill="${FILL.accent}"></rect>
        <text x="${round(x + w / 2)}" y="${base + 14}" text-anchor="middle" font-size="10" fill="var(--fg-3)">${esc(row.label)}</text>
      </g>`;
  });

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" preserveAspectRatio="xMidYMid meet"
         aria-label="Charged and paid by month">
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
  return `${swatch(FILL.muted, 'Charged')} ${swatch(FILL.accent, 'Paid')}`;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
const round = (n) => Math.round(n * 10) / 10;
