// The root-cause dialogs: a new manual case over a set of denials, assign,
// conclude and close (each showing the register's own gate), and the
// corrective-action forms — raise or edit, mark done, verify, reopen, attach.
// Each validates, writes through the repositories and says what it did; the
// screens redraw on the commit.

import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as correctiveActions from '../../../../data/repositories/corrective-actions.js';
import * as denials from '../../../../data/repositories/denials.js';
import * as payers from '../../../../data/repositories/payers.js';
import { STAFF, staffName } from '../../../../data/seed/staff.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, esc, todayIso, usd } from '../../../../shared/format.js';

const errorBox = (el, problems) => {
  el.innerHTML = problems.length
    ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : '';
};

/** Everybody on the staff list as options, nobody first. */
export const staffOptions = (selected = '', { none = 'Nobody yet' } = {}) => `<option value="">${esc(none)}</option>${
  STAFF.map((s) => `<option value="${esc(s.id)}"${s.id === selected ? ' selected' : ''}>${esc(s.name)} — ${esc(s.title)}</option>`).join('')}`;

/**
 * A manual case: tick the denials it covers (search narrows the list; a
 * denial already in an open case says so), give the reason and, optionally,
 * an analyst. Resolves with the case or undefined.
 */
export async function openNewCaseDialog({ denialIds = [] } = {}) {
  const picked = new Set(denialIds);
  const dialog = modal.open({
    title: 'New RCA case',
    sub: 'A manual case over any set of denials',
    icon: 'troubleshoot',
    size: 'lg',
    body: `
      <div class="toolbar">
        <label class="field field--grow"><span class="icon icon--sm">search</span><input type="search" id="nc-q" placeholder="Search denial, claim, payer or cause" aria-label="Search denials"></label>
        <span class="t-body-sm" id="nc-count"></span>
      </div>
      <div id="nc-list"></div>
      <label class="field field--area"><span class="icon icon--sm">notes</span>
        <textarea id="nc-reason" rows="2" placeholder="Why this case is being opened" aria-label="Reason" maxlength="300"></textarea>
      </label>
      <label class="field"><span class="icon icon--sm">person</span><select id="nc-analyst" aria-label="Analyst">${staffOptions(currentRole().id, { none: 'Unassigned for now' })}</select></label>
      <div id="nc-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="nc-save">Open case</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  const rows = () => denials.search($('#nc-q').value, {}).filter((d) => d.status !== 'Reclassified').slice(0, 40);
  function drawList() {
    const list = rows();
    $('#nc-count').textContent = `${picked.size} picked`;
    $('#nc-list').innerHTML = list.length ? `
      <table class="tbl">
        <thead><tr><th scope="col"></th><th scope="col">Denial</th><th scope="col">Claim</th><th scope="col">Payer</th><th scope="col">Denied</th><th scope="col">Root cause</th><th scope="col">Status</th><th scope="col">Case</th></tr></thead>
        <tbody>${list.map((d) => {
    const c = rcaCases.caseFor(d.id);
    return `
          <tr>
            <td><input type="checkbox" data-pick="${esc(d.id)}" aria-label="Pick ${esc(d.id)}"${picked.has(d.id) ? ' checked' : ''}></td>
            <td><span class="t-mono-sm">${esc(d.id)}</span></td>
            <td><span class="t-mono-sm">${esc(d.claimNo)}</span></td>
            <td>${esc(payers.get(d.payerId)?.nameEn || d.payerId)}</td>
            <td><span class="t-mono-sm">${esc(usd(d.amounts.denied))}</span></td>
            <td>${esc(d.rootCauseId ? denials.rootCauseLabel(d.rootCauseId) : 'Untriaged')}</td>
            <td><span class="badge">${esc(d.status)}</span></td>
            <td>${c ? `<span class="badge${rcaCases.isOpen(c) ? ' badge--warning' : ''}" title="${esc(`${rcaCases.statusLabel(c.status)} — ${c.detail}`)}">${esc(c.id)}</span>` : '<span class="t-body-sm">—</span>'}</td>
          </tr>`;
  }).join('')}</tbody>
      </table>` : '<p class="t-body-sm">No denial matches.</p>';
  }
  $('#nc-q').addEventListener('input', drawList);
  dialog.el.addEventListener('change', (e) => {
    const box = e.target.closest('[data-pick]');
    if (!box) return;
    if (box.checked) picked.add(box.dataset.pick); else picked.delete(box.dataset.pick);
    $('#nc-count').textContent = `${picked.size} picked`;
  });
  $('#nc-save').addEventListener('click', () => {
    const r = rcaCases.create({ trigger: 'manual', denialIds: [...picked], detail: $('#nc-reason').value, analystId: $('#nc-analyst').value || null });
    if (r?.error) return errorBox($('#nc-error'), [r.error]);
    toast(`${r.id} opened over ${r.denialIds.length} denial${r.denialIds.length === 1 ? '' : 's'}`);
    return dialog.close(r);
  });
  drawList();
  return dialog.closed;
}

export async function openAssignDialog(id) {
  const row = rcaCases.get(id);
  if (!row) return undefined;
  const dialog = modal.open({
    title: `Assign ${row.id}`,
    icon: 'person',
    size: 'sm',
    body: `<label class="field"><span class="icon icon--sm">person</span><select id="ra-who" aria-label="Analyst">${staffOptions(row.analystId || currentRole().id, { none: 'Unassigned' })}</select></label><div id="ra-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="ra-save">Assign</button>`,
  });
  dialog.el.querySelector('#ra-save').addEventListener('click', () => {
    const who = dialog.el.querySelector('#ra-who').value || null;
    const r = rcaCases.assign(id, who);
    if (r?.error) return errorBox(dialog.el.querySelector('#ra-error'), [r.error]);
    toast(who ? `${id} assigned to ${staffName(who)}` : `${id} unassigned`);
    return dialog.close(true);
  });
  return dialog.closed;
}

/** Conclude: the gate's sentences when it refuses, a confirm naming the retags when it does not. */
export async function openConcludeDialog(id) {
  const row = rcaCases.get(id);
  if (!row) return undefined;
  const blockers = rcaCases.concludeBlockers(row);
  if (blockers.length) {
    await modal.open({
      title: `${row.id} cannot conclude yet`, icon: 'rule', tone: 'warning', size: 'sm',
      body: `<p class="modal__lede">The gate reads:</p><ul>${blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`,
    }).closed;
    return undefined;
  }
  const cause = row.analysis.confirmedRootCause;
  const retags = rcaCases.denialsOf(row).filter((d) => d.rootCauseId !== cause);
  const ok = await modal.confirm({
    title: `Conclude ${row.id}`,
    icon: 'task_alt',
    tone: '',
    confirmLabel: 'Conclude',
    body: `<p class="modal__lede">${esc(denials.rootCauseLabel(cause))} · ${esc(rcaCases.natureLabel(row.analysis.causeNature))}.</p>
      ${retags.length ? `<p class="t-body-sm">The confirmed cause is written onto ${retags.length} denial${retags.length === 1 ? '' : 's'} as its root cause, audited old → new: ${retags.map((d) => `<span class="t-mono-sm">${esc(d.id)}</span> (${esc(d.rootCauseId ? denials.rootCauseLabel(d.rootCauseId) : 'untagged')})`).join(', ')}.</p>` : '<p class="t-body-sm">Every covered denial already carries this cause.</p>'}
      ${row.analysis.causeNature === 'individual' ? `<p class="t-body-sm">An accountability case opens for ${esc(staffName(row.causer?.personId))} with a ${esc(String(rcaCases.targetDays()))}-day analysis target behind it and the response window in front.</p>` : ''}`,
  });
  if (!ok) return undefined;
  const r = rcaCases.conclude(id);
  if (r?.error) { toast(r.error, 'warning'); return undefined; }
  toast(`${id} concluded${r.accountabilityCaseId ? ` · ${r.accountabilityCaseId} opened` : ''}`);
  return r;
}

export async function openCloseDialog(id) {
  const row = rcaCases.get(id);
  if (!row) return undefined;
  const blockers = rcaCases.closeBlockers(row);
  if (blockers.length) {
    await modal.open({
      title: `${row.id} cannot close yet`, icon: 'lock', tone: 'warning', size: 'sm',
      body: `<p class="modal__lede">The gate reads:</p><ul>${blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`,
    }).closed;
    return undefined;
  }
  const dialog = modal.open({
    title: `Close ${row.id}`, icon: 'lock', size: 'sm',
    body: `<p class="modal__lede">Every corrective action is verified. A closed case is read-only.</p>
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="cc-note" rows="2" placeholder="Closing note (optional)" aria-label="Closing note" maxlength="300"></textarea></label>
      <div id="cc-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="cc-save">Close case</button>`,
  });
  dialog.el.querySelector('#cc-save').addEventListener('click', () => {
    const r = rcaCases.close(id, { note: dialog.el.querySelector('#cc-note').value });
    if (r?.error) return errorBox(dialog.el.querySelector('#cc-error'), [r.error]);
    toast(`${id} closed`);
    return dialog.close(r);
  });
  return dialog.closed;
}

// --- corrective actions -----------------------------------------------------------------------

/** Raise an action on a case, or edit an open one (pass its id). */
export async function openActionDialog(rcaCaseId, actionId = null) {
  const existing = actionId ? correctiveActions.get(actionId) : null;
  const rca = rcaCases.get(rcaCaseId);
  const gapTarget = rca?.analysis?.configGap?.present ? rca.analysis.configGap.target : '';
  const v = existing || { action: '', type: gapTarget ? 'Configuration' : 'Process', targetRef: gapTarget, ownerId: rca?.analystId || '', dueDate: daysFromNow(14) };
  const dialog = modal.open({
    title: existing ? `Edit ${existing.id}` : 'Raise a corrective action',
    sub: rcaCaseId,
    icon: 'build',
    size: 'md',
    body: `
      <label class="field field--area"><span class="icon icon--sm">notes</span>
        <textarea id="ca-action" rows="2" placeholder="What will be done" aria-label="Action" maxlength="300">${esc(v.action)}</textarea>
      </label>
      <div class="toolbar">
        <label class="field"><span class="icon icon--sm">category</span>
          <select id="ca-type" aria-label="Type">${correctiveActions.TYPES.map((t) => `<option value="${t}"${t === v.type ? ' selected' : ''}>${esc(correctiveActions.typeLabel(t))}</option>`).join('')}</select>
        </label>
        <label class="field field--grow"><span class="icon icon--sm">link</span>
          <input type="text" id="ca-target" placeholder="Where it is made — a route such as #/pactum/contracts/CTR-0001/preauth" aria-label="Target" value="${esc(v.targetRef || '')}" maxlength="200">
        </label>
      </div>
      <p class="t-body-sm" id="ca-hint"></p>
      <div class="toolbar">
        <label class="field field--grow"><span class="icon icon--sm">person</span><select id="ca-owner" aria-label="Owner">${staffOptions(v.ownerId, { none: 'Pick an owner…' })}</select></label>
        <label class="field"><span class="icon icon--sm">event</span><input type="date" id="ca-due" aria-label="Due date" value="${esc(v.dueDate || '')}"></label>
      </div>
      <div id="ca-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="ca-save">${existing ? 'Save' : 'Raise action'}</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  const hint = () => {
    const t = $('#ca-type').value;
    $('#ca-hint').textContent = t === 'Configuration' ? 'A configuration action names the screen it is made on — the chip on the case opens it.'
      : t === 'PayerEscalation' ? 'Raised with the payer; the target may name the contract or the follow-up.' : 'The target is optional — a policy, a document, a screen.';
  };
  $('#ca-type').addEventListener('change', hint);
  hint();
  $('#ca-save').addEventListener('click', () => {
    const data = { rcaCaseId, action: $('#ca-action').value, type: $('#ca-type').value, targetRef: $('#ca-target').value, ownerId: $('#ca-owner').value, dueDate: $('#ca-due').value };
    const r = existing ? correctiveActions.update(existing.id, data) : correctiveActions.create(data);
    if (r?.error) return errorBox($('#ca-error'), [r.error]);
    toast(existing ? `${existing.id} updated` : `${r.id} raised — ${correctiveActions.typeLabel(r.type)}`);
    return dialog.close(r);
  });
  return dialog.closed;
}

/** One field, one write: done, verify, reopen, attach. */
export async function openActionNoteDialog(actionId, kind) {
  const row = correctiveActions.get(actionId);
  if (!row) return undefined;
  const copy = {
    done: { title: `Mark ${row.id} done`, icon: 'check', label: 'What was done (optional)', button: 'Mark done', required: false },
    verify: { title: `Verify ${row.id}`, icon: 'verified', label: 'What was checked — the note is the verification', button: 'Verify', required: true },
    reopen: { title: `Reopen ${row.id}`, icon: 'undo', label: 'Why the action is being reopened', button: 'Reopen', required: true, tone: 'warning' },
    attach: { title: `Attach to ${row.id}`, icon: 'attach_file', label: 'File name', button: 'Attach', required: true, single: true },
  }[kind];
  if (!copy) return undefined;
  const dialog = modal.open({
    title: copy.title, sub: row.action, icon: copy.icon, tone: copy.tone || '', size: 'sm',
    body: copy.single
      ? `<label class="field"><span class="icon icon--sm">description</span><input type="text" id="an-text" placeholder="${esc(copy.label)}" aria-label="${esc(copy.label)}" maxlength="120"></label><div id="an-error"></div>`
      : `<label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="an-text" rows="3" placeholder="${esc(copy.label)}" aria-label="${esc(copy.label)}" maxlength="300"></textarea></label><div id="an-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="an-save">${copy.button}</button>`,
  });
  dialog.el.querySelector('#an-save').addEventListener('click', () => {
    const text = dialog.el.querySelector('#an-text').value.trim();
    if (copy.required && !text) return errorBox(dialog.el.querySelector('#an-error'), [copy.label.endsWith('.') ? copy.label : `${copy.label}.`]);
    const r = kind === 'done' ? correctiveActions.markDone(actionId, text)
      : kind === 'verify' ? correctiveActions.verify(actionId, { verificationNote: text })
        : kind === 'reopen' ? correctiveActions.reopen(actionId, text)
          : correctiveActions.addAttachment(actionId, { fileName: text, size: 0 });
    if (r?.error) return errorBox(dialog.el.querySelector('#an-error'), [r.error]);
    toast(`${actionId} ${kind === 'attach' ? 'has a new attachment' : kind === 'done' ? 'marked done' : kind === 'verify' ? 'verified' : 'reopened'}`);
    return dialog.close(r);
  });
  return dialog.closed;
}

const daysFromNow = (n) => {
  const d = new Date(`${todayIso()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const dueLabel = (row) => (row.dueDate ? `due ${date(row.dueDate)}` : '');
