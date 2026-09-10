// The two dialogs around a posting: what it is about to do, and what it did.
// Both read the engine's plan through the repository, so the preview and the
// fan-out summary are the same arithmetic the posting ran.

import * as remittances from '../../../../data/repositories/remittances.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, usd } from '../../../../shared/format.js';
import { payerName } from './remittance-chips.js';

/** askPost(no) → the posting result, or null when nothing was posted. */
export async function askPost(no) {
  const rem = remittances.get(no);
  if (!rem) return null;
  const plan = remittances.planFor(rem);
  const waiting = plan.exceptions.filter((e) => e.kind === 'AmbiguousMatch' || e.kind === 'Unmatched');
  const over = plan.exceptions.filter((e) => e.kind === 'Overpayment');
  const canPost = !plan.blocked && plan.entries.length > 0;
  const dialog = modal.open({
    title: `Post ${rem.remittanceNo}`,
    sub: `${payerName(rem.payerId)} · ${usd(rem.payment.total)} by ${rem.payment.method}`,
    icon: 'publish',
    tone: plan.blocked ? 'critical' : waiting.length ? 'warning' : '',
    size: 'xxl',
    body: `
      ${plan.blocked ? `<div class="alert alert--critical"><span class="icon">error</span><div><div class="title">Blocked</div>${esc(plan.blocked)}. Correct the lines or the total first.</div></div>` : ''}
      ${plan.entries.length ? `
        <p class="t-body">${plan.entries.length} claim${plan.entries.length === 1 ? '' : 's'} will post now:</p>
        <table class="tbl">
          <thead><tr><th>Claim</th><th>Expected</th><th>Paid</th><th>Adjusted</th><th>Denied</th><th>Becomes</th><th>Then</th></tr></thead>
          <tbody>${plan.entries.map((en) => `
            <tr>
              <td class="t-mono-sm">${esc(en.claimNo)}</td>
              <td class="t-mono-sm">${esc(usd(en.expected))}</td>
              <td class="t-mono-sm">${esc(usd(en.paid))}</td>
              <td class="t-mono-sm">${esc(usd(en.adjusted))}</td>
              <td class="t-mono-sm">${esc(usd(en.denied))}</td>
              <td><span class="badge badge--${claims.statusTone(en.status)}"><span class="dot"></span>${esc(en.status)}</span></td>
              <td class="t-body-sm">${esc(thenOf(en))}</td>
            </tr>`).join('')}</tbody>
        </table>` : '<p class="t-body">No row is ready to post — every row still needs a match.</p>'}
      ${waiting.length ? `<p class="t-body-sm">${waiting.length} row${waiting.length === 1 ? '' : 's'} wait${waiting.length === 1 ? 's' : ''} as an exception: ${
        waiting.map((e) => `${esc(e.ref)} (${e.kind === 'AmbiguousMatch' ? 'ambiguous' : 'unmatched'})`).join(', ')}.</p>` : ''}
      ${over.length ? `<p class="t-body-sm">${over.length} overpayment${over.length === 1 ? '' : 's'} will be raised as an exception to resolve.</p>` : ''}
      ${plan.residue > 0 ? `<p class="t-body-sm">${esc(usd(plan.residue))} is not accounted for by any row and will be held as unapplied cash.</p>` : ''}`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-close="post"${canPost ? '' : ' disabled'} title="${esc(canPost ? 'Post the claims above' : plan.blocked || 'Nothing to post')}">
        <span class="icon icon--sm">publish</span>Post${plan.entries.length ? ` ${plan.entries.length} claim${plan.entries.length === 1 ? '' : 's'}` : ''}</button>`,
  });
  if ((await dialog.closed) !== 'post') return null;
  const { error, result } = remittances.post(no);
  if (error) { toast(error, 'critical'); return null; }
  await showSummary(rem.remittanceNo, result);
  return result;
}

function thenOf(en) {
  const parts = [];
  if (en.denials.length) parts.push(`${en.denials.length} denial${en.denials.length === 1 ? '' : 's'}`);
  if (en.shifts.length) parts.push(`${usd(en.patientShift)} to the patient`);
  if (en.handoff) parts.push(`hand-off ${usd(en.handoff.amount)}`);
  if (en.secondary) parts.push(`secondary ${usd(en.secondary.amount)}`);
  return parts.join(' · ') || '—';
}

/** The fan-out: one line per thing the posting did, with where it went. */
export async function showSummary(no, result) {
  const rem = remittances.get(no);
  const p = result.posting;
  const rows = [];
  for (const c of p.claims) {
    const claim = claims.get(c.claimNo);
    rows.push(['Claim', `<a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(c.claimNo)}">${esc(c.claimNo)}</a>`,
      `${esc(c.previousStatus)} → ${esc(claim?.status || '')}`]);
  }
  for (const id of p.denialIds) rows.push(['Denial', `<span class="t-mono-sm">${esc(id)}</span>`, 'created — the denials worklist takes it']);
  for (const id of p.txIds) rows.push(['Patient shift', `<span class="t-mono-sm">${esc(id)}</span>`, 'on the patient’s account — the settlement is recomputed']);
  for (const id of p.handoffIds) rows.push(['Hand-off', `<a class="crumb-link t-mono-sm" href="#/defensio">${esc(id)}</a>`, 'to Defensio — paid below the contracted rate beyond tolerance']);
  for (const cn of p.secondaryClaimNos) rows.push(['Secondary', `<a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(cn)}">${esc(cn)}</a>`, 'activated — a draft in the portfolio, chained to the primary']);
  for (const id of p.unappliedIds) rows.push(['Unapplied', `<a class="crumb-link t-mono-sm" href="#/claima/remittances/unapplied">${esc(id)}</a>`, 'held — apply, refund or adjust it']);
  const open = remittances.openExceptions(rem);
  for (const e of open) rows.push(['Exception', `<span class="t-mono-sm">${esc(e.id)}</span>`, `${esc(e.kind === 'AmbiguousMatch' ? 'Ambiguous match' : e.kind)} on ${esc(e.ref)} — ${esc(usd(e.amount))}, still open`]);
  const dialog = modal.open({
    title: `${p.id} posted`,
    sub: result.summary,
    icon: 'check_circle',
    size: 'xxl',
    body: `
      <div class="alert alert--${open.length ? 'warning' : 'success'}">
        <span class="icon">${open.length ? 'priority_high' : 'check_circle'}</span>
        <div><div class="title">${esc(rem.remittanceNo)} is ${esc(rem.status.toLowerCase())}</div>${esc(result.summary)}.</div>
      </div>
      <table class="tbl">
        <thead><tr><th>What</th><th>Record</th><th>Where it went</th></tr></thead>
        <tbody>${rows.map(([what, ref, where]) => `<tr><td>${esc(what)}</td><td>${ref}</td><td class="t-body-sm">${where}</td></tr>`).join('')}</tbody>
      </table>`,
  });
  toast(result.summary.split(' · ')[0] || 'Posted', 'success');
  await dialog.closed;
}
