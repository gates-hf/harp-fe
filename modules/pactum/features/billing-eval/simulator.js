// The billing simulator at #/pactum/billing-simulator — the screen that runs
// the evaluation engine. Inputs on the left, the traceable result on the right.
// Nothing here writes to the store: it prices a claim that never happened.
//
// #/pactum/billing-simulator/<contract id> opens pre-filled with that
// contract's payer, plan and a date its term covers, which is what the
// Simulate billing link on the contract page hands over.

import * as payers from '../../../../data/repositories/payers.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { evaluateEncounter, invoiceRows } from '../../../../data/engines/billing-engine.js';
import { limitRows, consumedLabel } from '../../../../data/engines/overage-engine.js';
import { breakdownHtml, totalsRailHtml, invoiceTableHtml } from './breakdown-panel.js';
import { SCENARIOS, scenarioById } from './scenarios.js';
// Three pure helpers the contracts feature already owns: the CDM picker and the
// CSV writer. Copying them here would be a second copy to keep in step.
import { optionsHtml, csvLine, download } from '../contracts/fee-schedule.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, usd } from '../../../../shared/format.js';

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
  };

  ctx.setCrumb([
    { label: 'Pactum', path: '/pactum/payers' },
    { label: 'Billing Simulator' },
  ]);

  prefill(ctx.params[0]);
  drawFields();
  drawLines();
  drawResult();

  /** The Simulate billing link: this contract's payer, plan and a covered date. */
  function prefill(contractId) {
    const contract = contractId ? contracts.get(contractId) : null;
    if (!contract) return;
    const now = contracts.today();
    state.payerId = contract.payerId;
    state.planId = contract.planIds?.[0] || '';
    state.encounter.dateOfService =
      now < contract.startDate ? contract.startDate : now > contract.endDate ? contract.endDate : now;
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

  function drawPlans() {
    const plans = (payers.get(state.payerId)?.plans || []).filter((p) => p.status === 'Active');
    if (!plans.some((p) => p.id === state.planId)) state.planId = plans[0]?.id || '';
    $('#bs-plan').innerHTML = plans.length
      ? plans.map((p) => `<option value="${esc(p.id)}"${p.id === state.planId ? ' selected' : ''}>${esc(p.name)} — ${esc(p.code)}</option>`).join('')
      : '<option value="">No active plan</option>';
    drawContract();
  }

  function drawContract() {
    const contract = state.payerId && state.planId
      ? contracts.contractForService(state.payerId, state.planId, state.encounter.dateOfService)
      : null;
    $('#bs-contract').innerHTML = contract
      ? `<div class="rule-child-row">
           <span class="icon">contract</span>
           <div>
             <a class="crumb-link" href="#/pactum/contracts/${esc(contract.id)}">${esc(contract.contractNo)} — ${esc(contract.name)}</a>
             <span class="badge badge--accent">v${contract.version}</span>
             <span class="badge"><span class="dot"></span>${esc(contract.status)}</span>
             <br><span class="t-body-sm">${date(contract.startDate)} – ${date(contract.endDate)}</span>
           </div>
         </div>`
      : `<div class="alert alert--warning">
           <span class="icon">error</span>
           <div>No active contract for this plan on ${date(state.encounter.dateOfService)}.</div>
         </div>`;
  }

  function drawLines() {
    $('#bs-line-count').textContent = `${state.lines.length} line${state.lines.length === 1 ? '' : 's'}`;
    $('#bs-lines').innerHTML = state.lines.length
      ? state.lines.map(lineHtml).join('')
      : '<p class="t-body-sm">No charge lines. Add one, or load a scenario.</p>';
  }

  function lineHtml(line, i) {
    const item = cdm.get(line.itemId);
    return `
      <div class="panel panel--sunken" data-index="${i}">
        <div class="panel-body">
          <label class="field">
            <select data-field="itemId" aria-label="Charge line ${i + 1}">${optionsHtml(cdm.findActive(), line.itemId)}</select>
          </label>
          <div class="toolbar">
            <label class="field">
              <span class="icon icon--sm">tag</span>
              <input type="number" min="1" step="1" value="${esc(line.qty)}" data-field="qty" aria-label="Quantity on line ${i + 1}">
            </label>
            <span class="t-body-sm">${item ? `${usd(item.standardPrice)} standard` : 'No charge chosen'}</span>
            <span class="spacer"></span>
            <button class="btn btn--ghost btn--icon btn--sm" data-act="remove-line" title="Remove this line">
              <span class="icon icon--sm">delete</span>
            </button>
          </div>
          ${item && cdm.isBundle(item) ? consumptionHtml(line, item) : ''}
        </div>
      </div>`;
  }

  /** A bundle line carries what the claim used, prefilled with what it includes. */
  function consumptionHtml(line, item) {
    const rows = limitRows(item.id, line.qty);
    if (!rows.length) return '<p class="t-body-sm">This bundle holds no components.</p>';
    return `
      <div class="toolbar">
        <span class="t-title-sm">Consumption</span>
        <span class="spacer"></span>
        <span class="t-body-sm">what the claim used</span>
      </div>
      <table class="tbl">
        <thead><tr><th>Component</th><th class="num">Consumed</th></tr></thead>
        <tbody>${rows.map((row) => componentRowHtml(line, row)).join('')}</tbody>
      </table>`;
  }

  function componentRowHtml(line, row) {
    const entry = line.consumption.find((c) => c.componentId === row.componentId);
    const value = entry ? entry[row.unit] ?? row.included : row.included;
    // The rail is narrow, so what the bundle includes reads under the name
    // rather than in a column of its own.
    return `
      <tr>
        <td>
          <span class="t-mono-sm">${esc(row.item.chargeCode)}</span> ${esc(cdm.label(row.item))}
          <br><span class="t-body-sm">includes ${esc(consumedLabel(row, row.included))}</span>
        </td>
        <td class="num">
          <label class="field">
            <input type="number" min="0" step="${row.unit === 'amount' ? '0.01' : '1'}" value="${esc(value)}"
                   data-consumption="${esc(row.componentId)}" data-unit="${row.unit}"
                   aria-label="Consumed ${esc(cdm.label(row.item))}">
          </label>
        </td>
      </tr>
      ${row.inner.map((inner) => `
        <tr>
          <td colspan="2" class="t-body-sm">· ${esc(inner.item.chargeCode)} — ${esc(cdm.label(inner.item))} ×${inner.qty},
              inside ${esc(cdm.label(row.item))}</td>
        </tr>`).join('')}`;
  }

  // --- result ---------------------------------------------------------------

  function drawResult() {
    const box = $('#bs-result');
    if (!state.outcome) {
      box.innerHTML = stateView('play_circle', 'Nothing run yet',
        'Choose a payer, a plan and the charges, then run the encounter. Or load one of the canned scenarios on the left.');
      return;
    }
    const { contract, error, traces, totals } = state.outcome;
    if (error) {
      box.innerHTML = stateView('error', 'No contract to price against', error);
      return;
    }
    const rows = invoiceRows(traces);
    box.innerHTML = `
      <div class="toolbar">
        <span class="t-title-sm">${esc(contract.contractNo)} v${contract.version}</span>
        <span class="badge badge--accent">${esc(contracts.payerName(contract))}</span>
        <span class="badge">${esc(contracts.planNameOf(contract, state.planId))}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">Date of service ${date(state.encounter.dateOfService)}</span>
      </div>
      ${totalsRailHtml(totals)}
      <div class="toolbar">
        <span class="t-title-sm">Breakdown</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${traces.length} charge line${traces.length === 1 ? '' : 's'} — open one to read its five steps</span>
      </div>
      ${traces.map((trace, i) => breakdownHtml(trace, { open: i === 0 })).join('')}
      <div class="toolbar">
        <span class="t-title-sm">Invoice preview</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${rows.filter((r) => r.isOverage).length} overage line${rows.filter((r) => r.isOverage).length === 1 ? '' : 's'} of ${rows.length}</span>
      </div>
      ${invoiceTableHtml(rows)}`;
  }

  function stateView(icon, title, body) {
    return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${icon}</span></div>
      <div class="state-view__title">${esc(title)}</div>
      <p class="state-view__body">${esc(body)}</p>
    </div>`;
  }

  // --- actions --------------------------------------------------------------

  function run() {
    const lines = state.lines.filter((l) => l.itemId);
    if (!lines.length) return toast('Add at least one charge line to run', 'warning');
    state.outcome = evaluateEncounter(state.payerId, state.planId, patientCtx(), encounterCtx(), lines);
    drawResult();
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
      lines: data.lines.map((line) => ({ ...blankLine(), ...line, consumption: line.consumption || prefilledConsumption(line) })),
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
    });
    drawFields();
    drawLines();
    drawResult();
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

  function prefilledConsumption(line) {
    const item = cdm.get(line.itemId);
    if (!item || !cdm.isBundle(item)) return [];
    return limitRows(item.id, line.qty).map((row) => ({ componentId: row.componentId, [row.unit]: row.included }));
  }

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
      return drawPlans();
    }
    if (el.id === 'bs-plan') {
      state.planId = el.value;
      return drawContract();
    }
    if (el.id === 'bs-dos') {
      state.encounter.dateOfService = el.value;
      return drawContract();
    }
    const line = lineOf(el);
    if (line && el.dataset.field === 'itemId') {
      line.itemId = el.value;
      line.consumption = prefilledConsumption(line);
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
