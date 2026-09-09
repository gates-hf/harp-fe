// The dialogs a policy needs before it moves: the reason behind a suspension, a
// cancellation or a reactivation, the reason a payer or plan changed on a policy
// claims were filed under, and the reorder sheet that renumbers the chain.
//
// Each returns true when the repository was written to, so the tab redraws. The
// screen decides who may act — nothing here gates on a role.

import * as policies from '../../../../data/repositories/policies.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc } from '../../../../shared/format.js';

const sub = (policy) => `${policies.payerName(policy)} · ${policies.planName(policy)} — ${policy.memberId}`;

export async function askSuspend(policy) {
  const reason = await askReason({
    title: 'Suspend policy',
    sub: sub(policy),
    icon: 'pause',
    tone: 'warning',
    lede: 'The policy leaves the chain and the ones below it move up. It keeps its dates and can be reactivated.',
    placeholder: 'Employer confirmed the group policy is on hold pending the renewal.',
    confirmLabel: 'Suspend policy',
  });
  if (!reason) return false;
  policies.setStatus(policy.id, 'Suspended', reason);
  toast(`${policies.payerName(policy)} policy suspended`, 'success');
  return true;
}

export async function askCancel(policy) {
  const reason = await askReason({
    title: 'Cancel policy',
    sub: sub(policy),
    icon: 'cancel',
    tone: 'critical',
    lede: 'The policy leaves the chain for good and cannot be reactivated. It stays on the record, and so does its history.',
    placeholder: 'Member left the employer; cover ended with the last payroll.',
    confirmLabel: 'Cancel policy',
  });
  if (!reason) return false;
  policies.setStatus(policy.id, 'Cancelled', reason);
  toast(`${policies.payerName(policy)} policy cancelled`, 'success');
  return true;
}

export async function askReactivate(policy) {
  const clash = policies.overlaps(
    policy.patientMrn, policy.payerId, policy.validFrom, policy.validTo, policy.id,
  );
  const reason = await askReason({
    title: 'Reactivate policy',
    sub: sub(policy),
    icon: 'play_arrow',
    lede: clash
      ? `Overlaps with policy ${clash.policyNo || clash.memberId} (${policies.payerName(clash)}) valid until ${date(clash.validTo)}. It rejoins the chain at the end.`
      : `Valid to ${date(policy.validTo)}. It rejoins the chain at the end — reorder it afterwards if it should pay first.`,
    placeholder: 'Employer confirmed the group policy is live again from this month.',
    confirmLabel: 'Reactivate policy',
  });
  if (!reason) return false;
  policies.setStatus(policy.id, 'Active', reason);
  toast(`${policies.payerName(policy)} policy reactivated`, 'success');
  return true;
}

/**
 * Reorder the chain. The design system ships no sortable list, so the rows move
 * with up/down buttons and the preview under them reads the order back as one
 * line — the same line the trail records.
 */
export async function openReorder(mrn) {
  let order = policies.chain(mrn).map((p) => p.id);
  if (order.length < 2) return false;
  const before = policies.orderLabel(mrn);

  const dialog = modal.open({
    title: 'Reorder the chain',
    sub: 'Priority 1 is billed first, then 2, then 3, then Self-Pay.',
    icon: 'swap_vert',
    size: 'md',
    body: '<div id="pr-list"></div><p class="modal__lede" id="pr-preview"></p>',
    note: 'The change is recorded on every policy that moves.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ok">Save order</button>`,
  });

  function draw() {
    dialog.el.querySelector('#pr-list').innerHTML = order.map((id, i) => {
      const p = policies.get(id);
      return `
        <div class="rule-child-row" data-row="${esc(id)}">
          <span class="t-mono-sm">${i + 1} ${esc(policies.priorityLabel(i + 1).split(' ')[1])}</span>
          <span>${esc(policies.payerName(p))}<br><span class="t-body-sm">${esc(policies.planName(p))} · ${esc(p.memberId)}</span></span>
          <span class="spacer"></span>
          <button class="btn btn--ghost btn--icon btn--sm" data-move="up" ${i === 0 ? 'disabled title="Already first"' : 'title="Move up"'}>
            <span class="icon icon--sm">arrow_upward</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-move="down" ${i === order.length - 1 ? 'disabled title="Already last"' : 'title="Move down"'}>
            <span class="icon icon--sm">arrow_downward</span>
          </button>
        </div>`;
    }).join('');

    dialog.el.querySelector('#pr-preview').textContent = order
      .map((id, i) => `${i + 1} ${policies.payerName(policies.get(id))}`)
      .join(' → ');
  }

  dialog.el.addEventListener('click', (e) => {
    const move = e.target.closest('[data-move]');
    if (move && !move.disabled) {
      const id = move.closest('[data-row]').dataset.row;
      const from = order.indexOf(id);
      const to = from + (move.dataset.move === 'up' ? -1 : 1);
      order.splice(to, 0, order.splice(from, 1)[0]);
      return draw();
    }
    if (e.target.closest('[data-act="ok"]')) dialog.close(order.join(','));
  });

  draw();
  const answer = await dialog.closed;
  if (!answer) return false;

  policies.reorder(mrn, answer.split(','));
  const after = policies.orderLabel(mrn);
  if (after === before) {
    toast('The order is unchanged', 'info');
    return false;
  }
  toast('Priority order changed', 'success');
  return true;
}

/**
 * One field, one reason, one answer — the shape every dialog here shares, and
 * the same shape the patient status dialogs wear. Returns the reason, or
 * undefined when the dialog was closed.
 */
export async function askReason({
  title, sub: subLine, icon, tone = 'warning', lede, placeholder, confirmLabel, minLength = 5,
}) {
  const dialog = modal.open({
    title,
    sub: esc(subLine),
    icon,
    tone,
    size: 'md',
    body: `
      <p class="modal__lede">${esc(lede)}</p>
      <dl class="dl">
        <dt>Reason *</dt>
        <dd>
          <label class="field field--area">
            <textarea name="value" rows="3" placeholder="${esc(placeholder)}"></textarea>
          </label>
          <div class="field-error" data-error="value" hidden></div>
        </dd>
      </dl>`,
    note: 'The change is recorded in the trail with your name and the time.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn ${tone === 'critical' ? 'btn--danger' : 'btn--primary'}" data-act="ok">${esc(confirmLabel)}</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ok"]')) return;
    const input = dialog.el.querySelector('[name="value"]');
    const box = dialog.el.querySelector('[data-error="value"]');
    const value = input.value.trim();
    const message = value.length < minLength ? 'Enter the reason. It is what the next reader of this record sees.' : '';
    box.hidden = !message;
    box.textContent = message;
    input.closest('.field').classList.toggle('field--invalid', Boolean(message));
    if (message) return input.focus();
    dialog.close(value);
  });

  return dialog.closed;
}
