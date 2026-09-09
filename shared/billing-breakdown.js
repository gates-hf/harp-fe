// The traceable breakdown of one charge line: the five steps the engine walked
// and what each one decided. Markup only — it takes a trace from
// data/engines/billing-engine.js and returns HTML, so every screen that prices
// a charge shows the same panel.
//
// It lives in shared/ rather than beside the billing simulator because a second
// module reads it now: Pactum's simulator and Frontis's cost estimate are the
// same five steps, and a module never reaches into another module's files. It
// reads two repositories to label a charge, which is the one thing that sets it
// apart from the rest of shared/ — the arrow runs shared/ -> data/ and never
// back, so nothing in data/ can cycle through it.
//
// The panel is a <details>, so a long encounter opens one line at a time and
// the keyboard reaches every one of them without a line of module CSS.

import * as cdm from '../data/repositories/cdm.js';
import { consumedLabel } from '../data/engines/overage-engine.js';
import { esc, usd } from './format.js';
import { metricRailHtml } from './metric-card.js';

const TONE = { Priced: 'success', 'Held for approval': 'warning', 'Not billable': 'critical' };

export const statusBadge = (status) =>
  `<span class="badge badge--${TONE[status] || ''}"><span class="dot"></span>${esc(status)}</span>`;

/** One line's trace. `open` expands the panel on first draw. */
export function breakdownHtml(trace, { open = false } = {}) {
  const r = trace.result;
  return `
    <details class="panel panel--bordered" data-line="${esc(trace.item.id)}"${open ? ' open' : ''}>
      <summary class="panel-header">
        <span class="t-mono-sm">${esc(trace.item.chargeCode)}</span>
        <span>${esc(cdm.label(trace.item))}</span>
        ${cdm.isBundle(trace.item) ? '<span class="badge badge--accent">Bundle</span>' : ''}
        <span class="spacer"></span>
        <span class="t-body-sm">×${trace.qty}</span>
        <span class="t-mono-sm">${usd(r.allowed)}</span>
        ${statusBadge(r.status)}
      </summary>
      <div class="panel-body">
        ${trace.steps.map(stepHtml).join('')}
        ${resultHtml(trace)}
      </div>
    </details>`;
}

/**
 * The lines behind each total, so a card can select the rows it counts. A card
 * whose total is nothing has no rows to select, and the rail draws it as a
 * plain number rather than a control that would empty the table.
 */
export const INVOICE_FILTERS = {
  all: { words: 'every line', test: () => true },
  payer: { words: 'lines the payer pays for', test: (r) => r.payer > 0 },
  patient: { words: 'lines the patient pays for', test: (r) => r.patient > 0 },
  overage: { words: 'overage lines', test: (r) => r.isOverage },
  held: { words: 'lines held for approval', test: (r) => r.status === 'Held for approval' },
  notBillable: { words: 'lines a rule took off the bill', test: (r) => r.status === 'Not billable' },
};

/** The totals card above the breakdown: money as text, decisions as counts. */
export function totalsRailHtml(totals, selected = 'all') {
  const card = (key, label, value, tone, title, text = true) => ({
    value, label, tone, text,
    title: `${title}${totals[key] || key === 'all' ? ' — select to list those lines' : ''}`,
    // Only a card with lines under it is a control; the rest are numbers.
    key: key === 'all' || totals[key] ? key : '',
    pressed: key === 'all' || totals[key] ? selected === key : undefined,
  });
  return `
    <!-- The totals sit in the 60% half of a split, not across the page, so this
         rail names its track count instead of fitting six cards in 571px. -->
    <div class="metric-rail metric-rail--3">
      ${metricRailHtml([
        card('all', 'Allowed', usd(totals.allowed), '', 'Every line and its overage, at contract rates'),
        card('payer', 'Payer share', usd(totals.payer), '', 'What the payer owes once the split is applied'),
        card('patient', 'Patient share', usd(totals.patient), '', 'What the patient owes out of pocket'),
        card('overage', 'Overage', usd(totals.overage), totals.overage > 0 ? 'warning' : '', 'Billed on top of a bundle price'),
        card('held', 'Held for approval', totals.held, totals.held ? 'warning' : '', 'Lines waiting on pre-authorization', false),
        card('notBillable', 'Not billable', totals.notBillable, totals.notBillable ? 'critical' : '', 'Lines a rule took off the bill', false),
      ])}
    </div>`;
}

/** The invoice as a claim would carry it, overage lines marked apart. */
export function invoiceTableHtml(rows) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th>Charge code</th><th>Description</th><th class="num">Qty</th>
          <th class="num">Allowed</th><th class="num">Payer</th><th class="num">Patient</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td class="t-mono-sm">${esc(row.chargeCode)}</td>
            <td>${esc(row.description)}${row.isOverage ? ' <span class="badge badge--warning">Overage</span>' : ''}</td>
            <td class="num t-mono-sm">${esc(row.qtyLabel)}</td>
            <td class="num t-mono-sm">${usd(row.amount)}</td>
            <td class="num t-mono-sm">${usd(row.payer)}</td>
            <td class="num t-mono-sm">${usd(row.patient)}</td>
            <td>${statusBadge(row.status)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function stepHtml(step) {
  return `
    <div class="toolbar">
      <span class="badge badge--accent">${step.n}</span>
      <span class="t-title-sm">${esc(step.title)}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${esc(headline(step))}</span>
    </div>
    ${bodyHtml(step)}`;
}

function headline(step) {
  if (step.key === 'methodology') return `${step.method} · ${step.scope}`;
  if (step.key === 'overage') return step.applies ? `${step.lines.length} overage line${step.lines.length === 1 ? '' : 's'} · ${usd(step.total)}` : 'Not applicable';
  if (step.key === 'coverage') return step.scope === 'None' ? 'No row' : `${step.scope} · patient ${step.share}`;
  if (step.key === 'preauth') return step.required ? 'Required' : 'Not required';
  return step.fired.length ? `${step.fired.length} rule${step.fired.length === 1 ? '' : 's'} fired · ${step.mode}` : 'Nothing fired';
}

function bodyHtml(step) {
  if (step.key === 'methodology') return methodologyHtml(step);
  if (step.key === 'overage') return overageHtml(step);
  if (step.key === 'coverage') return coverageHtml(step);
  if (step.key === 'preauth') return preAuthHtml(step);
  return rulesHtml(step);
}

function methodologyHtml(step) {
  return `
    <dl class="dl dl--narrow">
      <dt>Rule used</dt><dd>${esc(step.scope)} · ${esc(step.method)} — ${esc(step.params)}</dd>
      <dt>Unit price</dt><dd class="t-mono-sm">${usd(step.unitPrice)}</dd>
      <dt>Quantity</dt><dd class="t-mono-sm">${esc(step.qty)}</dd>
      <dt>Allowed amount</dt><dd class="t-mono-sm">${usd(step.allowedAmount)}</dd>
    </dl>`;
}

function overageHtml(step) {
  if (!step.applies) return `<p class="t-body-sm">${esc(step.reason)}</p>`;
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th>Component</th><th class="num">Included</th><th class="num">Consumed</th><th class="num">Overage</th>
          <th>Tolerance</th><th>Action</th><th>Source</th><th class="num">Amount</th>
          <th class="num">Payer</th><th class="num">Patient</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${step.rows.map(overageRowHtml).join('')}</tbody>
    </table>`;
}

function overageRowHtml(row) {
  const tone = row.status === 'Billable' ? 'success' : row.status === 'Held for approval' ? 'warning' : '';
  return `
    <tr>
      <td>
        <span class="t-mono-sm">${esc(row.item.chargeCode)}</span> ${esc(cdm.label(row.item))}
        ${row.inner.length
          ? `<br><span class="t-body-sm">contains ${esc(row.inner.map((i) => i.item.chargeCode).join(', '))}</span>`
          : ''}
        ${row.note ? `<br><span class="t-body-sm">${esc(row.note)}</span>` : ''}
      </td>
      <td class="num t-mono-sm">${esc(consumedLabel(row, row.included))}</td>
      <td class="num t-mono-sm">${esc(consumedLabel(row, row.consumed))}</td>
      <td class="num t-mono-sm">${row.overage > 0 ? esc(consumedLabel(row, row.overage)) : '—'}</td>
      <td class="t-body-sm">${esc(row.toleranceLabel)}</td>
      <td>${esc(row.action)}${row.forced ? ` <span class="badge badge--warning" title="A rule overrode the contract policy">by rule</span>` : ''}</td>
      <td class="t-body-sm">${esc(row.source)}</td>
      <td class="num t-mono-sm">${row.overage > 0 ? usd(row.amount) : '—'}</td>
      <td class="num t-mono-sm">${usd(row.payer)}</td>
      <td class="num t-mono-sm">${usd(row.patient)}</td>
      <td><span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(row.status)}</span></td>
    </tr>`;
}

function coverageHtml(step) {
  return `
    <dl class="dl dl--narrow">
      <dt>Row used</dt><dd>${esc(step.scope)}${step.covered === false ? ' — not covered' : ''}</dd>
      <dt>Patient share</dt><dd>${esc(step.share)}</dd>
      <dt>Payer pays</dt><dd class="t-mono-sm">${usd(step.payerShare)}</dd>
      <dt>Patient pays</dt><dd class="t-mono-sm">${usd(step.patientShare)}</dd>
    </dl>
    ${step.note ? `<p class="t-body-sm">${esc(step.note)}</p>` : ''}`;
}

function preAuthHtml(step) {
  return `
    <div class="rule-child-row">
      <span class="icon">${step.required ? 'gpp_maybe' : 'verified_user'}</span>
      <div>
        <span class="badge badge--${step.required ? 'warning' : 'success'}"><span class="dot"></span>${step.required ? 'Required' : 'Not required'}</span>
        <span class="t-body-sm">${esc(step.reason)}</span>
      </div>
    </div>
    <dl class="dl dl--narrow"><dt>Row used</dt><dd>${esc(step.source)}</dd></dl>`;
}

function rulesHtml(step) {
  if (!step.fired.length) return `<p class="t-body-sm">${esc(step.note)}</p>`;
  return `
    <table class="tbl">
      <thead><tr><th class="num">Priority</th><th>Rule</th><th>Conditions</th><th>Action</th></tr></thead>
      <tbody>
        ${step.fired.map((rule) => `
          <tr>
            <td class="num t-mono-sm">${esc(rule.priority)}</td>
            <td>${esc(rule.name)}</td>
            <td class="t-body-sm">${esc(rule.conditions)}</td>
            <td>${esc(rule.action)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${step.overrides.map((o) => `
      <div class="rule-child-row">
        <span class="icon">swap_horiz</span>
        <div>${esc(o.what)}: was ${esc(o.was)} → now ${esc(o.now)} <span class="t-body-sm">(${esc(o.ruleName)})</span></div>
      </div>`).join('')}`;
}

function resultHtml(trace) {
  const r = trace.result;
  return `
    <div class="toolbar">
      <span class="t-title-sm">Result</span>
      <span class="spacer"></span>
      ${r.preAuthRequired ? '<span class="badge badge--warning"><span class="dot"></span>Pre-auth required</span>' : ''}
      ${statusBadge(r.status)}
    </div>
    <dl class="dl dl--narrow">
      <dt>Allowed</dt><dd class="t-mono-sm">${usd(r.allowed)}</dd>
      <dt>Payer share</dt><dd class="t-mono-sm">${usd(r.payerShare)}</dd>
      <dt>Patient share</dt><dd class="t-mono-sm">${usd(r.patientShare)}</dd>
      ${r.overageLines.length
        ? `<dt>Overage lines</dt><dd>${r.overageLines.length} · ${usd(r.overageLines.reduce((n, l) => n + l.amount, 0))}</dd>`
        : ''}
      <dt>Priced under</dt><dd class="t-mono-sm">${esc(trace.contractNo)} v${esc(trace.version)}</dd>
    </dl>`;
}
