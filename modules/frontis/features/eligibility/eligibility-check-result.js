// The check screen's result half: the stack of attempts and the cascade prompt
// under it. Markup only — eligibility-check.js owns the state, runs the engine
// and writes the snapshots, so the two halves each stay near the line cap.
//
// Each attempt is a <details> whose <summary> is the panel header: the
// collapsible the design system needs no CSS for, the same one the billing
// breakdown uses.

import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as policies from '../../../../data/repositories/policies.js';
import { SELF_PAY } from '../../../../data/engines/eligibility-engine.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { conditionsHtml, coverageHtml, failuresHtml, overrideHtml, resultBadge, stepsHtml } from './eligibility-panel.js';

/** Every attempt in the cascade, oldest first. The newest one opens. */
export const attemptsHtml = (rows, role) =>
  rows.map((row, i) => attemptHtml(row, role, i === rows.length - 1)).join('');

function attemptHtml(row, role, open) {
  const canOverride = role.canOverrideEligibility && !eligibility.isOverridden(row);
  return `
    <details class="panel panel--sunken"${open ? ' open' : ''} data-ref="${esc(row.ref)}">
      <summary class="panel-header">
        <span class="t-mono-sm">${esc(row.ref)}</span>
        ${resultBadge(row)}
        <span class="spacer"></span>
        <span class="t-body-sm">${esc(eligibility.coverLabel(row))} · ${dateTime(row.checkedAt)}</span>
      </summary>
      <div class="panel-body">
        ${overrideHtml(row)}
        ${failuresHtml(row.failureReasons)}
        ${conditionsHtml(row.conditions)}
        <div class="toolbar"><span class="t-title-sm">Steps</span></div>
        ${stepsHtml(row.steps)}
        ${coverageHtml(row.coverageSummary)}
        <div class="toolbar">
          <a class="btn btn--secondary btn--sm" href="#/frontis/eligibility/${esc(row.ref)}">
            <span class="icon icon--sm">open_in_new</span>Open snapshot
          </a>
          <button class="btn btn--secondary btn--sm" data-act="print">
            <span class="icon icon--sm">print</span>Print
          </button>
          ${canOverride
            ? '<button class="btn btn--secondary btn--sm" data-act="override"><span class="icon icon--sm">flag</span>Override</button>'
            : `<button class="btn btn--secondary btn--sm" disabled title="${esc(overrideWhy(row, role))}">
                 <span class="icon icon--sm">flag</span>Override</button>`}
        </div>
      </div>
    </details>`;
}

const overrideWhy = (row, role) => (eligibility.isOverridden(row)
  ? 'This check has already been overridden — the answer is on the snapshot'
  : `Your role cannot override an eligibility result. ${role.title} is not a supervisory role.`);

/**
 * The cascade prompt. A refused attempt offers the next position in the chain;
 * an exhausted chain offers the fallback, which is the only answer left. A
 * passing attempt offers neither — the question has been answered.
 */
export function nextHtml(last, { remaining = [], triedSelfPay = false } = {}) {
  if (!last || eligibility.isPass(last.finalResult) || last.finalResult === 'Self-Pay') return '';

  const next = remaining[0];
  if (next) {
    return `
      <div class="alert alert--info">
        <span class="icon">low_priority</span>
        <div>
          <div class="title">Try next policy: ${esc(policies.label(next))}?</div>
          The cover above did not answer. The next position in the chain is checked as a fresh attempt on the
          same encounter, and recorded as a snapshot of its own.
          <div class="toolbar">
            <button class="btn btn--primary btn--sm" data-act="cascade" data-policy="${esc(next.id)}">Check next</button>
          </div>
        </div>
      </div>`;
  }
  if (triedSelfPay) return '';
  return `
    <div class="alert alert--warning">
      <span class="icon">payments</span>
      <div>
        <div class="title">All policies failed — proceed as Self-Pay?</div>
        Nothing in the chain covers this encounter. Recording self-pay closes the cascade and gives the desk a
        reference to hand the patient.
        <div class="toolbar">
          <button class="btn btn--primary btn--sm" data-act="cascade" data-policy="${SELF_PAY}">Record Self-Pay</button>
        </div>
      </div>
    </div>`;
}

/** Nothing run yet. The result half is tall, so the empty state is too. */
export const emptyHtml = () => `
  <div class="state-view state-view--tall">
    <div class="state-view__glyph"><span class="icon">verified_user</span></div>
    <div class="state-view__title">Nothing checked yet</div>
    <p class="state-view__body">Choose the patient and the cover, name the anticipated services if you have
      them, and run the check. Every run is recorded as a snapshot you can print and hand to the payer.</p>
  </div>`;
