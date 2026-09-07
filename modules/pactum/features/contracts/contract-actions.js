// The four decisions a contract carries: activate a draft, edit an active
// contract (corrective or as a new version), terminate, and delete a draft.
// Each one is a dialog that validates before it writes, and each one lands in
// the audit trail through the repository.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc } from '../../../../shared/format.js';
import { openContractForm } from './contract-form.js';

/** Activate a draft. Resolves to the activated contract, or undefined. */
export async function askActivate(contract) {
  if (!contract || contract.status !== 'Draft') return undefined;

  // The gate: a contract cannot bill without a rate for every charge, and a
  // bundle price cannot bill without saying who pays for an overrun.
  const blockers = contracts.activationBlockers(contract);
  if (blockers.length) {
    await modal.open({
      title: 'Not ready to activate',
      sub: `${esc(contract.contractNo)} — version ${contract.version}`,
      tone: 'warning',
      icon: 'priority_high',
      size: 'md',
      body: `
        <p class="modal__lede">Finish the configuration first — ${blockers.length === 1 ? 'one thing is' : `${blockers.length} things are`}
           still open on this draft.</p>
        ${blockers.map((why) => `
          <div class="rule-child-row">
            <span class="icon">priority_high</span>
            <div>${esc(why)}</div>
          </div>`).join('')}`,
      foot: '<button class="btn btn--primary" data-close>Back to the contract</button>',
    }).closed;
    return undefined;
  }

  const dialog = modal.open({
    title: 'Activate contract',
    sub: `${esc(contract.contractNo)} — version ${contract.version}`,
    icon: 'play_circle',
    size: 'sm',
    body: `
      <p class="modal__lede">Once active, this contract is what the platform bills ${esc(contracts.payerName(contract))} under.
         An earlier active version of the same agreement is closed on the same date.</p>
      <dl class="dl dl--narrow">
        <dt><label for="ca-effective">Active from *</label></dt>
        <dd>
          <label class="field"><input id="ca-effective" name="effectiveDate" type="date"
                 value="${esc(contract.startDate)}" min="${esc(contract.startDate)}"></label>
          <div class="field-error" data-error="effectiveDate" hidden></div>
        </dd>
      </dl>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="activate">Activate</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="activate"]')) return;
    const input = dialog.el.querySelector('[name="effectiveDate"]');
    const value = input.value;
    const fail = (message) => showError(dialog.el, 'effectiveDate', message);

    clearErrors(dialog.el);
    if (!value) return fail('Choose the date this contract becomes active.');
    if (value < contract.startDate) return fail(`The date cannot be before the start date, ${date(contract.startDate)}.`);

    const clash = contracts.planOverlap(contract.planIds, contract.startDate, contract.endDate, contract.id);
    if (clash) {
      return fail(`Plan ${clash.planName} is already covered by ${clash.contract.contractNo} (${clash.contract.status}) until ${date(clash.contract.endDate)}.`);
    }

    const activated = contracts.activate(contract.id, value);
    dialog.close(activated);
    toast('Contract activated — configuration is now live', 'success');
  });

  return dialog.closed;
}

/**
 * Edit an Active contract: correct it in place, or open a new version.
 * Resolves to 'corrective' after a saved correction, the new draft after a
 * change, or undefined when nothing happened.
 */
export async function chooseEditType(contract, { navigate } = {}) {
  if (!contract || contract.status !== 'Active') return undefined;
  const next = contracts.nextVersion(contract.lineageId);

  const dialog = modal.open({
    title: 'What kind of edit is this?',
    sub: `${esc(contract.contractNo)} — version ${contract.version}, active`,
    icon: 'edit_note',
    size: 'md',
    body: `
      <div class="rule-child-row">
        <div>
          <div class="t-title-sm">Corrective edit</div>
          <div class="t-body-sm">Fix a mistake in version ${contract.version}. The agreement did not change, so no new version is created and the trail records the fields you changed.</div>
        </div>
        <span class="spacer"></span>
        <button class="btn btn--secondary" data-act="corrective">Correct version ${contract.version}</button>
      </div>
      <div class="rule-child-row">
        <div>
          <div class="t-title-sm">Change</div>
          <div class="t-body-sm">The agreement itself changed. Version ${next} is drafted as a copy of this one; activating it closes version ${contract.version}.</div>
        </div>
        <span class="spacer"></span>
        <button class="btn btn--primary" data-act="change">Create version ${next}</button>
      </div>`,
    foot: '<button class="btn btn--secondary" data-close>Cancel</button>',
  });

  dialog.el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) dialog.close(act);
  });

  const choice = await dialog.closed;

  if (choice === 'corrective') {
    const saved = await openContractForm({ payerId: contract.payerId, contractId: contract.id });
    if (!saved) return undefined;
    toast(`${saved.contractNo} corrected`, 'success');
    return 'corrective';
  }

  if (choice === 'change') {
    const draft = contracts.createVersion(contract.id);
    toast(`Version ${draft.version} draft created`, 'success');
    navigate?.(`/pactum/contracts/${draft.id}`);
    return draft;
  }

  return undefined;
}

/** Terminate an active contract. Resolves to the terminated contract. */
export async function askTerminate(contract) {
  if (!contract || contract.status !== 'Active') return undefined;
  const today = contracts.today();

  const dialog = modal.open({
    title: 'Terminate contract',
    sub: `${esc(contract.contractNo)} — version ${contract.version}`,
    tone: 'critical',
    icon: 'block',
    size: 'md',
    note: 'A terminated contract becomes read-only. It stays on file with its history.',
    body: `
      <p class="modal__lede">Claims for ${esc(contracts.payerName(contract))} stop falling under this contract from the termination date.</p>
      <dl class="dl dl--narrow">
        <dt><label for="ct-date">Termination date *</label></dt>
        <dd>
          <label class="field"><input id="ct-date" name="terminationDate" type="date"
                 value="${esc(today)}" min="${esc(today)}" max="${esc(contract.endDate)}"></label>
          <div class="field-error" data-error="terminationDate" hidden></div>
        </dd>
        <dt><label for="ct-reason">Reason *</label></dt>
        <dd>
          <label class="field field--area"><textarea id="ct-reason" name="terminationReason" rows="3"
                    placeholder="Why is this contract ending early?"></textarea></label>
          <div class="field-error" data-error="terminationReason" hidden></div>
        </dd>
      </dl>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--danger" data-act="terminate">Terminate contract</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="terminate"]')) return;
    const el = dialog.el;
    const when = el.querySelector('[name="terminationDate"]').value;
    const reason = el.querySelector('[name="terminationReason"]').value.trim();

    clearErrors(el);
    let bad = false;
    if (!when || when < today) {
      showError(el, 'terminationDate', 'Choose today or a later date.');
      bad = true;
    } else if (when > contract.endDate) {
      showError(el, 'terminationDate', `The contract already ends on ${date(contract.endDate)}.`);
      bad = true;
    }
    if (reason.length < 4) {
      showError(el, 'terminationReason', 'Say why the contract is ending.');
      bad = true;
    }
    if (bad) return;

    const done = contracts.terminate(contract.id, { terminationDate: when, terminationReason: reason });
    dialog.close(done);
    toast(`${contract.contractNo} terminated`, 'success');
  });

  return dialog.closed;
}

/** Delete a draft. Resolves true when it was deleted. */
export async function askDeleteDraft(contract) {
  if (!contract || contract.status !== 'Draft') return false;
  const ok = await modal.confirm({
    title: 'Delete draft',
    body: `${contract.contractNo} — ${contract.name} has never been active, so it can be removed. The audit trail keeps the record.`,
    confirmLabel: 'Delete draft',
    tone: 'critical',
    icon: 'delete',
  });
  if (!ok) return false;
  contracts.deleteDraft(contract.id);
  toast(`${contract.contractNo} draft deleted`, 'success');
  return true;
}

// --- shared ------------------------------------------------------------------

function clearErrors(el) {
  for (const box of el.querySelectorAll('.field-error')) {
    box.hidden = true;
    box.textContent = '';
  }
  for (const field of el.querySelectorAll('.field')) field.classList.remove('field--invalid');
}

function showError(el, name, message) {
  const box = el.querySelector(`[data-error="${name}"]`);
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
  el.querySelector(`[name="${name}"]`)?.closest('.field')?.classList.add('field--invalid');
}
