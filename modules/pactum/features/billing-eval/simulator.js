// The billing simulator at #/pactum/billing-simulator — the screen that runs
// the evaluation engine. The encounter is entered in the rail on the left and
// the traceable result stands beside it. Nothing here writes to the store: it
// prices a claim that never happened.
//
// #/pactum/billing-simulator/<contract id> opens pre-filled with that
// contract's payer, plan and a date that version actually billed on, which is
// what the Simulate billing link on the contract page hands over.

import * as payers from '../../../../data/repositories/payers.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import { evaluateEncounter, invoiceRows } from '../../../../data/engines/billing-engine.js';
import { prefilledConsumption } from '../../../../shared/consumption-table.js';
import { contractHtml, lineHtml } from './simulator-inputs.js';
import { resultView } from './simulator-result.js';
import { SCENARIOS, scenarioById } from './scenarios.js';
// Three pure helpers the contracts feature already owns: the CDM picker and the
// CSV writer. Copying them here would be a second copy to keep in step.
import { csvLine, download } from '../contracts/fee-schedule.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { toast } from '../../../../shared/toast.js';
import { esc, iso } from '../../../../shared/format.js';

export const meta = { title: 'Billing simulator' };

const GENDERS = ['Female', 'Male'];

export async function render(mount, ctx) {
  const res = await fetch(new URL('./simulator.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load simulator.html (${res.status})`);
  mount.innerHTML = await res.text();

  const $ = (sel) => mount.querySelector(sel);
  const state = {
    scenarioId: SCENARIOS[0].id,
    payerId: '',
    planId: '',
    patient: { age: '', gender: '', nationality: '' },
    encounter: { dateOfService: contracts.today(), admissionType: '', department: '', lengthOfStay: '', diagnosisCode: '' },
    lines: [blankLine()],
    outcome: null,
    lineFilter: 'all',
  };

  // The priced result is a screen of its own — simulator-result.js draws it,
  // this file draws the encounter that feeds it.
  const result = resultView(mount, state);

  ctx.setCrumb([
    { label: 'Pactum', path: '/pactum/payers' },
    { label: 'Billing Simulator' },
  ]);

  prefill(ctx.params[0]);
  drawFields();
  drawLines();
  result.draw();

  /** The Simulate billing link: this contract's payer, plan and a live date. */
  function prefill(contractId) {
    const contract = contractId ? contracts.get(contractId) : null;
    if (!contract) return;
    state.payerId = contract.payerId;
    state.planId = contract.planIds?.[0] || '';
    state.encounter.dateOfService = billableDate(contract);
  }

  /**
   * A date this version actually billed on: inside its term, on or after it
   * went live, and on or before it closed or was terminated. Today whenever
   * today is one of them, so the link lands on a priced encounter rather than
   * on "no contract billed this plan".
   */
  function billableDate(c) {
    const from = [c.startDate, c.effectiveDate].filter(Boolean).sort().pop() || '';
    const to = [c.endDate, c.terminationDate, c.closedAt].filter(Boolean).sort()[0] || '';
    const now = contracts.today();
    if (from && now < from) return from;
    if (to && now > to) return to;
    return now;
  }

  // --- inputs ---------------------------------------------------------------

  function drawFields() {
    $('#bs-scenario').innerHTML = SCENARIOS.map(
      (s) => `<option value="${esc(s.id)}"${s.id === state.scenarioId ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    $('#bs-scenario-hint').textContent = scenarioById(state.scenarioId)?.hint || '';
    $('#bs-payer').innerHTML =
      `<option value=""${state.payerId ? '' : ' selected'}>Choose a payer</option>` +
      payers.findActive().map((p) => `<option value="${esc(p.id)}"${p.id === state.payerId ? ' selected' : ''}>${esc(p.nameEn)}</option>`).join('');
    $('#bs-gender').innerHTML = optionList(GENDERS, state.patient.gender, 'Not given');
    $('#bs-admission').innerHTML = optionList(contracts.ADMISSION_TYPES, state.encounter.admissionType, 'Not given');
    $('#bs-dos').value = state.encounter.dateOfService;
    $('#bs-age').value = state.patient.age;
    $('#bs-nationality').value = state.patient.nationality;
    $('#bs-department').value = state.encounter.department;
    $('#bs-los').value = state.encounter.lengthOfStay;
    $('#bs-diagnosis').value = state.encounter.diagnosisCode;
    drawPlans();
  }

  /** The payer's plans, from the repository's own active list — never a copy. */
  function activePlans() {
    return payers.findActive().find((p) => p.id === state.payerId)?.plans || [];
  }

  function drawPlans() {
    const plans = activePlans();
    // A plan the opened contract names stays on the list even after the payer
    // retires it: dropping it silently would price the claim under a different
    // contract from the one the user came from.
    const held = state.planId && !plans.some((p) => p.id === state.planId)
      ? payers.get(state.payerId)?.plans.find((p) => p.id === state.planId)
      : null;
    const list = held ? [...plans, held] : plans;
    if (!list.some((p) => p.id === state.planId)) state.planId = list[0]?.id || '';

    $('#bs-plan').innerHTML = list.length
      ? list.map((p) => `<option value="${esc(p.id)}"${p.id === state.planId ? ' selected' : ''}>${
        esc(p.name)} — ${esc(p.code)}${p.status === 'Active' ? '' : ' (inactive plan)'}</option>`).join('')
      : `<option value="">${state.payerId ? 'This payer has no active plan' : 'Choose a payer first'}</option>`;
    drawContract();
  }

  function drawContract() {
    const on = state.encounter.dateOfService;
    const contract = state.payerId && state.planId
      ? contracts.contractForService(state.payerId, state.planId, on)
      : null;
    $('#bs-contract').innerHTML = contractHtml({ contract, payerId: state.payerId, planId: state.planId, on });
  }

  function drawLines() {
    $('#bs-line-count').textContent = `${state.lines.length} line${state.lines.length === 1 ? '' : 's'}`;
    $('#bs-lines').innerHTML = state.lines.length
      ? state.lines.map(lineHtml).join('')
      : '<p class="t-body-sm">No charge lines. Add one, or load a scenario.</p>';
  }

  // --- actions --------------------------------------------------------------

  function run() {
    if (!state.payerId || !state.planId) return toast('Choose a payer and a plan before running', 'warning');
    const lines = state.lines.filter((l) => l.itemId);
    if (!lines.length) return toast('Add at least one charge line to run', 'warning');
    state.outcome = evaluateEncounter(state.payerId, state.planId, patientCtx(), encounterCtx(), lines);
    state.lineFilter = 'all';
    result.draw();
    if (state.outcome.error) toast(state.outcome.error, 'warning');
  }

  function loadScenario() {
    const scenario = scenarioById(state.scenarioId);
    if (!scenario) return;
    const data = scenario.build();
    Object.assign(state, {
      payerId: data.payerId,
      planId: data.planId,
      patient: { age: '', gender: '', nationality: '', ...data.patient },
      encounter: { ...state.encounter, ...data.encounter },
      lines: data.lines.map((line) => ({ ...blankLine(), ...line, consumption: line.consumption || prefilledConsumption(line.itemId, line.qty) })),
    });
    drawFields();
    drawLines();
    run();
    toast(`Loaded ${scenario.name.toLowerCase()}`, 'info');
  }

  function clear() {
    Object.assign(state, {
      patient: { age: '', gender: '', nationality: '' },
      encounter: { dateOfService: contracts.today(), admissionType: '', department: '', lengthOfStay: '', diagnosisCode: '' },
      lines: [blankLine()],
      outcome: null,
      lineFilter: 'all',
    });
    drawFields();
    drawLines();
    result.draw();
  }

  function exportCsv() {
    if (!state.outcome?.traces?.length) return toast('Run the encounter before exporting it', 'warning');
    const { contract, traces, totals } = state.outcome;
    const rows = invoiceRows(traces).map((r) =>
      csvLine([r.isOverage ? 'Overage' : 'Charge', r.chargeCode, r.description, r.qtyLabel,
        r.amount.toFixed(2), r.payer.toFixed(2), r.patient.toFixed(2), r.status]));
    const head = [
      csvLine([`${contract.contractNo} v${contract.version} — ${contracts.payerName(contract)}`]),
      csvLine([`Plan ${contracts.planNameOf(contract, state.planId)} · date of service ${state.encounter.dateOfService}`]),
      csvLine([`Allowed ${totals.allowed.toFixed(2)} · payer ${totals.payer.toFixed(2)} · patient ${totals.patient.toFixed(2)} · overage ${totals.overage.toFixed(2)}`]),
      '',
      ['Line', 'Charge Code', 'Description', 'Qty', 'Allowed', 'Payer', 'Patient', 'Status'].join(','),
    ];
    download(`billing-simulation-${contract.contractNo}-${state.encounter.dateOfService}.csv`, [...head, ...rows].join('\r\n'));
    toast('Simulation exported', 'success');
  }

  const patientCtx = () => ({
    age: state.patient.age === '' ? undefined : Number(state.patient.age),
    gender: state.patient.gender,
    nationality: state.patient.nationality,
  });

  const encounterCtx = () => ({
    ...state.encounter,
    lengthOfStay: state.encounter.lengthOfStay === '' ? undefined : Number(state.encounter.lengthOfStay),
  });

  // --- events ---------------------------------------------------------------

  mount.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'bs-scenario') {
      state.scenarioId = el.value;
      $('#bs-scenario-hint').textContent = scenarioById(state.scenarioId)?.hint || '';
      return;
    }
    if (el.id === 'bs-payer') {
      state.payerId = el.value;
      state.planId = '';
      return drawPlans();
    }
    if (el.id === 'bs-plan') {
      state.planId = el.value;
      return drawContract();
    }
    if (el.id === 'bs-dos') {
      // A half-typed date reads as blank, and a blank date matches no term —
      // so the field falls back to today rather than emptying the screen.
      state.encounter.dateOfService = iso(el.value) || contracts.today();
      el.value = state.encounter.dateOfService;
      return drawContract();
    }
    const line = lineOf(el);
    if (line && el.dataset.field === 'itemId') {
      line.itemId = el.value;
      line.consumption = prefilledConsumption(line.itemId, line.qty);
      return drawLines();
    }
    if (line && el.dataset.field === 'qty') {
      line.qty = Math.max(1, Number(el.value) || 1);
      return drawLines();
    }
  });

  mount.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.patient) state.patient[el.dataset.patient] = el.value;
    if (el.dataset.encounter) state.encounter[el.dataset.encounter] = el.value;
    const line = lineOf(el);
    if (!line) return;
    if (el.dataset.field === 'qty') line.qty = Math.max(1, Number(el.value) || 1);
    if (el.dataset.consumption) {
      let entry = line.consumption.find((c) => c.componentId === el.dataset.consumption);
      if (!entry) {
        entry = { componentId: el.dataset.consumption };
        line.consumption.push(entry);
      }
      entry[el.dataset.unit] = Number(el.value) || 0;
    }
  });

  mount.addEventListener('click', (e) => {
    const kpi = metricKey(e);
    if (kpi) {
      state.lineFilter = state.lineFilter === kpi ? 'all' : kpi;
      return result.drawInvoice();
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'run') return run();
    if (act === 'clear') return clear();
    if (act === 'load') return loadScenario();
    if (act === 'export') return exportCsv();
    if (act === 'add-line') {
      state.lines.push(blankLine());
      return drawLines();
    }
    if (act === 'remove-line') {
      state.lines.splice(Number(e.target.closest('[data-index]').dataset.index), 1);
      return drawLines();
    }
  });

  function lineOf(el) {
    const box = el.closest?.('[data-index]');
    return box ? state.lines[Number(box.dataset.index)] : null;
  }
}

const blankLine = () => ({ itemId: '', qty: 1, consumption: [] });

const optionList = (values, chosen, blank) =>
  `<option value=""${chosen ? '' : ' selected'}>${blank}</option>` +
  values.map((v) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(v)}</option>`).join('');
