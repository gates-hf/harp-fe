// The Case tab on the appeal page — Tab 1, auto-assembled from the
// registers through their published helpers and never typed here: the
// denial (its code, its money, its triage), the contract version the claim
// was priced under, the claim's lines with the denied one marked, the
// linked records and the timeline excerpt (the denials feature's own
// evidence panel, imported — one module, one way of reading a denial), and,
// when amendment 37's register is on disk, the root-cause conclusion on the
// denial. Read-only.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import * as denials from '../../../../data/repositories/denials.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { evidenceHtml } from '../denials/denial-evidence.js';
import { deadlineHtml, tierHtml } from './appeal-chips.js';

/** Amendment 37's conclusions on this case's denials, when its register exists; an empty list otherwise. */
async function rcaConclusions(denialIds) {
  try {
    const m = await import('../../../../data/repositories/rca-cases.js');
    const rows = m.getConcludedRcaCases?.() || [];
    return rows.filter((r) => (r.denialIds || []).some((d) => denialIds.includes(d)));
  } catch {
    return [];
  }
}

export function render(host, { caseId }) {
  const row = appealCases.get(caseId);
  if (!row) return;
  const denial = appealCases.denialOf(row);
  const parent = row.parentCaseId ? appealCases.get(row.parentCaseId) : null;
  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">What the registers say</span>
      <span class="spacer"></span>
      <span class="t-body-sm">Assembled from the denial, the claim, the contract version and the visit — nothing here is typed on the case.</span>
    </div>
    <dl class="dl">
      <dt>Denial</dt>
      <dd>${denial ? `<a class="crumb-link t-mono-sm" href="#/defensio/denials/${esc(denial.id)}">${esc(denial.id)}</a> · <span class="badge badge--critical">${esc(denial.payerReason?.code || denial.code || '—')}</span> ${esc(denial.payerReason?.text || '')}<br>
        <span class="t-body-sm">landed ${date(denial.createdAt)} · ${esc(usd(denial.amounts.denied))} denied, ${esc(usd(denial.amounts.open))} open · ${esc(denial.status)}${denial.repeatCount > 1 ? ` · repeat ×${denial.repeatCount}` : ''}</span>` : '<span class="t-body-sm">The denial is gone</span>'}</dd>
      <dt>Triage</dt>
      <dd>${denial?.class ? `${esc(denial.tier || '')} · ${esc(denial.class)} · ${esc(denials.rootCauseLabel(denial.rootCauseId))}${denial.triageNote ? `<br><span class="t-body-sm">${esc(denial.triageNote)}</span>` : ''}` : '<span class="t-body-sm">Not triaged</span>'}</dd>
      <dt>Disputed</dt>
      <dd><span class="t-mono-sm">${esc(usd(row.disputedAmount))}</span> · ${tierHtml(row)}</dd>
      <dt>File by</dt>
      <dd>${deadlineHtml(row)} <span class="t-body-sm">${esc(date(row.filingDeadline))}</span></dd>
      ${parent ? `<dt>Level ${parent.level}</dt><dd><a class="crumb-link t-mono-sm" href="#/defensio/appeals/${esc(parent.id)}">${esc(parent.id)}</a> · ${esc(appealCases.statusLabel(parent.status))}${parent.packageRef ? ` · <a class="crumb-link t-mono-sm" href="#/defensio/appeals/${esc(parent.id)}/package">${esc(parent.packageRef)}</a>` : ''}</dd>` : ''}
    </dl>
    <div id="tc-rca"></div>
    ${denial ? evidenceHtml(denial) : ''}`;

  rcaConclusions(row.denialIds || []).then((rows) => {
    const el = host.querySelector('#tc-rca');
    if (!el || !rows.length) return;
    el.innerHTML = `
      <div class="toolbar">
        <span class="t-title-sm">Root-cause conclusion</span>
        <span class="badge">${rows.length}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">What the root-cause analysis on this denial concluded — read from its register.</span>
      </div>
      <dl class="dl">${rows.map((r) => `
        <dt><a class="crumb-link t-mono-sm" href="#/defensio/rca/${esc(r.caseId)}">${esc(r.caseId)}</a></dt>
        <dd>${esc(r.confirmedRootCause ? denials.rootCauseLabel(r.confirmedRootCause) : 'Cause not named')}${r.causeNature ? ` · ${esc(r.causeNature)}` : ''} · <span class="badge">${esc(r.status)}</span>${
        r.configGap?.present ? `<br><span class="t-body-sm">Configuration gap${r.configGap.target ? ` — ${esc(r.configGap.target)}` : ''}${r.configGap.note ? `: ${esc(r.configGap.note)}` : ''}</span>` : ''}${
        r.correctiveAction ? `<br><span class="t-body-sm">Corrective action: ${esc(r.correctiveAction.type)}${r.correctiveAction.target ? ` on ${esc(r.correctiveAction.target)}` : ''} · ${esc(r.correctiveAction.status)}</span>` : ''}</dd>`).join('')}</dl>`;
  });
}
