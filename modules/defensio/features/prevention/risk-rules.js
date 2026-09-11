// Defensio risk rules at #/defensio/prevention/rules — every rule with its
// hit statistics (fired, acknowledged and sent out, denied anyway, paid, the
// follow-through), its source pattern, the flags a person has to answer (a
// retirement flag on the follow-through, a suspension proposed by a faded
// pattern) and the rail's slices; New rule (written by hand), Edit,
// Suspend / Resume, Retire, Keep. Severity is shown locked on every row.
// Reads go through data/repositories/risk-rules.js and the pattern register.

import * as riskRules from '../../../../data/repositories/risk-rules.js';
import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import * as modal from '../../../../shared/modal.js';
import * as drawer from '../../../../shared/drawer.js';
import { toast } from '../../../../shared/toast.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { metricRailHtml, metricKey, kpiFilter } from '../../../../shared/metric-card.js';
import { followThroughHtml, patternStatusHtml, ruleFlagsHtml, ruleStatusHtml, severityHtml } from './prevention-chips.js';
import { openRuleEditor } from './rule-editor.js';

export const meta = { title: 'Risk rules' };

const KPI = {
  all: { q: '', status: '', source: '', patternId: '', flagged: false, proposed: false },
  active: { status: 'Active' },
  suspended: { status: 'Suspended' },
  flagged: { flagged: true },
  proposed: { proposed: true },
};

export async function render(mount, ctx) {
  const res = await fetch(new URL('./risk-rules.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load risk-rules.html (${res.status})`);
  mount.innerHTML = await res.text();
  ctx.setCrumb([{ label: 'Defensio', path: '/defensio/prevention' }, { label: 'Prevention', path: '/defensio/prevention' }, { label: 'Risk rules' }]);

  const state = { ...KPI.all };
  const $ = (sel) => mount.querySelector(sel);
  const fields = { q: $('#rr-search'), status: $('#rr-status'), source: $('#rr-source') };
  fields.status.innerHTML = `<option value="">All statuses</option>${riskRules.STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('')}`;
  const { showing, select } = kpiFilter(state, KPI);
  function syncFilters() { for (const [key, el] of Object.entries(fields)) el.value = state[key] || ''; }

  function draw() {
    const c = riskRules.counts();
    $('#rr-metrics').innerHTML = metricRailHtml([
      { value: c.active, label: 'Active', key: 'active', pressed: showing('active'), tone: c.active ? 'success' : '', sub: `${c.firedTotal} warnings raised in all`, title: 'Rules warning at the claim scrub now' },
      { value: c.suspended, label: 'Suspended', key: 'suspended', pressed: showing('suspended'), tone: c.suspended ? 'warning' : '', sub: `${c.retired} retired`, title: 'Rules paused with a reason — resumable' },
      { value: c.flagged, label: 'Retire?', key: 'flagged', pressed: showing('flagged'), tone: c.flagged ? 'critical' : '', sub: `fired ≥ ${riskRules.retireFiredAtLeast()}, follow-through < ${Math.round(riskRules.retireFollowThroughBelow() * 100)}%`, title: 'Rules that fired often and whose warnings, sent out as they were, were paid rather than denied — poor predictors' },
      { value: c.proposed, label: 'Suspend?', key: 'proposed', pressed: showing('proposed'), tone: c.proposed ? 'warning' : '', sub: 'source pattern faded', title: 'Active rules whose pattern no longer holds the threshold — suspend them, or keep them with a reason' },
    ]);
    const pattern = state.patternId ? denialPatterns.get(state.patternId) : null;
    $('#rr-banner').innerHTML = pattern ? `
      <div class="alert alert--info"><span class="icon">insights</span><div><div class="title">Rules on ${esc(pattern.id)}</div>${esc(denialPatterns.labelOf(pattern))} — ${patternStatusHtml(pattern)} <button class="btn btn--ghost btn--sm" data-act="clear-pattern">Show every rule</button></div></div>` : '';
    const rows = riskRules.search(state.q, state);
    const filtered = Object.keys(KPI.all).some((k) => state[k] !== KPI.all[k]);
    $('#rr-body').innerHTML = rows.length ? tableHtml(rows) : emptyHtml(filtered);
  }

  for (const [key, el] of Object.entries(fields)) {
    el.addEventListener(key === 'q' ? 'input' : 'change', () => {
      state[key] = el.value;
      if (key === 'status' && el.value) { state.flagged = false; state.proposed = false; }
      draw();
    });
  }

  mount.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return undefined;
    const kpi = metricKey(e);
    if (kpi) { select(kpi); syncFilters(); return draw(); }
    const btn = e.target.closest('[data-act]');
    if (!btn) return undefined;
    const act = btn.dataset.act;
    const id = btn.closest('tr[data-id]')?.dataset.id;
    if (act === 'clear') { Object.assign(state, KPI.all); syncFilters(); return draw(); }
    if (act === 'clear-pattern') { state.patternId = ''; return draw(); }
    if (act === 'new') { await openRuleEditor({}); return undefined; }
    if (act === 'edit') { await openRuleEditor({ ruleId: id }); return undefined; }
    if (act === 'suspend' || act === 'retire') { await openReasonDialog(id, act); return undefined; }
    if (act === 'resume') { const r = riskRules.resume(id); toast(r?.error || `${id} warns again`, r?.error ? 'warning' : 'success'); return undefined; }
    if (act === 'keep') { await openKeepDialog(id); return undefined; }
    if (act === 'history') { openHistory(id); return undefined; }
    return undefined;
  });

  ctx.onData(draw);
  riskRules.whenSeeded().then(() => { if (mount.isConnected) draw(); });

  // Deep links: ?status=, ?source=, ?patternId=, ?slice=.
  for (const key of ['status', 'source', 'patternId']) if (ctx.query?.[key]) state[key] = ctx.query[key];
  if (ctx.query?.slice && KPI[ctx.query.slice]) select(ctx.query.slice);
  syncFilters();
  draw();
}

function tableHtml(rows) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Rule</th>
          <th scope="col" title="The pattern it mirrors, or the reason it was written by hand">Source</th>
          <th scope="col">Conditions</th>
          <th scope="col">Message</th>
          <th scope="col">Severity</th>
          <th scope="col">Status</th>
          <th scope="col" title="Claims the rule warned on">Fired</th>
          <th scope="col" title="Warnings acknowledged and the claim sent out as it was">Sent as warned</th>
          <th scope="col" title="Of those, denied on a line the rule named">Denied anyway</th>
          <th scope="col">Paid</th>
          <th scope="col" title="Denied anyway over sent as warned">Follow-through</th>
          <th scope="col">Flags</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((r) => {
    const s = riskRules.stats(r);
    const p = r.patternId ? denialPatterns.get(r.patternId) : null;
    const flagged = riskRules.retirementFlag(r) || riskRules.suspendProposal(r);
    return `
        <tr data-id="${esc(r.id)}"${flagged ? ' aria-current="true"' : ''}>
          <td><span class="t-mono-sm">${esc(r.id)}</span><br><span class="t-body-sm">${esc(date(r.createdAt))} · ${esc(r.createdBy)}</span></td>
          <td>${p ? `<a class="badge" href="#/defensio/prevention?pattern=${esc(p.id)}" title="${esc(denialPatterns.labelOf(p))}">${esc(p.id)}</a> ${patternStatusHtml(p)}` : `<span class="badge" title="${esc(r.manual?.reason || '')}">Manual</span>`}</td>
          <td><span class="t-body-sm">${esc(riskRules.conditionsLabel(r.conditions))}</span></td>
          <td><span class="t-body-sm" title="${esc(r.message)}">${esc(r.message.length > 90 ? `${r.message.slice(0, 88)}…` : r.message)}</span></td>
          <td>${severityHtml()}</td>
          <td>${ruleStatusHtml(r)}</td>
          <td><span class="t-mono-sm">${s.fired}</span></td>
          <td><span class="t-mono-sm">${s.ackSubmitted}</span></td>
          <td><span class="t-mono-sm">${s.deniedAnyway}</span></td>
          <td><span class="t-mono-sm">${s.paid}</span></td>
          <td>${followThroughHtml(r)}</td>
          <td>${ruleFlagsHtml(r)}</td>
          <td>${r.status === 'Retired' ? '<button class="btn btn--ghost btn--sm" data-act="history" title="The trail"><span class="icon icon--sm">history</span></button>' : `
            <button class="btn btn--secondary btn--sm" data-act="edit" title="Edit the message${r.patternId ? '' : ' and the conditions'}"><span class="icon icon--sm">edit</span></button>
            ${r.status === 'Active' ? '<button class="btn btn--secondary btn--sm" data-act="suspend" title="Pause it with a reason"><span class="icon icon--sm">pause</span>Suspend</button>' : '<button class="btn btn--primary btn--sm" data-act="resume" title="Warn again"><span class="icon icon--sm">play_arrow</span>Resume</button>'}
            ${riskRules.suspendProposal(r) ? '<button class="btn btn--secondary btn--sm" data-act="keep" title="Keep it although the pattern faded"><span class="icon icon--sm">push_pin</span>Keep</button>' : ''}
            <button class="btn btn--${riskRules.retirementFlag(r) ? 'danger' : 'ghost'} btn--sm" data-act="retire" title="Retire it for good, with a reason"><span class="icon icon--sm">archive</span>Retire</button>
            <button class="btn btn--ghost btn--sm" data-act="history" title="The trail"><span class="icon icon--sm">history</span></button>`}</td>
        </tr>`;
  }).join('')}</tbody>
    </table>`;
}

function emptyHtml(filtered) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'rule'}</span></div>
      <div class="state-view__title">${filtered ? 'Nothing matches' : 'No risk rule yet'}</div>
      <p class="state-view__body">${filtered ? 'No rule matches these filters. Clear them to see the whole list.' : 'Write one from a pattern on the prevention dashboard, or by hand here.'}</p>
      <div class="state-view__actions">${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : '<button class="btn btn--primary" data-act="new">New rule</button>'}</div>
    </div>`;
}

async function openReasonDialog(id, act) {
  const r = riskRules.get(id);
  if (!r) return undefined;
  const retire = act === 'retire';
  const flagged = riskRules.retirementFlag(r);
  const dialog = modal.open({
    title: `${retire ? 'Retire' : 'Suspend'} ${id}`, sub: riskRules.conditionsLabel(r.conditions), icon: retire ? 'archive' : 'pause', size: 'sm', tone: retire ? 'critical' : 'warning',
    body: `
      ${flagged && retire ? `<div class="alert alert--critical"><span class="icon">error</span><div>Fired ${riskRules.stats(r).fired} times; ${riskRules.stats(r).deniedAnyway} of the ${riskRules.stats(r).ackSubmitted} claims sent out over the warning were denied. A poor predictor.</div></div>` : ''}
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="rs-reason" rows="2" placeholder="${retire ? 'Why it is retired for good' : 'Why it is paused'}" aria-label="Reason" maxlength="300"></textarea></label>
      <div id="rs-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn ${retire ? 'btn--danger' : 'btn--primary'}" id="rs-save">${retire ? 'Retire' : 'Suspend'}</button>`,
  });
  dialog.el.querySelector('#rs-save').addEventListener('click', () => {
    const reason = dialog.el.querySelector('#rs-reason').value;
    const out = retire ? riskRules.retire(id, reason) : riskRules.suspend(id, reason);
    if (out?.error) { dialog.el.querySelector('#rs-error').innerHTML = `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(out.error)}</div></div>`; return; }
    toast(`${id} ${retire ? 'retired' : 'suspended'}`);
    dialog.close(true);
  });
  return dialog.closed;
}

async function openKeepDialog(id) {
  const r = riskRules.get(id);
  const proposal = riskRules.suspendProposal(r);
  if (!proposal) return toast('Nothing proposed on this rule', 'warning');
  const dialog = modal.open({
    title: `Keep ${id}`, sub: proposal.reason, icon: 'push_pin', size: 'sm',
    body: '<p class="modal__lede">The pattern behind this rule faded. Keeping the rule leaves it warning until the pattern fades again.</p><label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="rk-note" rows="2" placeholder="Why it stays (optional)" aria-label="Note" maxlength="300"></textarea></label>',
    foot: '<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="rk-save">Keep</button>',
  });
  dialog.el.querySelector('#rk-save').addEventListener('click', () => {
    const out = riskRules.keepDespiteFade(id, dialog.el.querySelector('#rk-note').value);
    toast(out?.error || `${id} kept`, out?.error ? 'warning' : 'success');
    dialog.close(true);
  });
  return dialog.closed;
}

const TONE = { Created: 'accent', Updated: '', Suspended: 'warning', Resumed: 'success', Retired: 'critical', Kept: 'info', Flagged: 'critical' };
function openHistory(id) {
  const r = riskRules.get(id);
  const entries = riskRules.history(id);
  const hits = (r?.hits || []).slice().sort((a, b) => String(b.firedAt).localeCompare(String(a.firedAt)));
  drawer.open({
    title: `${id} — history`, sub: riskRules.conditionsLabel(r?.conditions), icon: 'history',
    body: `
      ${entries.length ? `<ol class="journey">${entries.map((e) => `
        <li class="journey__row">
          <span class="journey__at t-mono-sm">${dateTime(e.at)}</span>
          <span class="journey__action"><span class="badge${TONE[e.action] ? ` badge--${TONE[e.action]}` : ''}">${esc(e.action)}</span></span>
          <span class="journey__actor">${esc(e.user || '')}</span>
          <span class="journey__detail">${esc(e.details || '')}</span>
        </li>`).join('')}</ol>` : '<p class="t-body-sm">No trail.</p>'}
      <div class="toolbar"><span class="t-title-sm">Live hits</span><span class="badge">${hits.length}</span><span class="spacer"></span><span class="t-body-sm">Claims the rule warned on since it was written; the counters above them carry the history before.</span></div>
      ${hits.length ? `<table class="tbl"><thead><tr><th scope="col">Claim</th><th scope="col">Fired</th><th scope="col">Acknowledged</th><th scope="col">Sent</th><th scope="col">Outcome</th></tr></thead><tbody>${hits.map((h) => `
        <tr><td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(h.claimNo || '')}/scrub">${esc(h.claimNo || h.claimId)}</a></td><td><span class="t-body-sm">${dateTime(h.firedAt)}</span></td><td>${h.acknowledged ? `<span class="badge badge--info">${esc(date(h.acknowledgedAt))}</span>` : '<span class="t-body-sm">—</span>'}</td><td>${h.submitted ? '<span class="badge">sent</span>' : '<span class="t-body-sm">—</span>'}</td><td>${h.outcome ? `<span class="badge badge--${h.outcome === 'denied' ? 'critical' : 'success'}" title="${esc(h.remittanceNo || '')}">${esc(h.outcome)}</span>` : '<span class="t-body-sm">open</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="t-body-sm">None yet.</p>'}`,
  });
}
