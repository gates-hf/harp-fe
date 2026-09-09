// The result of one check, as markup. Both screens that show a snapshot draw it
// from here — the check screen, where a fresh answer stacks under the last one,
// and the snapshot page, which is the same answer printed. A second copy of
// this markup would be a second thing to keep in step with the engine.
//
// Markup only: no state, no events, no writes.

import * as eligibility from '../../../../data/repositories/eligibility.js';
import { resultTone } from '../../../../data/engines/eligibility-engine.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';

/** The result as a badge. An overridden snapshot flies the flag beside it. */
export function resultBadge(row) {
  const tone = resultTone(row.finalResult);
  return `
    <span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(row.finalResult)}</span>
    ${eligibility.isOverridden(row)
      ? `<span class="badge badge--accent" title="Overridden by ${esc(row.override.by)} — the system answered ${esc(row.systemResult)}">
           <span class="icon icon--sm">flag</span>Overridden</span>`
      : ''}`;
}

/** The three steps that can refuse cover. The last three only raise conditions. */
const GATE_STEPS = new Set(['patientStatus', 'policyValidity', 'contract']);

/** The six steps in order. A step below a failure was never asked, not failed. */
export function stepsHtml(steps = []) {
  if (!steps.length) return '<p class="t-body-sm">This check recorded no steps.</p>';
  // The design system tints a badge, not an icon, so the glyph carries the
  // shape of the answer and the badge beside it carries the colour. Only a gate
  // step reads as a failure: a coverage exclusion or a pre-auth requirement is
  // a condition to act on, and a red Fail beside an Eligible result would say
  // the opposite of what the check decided.
  return steps.map((step, i) => {
    const gate = GATE_STEPS.has(step.key);
    const [icon, tone, word] = step.skipped
      ? ['remove', '', 'Not checked']
      : step.pass ? ['check_circle', 'success', 'Pass']
        : gate ? ['cancel', 'critical', 'Fail'] : ['rule', 'warning', 'Condition'];
    return `
      <div class="rule-child-row">
        <span class="icon">${icon}</span>
        <div>
          <span class="t-title-sm">${i + 1}. ${esc(step.label)}</span>
          <br><span class="t-body-sm">${esc(step.detail)}</span>
        </div>
        <span class="spacer"></span>
        <span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${word}</span>
      </div>`;
  }).join('');
}

/** Why the cover was refused. Only steps 1–3 ever populate this. */
export function failuresHtml(reasons = []) {
  if (!reasons.length) return '';
  return `
    <div class="alert alert--critical">
      <span class="icon">error</span>
      <div>
        <div class="title">${reasons.length === 1 ? 'Cover was refused' : `Cover was refused on ${reasons.length} counts`}</div>
        ${reasons.map((r) => esc(r)).join('<br>')}
      </div>
    </div>`;
}

/** What the clerk has to act on before the patient is admitted. */
export function conditionsHtml(conditions = []) {
  if (!conditions.length) return '';
  return `
    <div class="alert alert--warning">
      <span class="icon">rule</span>
      <div>
        <div class="title">${conditions.length} ${conditions.length === 1 ? 'condition' : 'conditions'}</div>
        ${conditions.map((c) => esc(c)).join('<br>')}
      </div>
    </div>`;
}

/**
 * The anticipated services, priced. Quantity rides in the service name and the
 * ceiling under the share rule, so the table fits the 60% column of the split
 * as well as the printed page.
 */
export function coverageHtml(summary) {
  if (!summary) return '';
  const head = `
    <div class="toolbar">
      <span class="t-title-sm">Coverage</span>
      <span class="spacer"></span>
      <span class="t-body-sm">Default rule: ${esc(summary.defaultRule || 'not configured')}${
        summary.ceilingRemaining ? ` · ceiling ${usd(summary.ceilingRemaining)}` : ''}</span>
    </div>`;

  if (!summary.rows.length) {
    return `${head}
      <p class="t-body-sm">No services were named on this check, so the plan's default rule is the whole answer.
        Name the anticipated services to price them and see which need approval.</p>`;
  }

  return `${head}
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Service</th>
          <th scope="col" class="num">Allowed</th>
          <th scope="col">Covered</th>
          <th scope="col" class="num">Patient share</th>
          <th scope="col">Pre-auth</th>
        </tr>
      </thead>
      <tbody>${summary.rows.map(rowHtml).join('')}</tbody>
    </table>`;
}

function rowHtml(row) {
  const pre = row.preAuth;
  return `
    <tr>
      <td>
        ${esc(row.service)}${row.qty > 1 ? ` <span class="badge">×${row.qty}</span>` : ''}
        ${row.scope ? `<br><span class="t-body-sm">${esc(row.scope)}</span>` : ''}
      </td>
      <td class="num t-mono-sm">${usd(row.allowed)}</td>
      <td>
        <span class="badge${row.covered ? ' badge--success' : ' badge--critical'}">
          <span class="dot"></span>${row.covered ? 'Covered' : 'Excluded'}
        </span>
      </td>
      <td class="num t-mono-sm">
        ${usd(row.estimatedPatientShare)}
        <br><span class="t-body-sm">${esc(row.shareRule)}${row.ceiling ? ` · cap ${usd(row.ceiling)}` : ''}</span>
      </td>
      <td>
        ${pre
          ? `<span class="badge${pre.required ? ' badge--warning' : ''}"${pre.reason ? ` title="${esc(pre.reason)}"` : ''}>
               <span class="dot"></span>${pre.required ? 'Required' : 'Not required'}</span>`
          : '<span class="t-body-sm">—</span>'}
      </td>
    </tr>`;
}

/** The override block. The system's answer stays visible beside it, always. */
export function overrideHtml(row) {
  if (!eligibility.isOverridden(row)) return '';
  const o = row.override;
  return `
    <div class="alert alert--info">
      <span class="icon">flag</span>
      <div>
        <div class="title">Overridden: ${esc(row.systemResult)} → ${esc(o.result)}</div>
        ${esc(o.reason)}${o.payerRef ? ` · payer reference ${esc(o.payerRef)}` : ''}${o.contact ? ` · ${esc(o.contact)}` : ''}
        <br><span class="t-body-sm">${esc(o.by)} on ${dateTime(o.at)}</span>
        ${o.note ? `<br><span class="t-body-sm">${esc(o.note)}</span>` : ''}
      </div>
    </div>`;
}

/** Who, when, against what — the line every snapshot carries under its title. */
export function metaHtml(row) {
  const contract = row.contract
    ? `<a class="crumb-link" href="#/pactum/contracts/${esc(row.contract.id)}">${esc(row.contract.no)} v${row.contract.version}</a>`
    : 'no contract';
  return `
    <span class="t-mono-sm">${esc(row.ref)}</span>
    <span>·</span><span>${esc(eligibility.coverLabel(row))}</span>
    <span>·</span><span>${esc(row.checkType)}</span>
    <span>·</span><span>${esc(row.visitType || 'no visit type')}</span>
    <span>·</span><span>${date(row.checkedAt)} by ${esc(row.checkedBy)}</span>
    <span>·</span><span>${contract}</span>`;
}
