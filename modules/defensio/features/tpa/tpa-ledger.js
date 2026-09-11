// Defensio TPA ledger at #/defensio/tpa — the rail over every fee an
// administrator withheld, and three tabs: Accruals (the register, largest
// open overcharge first, with the filters and a same-administrator bulk
// dispute), Schedules (the administrators, their payer links and the
// versions of each fee schedule, append-only) and Disputes (raised,
// acknowledged, settled). A tab id after the path deep-links; an accrual id
// after /accruals opens that accrual's drawer on the tab. Reads go through
// the four TPA repositories and nowhere else.
//
// This feature also owns the amendment archive and flow and hands the mount
// over on the deeper path: anything after /tpa/amendments is theirs.

import * as accruals from '../../../../data/repositories/tpa-fee-accruals.js';
import * as amendments from '../../../../data/repositories/tpa-amendments.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, blank, railHtml, selectKpi } from './tpa-kpis.js';
import * as accrualsTab from './tab-accruals.js';
import * as schedulesTab from './tab-schedules.js';
import * as disputesTab from './tab-disputes.js';
import { openAccrualDrawer } from './accrual-drawer.js';
import { openAddTpaDialog, openRaiseDisputeDialog } from './tpa-dialogs.js';

export const meta = { title: 'TPA ledger' };

const TABS = [
  { id: 'accruals', label: 'Accruals', mod: accrualsTab },
  { id: 'schedules', label: 'Schedules', mod: schedulesTab },
  { id: 'disputes', label: 'Disputes', mod: disputesTab },
];

export async function render(mount, ctx) {
  if (ctx.params[0] === 'amendments') return (await import('./tpa-amendment.js')).render(mount, ctx);

  const res = await fetch(new URL('./tpa-ledger.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load tpa-ledger.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = {
    tab: TABS.some((t) => t.id === ctx.params[0]) ? ctx.params[0] : 'accruals',
    accruals: { ...blank(), page: 0, selected: new Set() },
    schedules: { open: new Set() },
    disputes: { q: '', tpaId: '', status: '', focus: '' },
  };
  const $ = (sel) => mount.querySelector(sel);
  let current = { id: null, api: null };

  ctx.setCrumb([{ label: 'Defensio', path: '/defensio/tpa' }, { label: 'TPA ledger' }]);

  function draw({ fresh = false } = {}) {
    const role = currentRole();
    $('#tl-metrics').innerHTML = railHtml(state.accruals, state.tab);
    $('#tl-tabs').innerHTML = TABS.map((t) => `
      <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab" aria-selected="${t.id === state.tab}" data-tab="${t.id}">${esc(t.label)}</button>`).join('');
    drawActions(role);
    const tab = TABS.find((t) => t.id === state.tab) || TABS[0];
    if (current.id === tab.id && current.api && !fresh) { current.api.redraw(); return; }
    const host = document.createElement('div');
    $('#tl-panel').replaceChildren(host);
    current = { id: tab.id, api: tab.mod.render(host, { state: state[tab.id], role, ctx, redraw: () => draw(), openAccrual: openAccrualDrawer, onSelection: () => drawActions(currentRole()) }) };
  }

  /** The header's buttons belong to the tab on screen. */
  function drawActions(role) {
    const archive = `<a class="btn btn--secondary btn--sm" href="#/defensio/tpa/amendments" title="Restate a past period, or read the amendments on file"><span class="icon icon--sm">history_edu</span>Amendments${amendments.counts().open ? ` (${amendments.counts().open})` : ''}</a>`;
    if (state.tab === 'schedules') {
      $('#tl-actions').innerHTML = `${archive}<button class="btn btn--primary btn--sm" data-act="add-tpa" title="Register an administrator and link the payers it stands in front of"><span class="icon icon--sm">add_business</span>Add administrator</button>`;
      return;
    }
    if (state.tab === 'disputes') { $('#tl-actions').innerHTML = archive; return; }
    const picked = [...state.accruals.selected].map((id) => accruals.get(id)).filter(Boolean);
    const disputable = picked.filter(accruals.isDisputable);
    const tpaIds = new Set(disputable.map((a) => a.tpaId));
    const ok = disputable.length && disputable.length === picked.length && tpaIds.size === 1;
    const title = !picked.length ? 'Tick the overcharged accruals to dispute together'
      : disputable.length !== picked.length ? 'Only overcharged accruals nobody has disputed can be raised — untick the rest'
        : tpaIds.size > 1 ? `The selection spans ${tpaIds.size} administrators — a dispute is with one` : `Dispute ${disputable.length} accrual${disputable.length === 1 ? '' : 's'} with ${accruals.tpaName(disputable[0])}`;
    $('#tl-actions').innerHTML = `${archive}<button class="btn btn--primary btn--sm" data-act="bulk-dispute"${ok ? '' : ' disabled'} title="${esc(title)}"><span class="icon icon--sm">gavel</span>Dispute selection${picked.length ? ` (${picked.length})` : ''}</button>`;
    void role;
  }

  // --- events -----------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; return draw({ fresh: true }); }
    const kpi = metricKey(e);
    if (kpi) {
      selectKpi(state.accruals, kpi);
      state.accruals.page = 0;
      state.tab = 'accruals';
      return draw({ fresh: true });
    }
    const act = e.target.closest('#tl-actions [data-act]')?.dataset.act;
    if (act === 'add-tpa') { await openAddTpaDialog(); return undefined; }
    if (act === 'bulk-dispute') {
      const done = await openRaiseDisputeDialog([...state.accruals.selected]);
      if (done) state.accruals.selected.clear();
      return undefined;
    }
    return undefined;
  });

  // A separation in Denials, a remittance posted in Claima, a version added
  // here or an amendment posted all redraw the ledger without a reload; a
  // change of demo role re-reads the masking and the gates.
  ctx.onData(() => draw());
  const offRole = onRole(() => (mount.isConnected ? draw({ fresh: true }) : offRole()));
  amendments.peersReady.then(() => { if (mount.isConnected) draw(); });

  // Deep links: /tpa/<tab>, /tpa/accruals/<id>, ?slice=&state=&tpaId=&payerId=&dispute=.
  for (const key of ['state', 'tpaId', 'payerId']) if (ctx.query?.[key]) state.accruals[key] = ctx.query[key];
  if (ctx.query?.slice && KPI[ctx.query.slice]) selectKpi(state.accruals, ctx.query.slice);
  if (ctx.query?.dispute) state.disputes.focus = ctx.query.dispute;
  if (ctx.query?.tpaId) state.disputes.tpaId = ctx.query.tpaId;
  draw({ fresh: true });
  if (state.tab === 'accruals' && ctx.params[1]) {
    if (accruals.get(ctx.params[1])) openAccrualDrawer(ctx.params[1]);
  }
}
