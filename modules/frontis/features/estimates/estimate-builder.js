// The estimate builder at #/frontis/estimates/new, and at /<no> while the
// estimate is still a Draft. The question is in the rail, the price beside it.
//
// Nothing is written until Save draft or Issue, with the one thing the domain
// forces the other way round: Issue saves first, because the number the patient
// is handed has to exist before the price can be frozen onto it.
//
// Issue is enabled only after a simulation of exactly these inputs. A price
// nobody has seen is not a price anybody can be handed, so changing a service,
// the cover or the date puts the button back out of reach until it is run again.

import * as estimates from '../../../../data/repositories/estimates.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { prefilledConsumption } from '../../../../shared/consumption-table.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc, iso, todayIso } from '../../../../shared/format.js';
import { DEPARTMENTS, VISIT_TYPES, optionList, policyHtml, subjectHtml } from './estimate-inputs.js';
import { linesPanelHtml } from './estimate-lines.js';
import { resultView } from './estimate-result.js';
import { askIssue } from './estimate-actions.js';

export const meta = { title: 'Cost estimate' };

export async function render(mount, ctx) {
  const existing = ctx.params[0] === 'new' ? null : estimates.get(ctx.params[0]);
  if (existing && !estimates.isDraft(existing)) throw new Error(`${existing.no} is not a draft`);

  const res = await fetch(new URL('./estimate-builder.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load estimate-builder.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = existing ? fromRow(existing) : blank(ctx.query);
  const $ = (sel) => mount.querySelector(sel);
  const result = resultView(mount, state);

  ctx.setHeader(state.no ? `Estimate ${state.no}` : 'New cost estimate');
  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Estimates', path: '/frontis/estimates' },
    { label: state.no || 'New' },
  ]);

  const visitSel = $('#eb-visit-type');
  const deptSel = $('#eb-department');
  const dosInput = $('#eb-dos');
  visitSel.innerHTML = optionList(VISIT_TYPES, state.context.visitType);
  deptSel.innerHTML = `<option value=""${state.context.department ? '' : ' selected'}>Choose a department</option>${
    optionList(DEPARTMENTS, state.context.department)}`;

  function draw() {
    const role = currentRole();
    for (const btn of mount.querySelectorAll('[data-subject]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.subject === state.subject.kind));
    }
    $('#eb-subject').innerHTML = subjectHtml(state, role);
    $('#eb-policy').innerHTML = policyHtml(state);
    visitSel.value = state.context.visitType;
    deptSel.value = state.context.department;
    dosInput.value = state.context.dateOfService;
    $('#eb-lines').innerHTML = linesPanelHtml(state.lines, estimates.grossOf(state));
    $('#eb-back').href = state.no ? `#/frontis/estimates/${state.no}` : '#/frontis/estimates';
    markIssue();
  }

  /** The freshness gate: a price is issuable only while it is the one on screen. */
  function markIssue() {
    const btn = mount.querySelector('[data-act="issue"]');
    const why = issueBlockedBy();
    btn.disabled = Boolean(why);
    btn.title = why;
    $('#eb-freshness').textContent = state.outcome && !why
      ? 'This price matches what is in the rail'
      : state.outcome ? 'The inputs have moved since this was priced' : '';
  }

  function issueBlockedBy() {
    const why = validate();
    if (why) return why;
    if (!state.outcome) return 'Simulate the estimate before issuing it';
    if (state.outcome.error) return state.outcome.error;
    if (state.signature !== signature()) return 'The inputs have changed — simulate again before issuing';
    return '';
  }

  /** Everything the inputs say, as one string: what "the same price" means. */
  const signature = () => JSON.stringify([state.subject, state.policy, state.context, state.lines]);

  function validate() {
    if (state.subject.kind === 'patient') {
      const patient = patients.get(state.subject.mrn);
      if (!patient) return 'Choose the patient this estimate is for';
      if (patient.status === 'Merged') return 'A merged record is read-only — quote on the record that survived';
    } else {
      if (!state.subject.name.trim()) return 'Enter the name this quotation is for';
      if (!state.subject.phone.trim()) return 'Enter a mobile number for the quotation';
      if (!state.policy.selfPay && !state.policy.planId) return 'Choose the plan on the card, or quote Self-Pay';
    }
    if (!state.context.department) return 'Choose the department';
    if (!estimates.pricedLines(state).length) return 'Add at least one service';
    return '';
  }

  const showError = (message) => {
    const box = $('#eb-error');
    // .alert sets display:flex, which outranks hidden, so the box is a plain
    // wrapper the alert is written into rather than a hidden alert.
    box.innerHTML = message
      ? `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(message)}</div></div>`
      : '';
  };

  // --- actions --------------------------------------------------------------

  function simulate() {
    const why = validate();
    if (why) return showError(why);
    showError('');
    state.outcome = estimates.simulate(payload());
    state.signature = signature();
    state.lineFilter = 'all';
    result.draw();
    markIssue();
    if (state.outcome.error) toast(state.outcome.error, 'warning');
  }

  /** The estimate as the repository holds it, built from the rail's state. */
  const payload = () => ({
    subject: state.subject.kind === 'patient'
      ? { kind: 'patient', mrn: state.subject.mrn }
      : { kind: 'prospect', name: state.subject.name.trim(), phone: state.subject.phone.trim() },
    policy: { ...state.policy },
    context: { ...state.context },
    lines: state.lines.filter((line) => line.itemId),
    // Quoted from an encounter's Linked Records rather than from the list: the
    // estimate belongs to that visit from the moment it is saved, so the tab it
    // was opened from is where it comes back.
    encounterNo: state.encounterNo || null,
  });

  /** The encounter that asked for it registers it, the way every record does. */
  function linkToEncounter(no) {
    if (state.encounterNo) encounters.linkRecord(state.encounterNo, 'estimate', no);
  }

  /** Save: the first one creates the number, the rest replace what it holds. */
  function save({ quiet = false } = {}) {
    const why = validate();
    if (why) {
      showError(why);
      return null;
    }
    showError('');
    if (!state.no) {
      const row = estimates.create(payload());
      state.no = row.no;
      linkToEncounter(row.no);
      if (!quiet) toast(`${row.no} saved as a draft`, 'success');
      // The draft has a number now, so the page it lives at is its own.
      ctx.navigate(`/frontis/estimates/${row.no}`);
      return row;
    }
    const row = estimates.updateDraft(state.no, payload());
    if (row && !quiet) toast(`${row.no} saved`, 'success');
    return row;
  }

  async function issue() {
    if (issueBlockedBy()) return;
    // Issue writes the draft first: the price is frozen onto a number, and the
    // number is what Save draft hands out.
    if (!state.no) {
      const row = estimates.create(payload());
      if (!row) return;
      state.no = row.no;
      linkToEncounter(row.no);
    } else {
      estimates.updateDraft(state.no, payload(), { details: 'Saved before issuing' });
    }
    const issued = await askIssue(state.no);
    if (issued) ctx.navigate(`/frontis/estimates/${issued.no}`);
    else draw();
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const subject = e.target.closest('[data-subject]');
    if (subject) {
      state.subject = { ...state.subject, kind: subject.dataset.subject };
      state.policy = { policyId: null, payerId: null, planId: null, selfPay: false };
      stale();
      return draw();
    }

    const kpi = metricKey(e);
    if (kpi && state.outcome) {
      state.lineFilter = state.lineFilter === kpi ? 'all' : kpi;
      return result.drawTotals();
    }

    const row = e.target.closest('tr[data-mrn]');
    if (row) {
      pick(row.dataset.mrn);
      return draw();
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'unpick') {
      state.subject = { ...state.subject, mrn: '' };
      state.q = '';
      state.policy = { policyId: null, payerId: null, planId: null, selfPay: false };
      stale();
      return draw();
    }
    if (act === 'save') return void save();
    if (act === 'simulate') return simulate();
    if (act === 'issue') return issue();
    if (act === 'add-line') {
      state.lines.push({ itemId: '', qty: 1, consumption: [] });
      stale();
      return draw();
    }
    if (act === 'remove-line') {
      state.lines.splice(Number(e.target.closest('[data-index]').dataset.index), 1);
      stale();
      return draw();
    }
  });

  mount.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'eb-patient-q') {
      state.q = el.value;
      $('#eb-subject').innerHTML = subjectHtml(state, currentRole());
      return;
    }
    if (el.id === 'eb-name' || el.id === 'eb-phone') {
      state.subject[el.id === 'eb-name' ? 'name' : 'phone'] = el.value;
      return stale();
    }
    const line = lineOf(el);
    if (!line) return;
    if (el.dataset.field === 'qty') {
      line.qty = Math.max(1, Number(el.value) || 1);
      stale();
    }
    if (el.dataset.consumption) {
      let entry = line.consumption.find((c) => c.componentId === el.dataset.consumption);
      if (!entry) {
        entry = { componentId: el.dataset.consumption };
        line.consumption.push(entry);
      }
      entry[el.dataset.unit] = Number(el.value) || 0;
      stale();
    }
  });

  mount.addEventListener('change', (e) => {
    const el = e.target;
    if (el.name === 'eb-policy') {
      state.policy = el.value === 'self'
        ? { policyId: null, payerId: null, planId: null, selfPay: true }
        : coverOf(el.value);
      stale();
      return draw();
    }
    if (el.name === 'eb-selfpay') {
      state.policy = { ...state.policy, selfPay: el.value === 'self' };
      stale();
      return draw();
    }
    if (el.id === 'eb-payer') {
      const payer = payers.get(el.value);
      const plan = (payer?.plans || []).find((p) => p.status === 'Active');
      state.policy = { policyId: null, payerId: el.value || null, planId: plan?.id || null, selfPay: false };
      stale();
      return draw();
    }
    if (el.id === 'eb-plan') {
      state.policy = { ...state.policy, planId: el.value || null };
      stale();
      return draw();
    }
    if (el.id === 'eb-visit-type' || el.id === 'eb-department') {
      state.context[el.id === 'eb-visit-type' ? 'visitType' : 'department'] = el.value;
      stale();
      return markIssue();
    }
    if (el.id === 'eb-dos') {
      // A half-typed date reads as blank, and a blank date matches no term — so
      // the field falls back to today rather than emptying the answer.
      state.context.dateOfService = iso(el.value) || todayIso();
      el.value = state.context.dateOfService;
      stale();
      return draw();
    }
    const line = lineOf(el);
    if (line && el.dataset.field === 'itemId') {
      line.itemId = el.value;
      line.consumption = prefilledConsumption(line.itemId, line.qty);
      stale();
      return draw();
    }
    if (line && el.dataset.field === 'qty') {
      line.qty = Math.max(1, Number(el.value) || 1);
      line.consumption = prefilledConsumption(line.itemId, line.qty);
      stale();
      return draw();
    }
  });

  mount.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-mrn]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      pick(row.dataset.mrn);
      draw();
    }
  });

  /** Choosing a patient takes the highest cover on their chain without asking. */
  function pick(mrn) {
    state.subject = { kind: 'patient', mrn, name: '', phone: '' };
    state.q = '';
    const first = policies.chain(mrn)[0];
    state.policy = first
      ? coverOf(first.id)
      : { policyId: null, payerId: null, planId: null, selfPay: true };
    stale();
  }

  const coverOf = (policyId) => {
    const policy = policies.get(policyId);
    return policy
      ? { policyId: policy.id, payerId: policy.payerId, planId: policy.planId, selfPay: false }
      : { policyId: null, payerId: null, planId: null, selfPay: true };
  };

  /** The price on screen is no longer the price of what is in the rail. */
  const stale = () => {
    state.signature = '';
    markIssue();
  };

  function lineOf(el) {
    const box = el.closest?.('[data-index]');
    return box ? state.lines[Number(box.dataset.index)] : null;
  }

  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  draw();
  result.draw();
}

// --- state --------------------------------------------------------------------

function blank(query = {}) {
  const mrn = patients.get(query.mrn) ? query.mrn : '';
  const state = {
    no: '',
    subject: { kind: query.subject === 'prospect' ? 'prospect' : 'patient', mrn, name: '', phone: '' },
    q: '',
    // A walk-in is quoted off a card far more often than not, so the payer
    // picker opens live; a patient with nothing on their chain is self-pay.
    policy: { policyId: null, payerId: null, planId: null, selfPay: query.subject !== 'prospect' && !mrn },
    context: { visitType: 'Outpatient', department: '', dateOfService: todayIso() },
    lines: [{ itemId: '', qty: 1, consumption: [] }],
    outcome: null,
    signature: '',
    lineFilter: 'all',
    // The encounter this estimate is being quoted for, when it was started from
    // one. It is carried through to the draft so the Linked Records tab that
    // opened the builder is the one the estimate comes back to.
    encounterNo: query.encounterNo || '',
  };
  const first = mrn ? policies.chain(mrn)[0] : null;
  if (first) {
    state.policy = { policyId: first.id, payerId: first.payerId, planId: first.planId, selfPay: false };
  }
  return state;
}

function fromRow(row) {
  return {
    no: row.no,
    subject: {
      kind: row.subject.kind,
      mrn: row.subject.mrn || '',
      name: row.subject.name || '',
      phone: row.subject.phone || '',
    },
    q: '',
    policy: { ...row.policy },
    context: { ...row.context },
    lines: row.lines.map((line) => ({ ...line, consumption: (line.consumption || []).map((c) => ({ ...c })) })),
    outcome: null,
    signature: '',
    lineFilter: 'all',
    encounterNo: row.encounterNo || '',
  };
}
