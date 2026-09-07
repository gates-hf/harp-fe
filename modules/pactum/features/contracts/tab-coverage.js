// The Coverage tab of the contract page: one split schedule per linked plan,
// the missing-Default banner the activation gate reads, and a preview strip that
// runs an allowed amount through the resolved row. contract-view.js renders this
// into a fresh node each time, so the listeners bound here retire with it.
//
// The selected plan is local state, so a save redraws this tab rather than the
// whole page — the plan the user is working on stays selected.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, usd } from '../../../../shared/format.js';
import { optionsHtml } from './fee-schedule.js';
import { openCoverageForm, openCopyCoverage } from './coverage-form.js';
import { cdmIsEmpty, cdmGateHtml } from './cdm-gate.js';

const PRECEDENCE = 'Precedence: a charge takes the narrowest row covering it — Item, then Category, '
  + 'then Service Group, then Default. Coverage carries no dates, so a plan holds one row per scope.';

/** render(host, { contractId, readOnly }) */
export async function render(host, { contractId, readOnly }) {
  // Nothing here can be configured against an empty charge master.
  if (cdmIsEmpty()) {
    host.innerHTML = cdmGateHtml();
    return;
  }

  const res = await fetch(new URL('./tab-coverage.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load tab-coverage.html (${res.status})`);
  host.innerHTML = await res.text();

  const $ = (sel) => host.querySelector(sel);
  const contract = () => contracts.get(contractId);
  const plans = contracts.plansOf(contract());
  const state = { planId: plans[0]?.id || '', itemId: '', allowed: '' };
  const rows = () => contracts.coverageFor(contract(), state.planId);

  function draw() {
    const c = contract();
    $('#tc-plans').innerHTML = plans.map(planButtonHtml).join('')
      || '<span class="t-body-sm">This contract has no linked plans.</span>';
    $('#tc-actions').innerHTML = actionsHtml();
    $('#tc-banner').innerHTML = bannerHtml(c);

    const list = rows();
    $('#tc-rows').innerHTML = list.map(rowHtml).join('');
    $('#tc-table').hidden = list.length === 0;
    $('#tc-empty').hidden = list.length > 0;
    if (!list.length) $('#tc-empty').innerHTML = emptyHtml();
    $('#tc-hint').textContent = readOnly
      ? `${PRECEDENCE} This contract is ${c.status.toLowerCase()}, so its coverage is read-only.`
      : PRECEDENCE;

    drawPreview();
  }

  function planButtonHtml(plan) {
    const ok = contracts.hasDefaultCoverage(contract(), plan.id);
    return `
      <button type="button" data-plan="${esc(plan.id)}" aria-pressed="${plan.id === state.planId}"
              title="${ok ? 'Default row set' : 'No Default row on this plan'}">
        ${esc(plan.name)} ${ok ? '✓' : '· Default missing'}
      </button>`;
  }

  function actionsHtml() {
    if (readOnly || !state.planId) return '';
    return `
      <button class="btn btn--secondary btn--sm" data-act="copy"${plans.length < 2 ? ' disabled title="This contract has one linked plan, so there is nothing to copy from"' : ''}>
        <span class="icon icon--sm">content_copy</span>Copy from plan…
      </button>
      <button class="btn btn--primary btn--sm" data-act="add">
        <span class="icon icon--sm">add</span>Add row
      </button>`;
  }

  function bannerHtml(c) {
    const missing = contracts.plansMissingDefaultCoverage(c);
    if (!missing.length) {
      return `
        <div class="alert alert--success">
          <span class="icon">check_circle</span>
          <div><div class="title">Default coverage: set on every plan</div>
            Any charge no narrower row covers still splits between the payer and the patient.</div>
        </div>`;
    }
    return `
      <div class="alert alert--warning">
        <span class="icon">priority_high</span>
        <div><div class="title">Default coverage: ${readOnly ? 'never set' : 'required before activation'}</div>
          ${missing.length === 1 ? 'Plan' : 'Plans'} ${esc(missing.map((p) => p.name).join(', '))}
          ${missing.length === 1 ? 'has' : 'have'} no Default row${readOnly ? '.' : '. Add one so every charge has a patient share.'}</div>
      </div>`;
  }

  function rowHtml(row) {
    return `
      <tr data-id="${esc(row.id)}">
        <td>${esc(row.scopeLevel)}</td>
        <td>${scopeValueHtml(row)}</td>
        <td><span class="badge badge--${row.covered ? 'success' : 'critical'}"><span class="dot"></span>${row.covered ? 'Yes' : 'No'}</span></td>
        <td class="t-mono-sm">${esc(contracts.shareSummary(row))}</td>
        <td class="num t-mono-sm">${row.ceiling ? usd(row.ceiling) : '—'}</td>
        <td>${readOnly ? '' : `
          <button class="btn btn--ghost btn--icon btn--sm" data-act="edit" title="Edit this row">
            <span class="icon icon--sm">edit</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="remove" title="Remove this row">
            <span class="icon icon--sm">delete</span>
          </button>`}
        </td>
      </tr>`;
  }

  /** An item scope names the line it covers; every other level is its value. */
  function scopeValueHtml(row) {
    if (row.scopeLevel === 'Default') return '—';
    if (row.scopeLevel !== 'Item') return esc(row.scopeValue);
    const item = cdm.get(row.scopeValue);
    return item
      ? `<span class="t-mono-sm">${esc(item.chargeCode)}</span> ${esc(cdm.label(item))}`
      : esc(row.scopeValue);
  }

  function emptyHtml() {
    const plan = contracts.planNameOf(contract(), state.planId);
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">balance</span></div>
        <div class="state-view__title">No coverage on ${esc(plan)} yet</div>
        <p class="state-view__body">${readOnly
          ? 'This contract closed without a split for this plan.'
          : 'Start with a Default row — it splits everything the contract does not name — then add narrower rows for the services that split differently.'}</p>
        ${readOnly ? '' : `
        <div class="state-view__actions">
          <button class="btn btn--primary" data-act="add">Add row</button>
          ${plans.length > 1 ? '<button class="btn btn--secondary" data-act="copy">Copy from plan…</button>' : ''}
        </div>`}
      </div>`;
  }

  // --- preview strip --------------------------------------------------------

  /** The table prints a bare dash for no share; a sentence needs the words. */
  function shareLine(row) {
    const summary = contracts.shareSummary(row);
    return summary === '—' ? 'no patient share' : summary;
  }

  /** The allowed amount a claim would carry: the contract rate, else the price. */
  function defaultAllowed(item) {
    if (!item) return '';
    return String(contracts.resolvedPrice(contract(), item) || item.standardPrice || 0);
  }

  function drawPreview() {
    const items = cdm.findActive();
    if (!state.itemId) state.itemId = items[0]?.id || '';
    $('#tc-try-item').innerHTML = optionsHtml(items, state.itemId);
    const item = cdm.get(state.itemId);
    if (state.allowed === '') state.allowed = defaultAllowed(item);
    $('#tc-try-allowed').value = state.allowed;
    drawPreviewOut();
  }

  function drawPreviewOut() {
    const item = cdm.get(state.itemId);
    const box = $('#tc-try-out');
    if (!item || !state.planId) {
      box.innerHTML = '<p class="t-body-sm">Choose a charge line to see how this plan splits it.</p>';
      return;
    }
    const row = contracts.resolveCoverage(contract(), state.planId, item);
    const allowed = Number(state.allowed) || 0;
    const patient = contracts.patientShare(allowed, row);
    const payer = contracts.payerShare(allowed, row);
    box.innerHTML = `
      <dl class="dl dl--narrow">
        <dt>Resolved row</dt>
        <dd>${row
          ? `${esc(contracts.scopeLabel(row))} — ${esc(shareLine(row))}${row.ceiling ? ` · ceiling ${usd(row.ceiling)}` : ''}`
          : 'No row covers this charge, so the payer carries the whole allowed amount.'}</dd>
        <dt>Allowed amount</dt><dd class="t-mono-sm">${usd(allowed)}</dd>
        <dt>Patient share</dt><dd class="t-mono-sm">${usd(patient)}</dd>
        <dt>Payer share</dt><dd class="t-mono-sm">${usd(payer)}</dd>
      </dl>`;
  }

  // --- actions --------------------------------------------------------------

  async function edit(rowId) {
    const saved = await openCoverageForm({ contractId, planId: state.planId, rowId });
    if (saved) draw();
  }

  async function copy() {
    const copied = await openCopyCoverage({ contractId, toPlanId: state.planId });
    if (copied != null) draw();
  }

  async function remove(rowId) {
    const row = rows().find((r) => r.id === rowId);
    if (!row) return;
    const ok = await modal.confirm({
      title: 'Remove coverage row',
      body: `${contracts.scopeLabel(row)} on ${contracts.planNameOf(contract(), state.planId)} stops splitting this contract. `
        + 'Charges in that scope fall to the next row up.',
      confirmLabel: 'Remove row',
      tone: 'critical',
      icon: 'delete',
    });
    if (!ok) return;
    contracts.removeCoverageRow(contractId, state.planId, rowId);
    toast('Coverage row removed', 'success');
    draw();
  }

  // --- events ---------------------------------------------------------------

  host.addEventListener('click', (e) => {
    const plan = e.target.closest('[data-plan]');
    if (plan) {
      state.planId = plan.dataset.plan;
      return draw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || readOnly) return;
    if (act === 'add') return void edit(null);
    if (act === 'copy') return void copy();
    const id = e.target.closest('tr[data-id]')?.dataset.id;
    if (act === 'edit') return void edit(id);
    if (act === 'remove') return void remove(id);
  });

  host.addEventListener('change', (e) => {
    if (e.target.id !== 'tc-try-item') return;
    state.itemId = e.target.value;
    state.allowed = defaultAllowed(cdm.get(state.itemId));
    $('#tc-try-allowed').value = state.allowed;
    drawPreviewOut();
  });

  host.addEventListener('input', (e) => {
    if (e.target.id !== 'tc-try-allowed') return;
    state.allowed = e.target.value;
    drawPreviewOut();
  });

  draw();
}
