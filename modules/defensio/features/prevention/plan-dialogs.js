// The prevention plan's dialogs: edit the head, raise or edit an action,
// mark it done or reopen it, attach evidence (a note, or a file by name —
// nothing is uploaded), activate (the baseline it will freeze shown first),
// start measurement (the done-without-evidence warning listed), close on
// the verdict (an ineffective plan has to choose reopen or escalate) and
// cancel. Each validates, writes through the repository and says what it
// did; the page redraws on the commit.

import * as preventionPlans from '../../../../data/repositories/prevention-plans.js';
import * as riskRules from '../../../../data/repositories/risk-rules.js';
import * as engine from '../../../../data/engines/plan-effectiveness.js';
import { STAFF } from '../../../../data/seed/staff.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, fileSize, todayIso, usd } from '../../../../shared/format.js';
import { verdictHtml } from './prevention-chips.js';

const errorBox = (el, problems) => {
  el.innerHTML = problems.length ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : '';
};
export const staffOptions = (selected = '', { none = 'Nobody yet' } = {}) => `<option value="">${esc(none)}</option>${
  STAFF.map((s) => `<option value="${esc(s.id)}"${s.id === selected ? ' selected' : ''}>${esc(s.name)} — ${esc(s.title)}</option>`).join('')}`;
const field = (icon, inner) => `<label class="field"><span class="icon icon--sm">${icon}</span>${inner}</label>`;

export async function openEditDialog(id) {
  const plan = preventionPlans.get(id);
  if (!plan) return undefined;
  const dialog = modal.open({
    title: `Edit ${plan.id}`, icon: 'edit', size: 'md',
    body: `
      ${field('title', `<input id="pe-title" value="${esc(plan.title)}" placeholder="Title" aria-label="Title" maxlength="140">`)}
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="pe-desc" rows="4" placeholder="What the plan changes and why" aria-label="Description" maxlength="800">${esc(plan.description || '')}</textarea></label>
      ${field('person', `<select id="pe-owner" aria-label="Owner">${staffOptions(plan.ownerId)}</select>`)}
      ${field('supervisor_account', `<select id="pe-sponsor" aria-label="Sponsor">${staffOptions(plan.sponsorId, { none: 'No sponsor' })}</select>`)}
      <div id="pe-error"></div>`,
    foot: '<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="pe-save">Save</button>',
  });
  dialog.el.querySelector('#pe-save').addEventListener('click', () => {
    const $ = (s) => dialog.el.querySelector(s);
    const r = preventionPlans.update(id, { title: $('#pe-title').value, description: $('#pe-desc').value, ownerId: $('#pe-owner').value, sponsorId: $('#pe-sponsor').value });
    if (r?.error) return errorBox($('#pe-error'), [r.error]);
    toast(`${id} saved`);
    return dialog.close(true);
  });
  return dialog.closed;
}

/** Raise (no actionId) or edit an action of the plan's own, or one that names a risk rule. */
export async function openActionDialog(id, actionId = null) {
  const plan = preventionPlans.get(id);
  const a = actionId ? (plan?.actions || []).find((x) => x.id === actionId) : null;
  if (!plan) return undefined;
  const rules = riskRules.all().filter((r) => r.status !== 'Retired');
  const dialog = modal.open({
    title: a ? `Edit ${a.id}` : 'Raise an action', sub: plan.title, icon: 'build', size: 'md',
    body: `
      <div class="toolbar">
        <div class="segmented" id="pa-kind" role="group" aria-label="Kind">
          <button type="button" class="segmented__btn" data-kind="own" aria-pressed="${(a?.kind || 'own') === 'own'}"${a ? ' disabled' : ''}>Plan action</button>
          <button type="button" class="segmented__btn" data-kind="riskRule" aria-pressed="${a?.kind === 'riskRule'}"${a ? ' disabled' : ''}>Risk rule</button>
        </div>
        <span class="t-body-sm">A change somebody makes, or a rule that warns at the scrub</span>
      </div>
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="pa-text" rows="2" placeholder="What changes" aria-label="Action" maxlength="300">${esc(a?.text || '')}</textarea></label>
      <div id="pa-own"${(a?.kind || 'own') === 'own' ? '' : ' hidden'}>
        ${field('category', `<select id="pa-type" aria-label="Type">${preventionPlans.ACTION_TYPES.map((t) => `<option value="${t}"${t === a?.type ? ' selected' : ''}>${esc(preventionPlans.actionTypeLabel(t))}</option>`).join('')}</select>`)}
        ${field('link', `<input id="pa-target" value="${esc(a?.targetRef || '')}" placeholder="Where it is made — a screen (#/pactum/…) or a reference" aria-label="Target" maxlength="200">`)}
      </div>
      <div id="pa-rule"${a?.kind === 'riskRule' ? '' : ' hidden'}>
        ${field('rule', `<select id="pa-ruleref" aria-label="Risk rule"><option value="">Pick a rule</option>${rules.map((r) => `<option value="${esc(r.id)}"${r.id === a?.riskRuleRef ? ' selected' : ''}>${esc(r.id)} · ${esc(riskRules.conditionsLabel(r.conditions))} (${esc(r.status)})</option>`).join('')}</select>`)}
      </div>
      ${field('person', `<select id="pa-owner" aria-label="Owner">${staffOptions(a?.ownerId || '')}</select>`)}
      ${field('event', `<input type="date" id="pa-due" value="${esc(a?.dueDate || '')}" aria-label="Due">`)}
      <div id="pa-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="pa-save">${a ? 'Save' : 'Raise'}</button>`,
  });
  const $ = (s) => dialog.el.querySelector(s);
  let kind = a?.kind || 'own';
  dialog.el.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-kind]');
    if (!seg || seg.disabled) return;
    kind = seg.dataset.kind;
    for (const b of dialog.el.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b === seg));
    $('#pa-own').hidden = kind !== 'own';
    $('#pa-rule').hidden = kind !== 'riskRule';
  });
  $('#pa-save').addEventListener('click', () => {
    const data = { kind, text: $('#pa-text').value, type: $('#pa-type').value, targetRef: $('#pa-target').value.trim() || null, riskRuleRef: $('#pa-ruleref').value || null, ownerId: $('#pa-owner').value || null, dueDate: $('#pa-due').value };
    const r = a ? preventionPlans.updateAction(id, a.id, data) : preventionPlans.addAction(id, data);
    if (r?.error) return errorBox($('#pa-error'), [r.error]);
    toast(a ? `${a.id} saved` : 'Action raised');
    return dialog.close(true);
  });
  return dialog.closed;
}

/** Done (a note) or reopen (a reason) on an action. */
export async function openActionNoteDialog(id, actionId, act) {
  const plan = preventionPlans.get(id);
  const a = (plan?.actions || []).find((x) => x.id === actionId);
  if (!a) return undefined;
  const done = act === 'done';
  const noEvidence = done && !(a.evidence || []).length;
  const dialog = modal.open({
    title: done ? `Mark ${a.id} done` : `Reopen ${a.id}`, sub: a.text, icon: done ? 'check' : 'undo', size: 'sm', tone: done ? '' : 'warning',
    body: `
      ${noEvidence ? '<div class="alert alert--warning"><span class="icon">priority_high</span><div>No evidence is attached to this action. It can be marked done, and the plan will say so — attach a note or a file first if you have one.</div></div>' : ''}
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="pn-note" rows="2" placeholder="${done ? 'What was done (optional)' : 'Why it is being reopened'}" aria-label="Note" maxlength="300"></textarea></label>
      <div id="pn-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="pn-save">${done ? 'Mark done' : 'Reopen'}</button>`,
  });
  dialog.el.querySelector('#pn-save').addEventListener('click', () => {
    const note = dialog.el.querySelector('#pn-note').value;
    const r = done ? preventionPlans.markActionDone(id, actionId, { note }) : preventionPlans.reopenAction(id, actionId, note);
    if (r?.error) return errorBox(dialog.el.querySelector('#pn-error'), [r.error]);
    toast(done ? `${actionId} done` : `${actionId} reopened`);
    return dialog.close(true);
  });
  return dialog.closed;
}

/** Evidence on an action (actionId) or on the plan (null): a note, or a file picked and recorded by name and size. */
export async function openEvidenceDialog(id, actionId = null) {
  const dialog = modal.open({
    title: actionId ? `Evidence on ${actionId}` : 'Plan evidence', icon: 'attach_file', size: 'sm',
    body: `
      <div class="toolbar">
        <div class="segmented" id="ev-kind" role="group" aria-label="Kind">
          <button type="button" class="segmented__btn" data-kind="note" aria-pressed="true">Note</button>
          <button type="button" class="segmented__btn" data-kind="file" aria-pressed="false">File</button>
        </div>
      </div>
      <div id="ev-note"><label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="ev-text" rows="3" placeholder="What shows the action was done" aria-label="Note" maxlength="400"></textarea></label></div>
      <div id="ev-file" hidden>${field('upload_file', '<input type="file" id="ev-input" aria-label="File">')}<p class="t-body-sm">The file stays on your machine — its name and size are what the plan records.</p></div>
      <div id="ev-error"></div>`,
    foot: '<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="ev-save">Attach</button>',
  });
  const $ = (s) => dialog.el.querySelector(s);
  let kind = 'note';
  dialog.el.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-kind]');
    if (!seg) return;
    kind = seg.dataset.kind;
    for (const b of dialog.el.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b === seg));
    $('#ev-note').hidden = kind !== 'note';
    $('#ev-file').hidden = kind !== 'file';
  });
  $('#ev-save').addEventListener('click', () => {
    const f = $('#ev-input').files?.[0];
    const r = preventionPlans.addEvidence(id, actionId, kind === 'file' ? { kind: 'file', fileName: f?.name || '', size: f?.size || 0 } : { kind: 'note', text: $('#ev-text').value });
    if (r?.error) return errorBox($('#ev-error'), [r.error]);
    toast(kind === 'file' ? `${f.name} (${fileSize(f.size)}) attached` : 'Note attached');
    return dialog.close(true);
  });
  return dialog.closed;
}

/** Activate: the baseline the plan will freeze, computed now from the register, then the confirm. */
export async function openActivateDialog(id) {
  const plan = preventionPlans.get(id);
  if (!plan) return undefined;
  const blockers = preventionPlans.activateBlockers(plan);
  if (blockers.length) return blocked('Not ready to activate', blockers);
  const preview = engine.baselineOf(preventionPlans.targetFacts(plan), todayIso(), plan.measurement.windowDays);
  const ok = await modal.confirm({
    title: `Activate ${plan.id}`, tone: 'warning', icon: 'play_arrow', confirmLabel: 'Activate',
    body: `The baseline freezes today and is never recomputed: <strong>${preview.count} denial${preview.count === 1 ? '' : 's'}, ${esc(usd(preview.value))}</strong> drawn by the targets in the ${preview.windowDays} days to ${esc(date(preview.to))}. Targets are frozen with it; actions stay open to edit.`,
  });
  if (!ok) return undefined;
  const r = preventionPlans.activate(id);
  if (r?.error) toast(r.error, 'warning'); else toast(`${id} active — baseline frozen`);
  return r;
}

export async function openStartMeasurementDialog(id) {
  const plan = preventionPlans.get(id);
  if (!plan) return undefined;
  const blockers = preventionPlans.measurementBlockers(plan);
  if (blockers.length) return blocked('Not ready to measure', blockers);
  const bare = (plan.actions || []).filter(preventionPlans.doneWithoutEvidence);
  const w = engine.windowOf(todayIso(), plan.measurement.windowDays);
  const ok = await modal.confirm({
    title: `Start measuring ${plan.id}`, tone: 'warning', icon: 'timer', confirmLabel: 'Start measurement',
    body: `Every action is done. The window runs ${w.days} days, to ${esc(date(w.to))}; the plan closes on the verdict once it has passed.${bare.length ? `<br><br><strong>${bare.length} action${bare.length === 1 ? ' was' : 's were'} marked done with no evidence attached</strong> — ${bare.map((a) => esc(a.id)).join(', ')}. The measurement starts anyway; the record says so.` : ''}`,
  });
  if (!ok) return undefined;
  const r = preventionPlans.startMeasurement(id);
  if (r?.error) toast(r.error, 'warning'); else toast(`${id} measuring to ${date(w.to)}`);
  return r;
}

/** Close on the verdict — an ineffective plan has to say what happens next. */
export async function openCloseDialog(id) {
  const plan = preventionPlans.get(id);
  if (!plan) return undefined;
  const blockers = preventionPlans.closeBlockers(plan);
  if (blockers.length) return blocked('Not ready to close', blockers);
  const result = preventionPlans.measure(id, { commit: false });
  const ineffective = result.verdict === 'Ineffective';
  const dialog = modal.open({
    title: `Close ${plan.id}`, sub: plan.title, icon: 'lock', size: 'md', tone: ineffective ? 'critical' : '',
    body: `
      <dl class="dl dl--narrow">
        <dt>Baseline</dt><dd><span class="t-mono-sm">${plan.baseline.count}</span> <span class="t-body-sm">· ${esc(usd(plan.baseline.value))} in the ${plan.baseline.windowDays} days to ${esc(date(plan.baseline.to))}</span></dd>
        <dt>Measured</dt><dd><span class="t-mono-sm">${result.count}</span> <span class="t-body-sm">· ${esc(usd(result.value))} from ${esc(date(result.from))} to ${esc(date(result.to))}</span></dd>
        <dt>Change</dt><dd><span class="t-mono-sm">${result.deltaPct > 0 ? '+' : ''}${result.deltaPct}%</span> <span class="t-body-sm">on value · ${result.deltaCountPct > 0 ? '+' : ''}${result.deltaCountPct}% on count</span></dd>
        <dt>Verdict</dt><dd>${verdictHtml(result)} <span class="t-body-sm">effective at or below ${preventionPlans.effectiveBelowPct()}%</span></dd>
        <dt>Prevented</dt><dd><span class="t-mono-sm">${esc(usd(result.prevented.value))}</span> <span class="badge" title="Baseline less measured — the register never learns what would have been denied">${esc(result.prevented.label)}</span></dd>
      </dl>
      ${ineffective ? `
      <div class="alert alert--critical"><span class="icon">error</span><div>The plan did not move the pattern. Say what happens next — it is not closed without a decision.</div></div>
      <div class="rule-child-row"><label><input type="radio" name="pc-decision" value="reopen" checked> Reopen — a fresh draft chained to this one, the targets and the actions carried over</label></div>
      <div class="rule-child-row"><label><input type="radio" name="pc-decision" value="escalate"> Escalate — open a root-cause case over the denials it was meant to stop</label></div>
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="pc-note" rows="2" placeholder="What the decision rests on" aria-label="Note" maxlength="300"></textarea></label>` : ''}
      <div id="pc-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn ${ineffective ? 'btn--danger' : 'btn--primary'}" id="pc-save">Close ${result.verdict.toLowerCase()}</button>`,
  });
  dialog.el.querySelector('#pc-save').addEventListener('click', () => {
    const kind = dialog.el.querySelector('input[name="pc-decision"]:checked')?.value || null;
    const r = preventionPlans.close(id, { decision: ineffective ? { kind, note: dialog.el.querySelector('#pc-note')?.value || '' } : null });
    if (r?.error) return errorBox(dialog.el.querySelector('#pc-error'), [r.error]);
    const d = r.measurement.decision;
    toast(`${id} closed ${result.verdict.toLowerCase()}${d?.ref ? ` — ${d.kind === 'reopen' ? 'reopened as' : 'escalated to'} ${d.ref}` : ''}`);
    return dialog.close(r);
  });
  return dialog.closed;
}

export async function openCancelDialog(id) {
  const dialog = modal.open({
    title: `Cancel ${id}`, icon: 'block', size: 'sm', tone: 'critical',
    body: '<label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="px-reason" rows="2" placeholder="Why the plan is being dropped" aria-label="Reason" maxlength="300"></textarea></label><div id="px-error"></div>',
    foot: '<button class="btn btn--secondary" data-close>Keep it</button><button class="btn btn--danger" id="px-save">Cancel plan</button>',
  });
  dialog.el.querySelector('#px-save').addEventListener('click', () => {
    const r = preventionPlans.cancel(id, dialog.el.querySelector('#px-reason').value);
    if (r?.error) return errorBox(dialog.el.querySelector('#px-error'), [r.error]);
    toast(`${id} cancelled`);
    return dialog.close(true);
  });
  return dialog.closed;
}

async function blocked(title, blockers) {
  await modal.open({ title, icon: 'block', tone: 'warning', size: 'sm', body: `<ul>${blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` }).closed;
  return undefined;
}
