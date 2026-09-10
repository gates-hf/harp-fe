// The resolution panel on the denial page: what the registers have decided
// so far (derived, never typed here), the deadline, the repeat chain, and
// the two doors a person has — Defensio's answer on a hand-off, and a manual
// close for the roles that hold it. Owns its node and listener like the
// triage panel.

import * as denials from '../../../../data/repositories/denials.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { openHandoffOutcomeDialog, openManualResolveDialog, openPayerAnswerDialog } from './denial-actions.js';
import { deadlineHtml, statusHtml } from './denial-chips.js';
import { repeatChainHtml } from './denial-evidence.js';

export function render(host, { id, redraw }) {
  const denial = denials.get(id);
  if (!denial) return;
  const role = currentRole();
  const open = denials.isOpen(denial);
  const dl = denials.deadline(denial);
  const withDefensio = open && denial.route?.kind === 'DefensioHandoff' && denial.route.active;
  const withPayer = open && denial.route?.kind === 'PayerReconsideration' && denial.route.active && !denial.route.answer;
  host.innerHTML = `
    <dl class="dl dl--narrow">
      <dt>State</dt><dd>${statusHtml(denial)}</dd>
      <dt>Appeal by</dt><dd>${deadlineHtml(denial)}<br><span class="t-body-sm">${esc(`${date(dl.appealBy)} — ${denials.appealWindowDays(denial.payerId)}-day window from ${date(denial.createdAt)}`)}</span></dd>
      <dt>Repeat</dt><dd>${denial.repeatCount >= 2 ? `Denied ${denial.repeatCount} times` : 'First denial on this line'}${
    (denial.repeats || []).length ? `<br><span class="t-body-sm">${denial.repeats.map((r) => `${esc(r.code || '')} on ${date(r.at)}`).join(' · ')}</span>` : ''}</dd>
      ${denial.resolution ? `
      <dt>Resolved</dt>
      <dd>${esc(resolutionLine(denial))}<br><span class="t-body-sm">${dateTime(denial.resolvedAt)} · ${esc(denial.resolution.by || '')}${denial.resolution.manual ? ' · <span class="badge badge--warning">manual</span>' : ''}</span>${
    denial.resolution.reason ? `<br><span class="t-body-sm">${esc(denial.resolution.reason)}</span>` : ''}</dd>` : `
      <dt>Resolves when</dt>
      <dd><span class="t-body-sm">${esc(resolvesWhen(denial))}</span></dd>`}
    </dl>
    ${repeatChainHtml(denial)}
    <div class="toolbar">
      <span class="spacer"></span>
      ${withDefensio ? `
      <button class="btn btn--secondary btn--sm" data-act="handoff" title="Record what Defensio came back with">
        <span class="icon icon--sm">gavel</span>Hand-off outcome
      </button>` : ''}
      ${withPayer ? `
      <button class="btn btn--secondary btn--sm" data-act="answer" title="Record the payer’s answer to the reconsideration">
        <span class="icon icon--sm">forum</span>Payer’s answer
      </button>` : ''}
      <button class="btn btn--secondary btn--sm" data-act="manual"${open && role.canResolveDenial ? '' : ' disabled'}
              title="${!open ? 'Already resolved' : role.canResolveDenial ? 'Close the denial with a reason — flagged as manual' : 'Only the RCM coder and the CMO can resolve a denial by hand'}">
        <span class="icon icon--sm">how_to_reg</span>Resolve manually
      </button>
    </div>`;

  host.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'handoff') { await openHandoffOutcomeDialog(denials.get(id)); return redraw(); }
    if (act === 'answer') { await openPayerAnswerDialog(denials.get(id)); return redraw(); }
    if (act === 'manual') { await openManualResolveDialog(denials.get(id)); return redraw(); }
    return undefined;
  });
}

function resolutionLine(denial) {
  const r = denial.resolution;
  const a = denial.amounts;
  const parts = [];
  if (a.recovered) parts.push(`${usd(a.recovered)} recovered`);
  if (a.writtenOff) parts.push(`${usd(a.writtenOff)} written off`);
  if (a.lost) parts.push(`${usd(a.lost)} lost`);
  if (a.transferred) parts.push(`${usd(a.transferred)} carried to ${r.successorId || 'the next denial'}`);
  return `${r.kind}${r.ref ? ` ${r.ref}` : ''} — ${parts.join(', ') || 'nothing moved'}`;
}

function resolvesWhen(denial) {
  const kind = denial.route?.kind;
  if (kind === 'DefensioHandoff') return 'Defensio answers: won recovers the open amount, lost loses it, settled recovers part and carries the rest to a new denial.';
  if (kind === 'WriteOff') return 'The write-off request posts — the write-off feature calls back with the amount.';
  if (kind === 'Refresh' || kind === 'Recode' || kind === 'ChargeCorrection' || kind === 'AuthRework') return 'The corrected claim goes back out and the payer’s next remittance pays the line: in full recovers it, in part carries the rest to a new denial, refused again reopens it as a repeat.';
  if (kind === 'PayerReconsideration') return 'The payer’s next remittance on this claim pays the line — or refuses it again, which reopens the denial as a repeat.';
  return 'A remittance that pays the line, a hand-off’s outcome, a write-off’s posting, or a person with a reason.';
}
