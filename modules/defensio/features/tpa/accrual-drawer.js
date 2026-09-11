// The accrual drawer — one TPA fee accrual read in full beside the ledger:
// the administrator, the payer, the claim and its separations, the
// remittance and the basis the fee was read against, the schedule version
// applied and what it allowed, the variance against the tolerance, the
// ledger line the identity is asserted on, the dispute or the amendment
// hanging off it (with the figures that stood before a restatement), and
// the trail. Read-only — the actions are on the tabs.

import * as accruals from '../../../../data/repositories/tpa-fee-accruals.js';
import * as disputes from '../../../../data/repositories/tpa-disputes.js';
import * as schedules from '../../../../data/repositories/tpa-fee-schedules.js';
import * as drawer from '../../../../shared/drawer.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { basisHtml, claimHtml, expectedHtml, linkHtml, matchStateHtml, remittanceHtml, separationsHtml, stateHtml, varianceHtml } from './tpa-chips.js';
import { historyHtml } from './tpa-history.js';

export function openAccrualDrawer(id) {
  const row = accruals.get(id);
  if (!row) return null;
  const role = currentRole();
  const b = accruals.bucketsOf(row);
  const version = row.expected ? schedules.versionByRef(row.expected.versionRef) : null;
  const dispute = row.dispute ? disputes.get(row.dispute.id) : null;
  const snap = row.preAmendmentSnapshot;
  const ledger = [
    ['Agreed', b.agreed, 'What both sides accept — the expected fee on an overcharge, the whole fee otherwise'],
    ['Recovered', b.recovered, 'What the administrator gave back on a settled dispute'],
    ['Written off', b.writtenOff, 'The remainder raised as a write-off request or accepted with a reason'],
    ['In dispute', b.openDisputed, 'Overcharge with the administrator on an open dispute'],
    ['Open overcharge', b.openUndisputed, 'Overcharge nobody has disputed yet'],
    ['Unscheduled', b.unscheduled, 'Held with no version to read it against'],
    ['Amendment net', b.amendmentNet, 'Agreed before the restatement less agreed after — the correction the amendment posted'],
  ].filter(([, n]) => n !== 0);
  const body = `
    <dl class="dl dl--narrow">
      <dt>State</dt><dd>${stateHtml(row)} ${matchStateHtml(row)}</dd>
      <dt>Administrator</dt><dd>${row.tpaId ? esc(accruals.tpaName(row)) : '<span class="badge badge--warning">none linked on the remittance date</span>'}</dd>
      <dt>Payer</dt><dd>${esc(accruals.payerName(row))}</dd>
      <dt>Claim</dt><dd>${claimHtml(row, role)}<br><span class="t-body-sm">separated on ${separationsHtml(row)}</span></dd>
      <dt>Remittance</dt><dd>${remittanceHtml(row)}</dd>
      <dt>Basis</dt><dd>${basisHtml(row)}</dd>
      <dt>Actual</dt><dd><span class="t-mono-sm">${esc(usd(row.actual.amount))}</span> <span class="t-body-sm">withheld</span></dd>
      <dt>Expected</dt><dd>${expectedHtml(row)}${version ? `<br><span class="t-body-sm">${esc(schedules.describe(version))} · in force ${esc(date(version.effectiveFrom))}${version.effectiveTo ? ` to ${esc(date(version.effectiveTo))}` : ' onwards'}</span>` : ''}</dd>
      <dt>Variance</dt><dd>${varianceHtml(row)} <span class="t-body-sm">tolerance ±${esc(usd(row.tolerance || 0))}</span></dd>
      <dt>Record</dt><dd>${linkHtml(row)}${dispute ? `<br><span class="t-body-sm">${esc(disputes.statusLabel(dispute.status))} · ${esc(usd(dispute.totalOvercharge))} in dispute${dispute.settlement ? ` · ${esc(usd(dispute.settlement.recovered))} recovered${dispute.writeOffRequestRef ? ` · <a class="crumb-link t-mono-sm" href="#/claima/writeoffs/${esc(dispute.writeOffRequestRef)}">${esc(dispute.writeOffRequestRef)}</a>` : ''}` : ''}</span>` : ''}</dd>
      ${row.note ? `<dt>Note</dt><dd class="t-body-sm">${esc(row.note)}</dd>` : ''}
    </dl>
    <div class="toolbar"><span class="t-title-sm">Ledger line</span><span class="spacer"></span><span class="badge${b.holds ? ' badge--success' : ' badge--critical'}" title="actual = agreed + recovered + written off + in dispute + open + unscheduled ± amendment net">${b.holds ? 'Adds up' : 'Out of step'}</span></div>
    <table class="tbl">
      <tbody>
        <tr><td>Actual</td><td class="t-mono-sm">${esc(usd(b.actual))}</td><td class="t-body-sm">what the administrator withheld</td></tr>
        ${ledger.map(([label, n, hint]) => `<tr><td>${esc(label)}</td><td class="t-mono-sm">${esc(usd(n))}</td><td class="t-body-sm">${esc(hint)}</td></tr>`).join('')}
      </tbody>
    </table>
    ${snap ? `
    <div class="toolbar"><span class="t-title-sm">Before the amendment</span><span class="spacer"></span><a class="badge badge--accent" href="#/defensio/tpa/amendments/${esc(row.amendment?.id || '')}">${esc(row.amendment?.id || '')}</a></div>
    <dl class="dl dl--narrow">
      <dt>Expected</dt><dd><span class="t-mono-sm">${esc(usd(snap.expected?.amount || 0))}</span> <span class="t-body-sm">${esc(snap.expected?.versionRef || 'no version')}</span></dd>
      <dt>State</dt><dd><span class="badge">${esc(snap.state)}</span> <span class="t-body-sm">variance ${esc(usd(snap.variance || 0))}</span></dd>
      <dt>Agreed then</dt><dd><span class="t-mono-sm">${esc(usd(snap.agreed || 0))}</span> <span class="t-body-sm">→ ${esc(usd(b.agreed))} now · correction ${esc(usd(row.amendment?.correction || 0))}</span></dd>
      <dt>Restated</dt><dd class="t-body-sm">${esc(dateTime(snap.at))}</dd>
    </dl>` : ''}
    <div class="toolbar"><span class="t-title-sm">History</span></div>
    ${historyHtml(accruals.history(row.id))}`;
  return drawer.open({
    title: `${row.id}`,
    sub: `TPA fee accrual · ${accruals.tpaName(row)} · ${usd(row.actual.amount)} withheld`,
    icon: 'account_balance_wallet',
    body,
  });
}

