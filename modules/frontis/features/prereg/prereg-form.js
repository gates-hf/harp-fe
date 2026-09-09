// The pre-registration form at #/frontis/prereg/new and #/frontis/prereg/<no> —
// one page, four panels, one Save.
//
// Everything the clerk types is held in state and written by Save, with the two
// exceptions the domain forces. A policy attached to a record that already
// exists is a policy on that record, written by the policy modal itself; and a
// pre-check is a record of what the payer answered at that moment, so it is
// written when it runs. Both of those need a saved pre-registration to hang
// off, which is why Run pre-check and Convert save first and a brand-new form
// has to be saved before either is offered.

import * as prereg from '../../../../data/repositories/prereg.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { openPolicyModal } from '../insurance/policy-form.js';
import { runAutoCheck } from '../eligibility/eligibility-check.js';
import { completenessCardHtml, computeCompleteness } from './prereg-completeness.js';
import { bannerHtml, footerHtml, isoOf, readRow } from './prereg-form-rail.js';
import { insurancePanel, patientPanel, precheckBlocker, precheckPanel, visitPanel } from './prereg-form-panels.js';
import { askCancel, askReactivate } from './prereg-actions.js';

export const meta = { title: 'Pre-registration' };

export async function render(mount, ctx) {
  const no = ctx.params[0] === 'new' ? '' : ctx.params[0];
  const row = no ? prereg.get(no) : null;
  if (no && !row) throw new Error(`No pre-registration ${no}`);

  const res = await fetch(new URL('./prereg-form.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load prereg-form.html (${res.status})`);
  mount.innerHTML = await res.text();

  const title = row ? `Pre-registration ${row.no}` : 'New pre-registration';
  ctx.setHeader(title);
  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Expected arrivals', path: '/frontis/prereg' },
    { label: row ? row.no : 'New' },
  ]);

  const state = readRow(row, ctx.query);
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    state.readOnly = Boolean(state.no) && !prereg.isOpen(prereg.get(state.no));
    $('#pf-no').textContent = state.no || 'Number assigned on save';
    $('#pf-completeness').innerHTML = completenessCardHtml(asRow(), { status: statusNow() });
    const stored = state.no ? prereg.get(state.no) : null;
    $('#pf-footer').innerHTML = footerHtml(state, stored);
    $('#pf-banner').innerHTML = bannerHtml(stored);
    $('#pf-patient').innerHTML = patientPanel(state, role);
    $('#pf-visit').innerHTML = visitPanel(state);
    $('#pf-insurance').innerHTML = insurancePanel(state);
    $('#pf-precheck').innerHTML = precheckPanel(state);
    if (state.readOnly) {
      for (const input of mount.querySelectorAll('#pf-patient input, #pf-patient select, #pf-visit input, #pf-visit select')) {
        input.disabled = true;
      }
    }
    clearError();
  }

  /**
   * The row as the completeness engine reads it, saved or not. Details taken
   * over the phone are kept even after a record is linked: the record answers
   * for identity from then on, and what the caller said is what conversion
   * offers to merge into it.
   */
  const asRow = () => ({
    patientMrn: state.patientMrn,
    newPatient: Object.values(state.newPatient).some((v) => String(v || '').trim()) ? state.newPatient : null,
    visit: { ...state.visit, expectedAt: isoOf(state.visit.expectedAt) },
    insurance: state.insurance,
    precheck: state.precheck,
  });

  /** What the status would be if this were saved now. */
  const statusNow = () => {
    const stored = state.no ? prereg.get(state.no) : null;
    if (stored && !prereg.isOpen(stored)) return stored.status;
    return computeCompleteness(asRow()).ready ? 'Ready' : 'Pending';
  };

  const showError = (message) => {
    const box = $('#pf-error');
    box.textContent = message;
    box.hidden = !message;
  };
  const clearError = () => showError('');

  // --- writes ---------------------------------------------------------------

  /** Returns the pre-registration number, or '' when the form is not saveable. */
  function save({ quiet = false } = {}) {
    const message = validate();
    if (message) {
      showError(message);
      return '';
    }
    const payload = asRow();
    if (state.no) {
      prereg.update(state.no, payload);
      if (!quiet) toast(`${state.no} saved`, 'success');
      return state.no;
    }
    const created = prereg.create(payload);
    state.no = created.no;
    if (!quiet) toast(`${created.no} created — ${created.status}`, 'success');
    return created.no;
  }

  function validate() {
    if (!state.patientMrn) {
      const p = state.newPatient;
      if (!p.nameEn.trim()) return 'Enter the patient name, or link the record they already have.';
      if (!p.dob) return 'Enter the date of birth. It is what the duplicate check reads.';
      if (!p.phone.trim()) return 'Enter a mobile number — it is how the desk confirms the arrival.';
    }
    if (!state.visit.type) return 'Choose the type of visit.';
    if (!state.visit.expectedAt) return 'Enter when the patient is expected.';
    if (!state.visit.department) return 'Choose the department.';
    return '';
  }

  /** The pre-check: save what it is about to check, run it, record the answer. */
  function precheck() {
    if (!save({ quiet: true })) return;
    const snapshot = runAutoCheck({
      mrn: state.patientMrn,
      preregNo: state.no,
      policyId: state.insurance.policyId,
      pendingPolicy: state.insurance.pendingPolicy,
      visitType: prereg.VISIT_TYPE_OF[state.visit.type] || null,
      services: state.visit.procedureItemId ? [{ itemId: state.visit.procedureItemId, qty: 1 }] : [],
    });
    if (!snapshot) return showError('The cover on this pre-registration could not be read. Attach it again.');
    prereg.setPrecheck(state.no, {
      status: snapshot.systemResult === 'Not Eligible' ? 'Failed' : 'Done',
      snapshotRef: snapshot.ref,
      at: snapshot.checkedAt,
      result: snapshot.systemResult,
    });
    state.precheck = { ...prereg.get(state.no).precheck };
    toast(`${snapshot.ref} — ${snapshot.systemResult}`, snapshot.systemResult === 'Not Eligible' ? 'warning' : 'success');
    draw();
  }

  /**
   * A cover captured for a patient nobody had registered belongs on the record
   * the moment one is linked: it is a real policy, and the chain is where the
   * rest of the platform reads it.
   */
  function linkPatient(mrn) {
    if (!patients.get(mrn)) return;
    state.patientMrn = mrn;
    state.q = '';
    state.dup = null;
    const pending = state.insurance.pendingPolicy;
    if (pending && policies.canAddToChain(mrn)) {
      const saved = policies.create({ ...pending, patientMrn: mrn });
      state.insurance = { mode: 'policy', policyId: saved.id, pendingPolicy: null };
      toast(`${policies.payerName(saved)} added to ${mrn}`, 'success');
    }
    draw();
  }

  async function attachPolicy() {
    const answer = await openPolicyModal({ patientMrn: state.patientMrn });
    if (!answer) return;
    state.insurance = answer.id
      ? { mode: 'policy', policyId: answer.id, pendingPolicy: null }
      : { mode: 'policy', policyId: null, pendingPolicy: answer };
    draw();
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('input', (e) => {
    if (e.target.id === 'pf-q') {
      state.q = e.target.value;
      $('#pf-patient').innerHTML = patientPanel(state, currentRole());
      mount.querySelector('#pf-q')?.focus();
      return;
    }
    readField(e.target, { redraw: false });
  });

  mount.addEventListener('change', (e) => {
    if (e.target.id === 'pf-q') return;
    readField(e.target, { redraw: true });
  });

  /** One named field into state. The two groups are the patient and the visit. */
  function readField(target, { redraw }) {
    const name = target.name;
    if (!name) return;
    if (name in state.newPatient) {
      state.newPatient[name] = target.value;
      if (redraw) {
        checkDuplicates();
        draw();
      }
      return;
    }
    if (name in state.visit) {
      state.visit[name] = target.value;
      // An inpatient visit is an admission, so the toggle is set and locked;
      // the department decides which doctors the picker offers.
      if (name === 'type' && target.value === 'IP') state.visit.admissionIntent = true;
      if (name === 'department') state.visit.doctorId = '';
      if (redraw) draw();
    }
  }

  /** The soft check: an answer, never a refusal — nothing is being registered. */
  function checkDuplicates() {
    if (state.patientMrn) return;
    const p = state.newPatient;
    if (!p.nameEn.trim() && !p.civilId && !p.passportNo && !p.phone.trim()) {
      state.dup = null;
      return;
    }
    const { hard, fuzzy, phone } = patients.findDuplicates(p);
    state.dup = hard ? { hard } : fuzzy.length || phone.length ? { soft: [...fuzzy, ...phone] } : null;
  }

  mount.addEventListener('click', async (e) => {
    const intent = e.target.closest('[data-intent]');
    if (intent && !intent.disabled) {
      state.visit.admissionIntent = intent.dataset.intent === 'true';
      return draw();
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;

    if (act === 'link') return linkPatient(e.target.closest('[data-mrn]')?.dataset.mrn || '');
    if (act === 'unlink') {
      state.patientMrn = null;
      return draw();
    }
    if (act === 'attach-policy') return void (await attachPolicy());
    if (act === 'use-policy') {
      state.insurance = { mode: 'policy', policyId: e.target.closest('[data-policy]')?.dataset.policy, pendingPolicy: null };
      return draw();
    }
    if (act === 'self-pay') {
      state.insurance = { mode: 'selfpay', policyId: null, pendingPolicy: null };
      return draw();
    }
    if (act === 'precheck') {
      const why = precheckBlocker(state);
      return why ? showError(why) : precheck();
    }
    if (act === 'save') {
      const saved = save();
      if (saved) ctx.navigate(`/frontis/prereg/${saved}`);
      return;
    }
    if (act === 'convert') {
      const saved = save({ quiet: true });
      if (saved) ctx.navigate(`/frontis/prereg/${saved}/convert`);
      return;
    }
    if (act === 'cancel') {
      if (await askCancel(state.no)) ctx.navigate('/frontis/prereg');
      return;
    }
    if (act === 'reactivate') {
      if (await askReactivate(state.no)) draw();
    }
  });

  draw();

  // A policy suspended, a record merged or the expiry sweep running in another
  // tab all change what this form is holding.
  ctx.onData(() => {
    if (state.no && !prereg.get(state.no)) return ctx.navigate('/frontis/prereg');
    draw();
  });
}
