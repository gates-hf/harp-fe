// The denial dialogs: assign, bulk triage over a same-reason selection, the
// reason a re-route needs, a manual close and Defensio's answer on a
// hand-off. Each validates, writes through data/repositories/denials.js and
// says what it did; the screens redraw on the commit.

import * as denials from '../../../../data/repositories/denials.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { ROLES, current as currentRole } from '../../../../shared/roles.js';
import { esc, usd } from '../../../../shared/format.js';

const errorBox = (el, problems) => {
  el.innerHTML = problems.length
    ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : '';
};

/** The grouped root-cause select every triage draws. */
export function rootCauseOptions(selected = '') {
  return `<option value="">Pick a root cause…</option>${denials.groupedRootCauses().map((g) => `
    <optgroup label="${esc(g.group)}">${g.causes.map((c) => `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>`).join('')}`;
}

export const classOptions = (selected = '') => `<option value="">Pick a class…</option>${
  denials.CLASSES.map((c) => `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`).join('')}`;

/** Assign one or several denials to a person from the demo's five, or nobody. */
export async function openAssignDialog(ids = []) {
  const rows = ids.map((id) => denials.get(id)).filter((d) => d && denials.isOpen(d));
  if (!rows.length) { toast('Pick an open denial to assign', 'warning'); return undefined; }
  const me = currentRole().name;
  const dialog = modal.open({
    title: rows.length === 1 ? `Assign ${rows[0].id}` : `Assign ${rows.length} denials`,
    icon: 'person',
    size: 'sm',
    body: `
      <label class="field">
        <span class="icon icon--sm">person</span>
        <select id="da-who" aria-label="Assignee">
          <option value="">Unassigned</option>
          ${ROLES.map((r) => `<option value="${esc(r.name)}"${r.name === me ? ' selected' : ''}>${esc(r.name)} — ${esc(r.title)}</option>`).join('')}
        </select>
      </label>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="da-save">Assign</button>`,
  });
  dialog.el.querySelector('#da-save').addEventListener('click', () => {
    const who = dialog.el.querySelector('#da-who').value || null;
    for (const d of rows) denials.assign(d.id, who);
    toast(`${rows.length === 1 ? rows[0].id : `${rows.length} denials`} ${who ? `assigned to ${who}` : 'unassigned'}`);
    dialog.close(true);
  });
  return dialog.closed;
}

/**
 * Bulk triage: one class, one root cause and optionally one route over a
 * selection that shares a payer reason — a triage is a reading of the
 * reason, so a mixed selection is refused with the codes it spans.
 */
export async function openBulkTriageDialog(ids = []) {
  const rows = ids.map((id) => denials.get(id)).filter((d) => d && denials.isOpen(d));
  if (!rows.length) { toast('Pick open denials to triage', 'warning'); return undefined; }
  const codes = [...new Set(rows.map((d) => d.payerReason?.code || d.code))];
  if (codes.length > 1) {
    toast(`Pick denials with one payer reason — the selection spans ${codes.join(', ')}`, 'warning');
    return undefined;
  }
  const s = denials.suggest(rows[0]);
  const total = rows.reduce((n, d) => n + d.amounts.open, 0);
  const dialog = modal.open({
    title: `Triage ${rows.length} denial${rows.length === 1 ? '' : 's'} — ${codes[0]}`,
    sub: `${denials.denialCodeLabel(codes[0])} · ${usd(total)} open`,
    icon: 'rule',
    size: 'md',
    body: `
      <p class="modal__lede">One class and one root cause, written on each: ${rows.map((d) => `<span class="t-mono-sm">${esc(d.id)}</span>`).join(', ')}.</p>
      <div class="toolbar">
        <label class="field"><span class="icon icon--sm">category</span><select id="bt-class" aria-label="Class">${classOptions(s.class)}</select></label>
        <label class="field field--grow"><span class="icon icon--sm">troubleshoot</span><select id="bt-cause" aria-label="Root cause">${rootCauseOptions(s.rootCauseId)}</select></label>
      </div>
      <div class="toolbar">
        <label class="field field--grow"><span class="icon icon--sm">route</span>
          <select id="bt-route" aria-label="Route">
            <option value="">Triage only — route each one from its page</option>
            ${denials.ROUTES.map((k) => `<option value="${k}"${k === s.route ? ' selected' : ''}>${esc(denials.routeLabel(k))}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="field field--area"><span class="icon icon--sm">notes</span>
        <textarea id="bt-note" rows="2" placeholder="What the evidence says (optional)" aria-label="Triage note" maxlength="300"></textarea>
      </label>
      <p class="t-body-sm">Suggested from the payer's reason: ${esc(s.why)} A route is applied to every denial it is available on; the rest stay triaged and say why.</p>
      <div id="bt-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="bt-save">Apply to ${rows.length}</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  $('#bt-cause').addEventListener('change', () => {
    const rc = denials.rootCause($('#bt-cause').value);
    if (rc) { $('#bt-class').value = rc.suggestedClass; $('#bt-route').value = rc.suggestedRoute; }
  });
  $('#bt-save').addEventListener('click', () => {
    const fields = { class: $('#bt-class').value, rootCauseId: $('#bt-cause').value, note: $('#bt-note').value.trim(), route: $('#bt-route').value };
    const problems = [];
    if (!fields.class) problems.push('Pick a class.');
    if (!fields.rootCauseId) problems.push('Pick a root cause.');
    if (problems.length) return errorBox($('#bt-error'), problems);
    const { done, problems: refused } = denials.triageMany(rows.map((d) => d.id), fields);
    toast(`${done.length} triaged${fields.route ? ` and routed to ${denials.routeLabel(fields.route)}` : ''}${refused.length ? ` · ${refused.length} not routed` : ''}`, refused.length ? 'warning' : 'success');
    if (refused.length) console.info('[denials] bulk triage', refused);
    return dialog.close(done);
  });
  return dialog.closed;
}

/** The reason a second route needs. Resolves with the text, or undefined. */
export async function askRerouteReason(denial, kind) {
  const dialog = modal.open({
    title: `Re-route ${denial.id}`,
    sub: `${denials.routeLabel(denial.route.kind)} → ${denials.routeLabel(kind)}`,
    icon: 'alt_route',
    tone: 'warning',
    size: 'sm',
    body: `
      <p class="modal__lede">The ${esc(denials.routeLabel(denial.route.kind).toLowerCase())} route stays in the history; the new route creates its own work item.</p>
      <label class="field field--area"><span class="icon icon--sm">notes</span>
        <textarea id="rr-reason" rows="3" placeholder="Why the first route is not the answer" aria-label="Reason" maxlength="300"></textarea>
      </label>
      <div id="rr-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="rr-save">Re-route</button>`,
  });
  dialog.el.querySelector('#rr-save').addEventListener('click', () => {
    const reason = dialog.el.querySelector('#rr-reason').value.trim();
    if (!reason) return errorBox(dialog.el.querySelector('#rr-error'), ['Say why the denial is being re-routed.']);
    return dialog.close(reason);
  });
  return dialog.closed;
}

/** A person closes the denial: how the open amount ends, and why. Role-gated by the repository. */
export async function openManualResolveDialog(denial) {
  const dialog = modal.open({
    title: `Resolve ${denial.id} by hand`,
    sub: `${usd(denial.amounts.open)} open · flagged as a manual resolution`,
    icon: 'how_to_reg',
    tone: 'warning',
    size: 'sm',
    body: `
      <p class="modal__lede">Every other resolution is derived — a remittance, a hand-off, a write-off. This one is yours, with a reason, and the analytics will say so.</p>
      <label class="field"><span class="icon icon--sm">flag</span>
        <select id="mr-result" aria-label="Outcome">
          <option value="lost">Not recoverable — the amount is lost</option>
          <option value="recovered">Recovered outside the system</option>
        </select>
      </label>
      <label class="field field--area"><span class="icon icon--sm">notes</span>
        <textarea id="mr-reason" rows="3" placeholder="Why it is closed this way" aria-label="Reason" maxlength="300"></textarea>
      </label>
      <div id="mr-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="mr-save">Resolve</button>`,
  });
  dialog.el.querySelector('#mr-save').addEventListener('click', () => {
    const r = denials.resolveManual(denial.id, { result: dialog.el.querySelector('#mr-result').value, reason: dialog.el.querySelector('#mr-reason').value.trim() });
    if (r?.error) return errorBox(dialog.el.querySelector('#mr-error'), [r.error]);
    toast(`${denial.id} resolved by hand`);
    return dialog.close(r);
  });
  return dialog.closed;
}

/** Defensio's answer on the hand-off the denial was routed to. */
export async function openHandoffOutcomeDialog(denial) {
  const open = denial.amounts.open;
  const dialog = modal.open({
    title: `Hand-off outcome — ${denial.id}`,
    sub: `${denial.route?.ref || 'Hand-off'} · ${usd(open)} with Defensio`,
    icon: 'gavel',
    size: 'sm',
    body: `
      <p class="modal__lede">Defensio does not exist yet, so its answer is recorded here: won recovers the amount, lost loses it, settled recovers part and carries the rest to a new denial.</p>
      <div class="toolbar">
        <label class="field"><span class="icon icon--sm">flag</span>
          <select id="ho-outcome" aria-label="Outcome">
            <option value="Won">Won — recovered in full</option>
            <option value="Settled">Settled — recovered in part</option>
            <option value="Lost">Lost</option>
          </select>
        </label>
        <label class="field"><span class="icon icon--sm">attach_money</span>
          <input type="number" id="ho-amount" min="0.01" max="${open}" step="0.01" value="${(open / 2).toFixed(2)}" aria-label="Amount recovered" disabled>
        </label>
      </div>
      <div id="ho-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="ho-save">Record</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  $('#ho-outcome').addEventListener('change', () => { $('#ho-amount').disabled = $('#ho-outcome').value !== 'Settled'; });
  $('#ho-save').addEventListener('click', () => {
    const outcome = $('#ho-outcome').value;
    const amount = Number($('#ho-amount').value);
    if (outcome === 'Settled' && !(amount > 0 && amount < open)) return errorBox($('#ho-error'), [`A settlement recovers more than nothing and less than ${usd(open)}.`]);
    const r = denials.recordHandoffOutcome(denial.id, outcome, { amount: outcome === 'Settled' ? amount : null });
    if (r?.error) return errorBox($('#ho-error'), [r.error]);
    toast(`${denial.id} — hand-off ${outcome.toLowerCase()}`);
    return dialog.close(r);
  });
  return dialog.closed;
}

/** The payer's answer to a reconsideration: overturned (the remittance follows) or upheld (pick the next route). */
export async function openPayerAnswerDialog(denial) {
  const dialog = modal.open({
    title: `Payer’s answer — ${denial.id}`,
    sub: `${denial.route?.ref || 'Reconsideration'} · ${usd(denial.amounts.open)} disputed`,
    icon: 'forum',
    size: 'sm',
    body: `
      <p class="modal__lede">Overturned puts the claim back with the payer so its remittance can be posted — that posting is what recovers the denial. Upheld ends this route and hands the denial back, triaged, for Defensio or a write-off.</p>
      <label class="field"><span class="icon icon--sm">flag</span>
        <select id="pa-outcome" aria-label="Answer">
          <option value="Overturned">Overturned — the payer will pay</option>
          <option value="Upheld">Upheld — the payer stands by the denial</option>
        </select>
      </label>
      <label class="field field--area"><span class="icon icon--sm">notes</span>
        <textarea id="pa-note" rows="3" placeholder="What the payer said" aria-label="Note" maxlength="300"></textarea>
      </label>
      <div id="pa-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="pa-save">Record</button>`,
  });
  dialog.el.querySelector('#pa-save').addEventListener('click', () => {
    const r = denials.recordPayerAnswer(denial.id, dialog.el.querySelector('#pa-outcome').value, { note: dialog.el.querySelector('#pa-note').value.trim() });
    if (r?.error) return errorBox(dialog.el.querySelector('#pa-error'), [r.error]);
    toast(`${denial.id} — payer ${r.route?.answer ? 'overturned the denial' : 'upheld the denial'}`);
    return dialog.close(r);
  });
  return dialog.closed;
}
