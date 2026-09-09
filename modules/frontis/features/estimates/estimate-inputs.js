// The builder's rail: who the estimate is for and what it is being priced
// against. Markup only — estimate-builder.js owns the state and the events.
//
// The two subjects ask different questions and the file is written that way. A
// registered patient has a chain, so the cover is the chain as radios with
// Self-Pay under it — the same list the encounter flow's classification step
// draws. A walk-in has no chain at all: the card is read at the counter, so the
// payer and the plan are picked by hand from the repository's own active lists.

import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as payers from '../../../../data/repositories/payers.js';
import { VISIT_TYPES } from '../../../../data/engines/eligibility-engine.js';
import { DEPARTMENTS } from '../../../../data/seed/reference.js';
import { age, date, esc } from '../../../../shared/format.js';

const MATCHES = 6;

export { VISIT_TYPES, DEPARTMENTS };

// --- subject ------------------------------------------------------------------

/** The register search, or the chosen record's banner over it. */
export function subjectHtml(state, role) {
  if (state.subject.kind === 'prospect') return prospectHtml(state);
  const patient = state.subject.mrn ? patients.view(patients.get(state.subject.mrn), role) : null;
  return `
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">search</span>
        <input type="search" id="eb-patient-q" value="${esc(state.q)}"
               placeholder="Search name, MRN, civil ID or phone" aria-label="Search patients">
      </label>
    </div>
    ${patient ? bannerHtml(patient) : pickerHtml(state, role)}`;
}

function bannerHtml(patient) {
  return `
    <div class="rule-child-row">
      ${patient.photo
        ? `<img class="avatar avatar--lg" src="${esc(patient.photo)}" alt="">`
        : '<span class="icon icon--lg">person</span>'}
      <div>
        <div class="t-title-sm">${esc(patient.nameEn)}
          ${patient.vip && !patient.masked ? '<span class="badge badge--accent">VIP</span>' : ''}
          ${patient.masked ? '<span class="badge">Restricted</span>' : ''}</div>
        <span class="t-mono-sm">${esc(patient.mrn)}</span>
        <span class="t-body-sm">${esc(patient.gender)}${age(patient.dob) === '—' ? '' : `, ${age(patient.dob)}`}</span>
      </div>
      <span class="spacer"></span>
      <button class="btn btn--ghost btn--sm" data-act="unpick">
        <span class="icon icon--sm">swap_horiz</span>Choose another
      </button>
    </div>`;
}

function pickerHtml(state, role) {
  const rows = patients.search(state.q).slice(0, MATCHES);
  if (!state.q.trim()) {
    return '<p class="t-body-sm">Search the register for the patient this estimate is for, or switch to a walk-in quotation.</p>';
  }
  if (!rows.length) {
    return `<p class="t-body-sm">No record matches “${esc(state.q)}”. A patient nobody has registered can still be
      quoted as a walk-in.</p>`;
  }
  return `
    <table class="tbl">
      <thead><tr><th scope="col">Patient</th><th scope="col">MRN</th><th scope="col">Date of birth</th></tr></thead>
      <tbody>
        ${rows.map((raw) => {
          const p = patients.view(raw, role);
          return `
            <tr data-mrn="${esc(p.mrn)}" tabindex="0" title="Quote for ${esc(p.nameEn)}">
              <td>${esc(p.nameEn)}${p.masked ? ' <span class="badge">Restricted</span>' : ''}</td>
              <td class="t-mono-sm">${esc(p.mrn)}</td>
              <td class="t-mono-sm">${date(p.dob)}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

/** A quotation for somebody nobody has registered: two fields and a warning. */
function prospectHtml(state) {
  return `
    <div class="rule-child-row">
      <span class="icon">person_search</span>
      <div>
        <div class="t-title-sm">Prospect — not linked to a patient</div>
        <span class="t-body-sm">Nothing is written to the register. Converting this estimate is what registers
          them, and the document is watermarked until it does.</span>
      </div>
    </div>
    <dl class="dl dl--narrow">
      <dt><label for="eb-name">Name</label></dt>
      <dd><label class="field">
        <input id="eb-name" type="text" value="${esc(state.subject.name)}" placeholder="As it is on the card">
      </label></dd>
      <dt><label for="eb-phone">Mobile</label></dt>
      <dd><label class="field">
        <input id="eb-phone" type="tel" value="${esc(state.subject.phone)}" placeholder="+961 3 000000">
      </label></dd>
    </dl>`;
}

// --- cover --------------------------------------------------------------------

/** The chain as radios with Self-Pay under it, or the walk-in's two pickers. */
export function policyHtml(state) {
  return `
    ${state.subject.kind === 'patient' ? chainHtml(state) : manualCoverHtml(state)}
    ${contractWarningHtml(state)}`;
}

function chainHtml(state) {
  if (!state.subject.mrn) return '<p class="t-body-sm">Choose the patient first — the cover comes off their chain.</p>';
  const chain = policies.chain(state.subject.mrn);
  const chosen = state.policy.selfPay ? 'self' : state.policy.policyId;
  const row = (value, label, sub) => `
    <label class="rule-child-row">
      <input type="radio" name="eb-policy" value="${esc(value)}"${value === chosen ? ' checked' : ''}>
      <div>
        <div>${label}</div>
        <span class="t-body-sm">${esc(sub)}</span>
      </div>
    </label>`;
  return `
    ${chain.map((p) => row(p.id,
      `${esc(policies.label(p))} <span class="badge">${esc(policies.priorityLabel(p.priority))}</span>`,
      `Member ${p.memberId} · valid to ${date(p.validTo)}`)).join('')}
    ${row('self', 'Self-Pay', chain.length
      ? 'The patient pays, whatever the chain says.'
      : 'No policy on the chain — the patient pays.')}`;
}

function manualCoverHtml(state) {
  const payer = state.policy.payerId ? payers.get(state.policy.payerId) : null;
  const plans = (payer?.plans || []).filter((p) => p.status === 'Active');
  return `
    <label class="rule-child-row">
      <input type="radio" name="eb-selfpay" value="cover"${state.policy.selfPay ? '' : ' checked'}>
      <div>
        <div>Insured — read the payer and the plan off the card</div>
        <span class="t-body-sm">The estimate is priced under the agreement the hospital holds with that payer.</span>
      </div>
    </label>
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">apartment</span>
        <select id="eb-payer" aria-label="Payer"${state.policy.selfPay ? ' disabled' : ''}>
          <option value=""${payer ? '' : ' selected'}>Choose a payer</option>
          ${payers.findActive().map((p) => `
            <option value="${esc(p.id)}"${p.id === state.policy.payerId ? ' selected' : ''}>${esc(p.nameEn)}</option>`).join('')}
        </select>
      </label>
      <label class="field field--grow">
        <span class="icon icon--sm">badge</span>
        <select id="eb-plan" aria-label="Plan"${state.policy.selfPay || !payer ? ' disabled' : ''}>
          ${plans.length
            ? plans.map((p) => `<option value="${esc(p.id)}"${p.id === state.policy.planId ? ' selected' : ''}>
                ${esc(p.name)} — ${esc(p.code)}</option>`).join('')
            : `<option value="">${payer ? 'This payer has no active plan' : 'Choose a payer first'}</option>`}
        </select>
      </label>
    </div>
    <label class="rule-child-row">
      <input type="radio" name="eb-selfpay" value="self"${state.policy.selfPay ? ' checked' : ''}>
      <div>
        <div>Self-Pay</div>
        <span class="t-body-sm">No card at the counter — priced at the charge master's standard rates.</span>
      </div>
    </label>`;
}

/**
 * The plan is real and the agreement is not: the estimate can still be built,
 * but nothing prices it, so the warning is raised where the plan is chosen
 * rather than left for the result panel to explain.
 */
function contractWarningHtml(state) {
  const { planId, selfPay } = state.policy;
  if (selfPay || !planId) return '';
  if (policies.planHasActiveContract(planId, state.context.dateOfService)) return '';
  return `
    <div class="alert alert--warning">
      <span class="icon">error</span>
      <div>
        <div class="title">No agreement prices this plan on ${date(state.context.dateOfService)}</div>
        The cover is real, but the hospital holds no contract that names this plan on that date. The estimate can
        be built; it cannot be priced until one is in force, or until it is quoted as Self-Pay.
      </div>
    </div>`;
}

export const optionList = (values, chosen) =>
  values.map((v) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(v)}</option>`).join('');
