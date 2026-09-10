// Nullify — the one dialog the claim page opens. It resolves the path from
// the claim's status and either shows the routing card (a paid or a denied
// claim is undone somewhere else first) or collects the withdrawal: the
// reason and its justification, the payer notification when the payer held
// the claim, what happens to the charge lines, the second signature above
// the threshold, and whether a fresh claim is assembled in its place — with
// the re-classification first when the reason is a wrong payer. Every write
// is data/repositories/nullifications.js's `nullify`; the dialog only asks.

import * as nullifications from '../../../../data/repositories/nullifications.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as charges from '../../../../data/repositories/charges.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { esc, todayIso, usd } from '../../../../shared/format.js';
import { coverLabel } from '../claims-assembly/claim-chips.js';
import { formHtml, routingHtml } from './nullify-dialog-form.js';

/** Why the Nullify button is disabled, or '' — the tooltip on the claim page. */
export function nullifyBlocker(claim, role = currentRole()) {
  if (!claim) return 'No claim';
  if (claim.status === 'Void') return `Already nullified${claim.nullification?.no ? ` — ${claim.nullification.no}` : ''}`;
  if (!role[nullifications.requestFlag()]) return 'Only the RCM coder and the CMO can nullify a claim';
  return '';
}

/**
 * askNullify(claimNo, { navigate }) → Promise<{ record, replacement } | undefined>.
 * A blocked path opens the routing card instead and resolves undefined.
 */
export async function askNullify(claimNo, { navigate = null } = {}) {
  const claim = claims.get(claimNo);
  const role = currentRole();
  if (!claim) return undefined;
  const blocker = nullifyBlocker(claim, role);
  if (blocker) {
    toast(blocker, 'warning');
    return undefined;
  }
  const resolved = nullifications.pathFor(claim);
  if (resolved.blocked) return askRouting(claim, resolved);

  const lines = charges.linesForClaim(claim);
  const value = nullifications.valueOf(claim);
  const needsApprover = nullifications.needsSecondApprover(claim);
  const approvers = nullifications.approversFor(role.name);
  const reclass = nullifications.reclassOptions(claim);
  const state = { replace: false };

  const dialog = modal.open({
    title: `Nullify ${claim.claimNo}`,
    sub: `${claim.status} · ${coverLabel(claim)} · ${usd(value)} to the payer`,
    icon: 'block',
    tone: 'critical',
    size: 'lg',
    body: formHtml({ claim, resolved, lines, value, needsApprover, approvers, reclass, role, threshold: nullifications.threshold() }),
    note: 'Nullifying is final: the claim is Void and the record is never edited.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--danger" data-act="nullify"><span class="icon icon--sm">block</span>Nullify claim</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);

  /** Show and hide the conditional blocks from what is chosen; typed values stay where they are. */
  function sync() {
    const reasonCode = $('#nd-reason').value;
    const hold = $('#nd-disposition').value === 'ReturnAndHold';
    $('#nd-reason-text').hidden = !nullifications.reasonNeedsText(reasonCode);
    $('#nd-hold').hidden = !hold;
    const canReplace = Boolean(claim.encounterNo) && !hold;
    if (!canReplace) state.replace = false;
    for (const b of dialog.el.querySelectorAll('[data-replace]')) {
      b.setAttribute('aria-pressed', String((b.dataset.replace === 'yes') === state.replace));
      b.disabled = !canReplace && b.dataset.replace === 'yes';
    }
    $('#nd-replace-why').textContent = !claim.encounterNo
      ? 'A generated claim has no visit behind it to assemble from.'
      : hold ? 'Held lines cannot be assembled — return them unheld, or replace later from the pool.'
        : state.replace
          ? (reasonCode === 'N01' ? 'The visit is re-classified first; the replacement is assembled against the new cover.'
            : 'The returned lines are released again and the visit is assembled fresh — never a copy of this claim.')
          : 'The lines stay in the pool; a replacement can be assembled from the portfolio later.';
    $('#nd-reclass').hidden = !(state.replace && reasonCode === 'N01');
    const reasonHint = nullifications.nullificationReason(reasonCode);
    $('#nd-reason-hint').textContent = reasonHint?.description || '';
  }

  dialog.el.addEventListener('change', (e) => {
    if (e.target.matches('#nd-reason') && nullifications.nullificationReason(e.target.value)?.replace && claim.encounterNo
      && $('#nd-disposition').value !== 'ReturnAndHold') state.replace = true;
    sync();
  });
  dialog.el.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-replace]');
    if (toggle && !toggle.disabled) {
      state.replace = toggle.dataset.replace === 'yes';
      return sync();
    }
    if (!e.target.closest('[data-act="nullify"]')) return;
    const form = readForm();
    const actors = { requestedBy: role.name, approvedBy: needsApprover ? ($('#nd-approver')?.value || null) : null };
    const problems = nullifications.validate(claim, form, actors, role);
    if (problems.length) return showErrors(problems);
    const res = nullifications.nullify(claim.claimNo, form, { actors });
    if (res.error) return showErrors([res.error]);
    dialog.close(res);
    const rep = res.replacement;
    toast(`${claim.claimNo} nullified — ${res.record.no}${rep ? ` · replaced by ${rep.claimNo}` : res.record.replacement ? ` · ${res.record.replacement.reason}` : ''}`,
      rep ? 'success' : 'warning');
    if (rep && navigate) navigate(`/claima/claims/${rep.claimNo}`);
  });

  function readForm() {
    const reclassSel = $('#nd-reclass-policy');
    return {
      reasonCode: $('#nd-reason').value,
      reasonText: $('#nd-reason-text-input').value.trim(),
      justification: $('#nd-justification').value.trim(),
      notification: resolved.path === 'PayerNotified' ? {
        method: $('#nd-method').value, reference: $('#nd-reference').value.trim(), date: $('#nd-date').value, note: $('#nd-note').value.trim(),
      } : null,
      disposition: $('#nd-disposition').value,
      holdReason: $('#nd-hold-reason').value,
      replace: state.replace,
      reclassPolicyId: state.replace && $('#nd-reason').value === 'N01' && reclassSel
        ? (reclassSel.value === '' ? undefined : reclassSel.value === 'self-pay' ? null : reclassSel.value)
        : undefined,
    };
  }

  function showErrors(problems) {
    $('#nd-error').innerHTML = `
      <div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>`;
    $('#nd-error').scrollIntoView({ block: 'nearest' });
  }

  if (!$('#nd-date').value) $('#nd-date').value = todayIso();
  sync();
  return dialog.closed;
}

/** The routing card: what blocks the nullification and the screen that undoes it first. */
async function askRouting(claim, resolved) {
  const dialog = modal.open({
    title: `${claim.claimNo} cannot be nullified yet`,
    sub: `${claim.status} · ${coverLabel(claim)}`,
    icon: 'alt_route',
    tone: 'warning',
    size: 'md',
    body: routingHtml(claim, resolved),
    foot: `
      <button class="btn btn--secondary" data-close>Close</button>
      ${resolved.route ? `<a class="btn btn--primary" href="${esc(resolved.route.href)}" data-close>${esc(resolved.route.label)}</a>` : ''}`,
  });
  await dialog.closed;
  return undefined;
}
