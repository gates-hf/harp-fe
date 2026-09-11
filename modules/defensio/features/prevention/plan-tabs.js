// The tabs of the prevention-plan page, each drawn into a node of its own
// with its own listener: Targets (add or remove while a draft — frozen with
// the baseline after), Actions (the plan's own, the rules it names, the ones
// adopted from a root-cause case with their status read from there; done,
// reopen, evidence; the done-without-evidence warning), Evidence (on the
// plan itself), Measurement (baseline against measured, the verdict, the
// prevented estimate, the decision an ineffective plan made) and History.

import * as preventionPlans from '../../../../data/repositories/prevention-plans.js';
import * as riskRules from '../../../../data/repositories/risk-rules.js';
import { staffName } from '../../../../data/seed/staff.js';
import { toast } from '../../../../shared/toast.js';
import { date, dateTime, esc, fileSize, usd } from '../../../../shared/format.js';
import { verdictHtml } from './prevention-chips.js';
import { openTargetPicker, openAdoptPicker } from './plan-pickers.js';
import { openActionDialog, openActionNoteDialog, openEvidenceDialog } from './plan-dialogs.js';

// --- Targets ----------------------------------------------------------------------------

export function renderTargets(host, { id }) {
  const plan = preventionPlans.get(id);
  const draft = plan.status === 'Draft';
  const facts = preventionPlans.targetFacts(plan);
  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Targets</span><span class="badge">${plan.targets.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${draft ? 'What the plan is meant to stop — frozen with the baseline at activation.' : 'Frozen with the baseline at activation.'} ${facts.length} denial${facts.length === 1 ? '' : 's'} on the register match.</span>
      ${draft ? '<button class="btn btn--primary btn--sm" data-act="add-target"><span class="icon icon--sm">add</span>Add target</button>' : ''}
    </div>
    ${plan.targets.length ? `
    <table class="tbl">
      <thead><tr><th scope="col">Type</th><th scope="col">Target</th><th scope="col"></th></tr></thead>
      <tbody>${plan.targets.map((t, i) => {
    const href = preventionPlans.targetHref(t);
    return `
        <tr>
          <td><span class="badge">${esc(preventionPlans.TARGET_LABELS[t.type] || t.type)}</span></td>
          <td>${href ? `<a class="crumb-link" href="${esc(href)}">${esc(preventionPlans.targetLabel(t))}</a>` : esc(preventionPlans.targetLabel(t))}<br><span class="t-mono-sm">${esc(t.ref)}</span></td>
          <td>${draft ? `<button class="btn btn--ghost btn--sm" data-act="remove-target" data-index="${i}" title="Remove"><span class="icon icon--sm">close</span></button>` : ''}</td>
        </tr>`;
  }).join('')}</tbody>
    </table>` : `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">ads_click</span></div>
      <div class="state-view__title">No target yet</div>
      <p class="state-view__body">A pattern, a root cause, or a corrective action a root-cause case raised. The baseline and the measurement count their denials.</p>
      ${draft ? '<div class="state-view__actions"><button class="btn btn--primary" data-act="add-target">Add target</button></div>' : ''}
    </div>`}`;
  host.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'add-target') {
      const t = await openTargetPicker({ picked: preventionPlans.get(id).targets });
      if (!t) return;
      const r = preventionPlans.addTarget(id, t);
      if (r?.error) toast(r.error, 'warning'); else toast('Target added');
    }
    if (btn.dataset.act === 'remove-target') {
      const r = preventionPlans.removeTarget(id, Number(btn.dataset.index));
      if (r?.error) toast(r.error, 'warning');
    }
  });
}

// --- Actions ----------------------------------------------------------------------------

export function renderActions(host, { id }) {
  const plan = preventionPlans.get(id);
  const rows = plan.actions || [];
  const editable = ['Draft', 'Active'].includes(plan.status);
  const done = rows.filter(preventionPlans.actionDone).length;
  const bare = rows.filter(preventionPlans.doneWithoutEvidence);
  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Actions</span><span class="badge">${rows.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${rows.length ? `${done} of ${rows.length} done${done === rows.length && plan.status === 'Active' ? ' — measurement can start' : ''}` : 'Activation needs one; measurement starts once every one is done.'}</span>
      ${editable ? `
      <button class="btn btn--secondary btn--sm" data-act="adopt" title="Link an action a concluded root-cause case raised — its status is read from there"><span class="icon icon--sm">link</span>Adopt from RCA</button>
      <button class="btn btn--primary btn--sm" data-act="raise"><span class="icon icon--sm">add</span>Raise action</button>` : ''}
    </div>
    ${bare.length ? `<div class="alert alert--warning"><span class="icon">priority_high</span><div>${bare.map((a) => esc(a.id)).join(', ')} ${bare.length === 1 ? 'was' : 'were'} marked done with no evidence attached.</div></div>` : ''}
    ${rows.length ? `
    <table class="tbl">
      <thead><tr><th scope="col">Action</th><th scope="col">Kind</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col">Evidence</th><th scope="col">Actions</th></tr></thead>
      <tbody>${rows.map((a) => rowHtml(plan, a, editable)).join('')}</tbody>
    </table>` : `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">build</span></div>
      <div class="state-view__title">No action yet</div>
      <p class="state-view__body">What changes so the pattern stops — a configuration, a training, a process, a risk rule at the scrub, or an action a root-cause case already raised.</p>
      ${editable ? '<div class="state-view__actions"><button class="btn btn--primary" data-act="raise">Raise action</button></div>' : ''}
    </div>`}`;
  host.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const actionId = btn.closest('tr[data-id]')?.dataset.id;
    if (act === 'raise') return openActionDialog(id);
    if (act === 'edit') return openActionDialog(id, actionId);
    if (act === 'adopt') {
      const ref = await openAdoptPicker({ adopted: preventionPlans.get(id).actions.map((x) => x.f2ActionRef).filter(Boolean) });
      if (!ref) return undefined;
      const r = preventionPlans.adoptF2Action(id, ref);
      return toast(r?.error || `${ref} adopted`, r?.error ? 'warning' : 'success');
    }
    if (act === 'remove') { const r = preventionPlans.removeAction(id, actionId); return toast(r?.error || `${actionId} removed`, r?.error ? 'warning' : 'success'); }
    if (act === 'done' || act === 'reopen') return openActionNoteDialog(id, actionId, act);
    if (act === 'evidence') return openEvidenceDialog(id, actionId);
    return undefined;
  });
}

function rowHtml(plan, a, editable) {
  const status = preventionPlans.actionStatus(a);
  const isDone = preventionPlans.actionDone(a);
  const overdue = preventionPlans.isOverdue(a);
  const f2 = a.kind === 'f2Action' ? preventionPlans.f2ActionOf(a) : null;
  const rule = a.kind === 'riskRule' && a.riskRuleRef ? riskRules.get(a.riskRuleRef) : null;
  const targetHref = a.targetRef && String(a.targetRef).startsWith('#/') ? a.targetRef : null;
  const tone = status === 'Verified' ? 'success' : status === 'Done' ? 'info' : 'warning';
  return `
    <tr data-id="${esc(a.id)}"${overdue ? ' aria-current="true"' : ''}>
      <td><span class="t-mono-sm">${esc(a.id)}</span><br>${esc(a.text || f2?.action || '')}${a.targetRef ? `<br>${targetHref ? `<a class="crumb-link t-mono-sm" href="${esc(targetHref)}" title="Open where the change is made">${esc(a.targetRef)}</a>` : `<span class="t-body-sm">${esc(a.targetRef)}</span>`}` : ''}${rule ? `<br><a class="crumb-link t-mono-sm" href="#/defensio/prevention/rules?patternId=${esc(rule.patternId || '')}" title="${esc(rule.message)}">${esc(rule.id)} · ${esc(rule.status)}</a>` : ''}</td>
      <td><span class="badge" title="${esc(preventionPlans.ACTION_KIND_LABELS[a.kind] || a.kind)}">${esc(a.kind === 'own' ? preventionPlans.actionTypeLabel(a.type) : preventionPlans.ACTION_KIND_LABELS[a.kind])}</span>${f2 ? `<br><a class="crumb-link t-mono-sm" href="#/defensio/rca/${esc(f2.rcaCaseId)}/actions" title="The root-cause case the action belongs to">${esc(f2.id)} · ${esc(f2.rcaCaseId)}</a>` : a.kind === 'f2Action' ? '<br><span class="t-body-sm">not resolved yet</span>' : ''}</td>
      <td>${esc(staffName(a.ownerId || f2?.ownerId))}</td>
      <td>${a.dueDate || f2?.dueDate ? `<span class="badge${overdue ? ' badge--critical' : ''}" title="${esc(overdue ? 'Past due and still open' : `Due ${date(a.dueDate || f2?.dueDate)}`)}">${date(a.dueDate || f2?.dueDate)}</span>` : '<span class="t-body-sm">—</span>'}</td>
      <td><span class="badge badge--${tone}" title="${esc(a.kind === 'f2Action' ? `Read from the root-cause case${f2?.verifiedAt ? ` — verified ${date(f2.verifiedAt)} by ${f2.verifiedBy}` : f2?.doneAt ? ` — done ${date(f2.doneAt)}` : ''}` : isDone ? `Done ${date(a.doneAt)} by ${a.doneBy}${a.doneNote ? ` — ${a.doneNote}` : ''}` : 'Open')}"><span class="dot"></span>${esc(status)}</span>${a.kind === 'f2Action' ? '<br><span class="t-body-sm">read from RCA</span>' : ''}</td>
      <td>${a.kind === 'f2Action' ? (f2?.attachments?.length ? f2.attachments.map((d) => `<span class="t-body-sm">${esc(d.fileName)}</span>`).join('<br>') : '<span class="t-body-sm">on the case</span>')
    : (a.evidence || []).length ? a.evidence.map((ev) => `<span class="t-body-sm" title="${esc(`${ev.by} · ${dateTime(ev.at)}`)}">${ev.kind === 'file' ? `${esc(ev.fileName)} (${fileSize(ev.size)})` : esc(ev.text)}</span>`).join('<br>')
      : `<span class="badge${isDone ? ' badge--warning' : ''}" title="${isDone ? 'Done with nothing attached' : 'Nothing attached yet'}">none</span>`}</td>
      <td>${a.kind === 'f2Action' ? `${editable ? '<button class="btn btn--ghost btn--sm" data-act="remove" title="Drop the adoption — the action stays on its case"><span class="icon icon--sm">link_off</span></button>' : '<span class="t-body-sm">—</span>'}`
    : `${!isDone && editable ? '<button class="btn btn--secondary btn--sm" data-act="edit" title="Edit"><span class="icon icon--sm">edit</span></button><button class="btn btn--primary btn--sm" data-act="done" title="Mark done"><span class="icon icon--sm">check</span>Done</button>' : ''}
      ${isDone && ['Draft', 'Active'].includes(plan.status) ? '<button class="btn btn--secondary btn--sm" data-act="reopen" title="Reopen with a reason"><span class="icon icon--sm">undo</span>Reopen</button>' : ''}
      ${preventionPlans.isOpen(plan) ? '<button class="btn btn--ghost btn--sm" data-act="evidence" title="Attach a note or a file"><span class="icon icon--sm">attach_file</span></button>' : ''}
      ${!isDone && editable ? '<button class="btn btn--ghost btn--sm" data-act="remove" title="Remove"><span class="icon icon--sm">close</span></button>' : ''}`}</td>
    </tr>`;
}

// --- Evidence ---------------------------------------------------------------------------

export function renderEvidence(host, { id }) {
  const plan = preventionPlans.get(id);
  const rows = plan.planEvidence || [];
  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Plan evidence</span><span class="badge">${rows.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">What shows the plan as a whole did what it says — an action's own evidence sits on the action.</span>
      ${preventionPlans.isOpen(plan) ? '<button class="btn btn--primary btn--sm" data-act="evidence"><span class="icon icon--sm">attach_file</span>Attach</button>' : ''}
    </div>
    ${rows.length ? `<table class="tbl"><thead><tr><th scope="col">Kind</th><th scope="col">Evidence</th><th scope="col">By</th><th scope="col">When</th></tr></thead><tbody>${rows.map((ev) => `
      <tr><td><span class="badge">${esc(ev.kind)}</span></td><td>${ev.kind === 'file' ? `${esc(ev.fileName)} <span class="t-body-sm">(${fileSize(ev.size)})</span>` : esc(ev.text)}</td><td>${esc(ev.by)}</td><td><span class="t-body-sm">${dateTime(ev.at)}</span></td></tr>`).join('')}</tbody></table>`
    : '<p class="t-body-sm">Nothing attached to the plan itself yet.</p>'}`;
  host.addEventListener('click', (e) => { if (e.target.closest('[data-act="evidence"]')) openEvidenceDialog(id, null); });
}

// --- Measurement ------------------------------------------------------------------------

export function renderMeasurement(host, { id }) {
  const plan = preventionPlans.get(id);
  const b = plan.baseline;
  const m = plan.measurement || {};
  const r = m.result;
  const w = preventionPlans.windowOf(plan);
  const left = preventionPlans.daysLeft(plan);
  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Measurement</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${m.startedAt ? `Window ${esc(date(w.from))} – ${esc(date(w.to))} (${w.days} days)${plan.status === 'InMeasurement' ? left < 0 ? ' — passed; close the plan on the verdict' : ` — ${left} day${left === 1 ? '' : 's'} left` : ''}` : 'Starts once the plan is active and every action is done.'}</span>
      ${plan.status === 'InMeasurement' ? '<button class="btn btn--secondary btn--sm" data-act="measure" title="Read the register again"><span class="icon icon--sm">refresh</span>Recompute</button>' : ''}
    </div>
    <div class="metric-rail metric-rail--3">
      <div class="metric-rail-card" title="${esc(b ? `Frozen ${date(b.computedAt)} over the ${b.windowDays} days before — ${b.note || ''}` : 'Frozen when the plan is activated')}">
        <span class="metric-rail-card__value">${b ? esc(usd(b.value)) : '—'}</span><span class="metric-rail-card__label">Baseline</span><span class="metric-rail-card__sub">${b ? `${b.count} denial${b.count === 1 ? '' : 's'} to ${esc(date(b.to))} · frozen` : 'not frozen yet'}</span></div>
      <div class="metric-rail-card${r ? ` metric-rail-card--${preventionPlans.verdictTone(r.verdict)}` : ''}" title="${esc(r ? `What the targets drew from ${date(r.from)} to ${date(r.to)}` : 'What the targets draw once measurement starts')}">
        <span class="metric-rail-card__value">${r ? esc(usd(r.value)) : '—'}</span><span class="metric-rail-card__label">Measured</span><span class="metric-rail-card__sub">${r ? `${r.count} denial${r.count === 1 ? '' : 's'} · ${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}% on value` : 'not started'}</span></div>
      <div class="metric-rail-card${r?.prevented?.value ? ' metric-rail-card--success' : ''}" title="Baseline less measured, never below zero — the register never learns what would have been denied, so this is an estimate and is written to no ledger">
        <span class="metric-rail-card__value">${r ? esc(usd(r.prevented.value)) : '—'}</span><span class="metric-rail-card__label">Prevented (${esc(preventionPlans.ESTIMATE_LABEL)})</span><span class="metric-rail-card__sub">${r ? `${r.prevented.count} fewer denial${r.prevented.count === 1 ? '' : 's'} than the baseline` : 'estimate'}</span></div>
    </div>
    <dl class="dl dl--narrow">
      <dt>Verdict</dt><dd>${r ? `${verdictHtml(r)} <span class="t-body-sm">effective at or below ${preventionPlans.effectiveBelowPct()}% of the baseline value${r.complete ? '' : ' — provisional while the window runs'}</span>` : '<span class="t-body-sm">—</span>'}</dd>
      ${m.closedAt ? `<dt>Closed</dt><dd>${esc(dateTime(m.closedAt))} <span class="t-body-sm">by ${esc(m.closedBy || '')}</span></dd>` : ''}
      ${m.decision ? `<dt>${m.decision.kind === 'reopen' ? 'Reopened' : 'Escalated'}</dt><dd>${m.decision.ref ? `<a class="crumb-link t-mono-sm" href="${m.decision.kind === 'reopen' ? `#/defensio/prevention/plans/${esc(m.decision.ref)}` : `#/defensio/rca/${esc(m.decision.ref)}`}">${esc(m.decision.ref)}</a>` : '<span class="t-body-sm">recorded on the plan</span>'}${m.decision.note ? `<br><span class="t-body-sm">${esc(m.decision.note)}</span>` : ''}</dd>` : ''}
      ${plan.predecessorId ? `<dt>Reopens</dt><dd><a class="crumb-link t-mono-sm" href="#/defensio/prevention/plans/${esc(plan.predecessorId)}">${esc(plan.predecessorId)}</a></dd>` : ''}
      ${plan.successorId ? `<dt>Reopened as</dt><dd><a class="crumb-link t-mono-sm" href="#/defensio/prevention/plans/${esc(plan.successorId)}">${esc(plan.successorId)}</a></dd>` : ''}
      ${r?.denialIds?.length ? `<dt>Measured denials</dt><dd>${r.denialIds.map((d) => `<a class="badge" href="#/defensio/denials/${esc(d)}">${esc(d)}</a>`).join(' ')}</dd>` : ''}
    </dl>`;
  host.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="measure"]')) return;
    const res = preventionPlans.measure(id);
    toast(res ? `${res.count} denial${res.count === 1 ? '' : 's'}, ${usd(res.value)} — ${res.verdict.toLowerCase()} so far` : 'Nothing to measure', res ? 'info' : 'warning');
  });
}

// --- History ----------------------------------------------------------------------------

const TONE = { Created: 'accent', Activated: 'info', 'Measurement started': 'info', Closed: 'success', Reopened: 'warning', Escalated: 'critical', Cancelled: 'critical', 'Action done': 'success', 'Action reopened': 'warning', 'Evidence added': '' };
export function renderHistory(host, { id }) {
  const entries = preventionPlans.history(id);
  host.innerHTML = `
    <div class="toolbar"><span class="t-title-sm">Changes</span><span class="badge">${entries.length}</span><span class="spacer"></span><span class="t-body-sm">Append-only — a save is a second line, never an edit.</span></div>
    ${entries.length ? `<ol class="journey">${entries.map((e) => `
      <li class="journey__row">
        <span class="journey__at t-mono-sm">${dateTime(e.at)}</span>
        <span class="journey__action"><span class="badge${TONE[e.action] ? ` badge--${TONE[e.action]}` : ''}">${esc(e.action)}</span></span>
        <span class="journey__actor">${esc(e.user || '')}</span>
        <span class="journey__detail">${esc(e.details || '')}</span>
      </li>`).join('')}</ol>` : '<p class="t-body-sm">No trail yet.</p>'}`;
}
