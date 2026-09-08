// The five things you come to the dashboard to start. Each one reuses the
// screen that already owns the work — the payer modal, the contract modal, the
// item modal, the bundle builder, the two importers — so nothing here is a
// second way to write the same record.

import * as payers from '../../../../data/repositories/payers.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc } from '../../../../shared/format.js';
import { openPayerForm } from '../payer-master/payer-form.js';
import { openItemForm } from '../cdm/cdm-item-form.js';
import { openContractForm } from '../contracts/contract-form.js';

export function buttonsHtml() {
  return `
    <button class="btn btn--secondary btn--sm" data-act="add-payer">
      <span class="icon icon--sm">account_balance</span>Add payer
    </button>
    <button class="btn btn--secondary btn--sm" data-act="add-contract">
      <span class="icon icon--sm">contract</span>Add contract
    </button>
    <button class="btn btn--secondary btn--sm" data-act="add-item">
      <span class="icon icon--sm">sell</span>Add CDM item
    </button>
    <a class="btn btn--secondary btn--sm" href="#/pactum/cdm/bundles/new">
      <span class="icon icon--sm">inventory_2</span>Create bundle
    </a>
    <button class="btn btn--primary btn--sm" data-act="import">
      <span class="icon icon--sm">upload_file</span>Bulk import
    </button>`;
}

/** Run one quick action. Returns true when the click was ours. */
export async function handle(act, ctx) {
  if (act === 'add-payer') {
    const payer = await openPayerForm(null);
    if (payer) toast(`${payer.nameEn} added`, 'success');
    return true;
  }
  if (act === 'add-item') {
    const result = await openItemForm(null);
    if (result) toast(`${result.row.chargeCode} added`, 'success');
    return true;
  }
  if (act === 'add-contract') {
    await addContract(ctx);
    return true;
  }
  if (act === 'import') {
    await chooseImport(ctx);
    return true;
  }
  return false;
}

// --- add contract ------------------------------------------------------------

/**
 * A contract belongs to a payer, so the dialog asks which one before the
 * contract modal opens. Saving lands on that payer's agreements, where the
 * new draft can be activated.
 */
async function addContract(ctx) {
  const active = payers.findActive();
  if (!active.length) {
    toast('No active payers yet — add a payer first', 'warning');
    return;
  }

  const payerId = await pickPayer(active);
  if (!payerId) return;

  const contract = await openContractForm({ payerId });
  if (!contract) return;
  toast(`${contract.contractNo} drafted`, 'success');
  ctx.navigate(`/pactum/payers/${payerId}/contracts`);
}

function pickPayer(list) {
  const dialog = modal.open({
    title: 'Add contract',
    sub: 'Pick the payer this agreement is with',
    icon: 'contract',
    size: 'sm',
    body: `
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">account_balance</span>
          <select id="qa-payer" aria-label="Payer">
            ${list.map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)} — ${esc(p.type)}</option>`).join('')}
          </select>
        </label>
      </div>`,
    note: 'Only active payers can take a new contract.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="pick">Continue</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="pick"]')) dialog.close(dialog.el.querySelector('#qa-payer').value);
  });
  return dialog.closed;
}

// --- bulk import -------------------------------------------------------------

/** Two importers, one button. The listbox is the system's pick-one sheet. */
async function chooseImport(ctx) {
  const dialog = modal.open({
    title: 'Bulk import',
    sub: 'Pick what you are loading',
    icon: 'upload_file',
    size: 'sm',
    body: `
      <div class="menu" role="menu">
        <div class="menu-item" role="menuitem" tabindex="0" data-pick="/pactum/payers/import">
          <span class="icon">account_balance</span>Payers — names, licences and contacts
        </div>
        <div class="menu-item" role="menuitem" tabindex="0" data-pick="/pactum/cdm/import">
          <span class="icon">sell</span>CDM items — charge codes and standard prices
        </div>
      </div>`,
    note: 'Both importers preview and validate before anything is saved.',
    foot: '<button class="btn btn--secondary" data-close>Cancel</button>',
  });

  const pick = (e) => {
    const item = e.target.closest('[data-pick]');
    if (item) dialog.close(item.dataset.pick);
  };
  dialog.el.addEventListener('click', pick);
  dialog.el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(e);
    }
  });

  const path = await dialog.closed;
  if (path) ctx.navigate(path);
}
