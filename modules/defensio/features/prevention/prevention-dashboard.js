// Defensio prevention dashboard at #/defensio/prevention — the rail, the
// prevention feed (Zone A: ranked causes with the No-plan flag, each row
// opening a plan prefilled with the cause), the pattern alerts (Zone B: the
// table with its filters and the rail's slices; acknowledge, plan, rule,
// view denials on each row, the drawer on the row itself) and the plans
// summary (Zone C, overdue actions highlighted). Reads go through the three
// repositories and nowhere else. This feature also owns the deeper links and
// hands the mount over on them: /prevention/plans/new and /plans/<id> to the
// plan page, /prevention/rules to the rules screen.

import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import * as preventionPlans from '../../../../data/repositories/prevention-plans.js';
import * as riskRules from '../../../../data/repositories/risk-rules.js';
import * as payers from '../../../../data/repositories/payers.js';
import { subscribe as onRole } from '../../../../shared/roles.js';
import { esc, usd } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { toast } from '../../../../shared/toast.js';
import { KPI, blank, railHtml, selectKpi } from './prevention-kpis.js';
import { feedHtml, patternsHtml, plansHtml } from './prevention-zones.js';
import { openAcknowledgeDialog, openPatternDrawer } from './pattern-actions.js';
import { openRuleEditor } from './rule-editor.js';

export const meta = { title: 'Prevention' };

export async function render(mount, ctx) {
  if (ctx.params[0] === 'plans') return (await import('./prevention-plan.js')).render(mount, ctx);
  if (ctx.params[0] === 'rules') return (await import('./risk-rules.js')).render(mount, ctx);

  const res = await fetch(new URL('./prevention-dashboard.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load prevention-dashboard.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = blank();
  const $ = (sel) => mount.querySelector(sel);
  const fields = { q: $('#pv-search'), status: $('#pv-status'), payerId: $('#pv-payer'), causeId: $('#pv-cause'), level: $('#pv-level') };
  fields.status.innerHTML = `<option value="">All statuses</option>${denialPatterns.STATUSES.map((s) => `<option value="${s}">${esc(denialPatterns.statusLabel(s))}</option>`).join('')}`;
  fields.payerId.innerHTML = `<option value="">Any payer</option>${payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;
  fields.causeId.innerHTML = `<option value="">Any cause</option>${denialPatterns.groupedRootCauses().map((g) => `<optgroup label="${esc(g.group)}">${g.causes.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</optgroup>`).join('')}`;
  fields.level.innerHTML = `<option value="">Any level</option>${denialPatterns.LEVELS.map((l) => `<option value="${l}">${esc(denialPatterns.LEVEL_LABELS[l])}</option>`).join('')}`;

  function syncFilters() { for (const [key, el] of Object.entries(fields)) el.value = state[key] || ''; }
  const filtered = () => Object.keys(KPI.all).some((k) => state[k] !== KPI.all[k]);

  function draw() {
    $('#pv-metrics').innerHTML = railHtml(state);
    const causes = denialPatterns.rankedCauses();
    const flagged = causes.filter((c) => c.noPlanFlag).length;
    $('#pv-feed-sub').textContent = `${causes.length} cause${causes.length === 1 ? '' : 's'} in the last ${denialPatterns.windowDays()} days · ${flagged ? `${flagged} worth ${usd(denialPatterns.noPlanFlagValue())} or more with no plan` : 'every cause over the flag value has a plan'}`;
    $('#pv-feed').innerHTML = feedHtml(causes);
    $('#pv-patterns').innerHTML = patternsHtml(denialPatterns.search(state.q, state), filtered());
    const plans = preventionPlans.search('', {});
    const c = preventionPlans.counts();
    $('#pv-plans-sub').textContent = `${c.inForce} in force · ${c.byStatus.Draft} draft · ${c.byStatus.ClosedEffective + c.byStatus.ClosedPartial + c.byStatus.ClosedIneffective} closed`;
    $('#pv-plans').innerHTML = plansHtml(plans);
  }

  // --- events -----------------------------------------------------------------

  for (const [key, el] of Object.entries(fields)) {
    el.addEventListener(key === 'q' ? 'input' : 'change', () => {
      state[key] = el.value;
      if (key === 'status' && el.value) { state.active = false; state.attention = false; }
      draw();
    });
  }

  mount.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return undefined;
    const kpi = metricKey(e);
    if (kpi === 'plans') {
      const panel = $('#pv-plans-panel');
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return undefined;
    }
    if (kpi) { selectKpi(state, kpi); syncFilters(); return draw(); }
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    const row = e.target.closest('tr[data-id]');
    const id = row?.dataset.id;
    if (act === 'clear') { Object.assign(state, blank()); syncFilters(); return draw(); }
    if (act === 'new-plan') return ctx.navigate('/defensio/prevention/plans/new');
    if (act === 'plan-cause') return ctx.navigate(`/defensio/prevention/plans/new?cause=${encodeURIComponent(btn.dataset.id)}`);
    if (act === 'acknowledge' && id) { await openAcknowledgeDialog(id); return undefined; }
    if (act === 'plan-pattern' && id) return ctx.navigate(`/defensio/prevention/plans/new?pattern=${encodeURIComponent(id)}`);
    if (act === 'rule-pattern' && id) { await openRuleEditor({ patternId: id }); return undefined; }
    if (act) return undefined;
    const planRow = e.target.closest('tr[data-plan]');
    if (planRow) return ctx.navigate(`/defensio/prevention/plans/${planRow.dataset.plan}`);
    if (row && id) return openDrawer(id);
    return undefined;
  });

  mount.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('tr[data-id], tr[data-plan]');
    if (!row || e.target !== row) return;
    e.preventDefault();
    if (row.dataset.plan) ctx.navigate(`/defensio/prevention/plans/${row.dataset.plan}`);
    else openDrawer(row.dataset.id);
  });

  async function openDrawer(id) {
    const result = await openPatternDrawer(id);
    if (result === 'acknowledge') await openAcknowledgeDialog(id);
    else if (result === 'plan') ctx.navigate(`/defensio/prevention/plans/new?pattern=${encodeURIComponent(id)}`);
    else if (result === 'rule') await openRuleEditor({ patternId: id });
  }

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  for (const p of [denialPatterns.whenSeeded(), preventionPlans.whenSeeded(), riskRules.whenSeeded()]) p.then(() => { if (mount.isConnected) draw(); });

  // Deep links: ?status=, ?payerId=, ?causeId=, ?level=, ?slice=, ?pattern= (opens the drawer).
  for (const key of ['status', 'payerId', 'causeId', 'level']) if (ctx.query?.[key]) state[key] = ctx.query[key];
  if (ctx.query?.slice && KPI[ctx.query.slice]) selectKpi(state, ctx.query.slice);
  syncFilters();
  draw();
  if (ctx.query?.pattern) {
    if (denialPatterns.get(ctx.query.pattern)) openDrawer(ctx.query.pattern);
    else toast(`${ctx.query.pattern} is not a pattern on the register`, 'warning');
  }
}
