// New encounter — patient, visit, financial classification, review. Reached at
// #/frontis/encounters/new, with ?mrn= from the patient record, with
// ?prefill=<pre-registration no.> from the conversion screen, and with
// ?estimate=<estimate no.> from an issued cost estimate — both of which fill
// every answer the desk already took and write the conversion back on create.
//
// Nothing is written until Create on the review step, with one exception the
// domain forces: the eligibility check run in step 3 is a snapshot of what the
// payer answered at that moment, so it is recorded when it runs. The encounter
// then claims it — eligibility.attachEncounter, once the number exists.
//
// The markup of the four steps lives in encounter-steps.js.

import * as encounters from '../../../../data/repositories/encounters.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as prereg from '../../../../data/repositories/prereg.js';
import * as estimates from '../../../../data/repositories/estimates.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as referrals from '../../../../data/repositories/referrals.js';
import * as audit from '../../../../data/repositories/audit.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { classifier } from './encounter-classification.js';
import { askDuplicate } from './encounter-duplicate.js';
import { openRegisterDrawer } from './encounter-register.js';
import { stepFinancial, stepPatient, stepReview, stepVisit, stepperHtml } from './encounter-steps.js';

export const meta = { title: 'New encounter' };

const STEPS = [
  { title: 'Patient', hint: 'Who the visit is for.' },
  { title: 'Visit', hint: 'What kind of visit, where and with whom.' },
  { title: 'Financial classification', hint: 'Who pays, checked against the payer.' },
  { title: 'Review', hint: 'Check it, then create the encounter.' },
];

export async function render(mount, ctx) {
  const res = await fetch(new URL('./encounter-new.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load encounter-new.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader('New encounter');
  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Encounters', path: '/frontis/encounters' },
    { label: 'New encounter' },
  ]);

  const state = {
    step: 0,
    q: '',
    mrn: patients.get(ctx.query?.mrn) ? ctx.query.mrn : '',
    type: '',
    department: '',
    doctorId: '',
    startAt: localNow(),
    visitReason: '',
    ward: '',
    bedClass: '',
    expectedLos: '',
    policyId: null,
    snapshotRef: '',
    overrideRef: null,
    reuse: false,
    warnedOn: '',
    proceededDespite: '',
    // The pre-registration or the cost estimate this visit is being converted
    // from, and the cover it captured — the classification step asks that one
    // first instead of the chain's own primary.
    prereg: '',
    estimate: '',
    prefillCover: '',
    // What the estimate said the visit would need. The eligibility check runs
    // against these charges rather than against cover in the abstract.
    services: [],
    // The referral this visit answers, and whether the payer asked for one that
    // is not there — set by the check on step 3 and read by the field on step 2.
    referralNo: ctx.query?.referral && referrals.get(ctx.query.referral) ? ctx.query.referral : '',
    referralFlag: false,
  };
  const $ = (sel) => mount.querySelector(sel);

  applyPrefill(ctx.query?.prefill);
  applyEstimate(ctx.query?.estimate);

  /**
   * Everything the pre-registration already answered. The visit is copied as
   * captured; the arrival time is used only while it is still ahead, because an
   * encounter that opens now started now.
   */
  function applyPrefill(no) {
    const row = no ? prereg.get(no) : null;
    if (!row || !prereg.isOpen(row)) return;
    state.prereg = row.no;
    if (row.patientMrn && patients.get(row.patientMrn)) state.mrn = row.patientMrn;
    state.type = prereg.ENCOUNTER_TYPE_OF[row.visit.type] || 'OP';
    state.department = row.visit.department || '';
    state.doctorId = row.visit.doctorId || '';
    const expected = Date.parse(row.visit.expectedAt);
    if (Number.isFinite(expected) && expected > Date.now()) state.startAt = localOf(expected);
    const procedure = row.visit.procedureItemId ? cdm.get(row.visit.procedureItemId) : null;
    if (procedure) state.visitReason = cdm.label(procedure);
    state.prefillCover = row.insurance.mode === 'selfpay' ? 'self' : row.insurance.policyId || '';
    // A referral that was holding a place on this arrival is the referral this
    // visit answers: the desk booked the one for the other.
    const held = referrals.scheduledFor(row.no);
    if (held && !state.referralNo) state.referralNo = held.no;
  }

  /**
   * Everything an issued estimate already answered. Only a live one is read: an
   * expired or superseded price is not what this visit is being opened under,
   * and the estimate screen says so rather than letting it through here.
   */
  function applyEstimate(no) {
    const row = no ? estimates.get(no) : null;
    if (!row || !estimates.isLive(row) || row.subject.kind !== 'patient') return;
    if (!patients.get(row.subject.mrn)) return;
    state.estimate = row.no;
    state.mrn = row.subject.mrn;
    state.type = encounters.TYPE_OF_VISIT[row.context.visitType] || 'OP';
    state.department = row.context.department || '';
    // The visit opens now: the estimate priced a day of service, it did not
    // book an arrival time the way a pre-registration does.
    state.startAt = localNow();
    state.prefillCover = row.policy.selfPay ? 'self' : row.policy.policyId || '';
    state.services = row.lines.map((line) => ({ itemId: line.itemId, qty: line.qty }));
  }

  /** The cover to ask first: the pre-registration's, if it is still on the chain. */
  function firstCover() {
    const chain = policies.chain(state.mrn);
    if (state.prefillCover === 'self' || chain.some((p) => p.id === state.prefillCover)) {
      return state.prefillCover;
    }
    return chain[0]?.id || 'self';
  }

  // Step 3's machine: it owns the four classification fields of `state` and
  // redraws through draw(), so this file keeps one render path.
  const { snapshot, remaining, classify, override, blockingReason } = classifier(state, () => draw());

  function draw() {
    const role = currentRole();
    $('#en-stepper').innerHTML = stepperHtml(STEPS, state.step);
    $('#en-title').textContent = STEPS[state.step].title;
    $('#en-hint').textContent = STEPS[state.step].hint;
    $('#en-body').innerHTML = [
      () => stepPatient(state, role),
      () => stepVisit(state),
      () => stepFinancial(state, {
        snapshot: snapshot(),
        reuse: state.reuse,
        canOverride: role.canOverrideEligibility,
        remaining: remaining(),
      }),
      () => stepReview(state, { patient: patients.view(patients.get(state.mrn), role), snapshot: snapshot() }),
    ][state.step]();
    $('#en-next').innerHTML = state.step === 3
      ? '<span class="icon icon--sm">check</span>Create encounter'
      : 'Next<span class="icon icon--sm">chevron_right</span>';
    $('#en-back').disabled = state.step === 0;
    $('#en-back').title = state.step === 0 ? 'You are on the first step' : '';
    markNext();
    clearError();
  }

  /**
   * The classification step is the one that can hold the flow: a refused check
   * is not a classification, so Next stays disabled until one is accepted,
   * overridden, or answered with Self-Pay.
   */
  function markNext() {
    const next = $('#en-next');
    const why = state.step === 3 || state.step !== 2 ? '' : blockingReason();
    next.disabled = Boolean(why);
    next.title = why;
  }

  const showError = (message) => {
    const box = $('#en-error');
    box.textContent = message;
    box.hidden = !message;
  };
  const clearError = () => showError('');

  // --- duplicates -----------------------------------------------------------

  /** Raised once per patient and type; the answer is kept for the trail. */
  async function checkDuplicate() {
    const open = state.mrn && state.type ? encounters.activeOfType(state.mrn, state.type) : null;
    if (!open || state.warnedOn === `${state.mrn}:${state.type}`) return true;
    state.warnedOn = `${state.mrn}:${state.type}`;

    const answer = await askDuplicate(open);
    if (answer === 'open') {
      ctx.navigate(`/frontis/encounters/${open.no}`);
      return false;
    }
    if (answer !== 'go') return false;
    state.proceededDespite = open.no;
    return true;
  }

  // --- validation and create ------------------------------------------------

  function validate() {
    if (state.step === 0) {
      const patient = patients.get(state.mrn);
      if (!patient) return 'Choose the patient this visit is for.';
      if (!patients.canOpenEncounter(patient)) return `A ${patient.status.toLowerCase()} record cannot open an encounter.`;
      return '';
    }
    if (state.step === 1) {
      if (!state.type) return 'Choose the type of visit.';
      if (!state.department) return 'Choose the department.';
      if (!state.doctorId) return 'Choose the attending doctor.';
      if (!state.startAt) return 'Enter when the visit starts.';
      if (state.type !== 'OP' && !state.visitReason.trim()) return 'Enter the reason for the visit.';
      if (state.type === 'IP' && !state.ward) return 'Choose the ward.';
      if (state.type === 'IP' && !state.bedClass) return 'Choose the bed class.';
      if (state.type === 'IP' && !(Number(state.expectedLos) > 0)) return 'Enter the expected length of stay in nights.';
      return '';
    }
    if (state.step === 2) return blockingReason();
    return '';
  }

  function create() {
    const row = encounters.create({
      patientMrn: state.mrn,
      type: state.type,
      department: state.department,
      doctorId: state.doctorId,
      visitReason: state.visitReason.trim(),
      ward: state.type === 'IP' ? state.ward : '',
      bedClass: state.type === 'IP' ? state.bedClass : '',
      expectedLos: state.type === 'IP' ? Number(state.expectedLos) : null,
      startAt: new Date(state.startAt).toISOString(),
      financial: encounters.classification({
        policyId: state.policyId,
        snapshotRef: state.snapshotRef || null,
        overrideRef: state.overrideRef,
      }),
      // The payer asked for a referral and there is none: the visit carries it
      // until one is linked, and the clearance desk reads it in the tooltip.
      flags: { referralMissing: state.referralFlag && !state.referralNo },
    });

    // The snapshot names the encounter that consumed it; a reused check already
    // belongs to an earlier one and is left pointing there.
    if (state.snapshotRef) eligibility.attachEncounter(state.snapshotRef, row.no);
    // A referral is spent by the visit that answers it: one visit comes off and
    // the two records name each other.
    if (state.referralNo && referrals.link(state.referralNo, row.no)) {
      encounters.linkRecord(row.no, 'referral', state.referralNo);
    }
    if (state.policyId) {
      const policy = policies.get(state.policyId);
      if (policy && !policy.usedInEncounters) policy.usedInEncounters = true;
    }
    patients.update(state.mrn, { lastVisitAt: row.startAt.slice(0, 10) }, { reason: `Encounter ${row.no}` });
    if (state.proceededDespite) {
      audit.log({
        entity: 'encounters',
        entityId: row.no,
        action: 'Duplicate warning',
        details: `Proceeded despite active ${state.proceededDespite}`,
      });
    }
    // The pre-registration and the estimate are each closed by the encounter
    // they became, and by nothing else: this is the only call that writes
    // either conversion. An estimate also registers itself on the encounter,
    // the way every record hanging off one does.
    const closed = [];
    if (state.prereg && prereg.markConverted(state.prereg, state.mrn, row.no)) closed.push(state.prereg);
    if (state.estimate && estimates.markConverted(state.estimate, row.no)) {
      encounters.linkRecord(row.no, 'estimate', state.estimate);
      closed.push(state.estimate);
    }
    toast(closed.length
      ? `${closed.join(' and ')} converted → ${row.no}`
      : `${row.no} created (${row.status})`, 'success');
    ctx.navigate(`/frontis/encounters/${row.no}`);
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const step = e.target.closest('[data-step]');
    if (step && Number(step.dataset.step) < state.step) {
      state.step = Number(step.dataset.step);
      return draw();
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'register') {
      const mrn = await openRegisterDrawer();
      if (mrn) {
        state.mrn = mrn;
        state.q = '';
        draw();
      }
      return;
    }
    if (act === 'pick') {
      state.mrn = e.target.closest('[data-mrn]')?.dataset.mrn || '';
      return draw();
    }
    if (act === 'unpick') {
      // Choosing a different patient is choosing a different visit: whatever a
      // pre-registration handed over no longer applies to it.
      Object.assign(state, {
        mrn: '', q: '', policyId: null, snapshotRef: '', warnedOn: '',
        prereg: '', estimate: '', prefillCover: '', services: [],
        referralNo: '', referralFlag: false,
      });
      return draw();
    }
    if (act === 'reuse') {
      state.reuse = false;
      return draw();
    }
    if (act === 'recheck') return classify(state.policyId || 'self', { force: true });
    if (act === 'next-policy') return classify(remaining()[0]?.id || 'self');
    if (act === 'self-pay') return classify('self');
    if (act === 'override') {
      if (await override()) toast('Override recorded beside the system answer', 'success');
      return;
    }

    if (e.target.closest('#en-back') && state.step > 0) {
      state.step -= 1;
      return draw();
    }
    if (e.target.closest('#en-next') && !$('#en-next').disabled) {
      const message = validate();
      if (message) return showError(message);
      if (state.step === 1 && !(await checkDuplicate())) return;
      if (state.step === 3) return create();
      state.step += 1;
      // Entering the classification step asks the highest policy on the chain
      // without waiting to be told to.
      if (state.step === 2 && !state.snapshotRef) {
        return classify(firstCover());
      }
      draw();
    }
  });

  mount.addEventListener('input', (e) => {
    if (e.target.id === 'en-patient-q') {
      state.q = e.target.value;
      return draw();
    }
    const name = e.target.name;
    if (name === 'visitReason' || name === 'expectedLos') state[name] = e.target.value;
  });

  mount.addEventListener('change', (e) => {
    const name = e.target.name;
    if (name === 'policyId') return classify(e.target.value);
    if (!name || !(name in state)) return;
    state[name] = e.target.value;
    // The doctor list is the department's, and a visit that changes type asks
    // for different fields — both redraw the step.
    if (name === 'department') state.doctorId = '';
    // The doctor list and the referrals on offer both follow the department,
    // and a visit that changes type or date asks for different fields.
    if (name === 'department' || name === 'type' || name === 'startAt') draw();
  });

  mount.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-mrn]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      state.mrn = row.dataset.mrn;
      draw();
    }
  });

  draw();
}

/** `datetime-local` wants local wall-clock time, not an ISO instant. */
const localNow = () => localOf(Date.now());

function localOf(at) {
  const when = new Date(at);
  when.setMinutes(when.getMinutes() - when.getTimezoneOffset());
  return when.toISOString().slice(0, 16);
}
