// Coding metrics at #/claima/coding/metrics — four panels over the figures
// data/repositories/coding.js computes, drawn as inline SVG over design-system
// colour tokens. The three shapes (a bar on a track, a stacked bar, a day
// column set) are copies of Pactum's perf-charts helpers, not imports: a
// module never reaches into another module's files.

import * as coding from '../../../../data/repositories/coding.js';
import { CONFIG } from '../../../../shared/config.js';
import { date, esc } from '../../../../shared/format.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';

export const meta = { title: 'Coding metrics' };

const FILL = {
  success: 'var(--viz-2)',
  warning: 'var(--viz-warning)',
  critical: 'var(--viz-3)',
  accent: 'var(--viz-1)',
  muted: 'var(--viz-info)',
  neutral: 'var(--viz-neutral)',
};

/** The age bands, youngest to oldest, painted calm to loud. */
const BAND_FILL = [FILL.success, FILL.accent, FILL.warning, FILL.critical];
const CODER_FILL = [FILL.accent, FILL.success, FILL.warning, FILL.muted];

export async function render(mount, ctx) {
  const res = await fetch(new URL('./coding-metrics.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load coding-metrics.html (${res.status})`);
  mount.innerHTML = await res.text();
  const $ = (sel) => mount.querySelector(sel);

  ctx.setHeader(meta.title);
  ctx.setCrumb([{ label: 'Claima', path: '/claima/home' }, { label: 'Coding', path: '/claima/coding' }, { label: 'Metrics' }]);

  function draw() {
    const m = coding.metrics();
    const c = coding.counts();
    $('#cm-metrics').innerHTML = metricRailHtml([
      { value: m.backlog.total, label: 'Open charts', href: '#/claima/coding', sub: 'Released, not yet coded',
        title: 'Every chart on the worklist that is not coded — opens the worklist' },
      { value: c.beyondSla, label: 'Beyond SLA', href: '#/claima/coding?beyondSla=1', tone: c.beyondSla ? 'critical' : '',
        sub: 'Open longer than the SLA', title: 'Open charts older than their SLA — opens the worklist filtered to them' },
      { value: m.queries.reduce((s, q) => s + q.open, 0), label: 'Open queries', href: '#/claima/coding/queries',
        sub: 'Waiting on a physician', title: 'Queries no physician has answered yet — opens the queue' },
      { value: m.tat.pct === null ? '—' : pct(m.tat.pct), label: 'Coded inside SLA', sub: `${m.tat.n} coded chart${m.tat.n === 1 ? '' : 's'}`,
        tone: m.tat.pct !== null && m.tat.pct < 0.8 ? 'warning' : '',
        title: 'Share of coded charts finished inside their SLA, all time' },
    ]);
    $('#cm-backlog-sub').textContent = `${m.backlog.total} open chart${m.backlog.total === 1 ? '' : 's'}`;
    $('#cm-backlog').innerHTML = backlogHtml(m.backlog);
    $('#cm-throughput').innerHTML = throughputHtml(m.perCoder);
    $('#cm-queries').innerHTML = queriesHtml(m.queries);
    $('#cm-tat').innerHTML = tatHtml(m.tat);
  }

  ctx.onData(draw);
  draw();
}

// --- panels ---------------------------------------------------------------------

/** One stacked bar per department, a segment per age band, worst department first. */
function backlogHtml(backlog) {
  if (!backlog.total) return emptyHtml('check_circle', 'No backlog', 'Every released chart is coded.');
  const rows = [...backlog.rows].sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...rows.map((r) => r.total));
  return `
    <table class="tbl">
      <thead><tr><th scope="col">Department</th><th scope="col">Charts</th><th scope="col">By age</th></tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${esc(r.department)}</td>
            <td class="t-mono-sm">${r.total}</td>
            <td>${stacked(r.cells, max, backlog.labels, r.department)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="toolbar">${backlog.labels.map((l, i) => swatch(BAND_FILL[i] || FILL.neutral, l)).join(' ')}</div>`;
}

/** Fourteen day columns, one segment per coder, with the day labels under. */
function throughputHtml(perCoder) {
  const coders = perCoder.coders.filter((c) => c.total > 0);
  if (!coders.length) return emptyHtml('history_edu', 'Nothing coded in the last 14 days', 'A chart marked coded lands here on the day it was finished.');
  return `
    ${dayColumns(perCoder.days, coders)}
    <div class="toolbar">${coders.map((c, i) => swatch(CODER_FILL[i % CODER_FILL.length], `${c.name} — ${c.total}`)).join(' ')}</div>`;
}

function queriesHtml(rows) {
  if (!rows.length) return emptyHtml('forum', 'No queries raised', 'A coder raises a query from the workspace when the chart cannot be coded as written.');
  const max = Math.max(1, ...rows.map((r) => r.open + r.answered));
  return `
    <table class="tbl">
      <thead><tr>
        <th scope="col">Physician</th><th scope="col">Open</th><th scope="col">Answered</th>
        <th scope="col">Oldest open</th><th scope="col">Answers in</th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td><a class="crumb-link" href="#/claima/coding/queries?physician=${esc(r.doctorId)}">${esc(r.name)}</a></td>
            <td><span class="t-mono-sm">${r.open}</span> ${bar({ value: r.open, max, tone: r.open ? 'warning' : 'neutral', label: `${r.open} open` })}</td>
            <td class="t-mono-sm">${r.answered}</td>
            <td class="t-mono-sm">${r.oldestOpen ? date(r.oldestOpen) : '—'}</td>
            <td class="t-mono-sm">${r.avgAnswerDays === null ? '—' : `${r.avgAnswerDays.toFixed(1)} d`}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function tatHtml(tat) {
  const sla = CONFIG.claima?.coding?.slaDays || {};
  const types = Object.entries(tat.byType);
  if (!tat.n) return emptyHtml('timer', 'Nothing coded yet', 'Turnaround is measured from the release of the charges to Mark coded.');
  return `
    <dl class="dl dl--narrow">
      <dt>Average turnaround</dt><dd>${tat.avgDays === null ? '—' : `${tat.avgDays.toFixed(1)} days`} over ${tat.n} chart${tat.n === 1 ? '' : 's'}</dd>
      <dt>Inside SLA</dt><dd>${tat.pct === null ? '—' : pct(tat.pct)} — ${tat.within} of ${tat.n}</dd>
    </dl>
    <table class="tbl">
      <thead><tr>
        <th scope="col">Type</th><th scope="col">SLA</th><th scope="col">Coded</th><th scope="col">Average</th><th scope="col">Inside SLA</th>
      </tr></thead>
      <tbody>
        ${types.map(([type, t]) => `
          <tr>
            <td>${esc(type)}</td>
            <td class="t-mono-sm">${sla[type] ?? t.slaDays} d</td>
            <td class="t-mono-sm">${t.n}</td>
            <td class="t-mono-sm">${t.avgDays === null ? '—' : `${t.avgDays.toFixed(1)} d`}</td>
            <td>${t.pct === null ? '<span class="t-body-sm">—</span>'
              : `<span class="t-mono-sm">${pct(t.pct)}</span> ${bar({ value: t.pct, max: 1, tone: t.pct >= 0.9 ? 'success' : t.pct >= 0.7 ? 'warning' : 'critical', label: `${pct(t.pct)} inside SLA` })}`}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// --- shapes ------------------------------------------------------------------------

const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
const round = (n) => Math.round(n * 10) / 10;

/** A horizontal bar on a track; `max` is the value the bar fills at. */
function bar({ value, max = 1, tone = 'accent', width = 96, height = 8, label = '' }) {
  const w = Math.max(value > 0 ? 2 : 0, Math.round(clamp(value / (max || 1), 0, 1) * width));
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" style="vertical-align:middle">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${height / 2}" fill="var(--border-subtle)"></rect>
      <rect x="0" y="0" width="${w}" height="${height}" rx="${height / 2}" fill="${FILL[tone] || FILL.neutral}"></rect>
    </svg>`;
}

/** One row's segments laid end to end on a shared scale. */
function stacked(cells, max, labels, name, { width = 200, height = 10 } = {}) {
  let x = 0;
  const parts = cells.map((n, i) => {
    const w = round((n / max) * width);
    const seg = n ? `<rect x="${round(x)}" y="0" width="${w}" height="${height}" fill="${BAND_FILL[i] || FILL.neutral}"><title>${esc(name)} — ${n} at ${esc(labels[i])}</title></rect>` : '';
    x += w;
    return seg;
  });
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(name)} backlog by age" style="vertical-align:middle">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${height / 2}" fill="var(--border-subtle)"></rect>
      ${parts.join('')}
    </svg>`;
}

/** A column per day, stacked per coder, the day of month under each. */
function dayColumns(days, coders, { height = 170 } = {}) {
  const width = Math.max(320, days.length * 34);
  const top = 14;
  const base = height - 22;
  const totals = days.map((_, i) => coders.reduce((s, c) => s + c.counts[i], 0));
  const max = Math.max(1, ...totals);
  const slot = width / days.length;
  const w = Math.min(22, slot * 0.6);
  const cols = days.map((day, i) => {
    let y = base;
    const segs = coders.map((c, k) => {
      const n = c.counts[i];
      if (!n) return '';
      const h = (n / max) * (base - top);
      y -= h;
      return `<rect x="${round(i * slot + (slot - w) / 2)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="2" fill="${CODER_FILL[k % CODER_FILL.length]}">
        <title>${esc(date(day))} — ${esc(c.name)}: ${n}</title></rect>`;
    });
    return `<g>${segs.join('')}<text x="${round(i * slot + slot / 2)}" y="${base + 14}" text-anchor="middle" font-size="10" fill="var(--fg-3)">${day.slice(8)}</text></g>`;
  });
  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" preserveAspectRatio="xMidYMid meet" aria-label="Charts coded per day">
      <line x1="0" y1="${base}" x2="${width}" y2="${base}" stroke="var(--border-1)" stroke-width="1"></line>
      <text x="0" y="10" font-size="10" fill="var(--fg-3)">Peak ${max} a day</text>
      ${cols.join('')}
    </svg>`;
}

const swatch = (fill, text) =>
  `<span class="t-body-sm"><svg width="9" height="9" viewBox="0 0 9 9" role="presentation" style="vertical-align:baseline">
    <rect width="9" height="9" rx="2" fill="${fill}"></rect></svg> ${esc(text)}</span>`;

function emptyHtml(icon, title, body) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${icon}</span></div>
      <div class="state-view__title">${esc(title)}</div>
      <p class="state-view__body">${esc(body)}</p>
    </div>`;
}
