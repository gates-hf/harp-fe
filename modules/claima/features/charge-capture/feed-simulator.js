// "Run feeds now" — the demo's stand-in for the order, result, procedure and
// census interfaces. It processes every Pending feed event through
// feeds.run(), which captures each one the way a manual charge is captured,
// and then says what happened: what landed, and what was refused and why.
//
// One function, used by both the worklist and the health screen, so the two
// buttons cannot behave differently.

import * as feeds from '../../../../data/repositories/feeds.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { esc, usd } from '../../../../shared/format.js';
import { open } from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';

export async function runFeedsNow() {
  const queue = feeds.pending();
  if (!queue.length) return void toast('Nothing is waiting in the feeds', 'warning');

  const res = feeds.run();
  toast(`${res.captured.length} line${res.captured.length === 1 ? '' : 's'} captured from the feeds${
    res.failed.length ? `, ${res.failed.length} failed` : ''}`, res.failed.length ? 'warning' : 'success');

  const dialog = open({
    title: 'Feeds processed',
    sub: `${queue.length} pending event${queue.length === 1 ? '' : 's'} — ${res.captured.length} captured, ${res.failed.length} failed`,
    icon: 'sync',
    size: 'lg',
    body: `
      ${res.captured.length ? `
        <div class="t-title-sm">Captured</div>
        <table class="tbl">
          <thead><tr><th scope="col">Source</th><th scope="col">Reference</th><th scope="col">Encounter</th><th scope="col">Charge</th><th scope="col" class="num">Qty</th><th scope="col">Line</th></tr></thead>
          <tbody>${res.captured.map(rowHtml).join('')}</tbody>
        </table>` : ''}
      ${res.failed.length ? `
        <div class="t-title-sm">Failed</div>
        <table class="tbl">
          <thead><tr><th scope="col">Source</th><th scope="col">Reference</th><th scope="col">Encounter</th><th scope="col">Charge</th><th scope="col">Why</th></tr></thead>
          <tbody>${res.failed.map((ev) => `
            <tr>
              <td><span class="badge badge--info">${esc(ev.type)}</span></td>
              <td class="t-mono-sm">${esc(ev.ref)}</td>
              <td class="t-mono-sm">${esc(ev.encounterNo)}</td>
              <td>${esc(itemLabel(ev))}</td>
              <td><span class="badge badge--critical" title="${esc(ev.error)}">${esc(ev.error)}</span></td>
            </tr>`).join('')}</tbody>
        </table>` : ''}`,
    foot: `
      <a class="btn btn--secondary" href="#/claima/charges/health" data-close>Capture health</a>
      <button class="btn btn--primary" data-close>Done</button>`,
  });
  return dialog.closed;
}

function rowHtml(ev) {
  return `
    <tr>
      <td><span class="badge badge--info" title="${esc(ev.trigger)}">${esc(ev.type)}</span></td>
      <td class="t-mono-sm">${esc(ev.ref)}</td>
      <td class="t-mono-sm">${esc(ev.encounterNo)}</td>
      <td>${esc(itemLabel(ev))}</td>
      <td class="num t-mono-sm">${esc(ev.qty)}</td>
      <td class="t-mono-sm">${esc(ev.capturedLineId)}</td>
    </tr>`;
}

function itemLabel(ev) {
  const item = cdm.get(ev.itemId);
  return item ? `${item.chargeCode} — ${cdm.label(item)} · ${usd(item.standardPrice)}` : ev.itemId;
}
