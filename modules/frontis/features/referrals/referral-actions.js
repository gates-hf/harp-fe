// The dialogs that spend, hold and close a referral, asked the same way from
// the worklist row, the form's footer and the read-only page.
//
// Rejecting and cancelling ask for a reason through the shared one-field dialog
// the policy and pre-registration actions already use — one prompt, one shape,
// one trail entry. Linking and scheduling are pickers instead, because the
// answer is a record and not a sentence.

import * as referrals from '../../../../data/repositories/referrals.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as prereg from '../../../../data/repositories/prereg.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { doctorName } from '../../../../data/seed/reference.js';
import { askReason } from '../insurance/policy-actions.js';

/** The subtitle every one of these dialogs carries. */
const sub = (row) =>
  `${referrals.patientName(row)} · ${referrals.partiesLabel(row)}${
    referrals.specialtyOf(row) ? ` · ${referrals.specialtyOf(row)}` : ''}`;

/**
 * Spend a visit on an encounter that already exists. Registration links a
 * referral as it creates the encounter; this is the other way round — the visit
 * was opened first and the letter turned up afterwards.
 */
export async function askLink(no, ctx) {
  const row = referrals.get(no);
  if (!row || !referrals.isOpen(row) || !row.patientMrn) return false;

  const open = encounters.byPatient(row.patientMrn).filter(encounters.isOpen);
  const dialog = modal.open({
    title: `Link ${esc(no)} to an encounter`,
    sub: esc(sub(row)),
    icon: 'link',
    size: 'lg',
    body: open.length ? bodyHtml(row, open) : noEncounterHtml(row),
    note: open.length
      ? `One visit comes off the referral. ${referrals.remaining(row)} of ${row.visits.total} left.`
      : '',
    foot: open.length
      ? `<button class="btn btn--secondary" data-close>Cancel</button>
         <button class="btn btn--primary" data-act="ok">Link the encounter</button>`
      : `<button class="btn btn--secondary" data-close>Close</button>
         <button class="btn btn--primary" data-act="new">Register the visit</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="new"]')) {
      dialog.close('new');
      return;
    }
    if (!e.target.closest('[data-act="ok"]')) return;
    const picked = dialog.el.querySelector('input[name="encounterNo"]:checked');
    const box = dialog.el.querySelector('[data-error]');
    box.hidden = Boolean(picked);
    box.textContent = picked ? '' : 'Choose the encounter this referral was spent on.';
    if (picked) dialog.close(picked.value);
  });

  const answer = await dialog.closed;
  if (answer === 'new') {
    ctx?.navigate(`/frontis/encounters/new?mrn=${row.patientMrn}&referral=${no}`);
    return false;
  }
  if (typeof answer !== 'string') return false;

  referrals.link(no, answer);
  encounters.linkRecord(answer, 'referral', no);
  const after = referrals.get(no);
  toast(after.status === 'Used'
    ? `${no} linked to ${answer} — referral used`
    : `${no} linked to ${answer} — ${referrals.remaining(after)} visit${
      referrals.remaining(after) === 1 ? '' : 's'} left`, 'success');
  return true;
}

function bodyHtml(row, open) {
  return `
    <p class="modal__lede">Choose the visit this referral was spent on. It is recorded on both records: the
      encounter gains the referral, and the referral gains the encounter.</p>
    ${open.map((enc, i) => `
      <label class="rule-child-row">
        <input type="radio" name="encounterNo" value="${esc(enc.no)}"${i === 0 ? ' checked' : ''}>
        <div>
          <div><span class="t-mono-sm">${esc(enc.no)}</span>
            <span class="badge${enc.type === 'ER' ? ' badge--critical' : enc.type === 'IP' ? ' badge--accent' : ''}">${esc(enc.type)}</span>
            <span class="badge${encounters.statusTone(enc.status) ? ` badge--${encounters.statusTone(enc.status)}` : ''}">
              <span class="dot"></span>${esc(enc.status)}</span>
            ${referrals.fitsDepartment(row, enc.department) ? '' : '<span class="badge badge--warning">other department</span>'}
          </div>
          <span class="t-body-sm">${esc(enc.department)} · ${esc(doctorName(enc.doctorId))} · ${dateTime(enc.startAt)}</span>
        </div>
      </label>`).join('')}
    <div class="field-error" data-error hidden></div>`;
}

function noEncounterHtml(row) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">event_busy</span></div>
      <div class="state-view__title">No open encounter</div>
      <p class="state-view__body">${esc(referrals.patientName(row))} has no visit open to spend this referral on.
        Register the visit and the referral is offered on the way through — that is where it is normally linked.</p>
    </div>`;
}

/** Hold the referral against an expected arrival. */
export async function askSchedule(no, ctx) {
  const row = referrals.get(no);
  if (!row || !referrals.isOpen(row) || !row.patientMrn) return false;

  const expected = prereg.byPatient(row.patientMrn).filter(prereg.isOpen);
  const dialog = modal.open({
    title: `Schedule ${esc(no)}`,
    sub: esc(sub(row)),
    icon: 'event_upcoming',
    size: 'lg',
    body: expected.length ? preregBodyHtml(expected) : noPreregHtml(row),
    note: 'The referral stays spendable — scheduling says when it is expected to be spent.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--secondary" data-act="new">
        <span class="icon icon--sm">add</span>New pre-registration</button>
      ${expected.length ? '<button class="btn btn--primary" data-act="ok">Hold the place</button>' : ''}`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="new"]')) return dialog.close('new');
    if (!e.target.closest('[data-act="ok"]')) return;
    const picked = dialog.el.querySelector('input[name="preregNo"]:checked');
    const box = dialog.el.querySelector('[data-error]');
    box.hidden = Boolean(picked);
    box.textContent = picked ? '' : 'Choose the arrival this referral is being held for.';
    if (picked) dialog.close(picked.value);
  });

  const answer = await dialog.closed;
  if (answer === 'new') {
    ctx?.navigate(`/frontis/prereg/new?mrn=${row.patientMrn}&referral=${no}`);
    return false;
  }
  if (typeof answer !== 'string') return false;

  referrals.schedule(no, answer);
  toast(`${no} is held for ${answer}`, 'success');
  return true;
}

function preregBodyHtml(expected) {
  return `
    <p class="modal__lede">Which arrival is this referral being held for? A scheduled referral is still spendable —
      it is the desk saying when it expects to spend it.</p>
    ${expected.map((row, i) => `
      <label class="rule-child-row">
        <input type="radio" name="preregNo" value="${esc(row.no)}"${i === 0 ? ' checked' : ''}>
        <div>
          <div><span class="t-mono-sm">${esc(row.no)}</span>
            <span class="badge${prereg.statusTone(row.status) ? ` badge--${prereg.statusTone(row.status)}` : ''}">
              <span class="dot"></span>${esc(row.status)}</span></div>
          <span class="t-body-sm">${esc(prereg.typeLabel(row.visit.type))} · ${esc(row.visit.department)} ·
            ${dateTime(row.visit.expectedAt)}</span>
        </div>
      </label>`).join('')}
    <div class="field-error" data-error hidden></div>`;
}

function noPreregHtml(row) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">event_upcoming</span></div>
      <div class="state-view__title">Nothing expected</div>
      <p class="state-view__body">${esc(referrals.patientName(row))} has no open pre-registration. Book the arrival
        and the referral is held against it.</p>
    </div>`;
}

/**
 * A pre-registration was taken for somebody with no record, and a referral is
 * already open on that phone number. Offering it here is the whole point of
 * taking the number: the desk booked the arrival the clinic asked for, and the
 * two records find each other before the patient walks in.
 *
 * Resolves the referral number that was held, or ''.
 */
export async function askLinkReferral(preregNo, phone) {
  const found = referrals.byPhone(phone).filter((row) => row.scheduledPreregNo !== preregNo);
  if (!found.length) return '';

  const dialog = modal.open({
    title: found.length === 1 ? 'A referral is open on this number' : 'Referrals are open on this number',
    sub: esc(`${preregNo} · ${phone}`),
    icon: 'forward',
    size: 'lg',
    body: `
      <p class="modal__lede">Nobody has registered this patient yet, so ${found.length === 1
        ? 'this referral is'
        : 'these referrals are'} still waiting on the phone number the clinic gave. Holding
        ${found.length === 1 ? 'it' : 'one'} against this arrival is what tells the desk why the patient is
        coming.</p>
      ${found.map((row, i) => `
        <label class="rule-child-row">
          <input type="radio" name="referralNo" value="${esc(row.no)}"${i === 0 ? ' checked' : ''}>
          <div>
            <div><span class="t-mono-sm">${esc(row.no)}</span>
              <span class="badge">${esc(referrals.specialtyOf(row) || 'no specialty')}</span></div>
            <span class="t-body-sm">${esc(referrals.sourceLabel(row))} · written ${date(row.referralDate)}${
              row.validUntil ? ` · valid to ${date(row.validUntil)}` : ''}</span>
          </div>
        </label>`).join('')}`,
    note: 'Registering the patient later attaches the referral to their record as well.',
    foot: `
      <button class="btn btn--secondary" data-close>Not now</button>
      <button class="btn btn--primary" data-act="ok">Hold the referral</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ok"]')) return;
    const picked = dialog.el.querySelector('input[name="referralNo"]:checked');
    if (picked) dialog.close(picked.value);
  });

  const answer = await dialog.closed;
  if (typeof answer !== 'string') return '';
  referrals.schedule(answer, preregNo);
  toast(`${answer} is held for ${preregNo}`, 'success');
  return answer;
}

/** The hospital will not answer this question. */
export async function askReject(no) {
  const row = referrals.get(no);
  if (!row || !referrals.isOpen(row)) return false;

  const reason = await askReason({
    title: `Reject ${no}?`,
    sub: sub(row),
    icon: 'thumb_down',
    tone: 'critical',
    lede: 'The referral is kept and stops being work: it leaves the worklist and cannot be spent. The reason is what the referring doctor is told.',
    placeholder: 'This hospital has no interventional cardiology service — referred on to the Hôtel-Dieu.',
    confirmLabel: 'Reject the referral',
  });
  if (!reason) return false;

  referrals.reject(no, reason);
  toast(`${no} rejected`, 'success');
  return true;
}

/** Withdrawn by whoever wrote it, or taken twice. */
export async function askCancel(no) {
  const row = referrals.get(no);
  if (!row || !referrals.isOpen(row)) return false;

  const reason = await askReason({
    title: `Cancel ${no}?`,
    sub: sub(row),
    icon: 'cancel',
    tone: 'critical',
    lede: 'The referral is kept and stops being work. Nothing has been written against a visit, so nothing is undone.',
    placeholder: 'Taken twice — the same letter is already on REF-2026-000204.',
    confirmLabel: 'Cancel the referral',
  });
  if (!reason) return false;

  referrals.cancel(no, reason);
  toast(`${no} cancelled`, 'success');
  return true;
}

/**
 * More time. An expired referral is the reason this exists, and extending one
 * puts it back on the worklist: the question it asks has not changed.
 */
export async function askExtend(no) {
  const row = referrals.get(no);
  if (!row || (!referrals.isOpen(row) && row.status !== 'Expired')) return false;

  const dialog = modal.open({
    title: `Extend ${esc(no)}`,
    sub: esc(sub(row)),
    icon: 'more_time',
    size: 'md',
    body: `
      <p class="modal__lede">${row.status === 'Expired'
        ? `This referral ran out on ${date(row.validUntil)} with ${referrals.remaining(row)} visit${
          referrals.remaining(row) === 1 ? '' : 's'} unspent. Give it a new date and it goes back on the worklist.`
        : `It is good until ${date(row.validUntil) || '—'}. A new date replaces that one.`}</p>
      <dl class="dl">
        <dt>Valid until *</dt>
        <dd>
          <label class="field"><input type="date" name="validUntil" value="${esc(referrals.defaultValidUntil())}"></label>
          <div class="field-error" data-error="validUntil" hidden></div>
        </dd>
        <dt>Reason *</dt>
        <dd>
          <label class="field field--area">
            <textarea name="reason" rows="3"
                      placeholder="Referring clinic confirmed by phone that the request still stands."></textarea>
          </label>
          <div class="field-error" data-error="reason" hidden></div>
        </dd>
      </dl>`,
    note: 'The change is recorded in the trail with your name and the time.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ok">Extend validity</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ok"]')) return;
    const dateInput = dialog.el.querySelector('[name="validUntil"]');
    const reasonInput = dialog.el.querySelector('[name="reason"]');
    const value = dateInput.value;
    const reason = reasonInput.value.trim();
    const problems = {
      validUntil: !value ? 'Enter the new end date.'
        : new Date(`${value}T00:00:00Z`).getTime() <= Date.now() - 86400000
          ? 'The new date has to be ahead of today, or the referral lapses again on the next sweep.' : '',
      reason: reason.length < 5 ? 'Enter the reason. It is what the next reader of this referral sees.' : '',
    };
    let focused = false;
    for (const [key, message] of Object.entries(problems)) {
      const box = dialog.el.querySelector(`[data-error="${key}"]`);
      const input = key === 'reason' ? reasonInput : dateInput;
      box.hidden = !message;
      box.textContent = message;
      input.closest('.field').classList.toggle('field--invalid', Boolean(message));
      if (message && !focused) {
        input.focus();
        focused = true;
      }
    }
    if (!focused) dialog.close({ validUntil: value, reason });
  });

  const answer = await dialog.closed;
  if (!answer) return false;

  referrals.extend(no, answer.validUntil, answer.reason);
  toast(`${no} is valid until ${date(answer.validUntil)}`, 'success');
  return true;
}
