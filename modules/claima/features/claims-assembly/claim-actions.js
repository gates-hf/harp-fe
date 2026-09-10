// The dialogs a claim moves through: run scrub, finalize, reopen, and the two
// bulk actions the portfolio offers over a selection. Every write goes through
// data/repositories/claims.js, which audits it; a dialog only asks.

import * as claims from '../../../../data/repositories/claims.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { esc, usd } from '../../../../shared/format.js';

/** Run the scrub on one draft and say what came back. Returns the run or null. */
export function runScrub(id) {
  const claim = claims.get(id);
  if (!claim) return null;
  if (claim.status !== 'Draft') {
    toast(`${claim.claimNo} is ${claim.status.toLowerCase()} — reopen it to scrub it again`, 'warning');
    return null;
  }
  const run = claims.runScrub(id);
  const errors = run.findings.filter((f) => f.severity === 'Error').length;
  const warnings = run.findings.length - errors;
  toast(`${claim.claimNo}: ${run.result}${run.findings.length
    ? ` — ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`,
  run.result === 'Fail' ? 'critical' : run.result === 'Warnings' ? 'warning' : 'success');
  return run;
}

/** Why the Finalize button is disabled, or '' — the tooltip. */
export const finalizeBlocker = (claim) => {
  const gate = claims.canFinalize(claim);
  return gate.ok ? '' : gate.why;
};

/** askFinalize(id) → Promise<claim|null>. */
export async function askFinalize(id) {
  const claim = claims.get(id);
  const gate = claims.canFinalize(claim);
  if (!gate.ok) {
    toast(gate.why, 'warning');
    return null;
  }
  const acked = claims.latestScrub(claim)?.acknowledgments?.length || 0;
  const ok = await modal.confirm({
    title: `Finalize ${claim.claimNo}`,
    body: `${usd(claim.totals.payerShare)} over ${claim.lines.length} line${claim.lines.length === 1 ? '' : 's'}, scrub ${
      claims.scrubResult(claim)}${acked ? ` with ${acked} warning${acked === 1 ? '' : 's'} acknowledged` : ''}. `
      + 'Finalizing marks the claim Ready for submission and locks its lines, its coding snapshot and its attachments. '
      + 'A role that can reopen claims can take it back to draft.',
    confirmLabel: 'Finalize',
    tone: 'warning',
    icon: 'lock',
  });
  if (!ok) return null;
  const row = claims.finalize(id);
  if (row) toast(`${row.claimNo} is Ready`, 'success');
  return row;
}

/** askReopen(id) → Promise<claim|null>. Role-gated, and a reason is required. */
export async function askReopen(id) {
  const claim = claims.get(id);
  const role = currentRole();
  if (!claim || claim.status !== 'Ready') return null;
  if (!role.canReopenClaim) {
    toast('Your role cannot reopen a finalized claim', 'warning');
    return null;
  }
  const dialog = modal.open({
    title: `Reopen ${claim.claimNo}`,
    sub: 'Back to draft — the scrub is voided and has to be run again',
    icon: 'lock_open',
    tone: 'warning',
    body: `
      <p class="t-body-sm">Say why. The reason is written to the claim’s history beside the reopen.</p>
      <label class="field field--area">
        <textarea id="ca-reason" rows="3" placeholder="Reason for reopening" aria-label="Reason"></textarea>
      </label>
      <div class="field-error" id="ca-error" hidden></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="reopen">Reopen claim</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="reopen"]')) return;
    const reason = dialog.el.querySelector('#ca-reason').value.trim();
    if (!reason) {
      const box = dialog.el.querySelector('#ca-error');
      box.textContent = 'A reason is required.';
      box.hidden = false;
      return;
    }
    const row = claims.reopen(id, reason);
    dialog.close(row);
    if (row) toast(`${row.claimNo} is a draft again`, 'success');
  });
  return dialog.closed;
}

/** Scrub every draft in the selection; the rest are named and skipped. */
export function bulkScrub(ids = []) {
  const rows = ids.map((id) => claims.get(id)).filter(Boolean);
  const drafts = rows.filter((c) => c.status === 'Draft');
  if (!drafts.length) {
    toast('Nothing in the selection is a draft', 'warning');
    return 0;
  }
  const results = { Pass: 0, Warnings: 0, Fail: 0 };
  for (const claim of drafts) {
    const run = claims.runScrub(claim.id);
    if (run) results[run.result] += 1;
  }
  const skipped = rows.length - drafts.length;
  toast(`Scrubbed ${drafts.length}: ${results.Pass} pass, ${results.Warnings} with warnings, ${results.Fail} fail${
    skipped ? ` · ${skipped} not a draft, skipped` : ''}`, results.Fail ? 'warning' : 'success');
  return drafts.length;
}

/**
 * Finalize everything in the selection that may be finalized — a valid Pass,
 * or Warnings every one of which is acknowledged — and say what was left.
 */
export async function bulkFinalize(ids = []) {
  const rows = ids.map((id) => claims.get(id)).filter(Boolean);
  const passing = rows.filter((c) => claims.canFinalize(c).ok);
  const left = rows.filter((c) => !claims.canFinalize(c).ok && c.status === 'Draft');
  if (!passing.length) {
    toast('Nothing in the selection passes — run the scrub, or acknowledge its warnings', 'warning');
    return 0;
  }
  const total = passing.reduce((n, c) => n + (Number(c.totals.payerShare) || 0), 0);
  const ok = await modal.confirm({
    title: `Finalize ${passing.length} claim${passing.length === 1 ? '' : 's'}`,
    body: `${usd(total)} across ${passing.map((c) => c.claimNo).join(', ')}. ${left.length
      ? `${left.length} draft${left.length === 1 ? '' : 's'} in the selection cannot be finalized yet: ${
        left.map((c) => `${c.claimNo} (${claims.canFinalize(c).why.toLowerCase()})`).join('; ')}.`
      : 'Every draft in the selection passes.'}`,
    confirmLabel: 'Finalize all passing',
    tone: 'warning',
    icon: 'lock',
  });
  if (!ok) return 0;
  let n = 0;
  for (const claim of passing) if (claims.finalize(claim.id)) n += 1;
  toast(`${n} claim${n === 1 ? '' : 's'} finalized${left.length ? ` · ${left.length} left in draft` : ''}`, 'success');
  return n;
}

/** The acknowledge dialog for one warning. Returns the run or undefined. */
export async function askAcknowledge(id, finding) {
  const role = currentRole();
  if (!role.canAcknowledgeScrubWarning) {
    toast('Your role cannot acknowledge scrub warnings', 'warning');
    return undefined;
  }
  const dialog = modal.open({
    title: 'Acknowledge warning',
    sub: `${esc(finding.category)} · ${esc(finding.code)}`,
    icon: 'task_alt',
    body: `
      <div class="alert alert--warning"><span class="icon">warning</span><div>${esc(finding.message)}</div></div>
      <p class="t-body-sm">Say why the claim goes out as it is. The reason is written to the claim’s history with your name.</p>
      <label class="field field--area">
        <textarea id="ca-ack" rows="3" placeholder="Reason" aria-label="Reason"></textarea>
      </label>
      <div class="field-error" id="ca-ack-error" hidden></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ack">Acknowledge</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ack"]')) return;
    const reason = dialog.el.querySelector('#ca-ack').value.trim();
    if (!reason) {
      const box = dialog.el.querySelector('#ca-ack-error');
      box.textContent = 'A reason is required.';
      box.hidden = false;
      return;
    }
    const run = claims.acknowledge(id, finding.id, reason);
    dialog.close(run);
    if (run) toast('Warning acknowledged', 'success');
  });
  return dialog.closed;
}
