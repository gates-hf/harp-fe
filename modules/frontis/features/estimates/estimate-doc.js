// The priced half of an estimate as markup: the totals, the lines, the limits a
// bundle price runs out at, the pre-authorisations still to get and the charges
// the plan refuses outright. One file because two screens draw exactly the same
// thing — the builder, from a simulation that has not been issued, and the
// document, from the result frozen when it was.
//
// It takes the result object and nothing else, so the document cannot show a
// number the builder did not, and neither can recompute one.

import { esc, usd } from '../../../../shared/format.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';

/**
 * The six figures, patient share first: what the patient is being asked to
 * find is the reason anyone reads an estimate. `selected` makes the cards
 * controls that filter the lines under them; passing null leaves them plain
 * numbers, which is what the printed document wants — it always shows every
 * line, so there is nothing for a card to select.
 */
export function totalsRailHtml(result, selected = null) {
  const t = result.totals;
  const pick = (key, has) => (selected === null || !has ? {} : { key, pressed: selected === key });
  return `
    <!-- The totals sit in the 60% half of a split on the builder and beside the
         document's summary, not across the page, so the rail names its track
         count rather than squeezing six cards into 571px. -->
    <div class="metric-rail metric-rail--3">
      ${metricRailHtml([
        { value: usd(t.patientShare), label: 'Patient share', tone: 'warning', text: true,
          sub: 'expected at the desk',
          title: `What the patient pays out of pocket${selected === null ? '' : ' — select to list those lines'}`,
          ...pick('patient', t.patientShare > 0) },
        { value: usd(t.allowed), label: 'Allowed', text: true,
          sub: `standard price ${usd(t.gross)}`,
          title: `Every line and its overage at the agreed rates; the charge master would price these at ${usd(t.gross)}`,
          ...pick('all', true) },
        { value: usd(t.payerShare), label: 'Payer share', text: true,
          sub: 'billed to the payer',
          title: `What the payer is expected to carry${selected === null ? '' : ' — select to list those lines'}`,
          ...pick('payer', t.payerShare > 0) },
        { value: t.held, label: 'Held for approval', tone: t.held ? 'warning' : '',
          sub: 'waiting on pre-auth',
          title: 'Lines that cannot be billed until the payer authorises them',
          ...pick('held', t.held > 0) },
        { value: t.notBillable, label: 'Not billable', tone: t.notBillable ? 'critical' : '',
          sub: 'taken off the bill',
          title: 'Lines a contract rule takes off the bill entirely',
          ...pick('notBillable', t.notBillable > 0) },
        { value: usd(t.overageExposure), label: 'Overage exposure', tone: t.overageExposure ? 'warning' : '', text: true,
          sub: 'beyond a package price',
          title: 'What is expected on top of a package price once its limits are passed',
          ...pick('overage', t.overageExposure > 0) },
      ])}
    </div>`;
}

/** The quotation itself: what each line costs and who is expected to pay it. */
export function linesTableHtml(rows) {
  if (!rows.length) return '<p class="t-body-sm">No services are priced on this estimate.</p>';
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Charge code</th><th scope="col">Service</th><th scope="col" class="num">Qty</th>
          <th scope="col" class="num">Standard</th><th scope="col" class="num">Allowed</th>
          <th scope="col" class="num">Payer</th><th scope="col" class="num">Patient</th><th scope="col">Flags</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td class="t-mono-sm">${esc(row.chargeCode)}</td>
            <td>${esc(row.description)}${row.isOverage
              ? ' <span class="badge badge--warning">Overage</span>' : ''}</td>
            <td class="num t-mono-sm">${esc(row.qtyLabel)}</td>
            <td class="num t-mono-sm">${row.gross === null || row.gross === undefined ? '—' : usd(row.gross)}</td>
            <td class="num t-mono-sm">${usd(row.amount)}</td>
            <td class="num t-mono-sm">${usd(row.payer)}</td>
            <td class="num t-mono-sm">${usd(row.patient)}</td>
            <td>${statusBadge(row.status)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

const TONE = { Priced: 'success', 'Held for approval': 'warning', 'Not billable': 'critical' };

export const statusBadge = (status) =>
  `<span class="badge${TONE[status] ? ` badge--${TONE[status]}` : ''}"><span class="dot"></span>${esc(status)}</span>`;

/**
 * Where a package price runs out. One block per bundle line: what each
 * component includes, what happens past it, and who carries that — the sentence
 * a patient signing a package price has to have been shown.
 */
export function limitsHtml(limits) {
  if (!limits?.length) return '';
  return `
    <div class="toolbar">
      <span class="t-title-sm">Package limits and exposure</span>
      <span class="spacer"></span>
      <span class="t-body-sm">what a package price covers, and what it does not</span>
    </div>
    ${limits.map(limitBlockHtml).join('')}`;
}

function limitBlockHtml(block) {
  return `
    <div class="panel panel--sunken">
      <div class="panel-header">
        <span class="t-mono-sm">${esc(block.chargeCode)}</span>
        <span>${esc(block.description)}</span>
        <span class="spacer"></span>
        <span class="badge${block.measured ? ' badge--accent' : ''}">${
          block.measured ? 'Measured against its limits' : 'Not measured'}</span>
      </div>
      <div class="panel-body">
        ${block.note ? `<p class="t-body-sm">${esc(block.note)}</p>` : ''}
        ${block.rows.map((row) => `
          <div class="rule-child-row">
            <span class="icon">inventory_2</span>
            <div>
              <div><span class="t-mono-sm">${esc(row.chargeCode)}</span> ${esc(row.description)}</div>
              <span class="t-body-sm">Included: ${esc(row.included)}${
                row.consumed ? ` · quoted at ${esc(row.consumed)}` : ''}${esc(exposureText(row))}</span>
            </div>
            <span class="spacer"></span>
            ${row.overage > 0
              ? `<span class="t-mono-sm" title="Payer ${usd(row.payer)} · patient ${usd(row.patient)}">${usd(row.amount)}</span>
                 ${row.status ? statusBadge(row.status) : ''}`
              : '<span class="t-body-sm">within the package</span>'}
          </div>`).join('')}
      </div>
    </div>`;
}

/**
 * What happens past the limit, when there is an answer worth printing. The
 * overage engine names an action only once a component has actually run over,
 * so a component still inside its allowance says what it includes and stops —
 * the right-hand column already says it is within the package price.
 * `toleranceLabel` writes the word "tolerance" itself, so this does not.
 */
function exposureText(row) {
  if (!row.action || row.action === 'None' || row.action === '—') return '';
  const tolerance = row.tolerance && row.tolerance !== '—' && row.tolerance !== 'no tolerance'
    ? `, ${row.tolerance}` : '';
  return ` · ${row.beyond} → ${row.action}${tolerance}`;
}

/** Everything the payer has to authorise before the charge can be billed. */
export function flagsHtml(flags) {
  if (!flags?.length) return '';
  return `
    <div class="alert alert--warning">
      <span class="icon">gpp_maybe</span>
      <div>
        <div class="title">${flags.length} charge${flags.length === 1 ? '' : 's'} need pre-authorisation</div>
        ${flags.map((flag) => `<span class="t-mono-sm">${esc(flag.chargeCode)}</span> ${esc(flag.description)} —
          ${esc(flag.reason)}`).join('<br>')}
      </div>
    </div>`;
}

/** The charges the plan names and refuses. The patient carries all of these. */
export function exclusionsHtml(exclusions) {
  if (!exclusions?.length) return '';
  return `
    <div class="alert alert--critical">
      <span class="icon">block</span>
      <div>
        <div class="title">${exclusions.length} charge${exclusions.length === 1 ? '' : 's'} not covered</div>
        ${exclusions.map((row) => `<span class="t-mono-sm">${esc(row.chargeCode)}</span> ${esc(row.description)} —
          ${esc(row.reason)} <span class="t-mono-sm">${usd(row.amount)}</span>`).join('<br>')}
      </div>
    </div>`;
}

/** Printed at the foot of the document, and frozen into it when it was issued. */
export const disclaimerHtml = (text) =>
  (text ? `<p class="t-body-sm">${esc(text)}</p>` : '');

/** What priced this: the agreement and version, or the self-pay answer. */
export function contractChipHtml(result) {
  if (result.selfPay) {
    return `
      <div class="rule-child-row">
        <span class="icon">payments</span>
        <div>
          <div>Self-Pay — priced at the charge master's standard rates</div>
          <span class="t-body-sm">No agreement applies, so there is no split: the patient carries every line.</span>
        </div>
      </div>`;
  }
  if (!result.contract) return '';
  return `
    <div class="rule-child-row">
      <span class="icon">contract</span>
      <a class="crumb-link" href="#/pactum/contracts/${esc(result.contract.id)}">${esc(result.contract.no)}</a>
      <span class="badge badge--accent">v${esc(result.contract.version)}</span>
      <span class="t-body-sm">the agreement that priced this estimate</span>
    </div>`;
}
