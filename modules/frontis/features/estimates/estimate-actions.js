// What can be done to an estimate from the list, the builder and the document:
// issue it, copy it, cancel it, read its trail, and turn it into the visit it
// was quoted for. One file, so the three screens cannot offer three different
// versions of the same act.
//
// Conversion is the one with a shape of its own. An estimate for a registered
// patient hands the visit straight to the encounter flow through ?estimate=,
// which is what pre-fills its steps and writes the conversion back on create.
// An estimate for a walk-in has no record to open a visit against, so the real
// registration form is mounted in the shared drawer first — the same form, the
// same duplicate check, the same MRN sequence — and the document is re-pointed
// at the record it just made before the flow is handed the visit.

import * as estimates from '../../../../data/repositories/estimates.js';
import * as modal from '../../../../shared/modal.js';
import { CONFIG } from '../../../../shared/config.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, todayIso, usd } from '../../../../shared/format.js';
import { openRegisterDrawer } from '../encounters/encounter-register.js';
import { openEstimateHistory } from './estimate-history.js';

/**
 * The row and header actions every screen shares. Returns true when something
 * was written, for a caller that redraws by hand; the lists subscribe to the
 * store and redraw on their own.
 */
export async function handleAction(act, no, ctx) {
  if (act === 'history') return void (await openEstimateHistory(no));
  if (act === 'duplicate') return duplicate(no, ctx);
  if (act === 'print') return void ctx.navigate(`/frontis/estimates/${no}?print=1`);
  if (act === 'convert') return convert(no, ctx);
  if (act === 'cancel') return askCancel(no);
  return false;
}

function duplicate(no, ctx) {
  const copy = estimates.duplicate(no);
  if (!copy) return false;
  toast(`${copy.no} drafted from ${no}`, 'success');
  ctx.navigate(`/frontis/estimates/${copy.no}`);
  return true;
}

/**
 * Issue: the last thing a draft does. The dialog exists to ask one question —
 * how long the price stands — because that is the only field the patient is
 * handed that nobody has set yet. Everything else has been on screen already.
 */
export async function askIssue(no, { validDays = CONFIG.estimateValidityDays } = {}) {
  const row = estimates.get(no);
  if (!row) return null;
  const result = estimates.simulate(row);
  const until = addDays(todayIso(), validDays);

  const dialog = modal.open({
    title: `Issue ${no}`,
    sub: 'The price is frozen into the document and stops moving',
    icon: 'task_alt',
    tone: 'warning',
    body: `
      <p class="t-body-sm">Once issued, this estimate is a document: it records what the configuration answered
        today and is never recomputed. A change to the agreement or to the cover from tomorrow changes the next
        estimate, not this one.</p>
      <dl class="dl dl--narrow">
        <dt>Patient share</dt><dd class="t-mono-sm">${usd(result.totals.patientShare)}</dd>
        <dt>Total charges</dt><dd class="t-mono-sm">${usd(result.totals.allowed)}</dd>
        <dt>Priced under</dt><dd>${result.contract
          ? `<span class="t-mono-sm">${esc(result.contract.no)}</span> v${esc(result.contract.version)}`
          : 'Self-Pay'}</dd>
      </dl>
      ${result.preAuthFlags.length
        ? `<div class="alert alert--warning"><span class="icon">gpp_maybe</span>
             <div>${result.preAuthFlags.length} charge${result.preAuthFlags.length === 1 ? '' : 's'} on this
               estimate need pre-authorisation. They are named on the document the patient is handed.</div></div>`
        : ''}
      ${estimates.isProspect(row)
        ? `<div class="alert alert--info"><span class="icon">person_search</span>
             <div>This is a walk-in quotation. The document is watermarked as a prospect until the patient is
               registered, which conversion does.</div></div>`
        : ''}
      <div class="toolbar">
        <label class="field">
          <span class="icon icon--sm">event</span>
          <input type="date" id="ei-until" value="${esc(until)}" min="${esc(todayIso())}" aria-label="Valid until">
        </label>
        <span class="t-body-sm">how long this price stands</span>
      </div>
      <div id="ei-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="issue"><span class="icon icon--sm">task_alt</span>Issue</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="issue"]')) return;
    const value = dialog.el.querySelector('#ei-until').value;
    // .alert sets display:flex, which outranks hidden — the box is a plain
    // wrapper the alert is written into and emptied out of.
    const box = dialog.el.querySelector('#ei-error');
    if (!value || value < todayIso()) {
      box.innerHTML = `
        <div class="alert alert--critical"><span class="icon">error</span>
          <div>An estimate cannot be valid until a date that has passed.</div></div>`;
      return;
    }
    dialog.close(value);
  });

  const until2 = await dialog.closed;
  if (typeof until2 !== 'string') return null;
  const issued = estimates.issue(no, { validUntil: until2 });
  if (!issued) return toast('Nothing to issue — add a service first', 'warning') || null;
  toast(`${no} issued, valid to ${date(issued.validUntil)}`, 'success');
  return issued;
}

/** Cancelling is a decision, so it asks for the reason it was taken. */
export async function askCancel(no) {
  const row = estimates.get(no);
  if (!row) return false;
  const dialog = modal.open({
    title: `Cancel ${no}`,
    sub: `${estimates.subjectName(row)} · ${estimates.coverLabel(row)}`,
    icon: 'cancel',
    tone: 'critical',
    body: `
      <p class="t-body-sm">A cancelled estimate stays on file and stays readable — it is a quotation the desk
        withdrew, not one that never existed. It cannot be issued or converted afterwards.</p>
      <label class="field field--area">
        <textarea id="ec-reason" rows="3" placeholder="Why is this quotation being withdrawn?"
                  aria-label="Reason"></textarea>
      </label>`,
    foot: `
      <button class="btn btn--secondary" data-close>Keep it</button>
      <button class="btn btn--critical" data-act="cancel">Cancel estimate</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="cancel"]')) dialog.close(dialog.el.querySelector('#ec-reason').value.trim());
  });

  const reason = await dialog.closed;
  if (typeof reason !== 'string') return false;
  estimates.cancel(no, reason);
  toast(`${no} cancelled`, 'info');
  return true;
}

// --- conversion ---------------------------------------------------------------

/**
 * The estimate becoming the visit it priced. Nothing is written here: the
 * encounter flow is what creates the encounter, and creating it is what closes
 * this estimate — the same rule the pre-registration conversion follows.
 */
async function convert(no, ctx) {
  const row = estimates.get(no);
  if (!row || !estimates.isLive(row)) {
    toast('Only an issued estimate inside its validity converts', 'warning');
    return false;
  }
  if (estimates.isProspect(row)) {
    const linked = await registerProspect(row);
    if (!linked) return false;
    ctx.navigate(`/frontis/encounters/new?mrn=${linked}&estimate=${no}`);
    return true;
  }
  ctx.navigate(`/frontis/encounters/new?mrn=${row.subject.mrn}&estimate=${no}`);
  return true;
}

/**
 * A walk-in becoming a patient. The registration screen itself is mounted in
 * the shared drawer, prefilled with the two things the counter took, so there
 * is no second registration form to keep in step.
 */
async function registerProspect(row) {
  const confirmed = await modal.confirm({
    title: 'Register this patient first',
    body: `<p class="t-body-sm">${esc(row.subject.name)} was quoted at the counter and has no record. A visit is
      opened against a record, so the register asks for the rest of the details first — the full duplicate check
      runs on save, and an identifier already on file stops it.</p>`,
    confirmLabel: 'Register patient',
    tone: 'warning',
    icon: 'person_add',
  });
  if (!confirmed) return '';

  const mrn = await openRegisterDrawer({ nameEn: row.subject.name, phone: row.subject.phone });
  if (!mrn) return '';
  estimates.linkSubject(row.no, mrn);
  toast(`${row.no} linked to ${mrn}`, 'success');
  return mrn;
}

function addDays(day, n) {
  const when = new Date(`${day}T00:00:00.000Z`);
  when.setUTCDate(when.getUTCDate() + n);
  return when.toISOString().slice(0, 10);
}
