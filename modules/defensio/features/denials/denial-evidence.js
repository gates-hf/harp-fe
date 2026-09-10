// The evidence a denial is triaged from: the claim's lines with the denied
// one marked (billed, the expected payer share stamped at assembly — never
// recomputed here — what was denied and the payer's code), the contract
// version the claim was priced under, the authorisations, referral,
// eligibility check and documents linked to the visit, and the last eight
// events of the claim's timeline. Everything is read through the published
// repositories and the lifecycle engine; nothing is duplicated. Read-only
// markup; the page draws it into the Evidence tab. The event shapes are
// copied from Claima's lifecycle-chips.js — a module never imports another
// module's files.

import * as denials from '../../../../data/repositories/denials.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as lifecycle from '../../../../data/engines/claim-events.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { contractHtml } from './denial-chips.js';

const EXCERPT = 8;

/** The glyph and tone of an event type (copied from modules/claima/features/lifecycle/lifecycle-chips.js). */
const EVENT_SHAPE = {
  Assembled: { icon: 'inventory_2', tone: '' }, Refreshed: { icon: 'sync', tone: '' }, Scrubbed: { icon: 'fact_check', tone: '' },
  Finalized: { icon: 'lock', tone: 'success' }, Reopened: { icon: 'lock_open', tone: 'warning' }, Batched: { icon: 'inbox', tone: 'info' },
  FileGenerated: { icon: 'description', tone: 'info' }, Submitted: { icon: 'send', tone: 'info' }, Acknowledged: { icon: 'mark_email_read', tone: 'info' },
  Rejected: { icon: 'block', tone: 'critical' }, Resubmitted: { icon: 'replay', tone: 'info' }, RemittancePosted: { icon: 'payments', tone: 'success' },
  Denied: { icon: 'cancel', tone: 'critical' }, HandedOff: { icon: 'gavel', tone: 'warning' }, PatientShift: { icon: 'person', tone: 'warning' },
  FollowUp: { icon: 'call', tone: '' }, Escalated: { icon: 'flag', tone: 'critical' }, Closed: { icon: 'check_circle', tone: 'success' },
};
const eventLabel = (type) => String(type).replace(/([a-z])([A-Z])/g, (m, a, b) => `${a} ${b.toLowerCase()}`);
const eventBadge = (type) => { const s = EVENT_SHAPE[type] || { icon: 'circle', tone: '' }; return `<span class="badge${s.tone ? ` badge--${s.tone}` : ''}">${esc(eventLabel(type))}</span>`; };
const eventIcon = (type) => `<span class="icon icon--sm" aria-hidden="true">${(EVENT_SHAPE[type] || { icon: 'circle' }).icon}</span>`;

export function evidenceHtml(denial) {
  const claim = denials.claimOf(denial);
  if (!claim) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">description_off</span></div>
        <div class="state-view__title">The claim is gone</div>
        <p class="state-view__body">${esc(denial.claimNo)} is no longer on file, so there is nothing to read the denial against.</p>
      </div>`;
  }
  return `
    <div class="toolbar">
      <span class="t-title-sm">Denied lines</span>
      <span class="badge">${claim.lines.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">Expected is what the contract said the payer owed when the claim was assembled — stamped, never recomputed.</span>
    </div>
    ${linesHtml(denial, claim)}
    <div class="toolbar">
      <span class="t-title-sm">Linked records</span>
      <span class="spacer"></span>
      ${contractHtml(claim)}
    </div>
    ${linksHtml(denial, claim)}
    <div class="toolbar">
      <span class="t-title-sm">Timeline</span>
      <span class="spacer"></span>
      <a class="crumb-link" href="#/claima/timeline/${esc(claim.claimNo)}">Full timeline</a>
    </div>
    ${excerptHtml(claim)}`;
}

/** Every line of the claim, the denied one first and marked; other denials on the claim named on their lines. */
function linesHtml(denial, claim) {
  const others = denials.byClaim(claim.claimNo).filter((d) => d.id !== denial.id && d.status !== 'Reversed');
  const rows = [...claim.lines].sort((a, b) => (a.id === denial.lineId ? -1 : b.id === denial.lineId ? 1 : 0));
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Line</th>
          <th scope="col">Charge</th>
          <th scope="col">Qty</th>
          <th scope="col">Billed</th>
          <th scope="col" title="The payer share expected at assembly, stamped on the claim">Expected</th>
          <th scope="col">Denied</th>
          <th scope="col">Code</th>
          <th scope="col">Line status</th>
        </tr>
      </thead>
      <tbody>${rows.map((l) => {
    const mine = denial.scope === 'Claim' || l.id === denial.lineId;
    const other = others.find((d) => d.lineId === l.id);
    const item = cdm.get(l.itemId);
    const deniedHere = mine ? (denial.scope === 'Line' ? denial.amounts.denied : l.remittance?.denied || l.payerShare || 0) : l.remittance?.denied || 0;
    return `
        <tr${mine ? ' aria-current="true"' : ''} data-line="${esc(l.id)}">
          <td><span class="t-mono-sm">${esc(l.id)}</span>${mine ? ' <span class="badge badge--critical" title="The line this denial is about">this denial</span>' : ''}${
      other ? ` <a class="badge" href="#/defensio/denials/${esc(other.id)}" title="Another denial on this line">${esc(other.id)}</a>` : ''}</td>
          <td><span class="t-mono-sm">${esc(l.chargeCode || item?.chargeCode || l.itemId)}</span><br><span class="t-body-sm">${esc(l.description || cdm.label(item) || '')}${l.isOverage ? ' · overage' : ''}${l.late ? ' · late' : ''}</span></td>
          <td>${l.qty}</td>
          <td><span class="t-mono-sm">${esc(usd(l.grossBilled))}</span></td>
          <td><span class="t-mono-sm" title="Allowed ${esc(usd(l.allowedExpected))} · patient ${esc(usd(l.patientShare))}">${esc(usd(l.payerShare))}</span></td>
          <td>${deniedHere ? `<span class="t-mono-sm">${esc(usd(deniedHere))}</span>` : '<span class="t-body-sm">—</span>'}</td>
          <td>${mine ? `<span class="badge badge--critical" title="${esc(denial.payerReason?.text || '')}">${esc(denial.payerReason?.code || denial.code || '—')}</span>`
    : l.remittance?.denialCode ? `<span class="badge" title="${esc(denials.denialCodeLabel(l.remittance.denialCode))}">${esc(l.remittance.denialCode)}</span>` : '<span class="t-body-sm">—</span>'}</td>
          <td><span class="badge">${esc(l.status || 'Open')}</span></td>
        </tr>`;
  }).join('')}</tbody>
    </table>`;
}

/** Authorisations, referral, eligibility check and documents — each a link, or a plain "none". */
function linksHtml(denial, claim) {
  const line = denials.lineOf(denial);
  const auths = claim.encounterNo ? preauth.byEncounter(claim.encounterNo) : [];
  const docs = claim.encounterNo && claims.clinicalDocsOf ? claims.clinicalDocsOf(claim.encounterNo) : [];
  const attachments = claim.attachments || [];
  const none = (text) => `<span class="t-body-sm">${esc(text)}</span>`;
  return `
    <dl class="dl">
      <dt>Encounter</dt>
      <dd>${claim.encounterNo ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(claim.encounterNo)}">${esc(claim.encounterNo)}</a>${claim.department ? ` · ${esc(claim.department)}` : ''}` : none('No visit behind this claim — a generated claim')}</dd>
      <dt>Coding</dt>
      <dd>${claim.encounterNo ? `<a class="crumb-link" href="#/claima/coding/${esc(claim.encounterNo)}">Chart ${esc(claim.encounterNo)}</a>${claim.coding?.principal?.code ? ` · <span class="t-mono-sm">${esc(claim.coding.principal.code)}</span> ${esc(claim.coding.principal.desc || '')}` : ''}` : none('No chart — a generated claim')}</dd>
      <dt>Authorisation</dt>
      <dd>${auths.length ? auths.map((a) => `<a class="crumb-link t-mono-sm" href="#/frontis/preauth/${esc(a.no)}">${esc(a.no)}</a> <span class="badge">${esc(a.status)}</span>${
        a.decision?.authNumber ? ` <span class="t-body-sm">${esc(a.decision.authNumber)}</span>` : ''}`).join('<br>')
    : line?.authNumber ? `<span class="t-mono-sm">${esc(line.authNumber)}</span> on the line` : none(line?.preAuthRequired ? 'Required by the contract, none on file' : 'None on file')}</dd>
      <dt>Referral</dt>
      <dd>${claim.referralNo ? `<a class="crumb-link t-mono-sm" href="#/frontis/referrals/${esc(claim.referralNo)}/view">${esc(claim.referralNo)}</a>` : none('None')}</dd>
      <dt>Eligibility</dt>
      <dd>${claim.snapshotRef ? `<a class="crumb-link t-mono-sm" href="#/frontis/eligibility/${esc(claim.snapshotRef)}">${esc(claim.snapshotRef)}</a>` : none('No check on the claim')}</dd>
      <dt>Documents</dt>
      <dd>${attachments.length || docs.length
    ? [...attachments.map((a) => `<span class="t-body-sm">${esc(a.type)} — ${esc(a.fileName)} <span class="badge">${esc(a.origin || 'Attached')}</span></span>`),
      ...docs.filter((d) => !attachments.some((a) => a.docId === d.id)).map((d) => `<span class="t-body-sm">${esc(d.type)} — ${esc(d.title)} <span class="badge">not attached</span></span>`)].join('<br>')
    : none('Nothing attached')}${claim.encounterNo ? `<br><a class="crumb-link" href="#/claima/claims/${esc(claim.claimNo)}/attachments">Attachments tab</a>` : ''}</dd>
      <dt>Remittance</dt>
      <dd>${denial.remittanceNo ? `<a class="crumb-link t-mono-sm" href="#/claima/remittances/${esc(denial.remittanceNo)}/exceptions">${esc(denial.remittanceNo)}</a>` : none('Answered outside a posted remittance')}${
    (denial.repeats || []).length ? `<br><span class="t-body-sm">Denied again on ${denial.repeats.map((r) => esc(r.remittanceNo || '—')).join(', ')}</span>` : ''}</dd>
    </dl>`;
}

/** The last eight events of the claim's timeline, newest last, as the timeline page draws them. */
function excerptHtml(claim) {
  const events = lifecycle.byClaim(claim.claimNo);
  if (!events.length) return '<p class="t-body-sm">No events yet.</p>';
  const shown = events.slice(-EXCERPT);
  return `
    ${events.length > EXCERPT ? `<p class="t-body-sm">${events.length - EXCERPT} earlier event${events.length - EXCERPT === 1 ? '' : 's'} on the full timeline.</p>` : ''}
    <ol class="journey">${shown.map((ev) => `
      <li class="journey__row">
        <span class="journey__at t-mono-sm">${dateTime(ev.at)}</span>
        <span class="journey__action">${eventBadge(ev.type)}</span>
        <span class="journey__actor">${esc(ev.actor)}</span>
        <span class="journey__detail">${eventIcon(ev.type)} ${esc(ev.summary)}${ev.link ? ` · <a class="crumb-link" href="${esc(ev.link.href)}">${esc(ev.link.label)}</a>` : ''}</span>
      </li>`).join('')}</ol>`;
}

export const repeatChainHtml = (denial) => {
  const chain = denials.chainOf(denial);
  if (chain.length < 2) return '';
  return `
    <div class="rule-child-row">
      <span class="t-body-sm">Chain</span>
      ${chain.map((d) => `<a class="btn btn--${d.id === denial.id ? 'tint' : 'secondary'} btn--sm" href="#/defensio/denials/${esc(d.id)}" aria-current="${d.id === denial.id ? 'page' : 'false'}"
        title="${esc(`${d.status} · ${usd(d.amounts.denied)} · ${date(d.createdAt)}`)}"><span class="t-mono-sm">${esc(d.id)}</span> <span class="badge">×${d.repeatCount}</span></a>`).join('<span class="icon icon--sm" aria-hidden="true">arrow_forward</span>')}
    </div>`;
};
