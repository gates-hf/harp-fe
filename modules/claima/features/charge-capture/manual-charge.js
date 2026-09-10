// Manual charge — a charge entered by hand against a visit, in the shared
// modal. The price is the engine's: the preview under the fields is
// charges.preview(), the same call the capture makes, so what is shown is what
// lands. There is no field for a payer or a patient share anywhere here.
//
// A late charge says so before it is captured: a banner names when the visit
// closed or released, and beyond the window the Capture button is off for a
// role without late-charge rights, with the reason in its tooltip.

import * as charges from '../../../../data/repositories/charges.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { DOCTORS } from '../../../../data/seed/reference.js';
import { CONFIG } from '../../../../shared/config.js';
import { date, esc, todayIso, usd } from '../../../../shared/format.js';
import { open } from '../../../../shared/modal.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';

/**
 * openManualCharge({ encounterNo, itemId, qty, dateOfService }, { onDone })
 * Resolves with the captured line, or undefined when the dialog was closed.
 */
export async function openManualCharge(prefill = {}, { onDone } = {}) {
  const state = {
    encounterNo: prefill.encounterNo || '',
    itemId: prefill.itemId || '',
    qty: Math.max(1, Number(prefill.qty) || 1),
    dateOfService: prefill.dateOfService || todayIso(),
    doctorId: '',
    reason: '',
  };
  const enc0 = encounters.get(state.encounterNo);
  if (enc0) state.doctorId = enc0.doctorId || '';

  const dialog = open({
    title: 'Manual charge',
    sub: 'Priced through the agreement in force on the date of service',
    icon: 'add_card',
    size: 'lg',
    body: bodyHtml(state),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="capture" id="mc-capture">Capture</button>`,
  });
  const el = dialog.el;
  const $ = (sel) => el.querySelector(sel);

  function redraw() {
    $('.modal__body').innerHTML = bodyHtml(state);
    syncButton();
  }

  function syncButton() {
    const btn = $('#mc-capture');
    const why = blocker(state);
    btn.disabled = Boolean(why);
    btn.title = why || 'Capture and post this charge';
  }

  el.addEventListener('input', (e) => {
    const field = e.target.closest('[data-field]');
    if (!field) return;
    if (field.dataset.field === 'reason') {
      state.reason = field.value;
      syncButton();
    }
  });

  el.addEventListener('change', (e) => {
    const field = e.target.closest('[data-field]');
    if (!field) return;
    const key = field.dataset.field;
    if (key === 'reason') return;
    state[key] = key === 'qty' ? Math.max(1, Number(field.value) || 1) : field.value;
    if (key === 'encounterNo') {
      const enc = encounters.get(state.encounterNo);
      state.doctorId = enc?.doctorId || '';
      const { from, to } = charges.dosBounds(enc);
      if (enc && (state.dateOfService < from || state.dateOfService > to)) state.dateOfService = to;
    }
    redraw();
  });

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'capture') return;
    const enc = encounters.get(state.encounterNo);
    const late = charges.lateness(enc);
    const res = charges.capture(state.encounterNo, state, {
      type: 'Manual', ref: '', capturedBy: currentRole().name, reason: state.reason.trim(),
    }, { lateReason: late && !late.window ? state.reason.trim() : '' });
    if (res.error) {
      toast(res.error, 'critical');
      return;
    }
    const item = cdm.get(res.line.itemId);
    toast(`${item.chargeCode} ×${res.line.qty} captured on ${res.line.encounterNo} — ${usd(res.line.pricing.allowed)} allowed${
      res.line.flags.includes('Late') ? ' (late)' : ''}`);
    dialog.close(res.line);
    onDone?.(res.line);
  });

  syncButton();
  return dialog.closed;
}

// --- markup ---------------------------------------------------------------------

/** Why Capture is off, or ''. The repository's own refusal, then the reason. */
function blocker(state) {
  const enc = encounters.get(state.encounterNo);
  if (!enc) return 'Choose an encounter';
  if (!state.itemId) return 'Choose a charge';
  const late = charges.lateness(enc);
  const why = charges.captureBlocked(enc, state, { lateReason: late && !late.window ? state.reason.trim() : '' });
  if (why) return why;
  if (!state.reason.trim()) return 'Give the reason the charge is entered by hand';
  return '';
}

function bodyHtml(state) {
  const enc = encounters.get(state.encounterNo);
  const item = cdm.get(state.itemId);
  const { from, to } = enc ? charges.dosBounds(enc) : { from: '', to: todayIso() };
  return `
    ${bannerHtml(enc)}
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">event_available</span>
        <select data-field="encounterNo" aria-label="Encounter">
          <option value=""${enc ? '' : ' selected'}>Choose an encounter</option>
          ${encounterOptions().map((row) => `
            <option value="${esc(row.no)}"${row.no === state.encounterNo ? ' selected' : ''}>${esc(encounterLabel(row))}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">sell</span>
        <select data-field="itemId" aria-label="Charge">
          <option value=""${item ? '' : ' selected'}>Choose a charge</option>
          ${cdm.findActive().map((row) => `
            <option value="${esc(row.id)}"${row.id === state.itemId ? ' selected' : ''}>${esc(row.chargeCode)} — ${esc(cdm.label(row))}${
              cdm.isBundle(row) ? ' (package)' : ''} · ${esc(usd(row.standardPrice))}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span class="icon icon--sm">tag</span>
        <input type="number" min="1" step="1" value="${esc(state.qty)}" data-field="qty" aria-label="Quantity">
      </label>
    </div>
    <div class="toolbar">
      <label class="field">
        <span class="icon icon--sm">event</span>
        <input type="date" value="${esc(state.dateOfService)}" min="${esc(from)}" max="${esc(to)}" data-field="dateOfService"
               aria-label="Date of service" title="${enc ? `Inside the visit: ${esc(date(from))} – ${esc(date(to))}` : ''}">
      </label>
      <label class="field field--grow">
        <span class="icon icon--sm">stethoscope</span>
        <select data-field="doctorId" aria-label="Doctor"
                title="${charges.needsDoctor(item) ? `A ${esc(item.category.toLowerCase())} charge needs the attending doctor` : 'Optional on this charge'}">
          <option value=""${state.doctorId ? '' : ' selected'}>${charges.needsDoctor(item) ? 'Doctor (required)' : 'Doctor (optional)'}</option>
          ${DOCTORS.map((d) => `<option value="${d.id}"${d.id === state.doctorId ? ' selected' : ''}>${esc(d.name)} — ${esc(d.department)}</option>`).join('')}
        </select>
      </label>
    </div>
    <label class="field field--area">
      <span class="icon icon--sm">notes</span>
      <textarea data-field="reason" rows="2" placeholder="Reason the charge is entered by hand (required)"
                aria-label="Reason">${esc(state.reason)}</textarea>
    </label>
    ${previewHtml(state, enc, item)}`;
}

function bannerHtml(enc) {
  if (!enc) return '';
  const late = charges.lateness(enc);
  if (!late) return '';
  const window = CONFIG.claima.capture.lateWindowDays;
  const role = currentRole();
  if (late.window) {
    return `
      <div class="alert alert--info">
        <span class="icon">schedule</span>
        <div>${esc(late.why)}, ${late.days} day${late.days === 1 ? '' : 's'} ago — inside the ${window}-day window.
          This line will be flagged Late.</div>
      </div>`;
  }
  return `
    <div class="alert alert--warning">
      <span class="icon">gpp_maybe</span>
      <div>${esc(late.why)}, ${late.days} days ago — beyond the ${window}-day window. ${role.canLateCharge
        ? 'Your reason below is recorded as the approval.'
        : `${esc(role.title)} cannot capture a charge this late; the RCM coder or the CMO can.`}</div>
    </div>`;
}

function previewHtml(state, enc, item) {
  if (!enc || !item) {
    return `
      <div class="panel panel--sunken">
        <div class="panel-body t-body-sm">Choose an encounter and a charge to see what it prices at.</div>
      </div>`;
  }
  const res = charges.preview(enc.no, state);
  if (res.error || !res.pricing) {
    return `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(res.error || 'This charge could not be priced')}</div></div>`;
  }
  const p = res.pricing;
  const under = res.selfPay
    ? 'Self-Pay — the charge master’s price is the price and the patient carries all of it'
    : `Priced under ${res.trace.contractNo} v${res.trace.version} on ${date(state.dateOfService)}`;
  return `
    <div class="panel panel--sunken">
      <div class="panel-header">
        <span class="t-title-sm">Preview</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${esc(under)}</span>
      </div>
      <div class="panel-body">
        <dl class="dl">
          <dt>Gross</dt><dd class="t-mono-sm">${usd(p.gross)}</dd>
          <dt>Allowed</dt><dd class="t-mono-sm">${usd(p.allowed)}</dd>
          <dt>Payer share</dt><dd class="t-mono-sm">${usd(p.payerShare)}</dd>
          <dt>Patient share</dt><dd class="t-mono-sm"><b>${usd(p.patientShare)}</b></dd>
          <dt>Status</dt><dd>${statusChip(p)}</dd>
        </dl>
        ${p.allowed === 0 ? `
          <div class="alert alert--warning">
            <span class="icon">money_off</span>
            <div>This line prices at nothing${res.trace?.steps?.[4]?.fired?.length
              ? ` — ${esc(res.trace.steps[4].fired.map((r) => r.name).join(', '))}` : ''}. It will be flagged Zero price and cannot be released.</div>
          </div>` : ''}
      </div>
    </div>`;
}

function statusChip(p) {
  if (p.status === 'Not billable') return '<span class="badge badge--critical">Not billable</span>';
  if (p.status === 'Held for approval') return '<span class="badge badge--warning">Held for approval</span>';
  return `<span class="badge badge--success">Priced</span>${p.overageRows ? ` <span class="badge badge--warning">${p.overageRows} overage</span>` : ''}`;
}

/** Visits a charge may land on: open or closed, never cancelled or not yet arrived. */
function encounterOptions() {
  return encounters.all()
    .filter((row) => row.status !== 'Cancelled' && row.status !== 'Planned')
    .sort((a, b) => Number(encounters.isOpen(b)) - Number(encounters.isOpen(a)) || String(b.startAt).localeCompare(String(a.startAt)));
}

function encounterLabel(enc) {
  const patient = patients.view(patients.get(enc.patientMrn), currentRole());
  return `${enc.no} — ${patient?.nameEn || enc.patientMrn} · ${enc.type} · ${enc.department} · ${enc.status}`;
}
