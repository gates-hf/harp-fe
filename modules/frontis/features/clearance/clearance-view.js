// The clearance answer for one visit — the encounter page's Clearance tab, and
// the screen #/frontis/encounters/<no>/clearance opens on, which is the same
// thing: a tab id in the path deep-links to the tab.
//
// It owns its own node inside the panel, so the listener it binds retires when
// the tab is redrawn — the shell's freshBody rule, one level down. Everything
// on it is read from the stamp; the only writes are the two dialogs, and both
// go through their own repositories.

import * as clearance from '../../../../data/repositories/clearance.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as acknowledgments from '../../../../data/repositories/acknowledgments.js';
import * as payments from '../../../../data/repositories/payments.js';
import { CONFIG } from '../../../../shared/config.js';
import { date, dateTime, esc, fileSize, relativeTime, usd } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { checklistHtml } from './clearance-checklist.js';
import { askAcknowledge } from './acknowledge-dialog.js';
import { askCollect } from './payment-dialog.js';

/**
 * Draw the tab into `panel`. `masked` is the record's own restriction: a
 * clearance answer names the payer, the plan and what the patient is expected
 * to find, which is the line the Insurance, Eligibility and Financial tabs
 * already draw.
 */
export function renderClearanceTab(panel, enc, { masked = false } = {}) {
  const node = document.createElement('div');
  panel.replaceChildren(node);
  if (masked) {
    node.innerHTML = maskedHtml();
    return;
  }

  const no = enc.no;
  draw();

  node.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'recompute') {
      clearance.refreshClearance(no);
      return void toast('Clearance recomputed');
    }
    if (act === 'acknowledge') return void (await askAcknowledge(no));
    if (act === 'collect' || act === 'payments') return void (await askCollect(no));
  });

  function draw() {
    const row = encounters.get(no);
    if (!row) return;
    node.innerHTML = bodyHtml(row);
  }
}

function bodyHtml(enc) {
  const stamp = clearance.stampOf(enc);
  const indicator = clearance.indicator(enc);
  const open = encounters.isOpen(enc);
  return `
    ${headerHtml(enc, stamp, indicator, open)}
    ${checklistHtml(enc, { readOnly: !open })}
    <div class="toolbar"><span class="t-title-sm">Acknowledgment</span></div>
    ${acknowledgmentHtml(enc, open)}
    <div class="toolbar"><span class="t-title-sm">Payments</span></div>
    ${paymentsHtml(enc, open)}`;
}

function headerHtml(enc, stamp, indicator, open) {
  return `
    <div class="toolbar">
      <span class="badge badge--solid${indicator.tone ? ` badge--${indicator.tone}` : ''}"
            title="${esc(indicator.label)}">
        <span class="dot"></span>${esc(indicator.status)}</span>
      <span class="t-body-sm">${stamp.computedAt
        // The stamp is rewritten when the answer moves, not every time it is
        // asked, so the timestamp is when this answer started being true.
        ? `This answer has stood since ${esc(relativeTime(stamp.computedAt))}`
        : 'Not computed yet'}${stamp.pendingSince
          ? ` · oldest item outstanding ${esc(relativeTime(stamp.pendingSince))}`
          : ''}</span>
      <span class="spacer"></span>
      ${open
        ? `<button class="btn btn--secondary btn--sm" data-act="recompute"
             title="Clearance recomputes on every change; this is here to prove it">
             <span class="icon icon--sm">refresh</span>Recompute</button>`
        : `<button class="btn btn--secondary btn--sm" disabled
             title="A ${esc(String(enc.status).toLowerCase())} encounter is closed — its clearance is no longer recomputed">
             <span class="icon icon--sm">lock</span>Closed</button>`}
    </div>
    <p class="t-body-sm">Clearance is derived, not filled in: every item below is read from the record that
      answers it each time this page is drawn. Nothing here is a box anybody ticks.</p>`;
}

// --- acknowledgment card ------------------------------------------------------

function acknowledgmentHtml(enc, open) {
  const ack = acknowledgments.byEncounter(enc.no)[0];
  if (!ack) {
    const required = CONFIG.clearance.acknowledgmentRequired[modeKey(enc)];
    return `
      <p class="t-body-sm">${required
        ? 'Nothing signed yet. The patient acknowledges the estimate before the service, and the signature is recorded here.'
        : 'No acknowledgment is required for this kind of visit, and none has been taken.'}</p>
      ${open
        ? `<div class="toolbar">
             <button class="btn btn--secondary btn--sm" data-act="acknowledge">
               <span class="icon icon--sm">draw</span>Record acknowledgment</button>
           </div>`
        : ''}`;
  }
  return `
    <dl class="dl dl--narrow">
      <dt>Estimate</dt>
      <dd><a class="crumb-link t-mono-sm" href="#/frontis/estimates/${esc(ack.estimateNo)}">${esc(ack.estimateNo)}</a></dd>
      <dt>Acknowledged by</dt><dd>${esc(acknowledgments.byLabel(ack))}</dd>
      <dt>Method</dt><dd>${esc(ack.method)}</dd>
      <dt>Taken</dt><dd class="t-mono-sm">${dateTime(ack.at)}<br>
        <span class="t-body-sm">${esc(ack.user)}</span></dd>
      <dt>Signed copy</dt>
      <dd>${ack.document
        ? `<span class="icon icon--sm">description</span> ${esc(ack.document.fileName)}
           <span class="t-body-sm">(${fileSize(ack.document.size)})</span>`
        : 'None on file'}</dd>
      ${ack.note ? `<dt>Note</dt><dd>${esc(ack.note)}</dd>` : ''}
    </dl>`;
}

const modeKey = (enc) => (enc?.type === 'IP' || enc?.type === 'ER' ? enc.type : 'OP');

// --- payments card ------------------------------------------------------------

function paymentsHtml(enc, open) {
  const item = (clearance.stampOf(enc).items || []).find((i) => i.key === 'payment');
  const rows = payments.byEncounter(enc.no);
  const received = payments.receivedFor(enc.no);

  if (item?.state === 'N/A' && !rows.length) {
    return `<p class="t-body-sm">${esc(item.detail)}</p>`;
  }

  return `
    <dl class="dl dl--narrow">
      <dt>Required</dt><dd>${esc(item?.detail || '—')}</dd>
      <dt>Received</dt><dd>${usd(received)}</dd>
    </dl>
    ${rows.length
      ? `<table class="tbl">
           <thead>
             <tr>
               <th scope="col">Receipt</th><th scope="col">Taken</th><th scope="col">Method</th>
               <th scope="col">Amount</th><th scope="col">Received by</th>
             </tr>
           </thead>
           <tbody>${rows.map(receiptRow).join('')}</tbody>
         </table>`
      : '<p class="t-body-sm">Nothing has been taken against this visit.</p>'}
    ${open
      ? `<div class="toolbar">
           <button class="btn btn--secondary btn--sm" data-act="collect">
             <span class="icon icon--sm">payments</span>Collect payment</button>
         </div>`
      : ''}`;
}

const receiptRow = (row) => `
  <tr>
    <td class="t-mono-sm">${esc(row.receiptNo)}
      ${row.kind !== 'Deposit' ? `<span class="badge">${esc(row.kind)}</span>` : ''}</td>
    <td class="t-mono-sm">${dateTime(row.at)}</td>
    <td>${esc(row.method)}${row.reference ? `<br><span class="t-body-sm">${esc(row.reference)}</span>` : ''}</td>
    <td>${usd(row.amount)}</td>
    <td class="t-body-sm">${esc(row.receivedBy)}</td>
  </tr>`;

// --- withheld -----------------------------------------------------------------

function maskedHtml() {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">lock</span></div>
      <div class="state-view__title">Clearance withheld</div>
      <p class="state-view__body">This encounter is for a restricted record. A clearance answer names the payer,
        the plan and what the patient is expected to find, so it is readable by roles with VIP access only.</p>
    </div>`;
}

/** Kept for a screen that wants the date a visit was cleared on, in words. */
export const clearedOn = (enc) => {
  const stamp = clearance.stampOf(enc);
  return stamp.status === 'Cleared' && stamp.computedAt ? date(stamp.computedAt) : '';
};
