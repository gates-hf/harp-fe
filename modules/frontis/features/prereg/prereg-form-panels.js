// The four panels of the pre-registration form, as markup. prereg-form.js owns
// the state, every event and every write; this file only draws, so the two stay
// near the line cap — the split encounter-steps.js already uses.
//
// Every list is read from its repository's own helper: the register through
// patients.search(), the chain through policies.chain(), the procedure picker
// through cdm.findActive(), the departments and doctors from the one reference
// seed.

import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as prereg from '../../../../data/repositories/prereg.js';
import * as eligibility from '../../../../data/repositories/eligibility.js';
import { DEPARTMENTS, doctorsIn } from '../../../../data/seed/reference.js';
import { age, date, dateTime, esc } from '../../../../shared/format.js';
import { conditionsHtml, failuresHtml, resultBadge } from '../eligibility/eligibility-panel.js';

const MATCHES = 6;

// --- 1. patient ----------------------------------------------------------------

/** A linked record, or the search over the register with the minimal form under it. */
export function patientPanel(state, role) {
  if (state.patientMrn) return linkedHtml(state, role);
  return `
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">search</span>
        <input type="search" id="pf-q" value="${esc(state.q)}"
               placeholder="Search MRN, name, civil ID or phone" aria-label="Search the register">
      </label>
    </div>
    ${matchesHtml(state, role)}
    <div class="toolbar"><span class="t-title-sm">Or take the details now</span></div>
    <p class="t-body-sm">Enough to recognise the patient on arrival. The full record is created at conversion,
      where the register asks for everything it needs.</p>
    ${newPatientHtml(state)}
    ${state.dup ? dupHtml(state.dup) : ''}`;
}

function linkedHtml(state, role) {
  const patient = patients.view(patients.get(state.patientMrn), role);
  if (!patient) return '<p class="t-body-sm">This record is no longer on file.</p>';
  const tone = patients.statusTone(patient.status);
  return `
    <div class="rule-child-row">
      <span class="icon">person</span>
      <div>
        <a class="crumb-link" href="#/frontis/patients/${esc(patient.mrn)}">${esc(patient.nameEn)}</a>
        <br><span class="t-mono-sm">${esc(patient.mrn)}</span>
        <span class="t-body-sm">· ${esc(patient.gender)}${age(patient.dob) === '—' ? '' : `, ${age(patient.dob)}`}
          · ${esc(patient.phone || '—')}</span>
      </div>
      <span class="spacer"></span>
      <span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(patient.status)}</span>
      ${state.readOnly ? '' : '<button class="btn btn--ghost btn--sm" data-act="unlink">Unlink</button>'}
    </div>
    <p class="t-body-sm">Linked to ${esc(patient.mrn)} — identity is read from the record, so the checklist counts it complete.
      ${patients.canOpenEncounter(patient) ? '' : `A ${patient.status.toLowerCase()} record cannot open an encounter, so this one will not convert.`}</p>`;
}

function matchesHtml(state, role) {
  const q = state.q.trim();
  if (!q) return '<p class="t-body-sm">Search first — a patient who has been here before keeps one record.</p>';
  const found = patients.search(q, {}).slice(0, MATCHES);
  if (!found.length) return '<p class="t-body-sm">No record matches. Take the details below instead.</p>';
  return found.map((p) => {
    const view = patients.view(p, role);
    return `
      <div class="rule-child-row">
        <span class="icon">person</span>
        <div>${esc(view.nameEn)}
          <br><span class="t-mono-sm">${esc(view.mrn)}</span>
          <span class="t-body-sm">· ${date(view.dob)}${view.civilId ? ` · ${esc(view.civilId)}` : ''}</span>
        </div>
        <span class="spacer"></span>
        <button class="btn btn--secondary btn--sm" data-act="link" data-mrn="${esc(view.mrn)}">Link</button>
      </div>`;
  }).join('');
}

function newPatientHtml(state) {
  const p = state.newPatient;
  return `
    <dl class="dl">
      ${field('Name (EN) *', `<input name="nameEn" value="${esc(p.nameEn)}" placeholder="Jad Moukarzel">`)}
      ${field('Name (AR)', `<input name="nameAr" value="${esc(p.nameAr)}" dir="rtl" placeholder="جاد مكرزل">`)}
      ${field('Date of birth *', `<input name="dob" type="date" value="${esc(p.dob)}">`)}
      ${field('Gender *', `<select name="gender">${patients.GENDERS
        .map((g) => `<option value="${g}"${p.gender === g ? ' selected' : ''}>${g}</option>`).join('')}</select>`)}
      ${field('Mobile *', `<input name="phone" value="${esc(p.phone)}" placeholder="+961 3 447 219">`)}
      ${field('Nationality', `<select name="nationality">${patients.NATIONALITIES
        .map((n) => `<option value="${n}"${p.nationality === n ? ' selected' : ''}>${n}</option>`).join('')}</select>`)}
      ${field('Civil ID', `<input name="civilId" value="${esc(p.civilId || '')}" placeholder="94092201">`)}
      ${field('Passport no.', `<input name="passportNo" value="${esc(p.passportNo || '')}" placeholder="LB7742019">`)}
    </dl>`;
}

/**
 * The soft duplicate answer. An identifier already on file is offered as a link
 * rather than refused: nothing is being registered here, so there is nothing to
 * block — the right answer is to point at the record that already exists.
 */
function dupHtml(dup) {
  if (dup.hard) {
    return `
      <div class="alert alert--warning">
        <span class="icon">person_search</span>
        <div>
          <div class="title">Already registered as ${esc(dup.hard.mrn)}</div>
          ${esc(dup.hard.nameEn)}, born ${date(dup.hard.dob)}, carries this identifier.
          <button class="btn btn--secondary btn--sm" data-act="link" data-mrn="${esc(dup.hard.mrn)}">Link instead</button>
        </div>
      </div>`;
  }
  const names = dup.soft.map((p) => `${p.mrn} (${p.nameEn})`).join(', ');
  return `
    <div class="alert alert--info">
      <span class="icon">info</span>
      <div>
        <div class="title">Similar records on file</div>
        ${esc(names)}. A shared line or a near-matching name is common in one household — link if it is the
        same person, and the duplicate check runs again in full at conversion.
      </div>
    </div>`;
}

// --- 2. expected visit ---------------------------------------------------------

export function visitPanel(state) {
  const v = state.visit;
  return `
    <dl class="dl">
      ${field('Visit type *', `<select name="type">${prereg.VISIT_TYPES
        .map((t) => `<option value="${esc(t)}"${v.type === t ? ' selected' : ''}>${esc(prereg.typeLabel(t))}</option>`).join('')}</select>`)}
      ${field('Expected arrival *', `<input name="expectedAt" type="datetime-local" value="${esc(v.expectedAt)}">`)}
      ${field('Department *', `<select name="department"><option value="">Choose a department</option>${DEPARTMENTS
        .map((d) => `<option value="${esc(d)}"${v.department === d ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select>`)}
      ${field('Doctor', `<select name="doctorId"><option value="">Not assigned yet</option>${doctorsIn(v.department)
        .map((d) => `<option value="${esc(d.id)}"${v.doctorId === d.id ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`)}
      ${field('Planned procedure', `<select name="procedureItemId"><option value="">None named</option>${cdm.findActive()
        .map((r) => `<option value="${esc(r.id)}"${v.procedureItemId === r.id ? ' selected' : ''}>${esc(r.chargeCode)} — ${esc(cdm.label(r))}</option>`).join('')}</select>`)}
      <dt>Admission intent</dt>
      <dd>
        <div class="segmented" role="group" aria-label="Admission intent">
          <button data-intent="true" aria-pressed="${v.admissionIntent}"${v.type === 'IP' ? ' disabled' : ''}>Yes</button>
          <button data-intent="false" aria-pressed="${!v.admissionIntent}"${v.type === 'IP' ? ' disabled' : ''}>No</button>
        </div>
        <span class="t-body-sm">${v.type === 'IP'
          ? 'An inpatient visit is an admission — the ward, the bed class and the length of stay are asked at conversion.'
          : 'Turn on when the clinic expects to admit from this visit.'}</span>
      </dd>
    </dl>`;
}

// --- 3. insurance --------------------------------------------------------------

export function insurancePanel(state) {
  const chain = state.patientMrn ? policies.chain(state.patientMrn) : [];
  return `
    <div class="toolbar">
      <span class="t-title-sm">${esc(coverTitle(state))}</span>
      <span class="spacer"></span>
      ${state.readOnly ? '' : `
        <button class="btn btn--secondary btn--sm" data-act="attach-policy">
          <span class="icon icon--sm">add_card</span>Attach policy
        </button>
        <button class="btn btn--secondary btn--sm" data-act="self-pay"${state.insurance.mode === 'selfpay' ? ' disabled title="Already marked self-pay"' : ''}>
          <span class="icon icon--sm">payments</span>Mark self-pay
        </button>`}
    </div>
    ${coverCardHtml(state)}
    ${chain.length ? `
      <div class="toolbar"><span class="t-title-sm">Cover already on the record</span></div>
      ${chain.map((p) => chainRowHtml(p, state)).join('')}` : ''}`;
}

function coverTitle(state) {
  if (state.insurance.mode === 'selfpay') return 'Self-pay';
  if (state.insurance.policyId || state.insurance.pendingPolicy) return 'Cover captured';
  return 'No cover captured yet';
}

function coverCardHtml(state) {
  const { mode, policyId, pendingPolicy } = state.insurance;
  if (mode === 'selfpay') {
    return `
      <div class="rule-child-row">
        <span class="icon">payments</span>
        <div><div class="t-title-sm">Self-Pay</div>
          <span class="t-body-sm">No payer is involved. The pre-check records the decision without verification.</span></div>
      </div>`;
  }
  if (policyId) {
    const policy = policies.get(policyId);
    if (!policy) return '<p class="t-body-sm">The policy this pre-registration named is no longer on file.</p>';
    return `
      <div class="rule-child-row">
        <span class="icon">contract</span>
        <div><div class="t-title-sm">${esc(policies.label(policy))}</div>
          <span class="t-body-sm">${esc(policies.priorityLabel(policy.priority))} · member ${esc(policy.memberId)} ·
            valid ${date(policy.validFrom)} – ${date(policy.validTo)}</span></div>
        <span class="spacer"></span>
        <span class="badge badge--success"><span class="dot"></span>On the record</span>
      </div>`;
  }
  if (pendingPolicy) {
    const payer = policies.payerOfPlan(pendingPolicy.planId);
    const plan = payer?.plans.find((p) => p.id === pendingPolicy.planId);
    return `
      <div class="rule-child-row">
        <span class="icon">add_card</span>
        <div><div class="t-title-sm">${esc(payer?.nameEn || '—')}${plan ? ` · ${esc(plan.name)}` : ''}</div>
          <span class="t-body-sm">Member ${esc(pendingPolicy.memberId)} · valid ${date(pendingPolicy.validFrom)} –
            ${date(pendingPolicy.validTo)}</span></div>
        <span class="spacer"></span>
        <span class="badge badge--warning"><span class="dot"></span>Written at conversion</span>
        ${state.readOnly ? '' : '<button class="btn btn--ghost btn--sm" data-act="attach-policy">Replace</button>'}
      </div>`;
  }
  return `<p class="t-body-sm">Attach the card the patient gave over the phone, or mark the visit self-pay.
    The pre-check cannot run until one of the two is answered.</p>`;
}

function chainRowHtml(policy, state) {
  const chosen = state.insurance.policyId === policy.id;
  return `
    <div class="rule-child-row">
      <span class="icon">badge</span>
      <div>${esc(policies.label(policy))}
        <br><span class="t-body-sm">${esc(policies.priorityLabel(policy.priority))} · member ${esc(policy.memberId)} ·
          to ${date(policy.validTo)}</span></div>
      <span class="spacer"></span>
      ${chosen
        ? '<span class="badge badge--success"><span class="dot"></span>In use</span>'
        : state.readOnly ? ''
          : `<button class="btn btn--secondary btn--sm" data-act="use-policy" data-policy="${esc(policy.id)}">Use this</button>`}
    </div>`;
}

// --- 4. eligibility pre-check ---------------------------------------------------

export function precheckPanel(state) {
  const row = state.precheck.snapshotRef ? eligibility.get(state.precheck.snapshotRef) : null;
  const why = precheckBlocker(state);
  return `
    <div class="toolbar">
      <span class="t-title-sm">${row ? 'Last pre-check' : 'No pre-check yet'}</span>
      <span class="spacer"></span>
      ${state.readOnly ? '' : `
        <button class="btn btn--secondary btn--sm" data-act="precheck"${why ? ' disabled' : ''} title="${esc(why)}">
          <span class="icon icon--sm">verified_user</span>${row ? 'Run again' : 'Run pre-check'}
        </button>`}
    </div>
    ${row ? snapshotHtml(row) : `<p class="t-body-sm">${esc(why
      || 'Ask the payer now, so the desk knows before the patient arrives whether the cover answers.')}</p>`}`;
}

/** Why the pre-check cannot run, or '' — the button's tooltip and the panel's line. */
export function precheckBlocker(state) {
  if (!state.no) return 'Save the pre-registration first — a check is recorded against its number.';
  if (!state.insurance.mode) return 'Attach a policy or mark the visit self-pay first.';
  return '';
}

function snapshotHtml(row) {
  return `
    <div class="toolbar">
      ${resultBadge(row)}
      <span class="t-mono-sm">${esc(row.ref)}</span>
      <span class="t-body-sm">${dateTime(row.checkedAt)} · ${esc(eligibility.coverLabel(row))}</span>
      <span class="spacer"></span>
      <a class="btn btn--ghost btn--sm" href="#/frontis/eligibility/${esc(row.ref)}">
        <span class="icon icon--sm">open_in_new</span>Snapshot
      </a>
    </div>
    ${failuresHtml(row.failureReasons)}
    ${conditionsHtml(row.conditions)}`;
}

// --- shared --------------------------------------------------------------------

const field = (label, control) => `<dt>${label}</dt><dd><label class="field">${control}</label></dd>`;
