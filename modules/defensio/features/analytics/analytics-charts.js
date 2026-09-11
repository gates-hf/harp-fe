// Inline SVG for the Defensio analytics screens — the shapes Pactum's
// perf-charts.js draws, copied rather than imported (a module never reaches
// into another module's files), plus the two this feature needs of its own:
// a month column chart with two series and a ranked horizontal bar list.
// Everything is SVG presentation attributes over design-system colour tokens
// — a module writes no CSS, and the charts follow the theme because the
// tokens do.

import { esc, usd } from '../../../../shared/format.js';

export const FILL = {
  success: 'var(--viz-2)',
  warning: 'var(--viz-warning)',
  critical: 'var(--viz-3)',
  accent: 'var(--viz-1)',
  muted: 'var(--viz-info)',
  neutral: 'var(--viz-neutral)',
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
const round = (n) => Math.round(n * 10) / 10;

/** A horizontal bar on a track; `max` is the value the bar fills at, shared across the rows it sits with. */
export function bar({ value, max = 1, tone = 'accent', width = 96, height = 8, label = '' }) {
  const w = Math.max(1, Math.round((clamp(value / (max || 1), 0, 1) * width) || 0));
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" style="vertical-align:middle">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${height / 2}" fill="var(--border-subtle)"></rect>
      <rect x="0" y="0" width="${w}" height="${height}" rx="${height / 2}" fill="${FILL[tone] || FILL.accent}"></rect>
    </svg>`;
}

/**
 * The change since the period before. The caller says which direction is
 * good; the other is amber, never red — a delta is a direction of travel,
 * not a breach.
 */
export function deltaArrow(delta, { goodWhenUp = false } = {}) {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.00005) {
    return `<svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label="unchanged" style="vertical-align:baseline">
      <rect x="1" y="5" width="10" height="2" rx="1" fill="${FILL.neutral}"></rect></svg>`;
  }
  const up = delta > 0;
  const good = up === goodWhenUp;
  const path = up ? 'M6 1 L11 8 H1 Z' : 'M6 11 L1 4 h10 Z';
  return `<svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label="${up ? 'up' : 'down'}" style="vertical-align:baseline">
    <path d="${path}" fill="${good ? FILL.success : FILL.warning}"></path></svg>`;
}

/** Monthly values as a line; a flat run of zeroes still draws its baseline. */
export function sparkline(values, { width = 88, height = 22, label = 'Monthly trend', tone = 'accent' } = {}) {
  const rows = values.length ? values : [0];
  const max = Math.max(0.01, ...rows);
  const step = rows.length > 1 ? width / (rows.length - 1) : 0;
  const y = (v) => height - 3 - (clamp(v / max, 0, 1) * (height - 6));
  const points = rows.map((v, i) => `${round(i * step)},${round(y(v))}`).join(' ');
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" style="vertical-align:middle">
      <polyline points="${points}" fill="none" stroke="${FILL[tone] || FILL.accent}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"></polyline>
      <circle cx="${round((rows.length - 1) * step)}" cy="${round(y(rows[rows.length - 1]))}" r="2.2" fill="${FILL[tone] || FILL.accent}"></circle>
    </svg>`;
}

/**
 * Two series, one pair of columns per month: the first sits behind at full
 * width, the second in front at half, so the gap between them is the
 * chart's subject. `rows` are { label, a, b, title }.
 */
export function monthColumns(rows, { height = 190, aLabel = 'Denied', bLabel = 'Recovered', money = true } = {}) {
  if (!rows.length) return '';
  const width = Math.max(320, rows.length * 46);
  const top = 14;
  const base = height - 24;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.a, r.b)));
  const slot = width / rows.length;
  const w = Math.min(26, slot * 0.56);
  const fmt = (n) => (money ? usd(n) : String(n));
  const cols = rows.map((row, i) => {
    const x = i * slot + (slot - w) / 2;
    const h = (row.a / max) * (base - top);
    const hb = (row.b / max) * (base - top);
    return `
      <g>
        <title>${esc(row.title || `${row.label} — ${aLabel} ${fmt(row.a)}, ${bLabel} ${fmt(row.b)}`)}</title>
        <rect x="${round(x)}" y="${round(base - h)}" width="${round(w)}" height="${round(h)}" rx="2" fill="${FILL.muted}"></rect>
        <rect x="${round(x + w / 4)}" y="${round(base - hb)}" width="${round(w / 2)}" height="${round(hb)}" rx="2" fill="${FILL.accent}"></rect>
        <text x="${round(x + w / 2)}" y="${base + 14}" text-anchor="middle" font-size="10" fill="var(--fg-3)">${esc(row.label)}</text>
      </g>`;
  });
  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" preserveAspectRatio="xMidYMid meet" aria-label="${esc(`${aLabel} and ${bLabel} by month`)}">
      <line x1="0" y1="${base}" x2="${width}" y2="${base}" stroke="var(--border-1)" stroke-width="1"></line>
      <text x="0" y="10" font-size="10" fill="var(--fg-3)">Peak ${esc(fmt(max))}</text>
      ${cols.join('')}
    </svg>`;
}

/** The key under a two-series chart. */
export function legend(aLabel, bLabel) {
  const swatch = (fill, label) => `<span class="t-body-sm"><svg width="9" height="9" viewBox="0 0 9 9" role="presentation" style="vertical-align:baseline"><rect width="9" height="9" rx="2" fill="${fill}"></rect></svg> ${esc(label)}</span>`;
  return `${swatch(FILL.muted, aLabel)} ${swatch(FILL.accent, bLabel)}`;
}

/**
 * A ranked list of horizontal bars — the top-N chart under a breakdown.
 * `rows` are { label, value, text, href }; the longest bar is the largest
 * value, so the rows read against each other.
 */
export function rankedBars(rows, { width = 220, tone = 'accent' } = {}) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 0.01);
  return `<table class="tbl"><tbody>${rows.map((r) => `
    <tr>
      <td>${r.href ? `<a class="crumb-link" href="${esc(r.href)}">${esc(r.label)}</a>` : esc(r.label)}</td>
      <td>${bar({ value: r.value, max, tone, width, label: `${r.label} ${r.text}` })}</td>
      <td class="num t-mono-sm">${esc(r.text)}</td>
    </tr>`).join('')}</tbody></table>`;
}

/**
 * A funnel: one bar per stage, each drawn against the first stage's count,
 * with its money beside it. Rows are { label, count, amount, href }.
 */
export function funnelBars(stages, { width = 260 } = {}) {
  if (!stages.length) return '';
  const max = Math.max(stages[0].count, 1);
  return `<table class="tbl"><tbody>${stages.map((s, i) => `
    <tr>
      <td>${s.href ? `<a class="crumb-link" href="${esc(s.href)}">${esc(s.label)}</a>` : esc(s.label)}</td>
      <td>${bar({ value: s.count, max, tone: i === stages.length - 1 ? 'success' : 'accent', width, label: `${s.label}: ${s.count}` })}</td>
      <td class="num t-mono-sm">${s.count}</td>
      <td class="num t-mono-sm">${esc(usd(s.amount))}</td>
    </tr>`).join('')}</tbody></table>`;
}
