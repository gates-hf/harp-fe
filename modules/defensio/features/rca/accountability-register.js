// The Defensio accountability register at #/defensio/accountability —
// authorised roles only (CONFIG.defensio.rca.accountabilityRoles); every
// other role gets the permission banner and nothing else, since the register
// is the one place names are read. The rail's five slices, search and
// filters, and a row that opens the case. This feature also owns the deeper
// link and hands the mount over on it: anything after /accountability is a
// case id.

import * as accountabilityCases from '../../../../data/repositories/accountability-cases.js';
import { STAFF } from '../../../../data/seed/staff.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, esc } from '../../../../shared/format.js';
import { metricKey, metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { appealHtml, decisionHtml, deductionHtml, personHtml, stageHtml } from './rca-chips.js';

export const meta = { title: 'Accountability' };

const PAGE_SIZE = 15;

const KPI = {
  all: { q: '', stage: '', decision: '', personId: '', deduction: '', open: false },
  open: { open: true },
  awaiting: { stage: 'Awaiting response' },
  toDecide: { stage: 'Response recorded' },
  underAppeal: { stage: 'Under appeal' },
  deductions: { deduction: 'SentToHR' },
};

export async function render(mount, ctx) {
  if (ctx.params[0]) return (await import('./accountability-case.js')).render(mount, ctx);

  const res = await fetch(new URL('./accountability-register.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load accountability-register.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...KPI.all, page: 0 };
  const $ = (sel) => mount.querySelector(sel);
  const fields = { q: $('#ac-search'), stage: $('#ac-stage'), decision: $('#ac-decision'), personId: $('#ac-person'), deduction: $('#ac-deduction') };
  fields.stage.innerHTML = `<option value="">All stages</option>${accountabilityCases.STAGES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
  fields.decision.innerHTML = `<option value="">Any decision</option>${accountabilityCases.DECISION_TYPES.map((t) => `<option value="${t}">${esc(accountabilityCases.decisionLabel(t))}</option>`).join('')}`;
  fields.personId.innerHTML = `<option value="">Anyone</option>${STAFF.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}`;
  fields.deduction.innerHTML = `<option value="">Any deduction stage</option>${accountabilityCases.DEDUCTION_STAGES.map((s) => `<option value="${s}">${esc(accountabilityCases.DEDUCTION_LABELS[s])}</option>`).join('')}`;

  const syncFilters = () => { for (const [key, el] of Object.entries(fields)) el.value = state[key] || ''; };
  const found = () => accountabilityCases.search(state.q, state).filter((a) => !state.open || accountabilityCases.isOpen(a));

  function draw() {
    const role = currentRole();
    const gate = $('#ac-gate');
    const allowed = accountabilityCases.canRead(role);
    $('#ac-metrics').hidden = !allowed;
    $('#ac-panel').hidden = !allowed;
    if (!allowed) {
      gate.innerHTML = `
        <div class="perm-banner">
          <span class="icon">lock</span>
          <div>
            <div class="title">Authorised roles only</div>
            The accountability register names people. ${esc(role.name)}’s role reads the root-cause cases with the names masked; switch to the RCM coder or the chief medical officer to open it.
          </div>
        </div>
        <div class="state-view state-view--tall">
          <div class="state-view__glyph"><span class="icon">gavel</span></div>
          <div class="state-view__title">Withheld</div>
          <p class="state-view__body">Root-cause cases are still readable — a person named on one shows as “Individual — case N”.</p>
          <div class="state-view__actions"><a class="btn btn--secondary" href="#/defensio/rca">Root-cause cases</a></div>
        </div>`;
      return;
    }
    gate.innerHTML = '';
    $('#ac-metrics').innerHTML = railHtml();
    drawBody();
  }

  function railHtml() {
    const { showing } = kpiFilter(state, KPI);
    const c = accountabilityCases.counts();
    return metricRailHtml([
      { value: c.open, label: 'Open cases', key: 'open', pressed: showing('open'), tone: c.open ? 'warning' : '', sub: `${c.total} on the register`, title: 'Cases not yet closed' },
      { value: c.awaiting, label: 'Awaiting response', key: 'awaiting', pressed: showing('awaiting'), tone: c.windowPassed ? 'critical' : c.awaiting ? 'warning' : '',
        sub: c.windowPassed ? `${c.windowPassed} past the window` : `${accountabilityCases.windowDays()}-day window`, title: 'The person has not answered and nothing has been decided' },
      { value: c.toDecide, label: 'To decide', key: 'toDecide', pressed: showing('toDecide'), tone: c.toDecide ? 'accent' : '', sub: 'response on file', title: 'Answered, or the window closed — a decision can be recorded by somebody other than the analyst' },
      { value: c.underAppeal, label: 'Under appeal', key: 'underAppeal', pressed: showing('underAppeal'), tone: c.underAppeal ? 'warning' : '', sub: 'senior review', title: 'Appeals filed and not yet reviewed' },
      { value: c.deductions, label: 'Deductions in flight', key: 'deductions', pressed: showing('deductions'), tone: c.deductions ? 'info' : '', sub: 'recommended or with HR', title: 'Deduction recommendations HR has not answered — nothing is ever posted from here' },
    ]);
  }

  function drawBody() {
    const role = currentRole();
    const rows = found();
    const body = $('#ac-body');
    const filtered = Object.keys(KPI.all).some((k) => state[k] !== KPI.all[k]);
    if (!rows.length) {
      body.innerHTML = `
        <div class="state-view">
          <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'gavel'}</span></div>
          <div class="state-view__title">${filtered ? 'Nothing matches' : 'No accountability cases'}</div>
          <p class="state-view__body">${filtered ? 'No case matches these filters.' : 'A case opens when a root-cause case concludes that one person’s act let a denial happen.'}</p>
          ${filtered ? '<div class="state-view__actions"><button class="btn btn--secondary" data-act="clear">Clear filters</button></div>' : ''}
        </div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = rows.slice(start, start + PAGE_SIZE);
    body.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th scope="col">Case</th>
            <th scope="col">RCA case</th>
            <th scope="col">Person</th>
            <th scope="col">Role in failure</th>
            <th scope="col">Stage</th>
            <th scope="col" title="The response window from the day the case opened">Window</th>
            <th scope="col">Decision</th>
            <th scope="col">Appeal</th>
            <th scope="col" title="A recommendation on its way to HR — never a posting">Deduction</th>
            <th scope="col">Opened</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>${page.map((a) => {
    const w = accountabilityCases.windowOf(a);
    return `
          <tr data-id="${esc(a.id)}" tabindex="0" title="Open ${esc(a.id)}">
            <td><a class="crumb-link t-mono-sm" href="#/defensio/accountability/${esc(a.id)}">${esc(a.id)}</a></td>
            <td><a class="crumb-link t-mono-sm" href="#/defensio/rca/${esc(a.rcaCaseId)}">${esc(a.rcaCaseId)}</a></td>
            <td>${personHtml(a.personId, a, role)}</td>
            <td><span class="t-body-sm">${esc(a.roleInFailure)}</span></td>
            <td>${stageHtml(a)}</td>
            <td>${w.answered ? `<span class="t-body-sm" title="${esc(a.employeeResponse.respondedAt ? `Responded ${date(a.employeeResponse.respondedAt)}` : `No response recorded ${date(a.employeeResponse.noResponseRecordedAt)}`)}">${a.employeeResponse.respondedAt ? 'Answered' : 'No response'}</span>`
      : `<span class="badge${w.passed ? ' badge--critical' : w.daysLeft <= 2 ? ' badge--warning' : ''}" title="${esc(`Closes ${date(w.closes)}`)}">${w.passed ? `Closed ${Math.abs(w.daysLeft)} d ago` : w.daysLeft === 0 ? 'Closes today' : `${w.daysLeft} d left`}</span>`}</td>
            <td>${decisionHtml(a)}</td>
            <td>${appealHtml(a)}</td>
            <td>${deductionHtml(a)}</td>
            <td><span class="t-body-sm">${date(a.openedAt)}</span></td>
            <td><button class="btn btn--${accountabilityCases.isOpen(a) ? 'primary' : 'secondary'} btn--sm" data-act="open" title="Open the case"><span class="icon icon--sm">${accountabilityCases.isOpen(a) ? 'gavel' : 'open_in_new'}</span>${accountabilityCases.isOpen(a) ? 'Work' : 'Open'}</button></td>
          </tr>`;
  }).join('')}</tbody>
      </table>
      <div class="tbl-foot">
        <span class="range">${start + 1}–${start + page.length} of ${rows.length}</span>
        <span class="pager">
          <button class="btn btn--secondary btn--sm" data-page="prev"${state.page === 0 ? ' disabled title="You are on the first page"' : ''}><span class="icon icon--sm">chevron_left</span>Previous</button>
          <button class="btn btn--secondary btn--sm" data-page="next"${state.page >= pages - 1 ? ' disabled title="You are on the last page"' : ''}>Next<span class="icon icon--sm">chevron_right</span></button>
        </span>
      </div>`;
  }

  // --- events -----------------------------------------------------------------

  for (const [key, el] of Object.entries(fields)) {
    el.addEventListener(key === 'q' ? 'input' : 'change', () => { state[key] = el.value; if (key === 'stage' && el.value) state.open = false; state.page = 0; draw(); });
  }

  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return undefined;
    const kpi = metricKey(e);
    if (kpi) { kpiFilter(state, KPI).select(kpi); state.page = 0; syncFilters(); return draw(); }
    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) { state.page += pager.dataset.page === 'next' ? 1 : -1; return drawBody(); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') { Object.assign(state, KPI.all, { page: 0 }); syncFilters(); return draw(); }
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return undefined;
    return ctx.navigate(`/defensio/accountability/${tr.dataset.id}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ctx.navigate(`/defensio/accountability/${tr.dataset.id}`); }
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  for (const key of ['stage', 'decision', 'personId', 'deduction']) if (ctx.query?.[key]) state[key] = ctx.query[key];
  if (ctx.query?.slice && KPI[ctx.query.slice]) kpiFilter(state, KPI).select(ctx.query.slice);
  syncFilters();
  draw();
}
