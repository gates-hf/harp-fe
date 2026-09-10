// The services table on the request page: what was asked for, what came back,
// and — once there is an approval — what is left of it.
//
// The Remaining column is the point. An approval is not a permission slip, it
// is a quantity: two nights, eight sessions, one scan. Billing spends it, and a
// desk looking at a request a fortnight later needs to know whether there is
// anything on it, which is the same question `activeFor` answers.

import * as preauth from '../../../../data/repositories/preauth-requests.js';
import { esc, usd } from '../../../../shared/format.js';

export function servicesTableHtml(row) {
  const answered = Boolean(row.decision) && row.status !== 'Denied';
  const showRemaining = preauth.isAuthorized(row) || row.status === 'Expired';
  return `
    <div class="toolbar">
      <span class="t-title-sm">Services</span>
      <span class="spacer"></span>
      <span class="t-body-sm">asked ${usd(preauth.requestedTotal(row))}${
        answered ? ` · approved ${usd(preauth.approvedTotal(row))}` : ''}</span>
    </div>
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Service</th>
          <th scope="col" class="num">Requested</th>
          <th scope="col" class="num">Approved</th>
          ${showRemaining ? '<th scope="col" class="num">Remaining</th>' : ''}
          <th scope="col">Line decision</th>
          <th scope="col">Reason</th>
        </tr>
      </thead>
      <tbody>
        ${row.services.map((service) => rowHtml(row, service, answered, showRemaining)).join('')}
      </tbody>
    </table>
    ${showRemaining ? `<p class="t-body-sm">Remaining is what the payer allowed less what has been billed against
      it. A line with nothing left stops answering the pre-auth flag, and the charge needs a fresh request.</p>` : ''}`;
}

function rowHtml(row, service, answered, showRemaining) {
  const remaining = preauth.remainingFor(row, service.itemId);
  const used = preauth.usedFor(row, service.itemId);
  const denied = service.lineDecision === 'Denied';
  const cut = answered && !denied && service.approvedQty !== null && service.approvedQty < service.qty;
  return `
    <tr>
      <td>${esc(preauth.serviceLabel(service))}</td>
      <td class="num t-mono-sm">${service.qty} · ${usd(service.requestedAmount)}</td>
      <td class="num t-mono-sm">${answered && service.approvedQty !== null
        ? `${service.approvedQty} · ${usd(service.approvedAmount)}`
        : '<span class="t-body-sm">—</span>'}</td>
      ${showRemaining
        ? `<td class="num t-mono-sm">${denied ? '<span class="t-body-sm">—</span>'
          : `${remaining}${used ? `<br><span class="t-body-sm">${used} used</span>` : ''}`}</td>`
        : ''}
      <td>${service.lineDecision
        ? `<span class="badge${denied ? ' badge--critical' : cut ? ' badge--warning' : ' badge--success'}">
             <span class="dot"></span>${esc(cut ? 'Reduced' : service.lineDecision)}</span>`
        : '<span class="t-body-sm">not answered</span>'}</td>
      <td>${service.lineReason
        ? `<span class="t-body-sm">${esc(service.lineReason)}</span>`
        : '<span class="t-body-sm">—</span>'}</td>
    </tr>`;
}
