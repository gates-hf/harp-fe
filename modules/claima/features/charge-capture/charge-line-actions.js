// The dialogs a capture line is acted on through: edit, replace, cancel, hold,
// lift a hold, approve a late charge, release a line, release a visit. Each
// asks one question, calls one repository function and says what happened.
// Every write is the repository's — a dialog never touches a line.

import * as charges from '../../../../data/repositories/charges.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { DOCTORS } from '../../../../data/seed/reference.js';
import { CONFIG } from '../../../../shared/config.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { open, confirm } from '../../../../shared/modal.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';

const label = (line) => {
  const item = cdm.get(line.itemId);
  return `${item?.chargeCode || line.itemId} ×${line.qty}`;
};

/** Edit quantity, date of service or doctor — a reversal and a repost. */
export async function askEdit(line) {
  const enc = encounters.get(line.encounterNo);
  const { from, to } = charges.dosBounds(enc);
  const dialog = open({
    title: `Edit ${label(line)}`,
    sub: `${line.encounterNo} · the line is reversed and reposted, so the ledger keeps both`,
    icon: 'edit',
    size: 'md',
    body: `
      <div class="toolbar">
        <label class="field">
          <span class="icon icon--sm">tag</span>
          <input type="number" min="1" step="1" value="${esc(line.qty)}" name="qty" aria-label="Quantity">
        </label>
        <label class="field">
          <span class="icon icon--sm">event</span>
          <input type="date" value="${esc(line.dateOfService)}" min="${esc(from)}" max="${esc(to)}" name="dateOfService" aria-label="Date of service">
        </label>
      </div>
      <label class="field">
        <span class="icon icon--sm">stethoscope</span>
        <select name="doctorId" aria-label="Doctor">
          <option value=""${line.doctorId ? '' : ' selected'}>No doctor</option>
          ${DOCTORS.map((d) => `<option value="${d.id}"${d.id === line.doctorId ? ' selected' : ''}>${esc(d.name)} — ${esc(d.department)}</option>`).join('')}
        </select>
      </label>
      <div id="la-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Reverse and repost</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'save') return;
    const form = dialog.el;
    const res = charges.edit(line.id, {
      qty: form.querySelector('[name="qty"]').value,
      dateOfService: form.querySelector('[name="dateOfService"]').value,
      doctorId: form.querySelector('[name="doctorId"]').value,
    });
    if (res.error) return showError(form, res.error);
    toast(`${label(line)} reposted as ${res.line.id} — ${usd(res.line.pricing.allowed)} allowed`);
    dialog.close(res.line);
    return undefined;
  });
  return dialog.closed;
}

/** Replace the charge under a line — the same reversal and repost. */
export async function askReplace(line) {
  const dialog = open({
    title: `Replace ${label(line)}`,
    sub: `${line.encounterNo} · reversed and reposted under the charge you choose`,
    icon: 'swap_horiz',
    size: 'md',
    body: `
      <label class="field">
        <span class="icon icon--sm">sell</span>
        <select name="itemId" aria-label="New charge">
          <option value="" selected>Choose a charge</option>
          ${cdm.findActive().filter((row) => row.id !== line.itemId).map((row) => `
            <option value="${esc(row.id)}">${esc(row.chargeCode)} — ${esc(cdm.label(row))} · ${esc(usd(row.standardPrice))}</option>`).join('')}
        </select>
      </label>
      <div id="la-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Reverse and repost</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'save') return;
    const itemId = dialog.el.querySelector('[name="itemId"]').value;
    if (!itemId) return showError(dialog.el, 'Choose a charge');
    const res = charges.replace(line.id, itemId);
    if (res.error) return showError(dialog.el, res.error);
    toast(`${label(line)} replaced — reposted as ${res.line.id}`);
    dialog.close(res.line);
    return undefined;
  });
  return dialog.closed;
}

/** Cancel: the ledger rows are reversed, and a released line tells the claim. */
export async function askCancel(line) {
  const released = line.status === 'Released';
  const reason = await askReason({
    title: `Cancel ${label(line)}`,
    sub: `${line.encounterNo} · ${usd(line.pricing.allowed)} allowed`,
    icon: 'delete',
    tone: 'critical',
    lede: released
      ? 'This line has been released to billing. Cancelling it reverses its ledger rows and marks the claim it sits on stale.'
      : 'The ledger rows this line posted are reversed. Both stay in the trail.',
    confirmLabel: 'Cancel charge',
    placeholder: 'Why the charge is cancelled',
  });
  if (!reason) return null;
  const row = charges.cancel(line.id, reason);
  toast(row ? `${label(line)} cancelled` : 'The line could not be cancelled', row ? 'success' : 'critical');
  return row;
}

/** Hold with a reason from the list, or one typed. */
export async function askHold(line) {
  const dialog = open({
    title: `Hold ${label(line)}`,
    sub: `${line.encounterNo} · a held line is never released until the hold is lifted`,
    icon: 'pause_circle',
    size: 'sm',
    body: `
      <label class="field">
        <span class="icon icon--sm">list</span>
        <select name="reason" aria-label="Reason">
          ${charges.HOLD_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
        </select>
      </label>
      <label class="field field--area">
        <span class="icon icon--sm">notes</span>
        <textarea name="note" rows="2" placeholder="Detail (required when the reason is Other)" aria-label="Detail"></textarea>
      </label>
      <div id="la-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Hold</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'save') return;
    const pick = dialog.el.querySelector('[name="reason"]').value;
    const note = dialog.el.querySelector('[name="note"]').value.trim();
    if (pick === 'Other' && !note) return showError(dialog.el, 'Say why');
    const reason = note ? `${pick} — ${note}` : pick;
    const row = charges.hold(line.id, reason);
    if (!row) return showError(dialog.el, 'The line could not be held');
    toast(`${label(line)} on hold`);
    dialog.close(row);
    return undefined;
  });
  return dialog.closed;
}

export function liftHold(line) {
  const why = charges.unholdBlocked(line);
  if (why) return void toast(why, 'warning');
  const row = charges.unhold(line.id);
  toast(row ? `Hold lifted on ${label(line)}` : 'The hold could not be lifted', row ? 'success' : 'critical');
  return row;
}

/** A role with late-charge rights approves what a feed captured beyond the window. */
export async function askApproveLate(line) {
  const role = currentRole();
  if (!role.canLateCharge) return void toast(`${role.title} cannot approve a late charge`, 'warning');
  const reason = await askReason({
    title: `Approve late charge ${label(line)}`,
    sub: `${line.encounterNo} · ${line.late?.since ? `closed or released ${date(line.late.since)}` : ''}`,
    icon: 'verified',
    tone: 'warning',
    lede: `This charge arrived more than ${CONFIG.claima.capture.lateWindowDays} days after the visit closed or released.
      Approving it lifts the hold; your name and the reason go on the line.`,
    confirmLabel: 'Approve',
    placeholder: 'Why the charge is accepted late',
  });
  if (!reason) return null;
  const row = charges.approveLate(line.id, reason);
  toast(row ? `${label(line)} approved` : 'The late charge could not be approved', row ? 'success' : 'critical');
  return row;
}

export async function releaseLine(line) {
  const why = charges.releaseBlocker(line);
  if (why) return void toast(why, 'warning');
  const ok = await confirm({
    title: 'Release this line?',
    body: `${esc(label(line))} on ${esc(line.encounterNo)} — ${esc(usd(line.pricing.allowed))} allowed — goes to coding and billing. A released line is corrected by cancelling it, never by editing it.`,
    confirmLabel: 'Release',
    icon: 'send',
  });
  if (!ok) return null;
  const res = charges.release(line.encounterNo, [line.id]);
  toast(res.released.length ? `${label(line)} released` : res.excluded[0]?.why || 'Nothing released', res.released.length ? 'success' : 'warning');
  return res;
}

/** Release every clean line on a visit, naming what stays behind and why. */
export async function releaseEncounter(no) {
  const lines = charges.byEncounter(no).filter(charges.isUnreleased);
  const clean = lines.filter((line) => !charges.releaseBlocker(line));
  const excluded = lines.filter((line) => charges.releaseBlocker(line));
  if (!clean.length) return void toast('No line on this visit is clean enough to release', 'warning');
  const allowed = clean.reduce((sum, line) => sum + line.pricing.allowed, 0);
  const ok = await confirm({
    title: `Release ${clean.length} line${clean.length === 1 ? '' : 's'} on ${no}?`,
    body: `${esc(usd(allowed))} allowed goes to coding and billing.${excluded.length ? `<br><br>Left behind:<br>${
      excluded.map((line) => `· ${esc(label(line))} — ${esc(charges.releaseBlocker(line))}`).join('<br>')}` : ''}`,
    confirmLabel: 'Release',
    icon: 'send',
  });
  if (!ok) return null;
  const res = charges.release(no);
  toast(`${res.released.length} line${res.released.length === 1 ? '' : 's'} released on ${no}${
    res.excluded.length ? ` — ${res.excluded.length} left behind` : ''}`);
  return res;
}

// --- the one-field reason dialog --------------------------------------------------

async function askReason({ title, sub, icon, tone, lede, confirmLabel, placeholder }) {
  const dialog = open({
    title,
    sub,
    icon,
    tone,
    size: 'sm',
    body: `
      <p class="modal__lede">${lede}</p>
      <label class="field field--area">
        <span class="icon icon--sm">notes</span>
        <textarea name="reason" rows="2" placeholder="${esc(placeholder)}" aria-label="Reason" autofocus></textarea>
      </label>
      <div id="la-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Back</button>
      <button class="btn ${tone === 'critical' ? 'btn--danger' : 'btn--primary'}" data-act="save">${esc(confirmLabel)}</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'save') return;
    const reason = dialog.el.querySelector('[name="reason"]').value.trim();
    if (!reason) return showError(dialog.el, 'Give a reason');
    dialog.close(reason);
    return undefined;
  });
  return dialog.closed;
}

/** The error box is a plain wrapper: .alert sets display, which outranks hidden. */
function showError(el, message) {
  el.querySelector('#la-error').innerHTML = `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(message)}</div></div>`;
  return undefined;
}
