// The timeline of one claim — the family strip, then every event in order
// with who, what and where to open it. Read-only markup that draws into any
// host: the timeline page wraps it in a panel, and the claim page's Timeline
// tab (when claims-assembly adds it) hands it the panel body. It binds no
// listeners, so a host has nothing to retire.

import * as lifecycle from '../../../../data/engines/claim-events.js';
import * as claims from '../../../../data/repositories/claims.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';
import { eventBadge, eventIcon, kindChip, label, statusHtml } from './lifecycle-chips.js';

/** Draw the strip and the events into `host` for the claim. */
export function render(host, { claimNo }) {
  host.innerHTML = timelineHtml(claimNo);
}

export function timelineHtml(claimNo) {
  const claim = claims.get(claimNo);
  if (!claim) return emptyHtml();
  const events = lifecycle.byClaim(claim.claimNo);
  return `
    ${familyHtml(claim)}
    <div class="toolbar">
      <span class="t-title-sm">Events</span>
      <span class="badge">${events.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${silenceLine(claim, events)}</span>
    </div>
    ${events.length ? `<ol class="journey">${events.map(rowHtml).join('')}</ol>` : emptyHtml()}`;
}

/**
 * The family strip: the claim's cycles — the submission feature keeps the
 * number and counts the times it went to the payer, so a closed cycle is a
 * chip naming its batch and the rejection it ended in — then the
 * supplementary and secondary claims hanging off it, every one a link and the
 * one on screen pressed, so the strip reads the same from any member.
 */
function familyHtml(claim) {
  const f = lifecycle.family(claim.claimNo);
  const cycles = claims.cycleChain ? claims.cycleChain(f?.original || claim) : [];
  const alone = (!f || f.members.length < 2) && cycles.length < 2;
  if (alone) {
    return `
      <div class="toolbar">
        <span class="t-title-sm">Family</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${esc(claim.claimNo)} stands alone — one cycle, no supplementary or secondary claim yet.</span>
      </div>`;
  }
  const arrow = '<span class="icon icon--sm" aria-hidden="true">arrow_forward</span>';
  const original = f?.original || claim;
  const cycleChips = cycles.length > 1
    ? cycles.map((c) => cycleChip(c, original, claim)).join(arrow)
    : (f?.cycles || [claim]).map((c, i) => memberChip(c, i === 0 ? 'Original' : `Cycle ${i + 1}`, claim)).join(arrow);
  const branch = (list, role) => (list.length
    ? `<div class="rule-child-row"><span class="t-body-sm">${esc(role)}</span>${list.map((c) => memberChip(c, role, claim)).join('')}</div>` : '');
  return `
    <div class="toolbar">
      <span class="t-title-sm">Family</span>
      <span class="badge">${(f?.members.length || 1) + Math.max(0, cycles.length - 1)}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">The original and each cycle it went round; supplementary and secondary claims hang off it.</span>
    </div>
    <div class="rule-child-row"><span class="t-body-sm">Cycles</span>${cycleChips}</div>
    ${branch(f?.supplementary || [], 'Supplementary')}
    ${branch(f?.secondary || [], 'Secondary')}`;
}

/** A member claim as a chip: pressed when it is the one on screen. */
function memberChip(c, role, current) {
  const here = c.claimNo === current.claimNo;
  return `
    <a class="btn btn--${here ? 'tint' : 'secondary'} btn--sm" href="#/claima/timeline/${esc(c.claimNo)}"
       aria-current="${here ? 'page' : 'false'}" title="${esc(`${role} · ${c.status} · ${usd(c.totals?.payerShare)}`)}">
      <span class="t-mono-sm">${esc(c.claimNo)}</span> ${kindChip(c) || `<span class="badge">${esc(role)}</span>`} ${statusHtml(c)}
    </a>`;
}

/** One cycle of the same claim: a closed one names its batch and how it ended, the current one is the claim. */
function cycleChip(cycle, original, current) {
  if (cycle.current) return memberChip(original, `Cycle ${cycle.cycle}`, current);
  const ended = cycle.rejection ? `Rejected ${cycle.rejection.code || ''}`.trim() : cycle.status;
  const tone = cycle.rejection ? 'critical' : '';
  return `
    <a class="btn btn--secondary btn--sm" href="${cycle.batchNo ? `#/claima/submission/${esc(cycle.batchNo)}` : `#/claima/timeline/${esc(original.claimNo)}`}"
       title="${esc(`Cycle ${cycle.cycle}${cycle.submittedAt ? ` · submitted ${cycle.submittedAt.slice(0, 10)}` : ''}${cycle.rejection?.reason ? ` · ${cycle.rejection.reason}` : ''}`)}">
      <span class="badge badge--info">Cycle ${cycle.cycle}</span>
      <span class="badge${tone ? ` badge--${tone}` : ''}">${esc(ended)}</span>
      ${cycle.batchNo ? `<span class="t-mono-sm">${esc(cycle.batchNo)}</span>` : ''}
    </a>`;
}

function silenceLine(claim, events) {
  if (!claims.isPending(claim)) {
    const last = lifecycle.lastPayerEvent(claim.claimNo, events);
    return last ? `Last from the payer: ${esc(label(last.type))} on ${dateTime(last.at)}.` : `${esc(claim.status)} — nothing pending with the payer.`;
  }
  const silent = lifecycle.silentDays(claim, events);
  const warn = lifecycle.thresholdFor(claim, 'silentDays');
  const esc2 = lifecycle.thresholdFor(claim, 'escalationDays');
  const state = silent >= esc2 ? '⚑ escalated' : silent >= warn ? 'silent — in the follow-up queue' : 'inside the silence threshold';
  return `With the payer ${silent} day${silent === 1 ? '' : 's'} without an answer (${warn} to chase, ${esc2} to escalate) — ${state}.`;
}

function rowHtml(ev) {
  return `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(ev.at)}</span>
      <span class="journey__action">${eventBadge(ev.type)}</span>
      <span class="journey__actor">${esc(ev.actor)}</span>
      <span class="journey__detail">${eventIcon(ev.type)} ${esc(ev.summary)}${ev.link
        ? ` · <a class="crumb-link" href="${esc(ev.link.href)}">${esc(ev.link.label)}</a>` : ''}${
        ev.derived ? ' <span class="badge" title="Read off the claim’s own fields rather than a recorded event">derived</span>' : ''}</span>
    </li>`;
}

function emptyHtml() {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">timeline</span></div>
      <div class="state-view__title">Nothing to show yet</div>
      <p class="state-view__body">A claim's timeline is built from its trail and the registers beside it — batches, remittances, denials, hand-offs and follow-ups — the moment any of them names it.</p>
    </div>`;
}
