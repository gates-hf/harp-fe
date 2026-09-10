// Charge history — everything that happened to one capture line, read-only
// and newest first, in the shared drawer. The trail bound to the `charges`
// entity: capture, hold, approval, release, reversal, with the user and the
// time. A reposted line names the line it replaced under the strip, so the
// pair reads as one story.

import * as audit from '../../../../data/repositories/audit.js';
import * as charges from '../../../../data/repositories/charges.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';

const ENTITY = 'charges';

export function chargeHistoryHtml(id) {
  const line = charges.get(id);
  const entries = audit.forEntity(ENTITY, id);
  return `
    ${line ? summaryHtml(line) : ''}
    ${entries.length ? `<ol class="journey">${entries.map(rowHtml).join('')}</ol>` : emptyHtml()}
    ${line?.reversesId ? `
      <div class="toolbar">
        <span class="t-body-sm">Reposted from ${esc(line.reversesId)}</span>
        <span class="spacer"></span>
        <button class="btn btn--ghost btn--sm" data-history="${esc(line.reversesId)}">Open its trail</button>
      </div>` : ''}`;
}

export async function openChargeHistory(id) {
  const line = charges.get(id);
  if (!line) return undefined;
  const item = cdm.get(line.itemId);

  const sheet = drawer.open({
    title: `History — ${esc(id)}`,
    sub: `${esc(item?.chargeCode || line.itemId)} ×${line.qty} on ${esc(line.encounterNo)} · append-only`,
    icon: 'history',
    body: chargeHistoryHtml(id),
  });

  sheet.el.addEventListener('click', (e) => {
    const other = e.target.closest('[data-history]')?.dataset.history;
    if (!other) return;
    sheet.el.querySelector('#drawer-title').textContent = `History — ${other}`;
    sheet.el.querySelector('.drawer__body').innerHTML = chargeHistoryHtml(other);
  });

  return sheet.closed;
}

function summaryHtml(line) {
  const p = line.pricing;
  const trace = p.trace || {};
  return `
    <dl class="dl">
      <dt>Status</dt><dd><span class="badge badge--${charges.statusTone(line.status)}"><span class="dot"></span>${esc(line.status)}</span>${
        line.holdReason ? ` <span class="t-body-sm">${esc(line.holdReason)}</span>` : ''}</dd>
      <dt>Source</dt><dd>${esc(line.source.type)}${line.source.ref ? ` · ${esc(line.source.ref)}` : ''} · ${esc(line.source.capturedBy)}</dd>
      <dt>Priced</dt><dd class="t-mono-sm">${usd(p.gross)} gross · ${usd(p.allowed)} allowed · ${usd(p.payerShare)} payer · ${usd(p.patientShare)} patient</dd>
      <dt>Under</dt><dd>${trace.selfPay ? 'Self-Pay — the standard price' : `${esc(trace.contractNo || '—')} v${esc(trace.version ?? '')}${
        trace.methodology ? ` · ${esc(trace.methodology)}` : ''}${trace.rules?.length ? ` · ${esc(trace.rules.join(', '))}` : ''}`}</dd>
      <dt>Ledger</dt><dd class="t-mono-sm">${line.ledgerTxIds.map((id) => esc(id)).join(', ') || '—'}</dd>
    </dl>`;
}

function rowHtml(entry) {
  return `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(entry.at)}</span>
      <span class="journey__action">${esc(entry.action)}</span>
      <span class="journey__actor">${esc(entry.user)}</span>
      <span class="journey__detail">${esc(entry.details || '')}</span>
    </li>`;
}

function emptyHtml() {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">Nothing recorded yet</div>
      <p class="state-view__body">Every capture, hold, approval, release and reversal from here on is recorded, with the user and the time.</p>
    </div>`;
}
