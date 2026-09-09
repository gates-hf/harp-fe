// The check screen's rail: the patient picker, the policy chain and the
// anticipated services, as markup. eligibility-check.js owns the state and the
// events, so the two files each stay near the line cap.
//
// Markup only. Every list here is read from its repository's own helper — the
// chain from policies.chain(), the charge lines from cdm.findActive().

import * as cdm from '../../../../data/repositories/cdm.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import { SELF_PAY } from '../../../../data/engines/eligibility-engine.js';
import { date, esc, usd } from '../../../../shared/format.js';

const MATCHES = 6;

/**
 * The patient half. Nothing chosen is a search box over the register; a chosen
 * patient is the record, its status and the way back to the search.
 */
export function patientHtml(state, role) {
  if (!state.mrn) return searchHtml(state, role);
  const patient = patients.view(patients.get(state.mrn), role);
  if (!patient) return searchHtml(state, role);
  const tone = patients.statusTone(patient.status);
  return `
    <div class="rule-child-row">
      <span class="icon">person</span>
      <div>
        <a class="crumb-link" href="#/frontis/patients/${esc(patient.mrn)}">${esc(patient.nameEn)}</a>
        <br><span class="t-mono-sm">${esc(patient.mrn)}</span>
        <span class="t-body-sm">· ${esc(patient.gender)} · ${esc(patient.nationality)}</span>
      </div>
      <span class="spacer"></span>
      <span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(patient.status)}</span>
      <button class="btn btn--ghost btn--sm" data-act="clear-patient">Change</button>
    </div>
    ${statusBannerHtml(patient)}`;
}

function searchHtml(state, role) {
  const found = state.q.trim() ? patients.search(state.q, {}).slice(0, MATCHES) : [];
  return `
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">search</span>
        <input type="search" id="ec-search" value="${esc(state.q)}"
               placeholder="Search MRN, name, civil ID or passport" aria-label="Search patients">
      </label>
    </div>
    ${state.q.trim() && !found.length
      ? '<p class="t-body-sm">No patient matches. Try the MRN, or register the patient first.</p>'
      : found.map((p) => matchHtml(patients.view(p, role))).join('')}
    ${state.q.trim() ? '' : '<p class="t-body-sm">Find the patient to verify. A restricted record is listed and read masked.</p>'}`;
}

function matchHtml(p) {
  return `
    <div class="rule-child-row" data-pick="${esc(p.mrn)}" tabindex="0" title="Choose ${esc(p.nameEn)}">
      <span class="icon">person</span>
      <div>
        ${esc(p.nameEn)}
        <br><span class="t-mono-sm">${esc(p.mrn)}</span>
        <span class="t-body-sm">· ${date(p.dob)}${p.civilId ? ` · ${esc(p.civilId)}` : ''}</span>
      </div>
      <span class="spacer"></span>
      <button class="btn btn--secondary btn--sm" data-act="pick-patient">Choose</button>
    </div>`;
}

/** A record that cannot be registered says so before the check is even run. */
function statusBannerHtml(patient) {
  if (patient.status === 'Active') return '';
  const why = patient.status === 'Merged'
    ? `This record was merged into ${esc(patient.mergedInto)}. Verify the record that survived.`
    : `A ${patient.status.toLowerCase()} record cannot start an encounter, so the check will refuse cover at step 1.`;
  return `
    <div class="alert alert--${patient.status === 'Blocked' ? 'warning' : 'critical'}">
      <span class="icon">${patient.status === 'Blocked' ? 'block' : 'error'}</span>
      <div><div class="title">${esc(patient.status)}</div>${why}</div>
    </div>`;
}

/**
 * The chain in priority order, then the Self-Pay fallback, one radio each. The
 * fallback is not a policy and never a row in the chain, so it is drawn here
 * rather than read from the repository.
 */
export function chainHtml(state) {
  if (!state.mrn) return '<p class="t-body-sm">Choose a patient to see the cover on file.</p>';
  const chain = policies.chain(state.mrn);
  return chain.map((p) => coverRowHtml(p.id, state.policyId, coverLabelHtml(p))).join('')
    + coverRowHtml(SELF_PAY, state.policyId, `
        <span class="t-title-sm">Self-Pay</span>
        <br><span class="t-body-sm">The patient pays. Recorded without verification.</span>`);
}

function coverLabelHtml(p) {
  const left = policies.daysLeft(p);
  return `
    <span class="t-title-sm">${esc(policies.payerName(p))} · ${esc(policies.planName(p))}</span>
    <br><span class="t-body-sm">${esc(policies.priorityLabel(p.priority))} · ${esc(p.memberId)} ·
      ${date(p.validFrom)} – ${date(p.validTo)}${left !== null && left <= 30 ? ` · expires in ${left} ${left === 1 ? 'day' : 'days'}` : ''}</span>`;
}

/** The design system ships no radio row, so the label carries a bare input. */
function coverRowHtml(value, selected, inner) {
  return `
    <label class="rule-child-row">
      <input type="radio" name="ec-cover" value="${esc(value)}"${value === selected ? ' checked' : ''}>
      <div>${inner}</div>
    </label>`;
}

/** The chain note: how many positions the check can try, in words. */
export function chainNote(state) {
  if (!state.mrn) return '';
  const n = policies.chain(state.mrn).length;
  if (!n) return 'No policy on file — this patient is self-pay.';
  return `${n} ${n === 1 ? 'policy' : 'policies'} in the chain, then Self-Pay`;
}

/** One anticipated service: the charge picker and its quantity on a row. */
export function servicesHtml(state) {
  if (!state.services.length) {
    return `<p class="t-body-sm">No services named. The check answers off the plan's default coverage rule —
      add the anticipated charges to price them and see which need approval.</p>`;
  }
  return state.services.map((line, i) => {
    const item = cdm.get(line.itemId);
    return `
      <div class="toolbar" data-index="${i}">
        <label class="field field--grow">
          <span class="icon icon--sm">sell</span>
          <select data-field="itemId" aria-label="Service ${i + 1}">${chargeOptions(line.itemId)}</select>
        </label>
        <label class="field">
          <span class="icon icon--sm">tag</span>
          <input type="number" min="1" step="1" value="${esc(line.qty)}" data-field="qty"
                 aria-label="Quantity on service ${i + 1}">
        </label>
        <span class="t-body-sm">${item ? usd(item.standardPrice) : '—'}</span>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="remove-service" title="Remove service ${i + 1}">
          <span class="icon icon--sm">delete</span>
        </button>
      </div>`;
  }).join('');
}

/**
 * The charge picker. Pactum's importer has a helper shaped like this, but a
 * module never reaches into another module's files — the list itself is shared,
 * through cdm.findActive(), which is the part that has to stay in step.
 */
function chargeOptions(selectedId) {
  return `<option value=""${selectedId ? '' : ' selected'}>Choose a charge line</option>${
    cdm.findActive().map((r) => `<option value="${esc(r.id)}"${r.id === selectedId ? ' selected' : ''}>
        ${esc(r.chargeCode)} — ${esc(cdm.label(r))}</option>`).join('')}`;
}
