// Defensio denial analytics at #/defensio/analytics (and /analytics/<view>)
// — the global period, compare and payer bar, the export, and six views as
// sub-tabs: Overview, Reasons vs causes, Breakdowns, Appeal funnel,
// Governance and Misclassification. Every figure on every view is computed
// by data/engines/denial-analytics.js; a view draws what the engine hands
// it and does no arithmetic of its own. Each view carries its own caption
// naming the date boundaries its figures are read on, and every figure
// element links to the worklist holding the records behind it.

import * as engine from '../../../../data/engines/denial-analytics.js';
import * as payers from '../../../../data/repositories/payers.js';
import { esc } from '../../../../shared/format.js';
import { csvOf, download } from './analytics-format.js';

export const meta = { title: 'Denial analytics' };

const VIEWS = [
  { id: 'overview', label: 'Overview', load: () => import('./view-overview.js') },
  { id: 'reasons', label: 'Reasons vs causes', load: () => import('./view-reasons.js') },
  { id: 'breakdowns', label: 'Breakdowns', load: () => import('./view-breakdowns.js') },
  { id: 'funnel', label: 'Appeal funnel', load: () => import('./view-funnel.js') },
  { id: 'governance', label: 'Governance', load: () => import('./view-governance.js') },
  { id: 'misclassification', label: 'Misclassification', load: () => import('./view-misclass.js') },
];

export async function render(mount, ctx) {
  const res = await fetch(new URL('./denial-analytics.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load denial-analytics.html (${res.status})`);
  mount.innerHTML = await res.text();

  const $ = (sel) => mount.querySelector(sel);
  const state = {
    view: VIEWS.some((v) => v.id === ctx.params[0]) ? ctx.params[0] : 'overview',
    period: ctx.query?.period || 'last30',
    compare: ctx.query?.compare === '' || ctx.query?.compare === 'none' ? '' : 'prior',
    payerId: ctx.query?.payerId || '',
    slice: ctx.query?.slice || 'payer',
  };
  let last = { csv: null, name: 'denial-analytics.csv' };
  let drawing = 0;
  const drawn = [];

  $('#da-period').innerHTML = engine.PERIODS.map((p) => `<option value="${p.key}">${esc(p.label)}</option>`).join('');
  $('#da-payer').innerHTML = `<option value="">All payers</option>${payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;
  if (!engine.PERIODS.some((p) => p.key === state.period)) state.period = 'last30';
  $('#da-period').value = state.period;
  $('#da-compare').value = state.compare;
  $('#da-payer').value = state.payerId;

  function drawTabs() {
    $('#da-tabs').innerHTML = VIEWS.map((v) => `
      <button class="sections__tab${v.id === state.view ? ' is-active' : ''}" role="tab" aria-selected="${v.id === state.view}" data-view="${v.id}">${esc(v.label)}</button>`).join('');
  }

  async function draw() {
    const token = ++drawing;
    const range = engine.periodRange(state.period);
    const prior = state.compare ? engine.priorRange(range) : null;
    $('#da-range').textContent = `${range.from} → ${range.to}${prior ? ` · vs ${prior.from} → ${prior.to}` : ''}`;
    drawTabs();
    const view = VIEWS.find((v) => v.id === state.view) || VIEWS[0];
    const mod = await view.load();
    if (token !== drawing || !mount.isConnected) return;
    // A view draws into a scratch node and its regions are moved under the
    // shell panel as siblings, so the page rhythm spaces them the way it
    // spaces every screen; the previous view's regions leave with their
    // listeners when the next one draws.
    const host = document.createElement('div');
    const out = mod.render(host, { range, prior, period: state.period, compare: state.compare, payerId: state.payerId, slice: state.slice, setSlice: (s) => { state.slice = s; draw(); }, navigate: ctx.navigate }) || {};
    for (const node of drawn.splice(0)) node.remove();
    const caption = document.createElement('div');
    caption.innerHTML = out.caption || '';
    const nodes = [...host.children, ...(out.caption ? [caption] : [])];
    mount.append(...nodes);
    drawn.push(...nodes);
    last = { csv: out.csv || null, name: out.name || `denial-analytics-${view.id}.csv` };
  }

  for (const [key, id] of [['period', '#da-period'], ['compare', '#da-compare'], ['payerId', '#da-payer']]) {
    $(id).addEventListener('change', (e) => { state[key] = e.target.value; draw(); });
  }

  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const tab = e.target.closest('[data-view]');
    if (tab) { state.view = tab.dataset.view; return draw(); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'export') {
      if (!last.csv?.length) return;
      return download(last.name, csvOf(last.csv));
    }
    return undefined;
  });

  // A triage, a routing, a decision captured, a remittance posted or a case concluded anywhere redraws the figures.
  ctx.onData(draw);
  engine.peersReady.then(() => { if (mount.isConnected) draw(); });
  draw();
}
