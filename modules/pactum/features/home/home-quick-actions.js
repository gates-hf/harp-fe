// The four things you come to the dashboard to start. Each one reuses the
// screen that already owns the work — the payer modal, the contract modal, the
// item modal, the bundle builder — so nothing here is a second way to write the
// same record. They are rows in the floating action bar (shared/fab.js), which
// is why they are data rather than markup.

import * as payers from '../../../../data/repositories/payers.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc } from '../../../../shared/format.js';
import { openPayerForm } from '../payer-master/payer-form.js';
import { openItemForm } from '../cdm/cdm-item-form.js';
import { openContractForm } from '../contracts/contract-form.js';

/** The bar's rows, in the order the work usually happens. */
export function actions() {
  return [
    { act: 'add-payer', label: 'Add payer', icon: 'account_balance' },
    { act: 'add-contract', label: 'Add contract', icon: 'contract' },
    { act: 'add-item', label: 'Add CDM item', icon: 'sell' },
    // The builder is a page, so this row is a real link: it survives a middle
    // click the way every other navigation in the shell does.
    { href: '#/pactum/cdm/bundles/new', label: 'Create bundle', icon: 'inventory_2' },
  ];
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
