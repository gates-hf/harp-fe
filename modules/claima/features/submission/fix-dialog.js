// Fix & Resubmit — the dialog that shows the routed fix for a rejected claim
// and, on confirm, applies it: a claim assembled from a visit goes back to
// draft (re-assembled, or with a recode request raised on its chart) and is
// finalized again on the portfolio; a claim with no visit behind it is
// resubmitted as filed on its next cycle and joins the payer's open batch.
// The secondary button opens where the fix is made without resubmitting.

import * as batches from '../../../../data/repositories/batches.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { cycleStripHtml, payerName } from './batch-chips.js';

const ROUTE_ICON = { Policy: 'health_and_safety', Refresh: 'sync', Recode: 'medical_information', Contract: 'handshake', Review: 'visibility' };

/** askFixAndResubmit(claimNo, { navigate }) → Promise<claim|null>. */
export async function askFixAndResubmit(claimNo, { navigate } = {}) {
  const claim = claims.get(claimNo);
  if (!claim || claim.status !== 'Rejected') {
    toast('Only a rejected claim is resubmitted', 'warning');
    return null;
  }
  const plan = batches.fixPlan(claim);
  const open = batches.openBatchFor(claim.payerId);
  const next = claims.cycleOf(claim) + 1;
  const dialog = modal.open({
    title: `Fix & resubmit ${claim.claimNo}`,
    sub: `${payerName(claim.payerId)} · ${usd(claim.totals.payerShare)} · rejected ${date(claim.rejection.at)} in ${claim.rejection.batchNo}`,
    icon: ROUTE_ICON[plan.route] || 'build',
    tone: 'warning',
    body: `
      <div class="alert alert--critical">
        <span class="icon">assignment_return</span>
        <div><div class="title">${esc(plan.code)} — ${esc(batches.rejectionLabel(plan.code))}</div>${esc(plan.reason || batches.rejectionReason(plan.code)?.description || '')}</div>
      </div>
      <dl class="dl dl--narrow">
        <dt>Fix</dt><dd><span class="badge badge--accent">${esc(plan.route)}</span> ${esc(plan.label)}</dd>
        <dt>Then</dt><dd>${esc(plan.note)}</dd>
        <dt>Next cycle</dt><dd>Cycle ${next}${open ? ` — joins <span class="t-mono-sm">${esc(open.batchNo)}</span>, the fund’s open batch` : ' — waits in the ready queue for the next batch'}</dd>
        <dt>So far</dt><dd>${cycleStripHtml(claim)}</dd>
      </dl>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      ${plan.href && plan.route !== 'Refresh' && plan.route !== 'Recode'
    ? `<a class="btn btn--secondary" href="${esc(plan.href)}" data-act="go">${esc(plan.hrefLabel)}</a>` : ''}
      <button class="btn btn--primary" data-act="fix">${plan.immediate ? `Resubmit as cycle ${next}` : 'Fix & resubmit'}</button>`,
  });
  dialog.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act="go"]')) {
      dialog.close(null);
      return;
    }
    if (!e.target.closest('[data-act="fix"]')) return;
    const { claim: row, error } = await batches.fixAndResubmit(claimNo);
    if (error) {
      toast(error, 'warning');
      return;
    }
    dialog.close(row);
    if (row.status === 'Ready') {
      const joined = row.batchId ? ` and joined ${row.batchId}` : ' — in the ready queue';
      toast(`${row.claimNo} resubmitted as cycle ${claims.cycleOf(row)}${joined}`, 'success');
    } else {
      toast(`${row.claimNo} is a draft again — ${plan.route === 'Recode' ? 'recode request raised on the chart' : 're-assembled from the visit'}; finalize it to resubmit`, 'success');
      if (navigate) navigate(`/claima/claims/${row.claimNo}`);
    }
  });
  return dialog.closed;
}
