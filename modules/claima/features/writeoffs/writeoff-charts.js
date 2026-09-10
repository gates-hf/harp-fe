// Inline SVG for the write-off analytics: a share bar split two ways, a plain
// bar on a shared track and a month column pair stacked by classification.
// Copied from the lifecycle charts rather than imported — a module never
// reaches into another feature's files — and, like them, SVG presentation
// attributes over design-system colour tokens, so the module writes no CSS.

import { esc, usd } from '../../../../shared/format.js';

export const FILL = {
  contractual: 'var(--viz-1)',
  discretionary: 'var(--viz-warning)',
  accent: 'var(--viz-1)',
  muted: 'var(--viz-info)',
  neutral: 'var(--viz-neutral)',
  critical: 'var(--viz-3)',
};

/** One value on a shared track. */
export function bar({ value, max = 1, tone = 'accent', width = 120, height = 8, label = '' }) {
  const w = Math.max(value > 0 ? 2 : 0, Math.round(clamp(value / (max || 1), 0, 1) * width));
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" style="vertical-align:middle">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${height / 2}" fill="var(--border-subtle)"></rect>
      <rect x="0" y="0" width="${w}" height="${height}" rx="${height / 2}" fill="${FILL[tone] || FILL.neutral}"></rect>
    </svg>`;
}

/** Contractual and discretionary laid end to end on one track — the primary split. */
export function splitBar(contractual, discretionary, { width = 100, height = 14 } = {}) {
  const total = contractual + discretionary;
  const a = total ? (contractual / total) * width : 0;
  const b = total ? (discretionary / total) * width : 0;
  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img"
         aria-label="${esc(`Contractual ${usd(contractual)}, discretionary ${usd(discretionary)}`)}">
      <rect x="0" y="0" width="${width}" height="${height}" rx="3" fill="var(--border-subtle)"></rect>
      ${a ? `<rect x="0" y="0" width="${round(a)}" height="${height}" rx="3" fill="${FILL.contractual}"><title>Contractual ${esc(usd(contractual))}</title></rect>` : ''}
      ${b ? `<rect x="${round(a)}" y="0" width="${round(b)}" height="${height}" rx="3" fill="${FILL.discretionary}"><title>Discretionary ${esc(usd(discretionary))}</title></rect>` : ''}
    </svg>`;
}

/** A column per month, contractual under discretionary, the total written above each. */
export function monthColumns(rows, { height = 190 } = {}) {
  if (!rows.length) return '';
  const width = Math.max(320, rows.length * 64);
  const top = 18;
  const base = height - 24;
  const max = Math.max(1, ...rows.map((r) => r.total));
  const slot = width / rows.length;
  const w = Math.min(34, slot * 0.55);
  const cols = rows.map((row, i) => {
    const x = i * slot + (slot - w) / 2;
    const hc = (row.contractual / max) * (base - top);
    const hd = (row.discretionary / max) * (base - top);
    return `
      <g>
        <title>${esc(row.label)} — ${esc(usd(row.total))} over ${row.count} write-off${row.count === 1 ? '' : 's'}: ${esc(usd(row.contractual))} contractual, ${esc(usd(row.discretionary))} discretionary</title>
        ${hc ? `<rect x="${round(x)}" y="${round(base - hc)}" width="${round(w)}" height="${round(hc)}" fill="${FILL.contractual}"></rect>` : ''}
        ${hd ? `<rect x="${round(x)}" y="${round(base - hc - hd)}" width="${round(w)}" height="${round(hd)}" fill="${FILL.discretionary}"></rect>` : ''}
        ${row.total ? `<text x="${round(x + w / 2)}" y="${round(base - hc - hd - 4)}" text-anchor="middle" font-size="9" fill="var(--fg-3)">${esc(short(row.total))}</text>` : ''}
        <text x="${round(x + w / 2)}" y="${base + 14}" text-anchor="middle" font-size="10" fill="var(--fg-3)">${esc(row.label)}</text>
      </g>`;
  });
  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" preserveAspectRatio="xMidYMid meet"
         aria-label="Posted write-offs by month, split by classification">
      <line x1="0" y1="${base}" x2="${width}" y2="${base}" stroke="var(--border-1)" stroke-width="1"></line>
      <text x="0" y="10" font-size="10" fill="var(--fg-3)">Peak ${esc(usd(max))}</text>
      ${cols.join('')}
    </svg>`;
}

export function legend() {
  return `${swatch(FILL.contractual, 'Contractual')} ${swatch(FILL.discretionary, 'Discretionary')}`;
}

const swatch = (fill, text) =>
  `<span class="t-body-sm"><svg width="9" height="9" viewBox="0 0 9 9" role="presentation" style="vertical-align:baseline">
    <rect width="9" height="9" rx="2" fill="${fill}"></rect></svg> ${esc(text)}</span>`;

const short = (n) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
const round = (n) => Math.round(n * 10) / 10;
