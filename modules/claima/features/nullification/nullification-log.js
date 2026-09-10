// Nullification log at #/claima/nullifications — every claim withdrawn, why,
// by which path, what happened to its charges and what replaced it. The rail
// is month to date: count and value select this month's rows, the
// replacement rate selects the records with a replacement, and the top reason
// selects that reason — so each card's number is the row count (or sum)
// under it. Immutable: nothing on this screen writes. It hands the mount
// over to the record page on the deeper path.

import * as nullifications from '../../../../data/repositories/nullifications.js';
import * as payers from '../../../../data/repositories/payers.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc, todayIso, usd } from '../../../../shared/format.js';
import { metricRailHtml, metricKey, kpiFilter } from '../../../../shared/metric-card.js';
import { csvOf, download, emptyHtml, tableHtml } from './nullification-rows.js';

export const meta = { title: 'Nullifications' };

const PAGE_SIZE = 15;

const blank = () => ({ q: '', reasonCode: '', path: '', disposition: '', payerId: '', from: '', to: '', replacement: '' });

export async function render(mount, ctx) {
  if (ctx.params[0]) return (await import('./nullification-view.js')).render(mount, ctx);

  const res = await fetch(new URL('./nullification-log.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load nullification-log.html (${res.status})`);
  mount.innerHTML = await res.text();
  await nullifications.ready;
  if (!mount.isConnected) return;

  ctx.setCrumb([
    { label: 'Claima', path: '/claima/nullifications' },
    { label: 'Nullifications' },
  ]);

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);
  const controls = {
    q: $('#nl-search'), reasonCode: $('#nl-reason'), path: $('#nl-path'), disposition: $('#nl-disposition'),
    payerId: $('#nl-payer'), replacement: $('#nl-replacement'), from: $('#nl-from'), to: $('#nl-to'),
  };

  controls.reasonCode.innerHTML = `<option value="">Any reason</option>${
    nullifications.NULLIFICATION_REASONS.map((r) => `<option value="${esc(r.code)}">${esc(r.code)} — ${esc(r.label)}</option>`).join('')}`;
  controls.path.innerHTML = `<option value="">Any path</option>${
    nullifications.PATHS.map((p) => `<option value="${esc(p)}">${esc(nullifications.PATH_LABELS[p])}</option>`).join('')}`;
  controls.disposition.innerHTML = `<option value="">Any disposition</option>${
    nullifications.DISPOSITIONS.map((d) => `<option value="${esc(d)}">${esc(nullifications.DISPOSITION_LABELS[d])}</option>`).join('')}`;
  controls.payerId.innerHTML = `<option value="">Any payer</option>${
    payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;

  /** The card slices. The top reason's slice is computed at draw time, since the reason moves with the data. */
  const kpiMap = () => {
    const mtd = nullifications.stats({ from: nullifications.monthStart() });
    const overall = nullifications.stats();
    return {
      all: blank(),
      mtd: { from: nullifications.monthStart(), to: todayIso() },
      value: { from: nullifications.monthStart(), to: todayIso() },
      replaced: { replacement: '1' },
      reason: overall.topReason ? { reasonCode: overall.topReason.code } : {},
      _mtd: mtd,
      _overall: overall,
    };
  };

  const found = () => nullifications.log(state.q, state);

  function syncFilters() {
    for (const [key, el] of Object.entries(controls)) el.value = state[key];
  }

  function draw() {
    const role = currentRole();
    const rows = found();
    $('#nl-metrics').innerHTML = railHtml();
    $('#nl-count').textContent = String(rows.length);
    const body = $('#nl-body');
    if (!rows.length) {
      body.innerHTML = emptyHtml(Object.keys(blank()).some((k) => state[k]));
      return;
    }
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = rows.slice(start, start + PAGE_SIZE);
    body.innerHTML = `
      ${tableHtml(page, role)}
      <div class="tbl-foot">
        <span class="range">${start + 1}–${start + page.length} of ${rows.length}</span>
        <span class="pager">
          <button class="btn btn--secondary btn--sm" data-page="prev"${state.page === 0 ? ' disabled title="You are on the first page"' : ''}>
            <span class="icon icon--sm">chevron_left</span>Previous
          </button>
          <button class="btn btn--secondary btn--sm" data-page="next"${state.page >= pages - 1 ? ' disabled title="You are on the last page"' : ''}>
            Next<span class="icon icon--sm">chevron_right</span>
          </button>
        </span>
      </div>`;
  }

  function railHtml() {
    const map = kpiMap();
    const { showing } = kpiFilter(state, map);
    const mtd = map._mtd;
    const overall = map._overall;
    const pct = Math.round(overall.replacementRate * 100);
    return metricRailHtml([
      { value: mtd.count, label: 'Nullified this month', key: 'mtd', pressed: showing('mtd'),
        sub: `${overall.count} all time`, title: 'Claims withdrawn since the first of the month — selects this month’s rows' },
      { value: usd(mtd.value), label: 'Value this month', key: 'value', pressed: showing('value'), tone: mtd.value ? 'warning' : '',
        sub: 'payer share at nullification', title: 'What the withdrawn claims billed their payers, month to date — the same rows as the count' },
      { value: `${pct}%`, label: 'Replacement rate', key: 'replaced', pressed: showing('replaced'),
        sub: `${overall.replaced} of ${overall.count} replaced`, title: 'The share of nullified claims a fresh claim was assembled for — selects those records' },
      overall.topReason
        ? { value: overall.topReason.code, label: `Top reason: ${overall.topReason.label}`, key: 'reason', pressed: showing('reason'), text: true,
          sub: `${overall.topReason.count} record${overall.topReason.count === 1 ? '' : 's'}`, title: `${overall.topReason.label} — the most used reason — selects its records` }
        : { value: '—', label: 'Top reason', text: true, sub: 'nothing nullified yet' },
    ]);
  }

  // --- events -----------------------------------------------------------------

  controls.q.addEventListener('input', () => { state.q = controls.q.value; state.page = 0; draw(); });
  for (const key of ['reasonCode', 'path', 'disposition', 'payerId', 'replacement', 'from', 'to']) {
    controls[key].addEventListener('change', () => { state[key] = controls[key].value; state.page = 0; syncFilters(); draw(); });
  }
  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const kpi = metricKey(e);
    if (kpi) {
      kpiFilter(state, kpiMap()).select(kpi);
      state.page = 0;
      syncFilters();
      return draw();
    }
    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      return draw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') {
      Object.assign(state, blank(), { page: 0 });
      syncFilters();
      return draw();
    }
    if (act === 'export') {
      const rows = found();
      download(`nullifications-${todayIso()}.csv`, csvOf(rows, currentRole()));
    }
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  for (const key of Object.keys(blank())) if (ctx.query?.[key] !== undefined) state[key] = ctx.query[key];
  syncFilters();
  draw();
}
