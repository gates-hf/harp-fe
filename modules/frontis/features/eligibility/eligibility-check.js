// The check screen at #/frontis/eligibility/new — the question in the rail, the
// answer beside it. `?mrn=`, `?policyId=`, `?type=` and `?encounterId=` prefill
// it, which is what Check eligibility on the patient record and Re-check on the
// worklist hand over.
//
// Every run creates a snapshot immediately: a check is a record of what the
// platform answered, so it is written before anyone reads it and never edited.
// A refused check offers the next policy in the chain, and the attempts stack
// as collapsible cards, each one its own snapshot pointing back at the first.

import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import { SELF_PAY, VISIT_TYPES, verify } from '../../../../data/engines/eligibility-engine.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { esc, todayIso } from '../../../../shared/format.js';
import { chainHtml, chainNote, patientHtml, servicesHtml } from './eligibility-check-inputs.js';
import { attemptsHtml, emptyHtml, nextHtml } from './eligibility-check-result.js';
import { askOverride } from './eligibility-override.js';

export const meta = { title: 'Eligibility check' };

export async function render(mount, ctx) {
  const res = await fetch(new URL('./eligibility-check.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load eligibility-check.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = {
    q: '',
    mrn: '',
    policyId: '',
    visitType: '',
    date: todayIso(),
    services: [],
    checkType: eligibility.CHECK_TYPES.includes(ctx.query.type) ? ctx.query.type : 'Manual',
    // What the first attempt of a fresh cascade is called. Every attempt after
    // it is a re-check of the same encounter, not a new manual one.
    firstType: eligibility.CHECK_TYPES.includes(ctx.query.type) ? ctx.query.type : 'Manual',
    encounterId: ctx.query.encounterId || null,
    // The references this session recorded, oldest first — the cascade.
    refs: [],
  };

  const $ = (sel) => mount.querySelector(sel);

  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Eligibility', path: '/frontis/eligibility' },
    { label: 'New check' },
  ]);

  $('#ec-visit').innerHTML = `<option value="">Not given</option>${
    VISIT_TYPES.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;

  prefill(ctx.query);
  drawInputs();
  drawResults();

  /** ?mrn and ?policyId, with the chain's first position as the default cover. */
  function prefill(query = {}) {
    if (query.mrn && patients.get(query.mrn)) state.mrn = query.mrn;
    if (!state.mrn) return;
    const chain = policies.chain(state.mrn);
    const asked = query.policyId;
    state.policyId = asked === SELF_PAY || chain.some((p) => p.id === asked)
      ? asked
      : chain[0]?.id || SELF_PAY;
  }

  // --- the rail -------------------------------------------------------------

  function drawInputs() {
    const role = currentRole();
    $('#ec-patient').innerHTML = patientHtml(state, role);
    $('#ec-chain').innerHTML = chainHtml(state);
    $('#ec-chain-note').textContent = chainNote(state);
    $('#ec-services').innerHTML = servicesHtml(state);
    $('#ec-service-count').textContent = state.services.length
      ? `${state.services.length} ${state.services.length === 1 ? 'service' : 'services'}`
      : '';
    $('#ec-visit').value = state.visitType;
    $('#ec-date').value = state.date;
    const run = mount.querySelector('[data-act="run"]');
    run.disabled = !state.mrn || !state.policyId;
    run.title = run.disabled ? 'Choose a patient and the cover to check against' : '';
  }

  // --- running --------------------------------------------------------------

  /**
   * One attempt. Self-Pay is recorded without verification, which is what
   * choosing it means: there is no payer to ask.
   */
  function run(policyId, { attemptOf = null } = {}) {
    const patient = patients.get(state.mrn);
    const policy = policyId === SELF_PAY ? SELF_PAY : policies.get(policyId);
    if (!patient || !policy) return null;

    const answer = verify({
      patient,
      policy,
      date: state.date,
      visitType: state.visitType || null,
      services: state.services.filter((s) => s.itemId),
    });

    const row = eligibility.create({
      patientMrn: patient.mrn,
      policyId: policyId === SELF_PAY ? null : policyId,
      payerId: policyId === SELF_PAY ? null : policy.payerId,
      planId: policyId === SELF_PAY ? null : policy.planId,
      checkType: state.checkType,
      visitType: state.visitType || null,
      services: state.services.filter((s) => s.itemId).map((s) => ({ ...s })),
      systemResult: answer.result,
      steps: answer.steps,
      conditions: answer.conditions,
      failureReasons: answer.failureReasons,
      coverageSummary: answer.coverageSummary,
      contract: answer.contract,
      encounterId: state.encounterId,
      attemptOf,
    });

    // A policy the payer honoured is a policy the desk has verified. Nothing
    // else in the platform stamps that date.
    if (row.policyId && eligibility.isPass(row.systemResult)) {
      policies.markVerified(row.policyId, row.checkedAt.slice(0, 10), row.ref);
    }

    state.refs.push(row.ref);
    // The first run is the attempt the cascade hangs off; the rest are re-checks
    // of the same encounter, not new manual ones.
    state.checkType = 'Re-check';
    toast(`${row.ref} — ${row.systemResult}`, eligibility.isPass(row.systemResult) ? 'success' : 'warning');
    return row;
  }

  /** The policies left to try under the one the last attempt refused. */
  function remaining() {
    const chain = policies.chain(state.mrn);
    const tried = new Set(state.refs.map((ref) => eligibility.get(ref)?.policyId).filter(Boolean));
    return chain.filter((p) => !tried.has(p.id));
  }

  /** Whether the cascade has already landed on the fallback. */
  function triedSelfPay() {
    return state.refs.some((ref) => !eligibility.get(ref)?.policyId);
  }

  // --- the result -----------------------------------------------------------

  function drawResults() {
    const rows = state.refs.map((ref) => eligibility.get(ref)).filter(Boolean);
    $('#ec-attempts').textContent = rows.length
      ? `${rows.length} ${rows.length === 1 ? 'attempt' : 'attempts'}`
      : '';
    $('#ec-results').innerHTML = rows.length ? attemptsHtml(rows, currentRole()) : emptyHtml();
    $('#ec-next').innerHTML = nextHtml(rows[rows.length - 1], {
      remaining: remaining(),
      triedSelfPay: triedSelfPay(),
    });
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('input', (e) => {
    if (e.target.id === 'ec-search') {
      state.q = e.target.value;
      $('#ec-patient').innerHTML = patientHtml(state, currentRole());
      mount.querySelector('#ec-search')?.focus();
      return;
    }
    readLine(e.target);
  });

  /**
   * One service row's field, off whichever event carried it. A select fires both
   * input and change, and the two do different things here — the value is read
   * on either, and only a chosen charge redraws (to show its standard price).
   */
  function readLine(target) {
    const row = target.closest?.('[data-index]');
    const field = target.dataset?.field;
    if (!row || !field) return false;
    const line = state.services[Number(row.dataset.index)];
    if (!line) return false;
    line[field] = field === 'qty' ? Math.max(1, Number(target.value) || 1) : target.value;
    return true;
  }

  mount.addEventListener('change', (e) => {
    if (e.target.id === 'ec-visit') {
      state.visitType = e.target.value;
      return;
    }
    if (e.target.id === 'ec-date') {
      state.date = e.target.value || todayIso();
      return;
    }
    if (e.target.name === 'ec-cover') {
      state.policyId = e.target.value;
      return;
    }
    if (readLine(e.target) && e.target.dataset.field === 'itemId') drawInputs();
  });

  mount.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      state.mrn = pick.dataset.pick;
      state.q = '';
      prefill({ mrn: state.mrn });
      state.refs = [];
      state.checkType = state.firstType;
      drawInputs();
      drawResults();
      return;
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;

    if (act === 'clear-patient') {
      Object.assign(state, { mrn: '', policyId: '', q: '', refs: [], checkType: state.firstType });
      drawInputs();
      drawResults();
      return;
    }
    if (act === 'add-service') {
      state.services.push({ itemId: '', qty: 1 });
      drawInputs();
      return;
    }
    if (act === 'remove-service') {
      const i = Number(e.target.closest('[data-index]')?.dataset.index);
      if (Number.isFinite(i)) state.services.splice(i, 1);
      drawInputs();
      return;
    }
    if (act === 'run') {
      state.refs = [];
      state.checkType = state.firstType;
      if (run(state.policyId)) drawResults();
      return;
    }
    if (act === 'cascade') {
      const policyId = e.target.closest('[data-policy]')?.dataset.policy;
      const first = state.refs[0] || null;
      if (policyId && run(policyId, { attemptOf: first })) {
        state.policyId = policyId;
        drawInputs();
        drawResults();
      }
      return;
    }
    if (act === 'print') return void window.print();
    if (act === 'override') {
      const ref = e.target.closest('[data-ref]')?.dataset.ref;
      if (ref && (await askOverride(ref))) drawResults();
    }
  });

  // A policy suspended in another tab changes what this screen may check
  // against, so the rail is live even while a result is on screen.
  ctx.onData(() => {
    drawInputs();
    drawResults();
  });
}

/**
 * The hook the two flows that check inline call: Encounter Registration, and
 * the pre-registration form's pre-check. Run the ladder, record the snapshot,
 * hand it back. Nothing here draws — each caller renders the answer itself.
 *
 * Three shapes of cover reach it. A policy on the chain is passed by id; a
 * cover a pre-registration is still holding has no id yet and is passed whole
 * as `pendingPolicy`; anything else is the self-pay decision. And a
 * pre-registration may have no patient record at all — `preregNo` stands in for
 * the MRN on the snapshot, and the ladder is handed a record that says the
 * patient is registrable, because the question being asked is about the cover.
 */
export function runAutoCheck({
  mrn = null, policyId = null, pendingPolicy = null, preregNo = null,
  encounterId = null, visitType = null, services = [], referral = false,
} = {}) {
  const patient = mrn
    ? patients.get(mrn)
    : preregNo ? { mrn: preregNo, status: 'Active' } : null;
  if (!patient) return null;

  const policy = pendingPolicy
    ? { ...pendingPolicy, status: 'Active' }
    : !policyId || policyId === SELF_PAY ? SELF_PAY : policies.get(policyId);
  if (!policy) return null;

  const on = todayIso();
  const answer = verify({ patient, policy, date: on, visitType, services, referral });
  const row = eligibility.create({
    patientMrn: mrn || null,
    preregNo,
    policyId: policy === SELF_PAY ? null : policyId,
    payerId: policy === SELF_PAY ? null : policy.payerId,
    planId: policy === SELF_PAY ? null : policy.planId,
    checkType: preregNo ? 'Pre-Registration' : 'Auto-Registration',
    visitType,
    services: services.map((s) => ({ ...s })),
    systemResult: answer.result,
    steps: answer.steps,
    conditions: answer.conditions,
    failureReasons: answer.failureReasons,
    coverageSummary: answer.coverageSummary,
    contract: answer.contract,
    encounterId,
  });
  if (row.policyId && eligibility.isPass(row.systemResult)) {
    policies.markVerified(row.policyId, on, row.ref);
  }
  return row;
}
