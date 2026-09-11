// The Disputes tab of the TPA ledger: every dispute, open first, with the
// administrator, the accruals it holds, the overcharge, the status flow
// (Raised → Acknowledged → Settled or Written off), the settlement and the
// write-off request it raised, and the evidence frozen when it was raised
// in a collapsible under each row. Acknowledge, Settle and Write off on each
// open row; the dialogs write through data/repositories/tpa-disputes.js.

import * as disputes from '../../../../data/repositories/tpa-disputes.js';
import * as tpas from '../../../../data/repositories/tpas.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { openAcknowledgeDialog, openSettleDialog, openWriteOffDialog } from './tpa-dialogs.js';
import { disputeStatusHtml } from './tpa-chips.js';
import { historyHtml } from './tpa-history.js';

export function render(host, { state, openAccrual }) {
  host.innerHTML = `
    <div class="toolbar">
      <label class="field field--grow"><span class="icon icon--sm">search</span><input type="search" id="tdp-search" placeholder="Search dispute, accrual, claim, reference or administrator" aria-label="Search disputes"></label>
      <label class="field"><span class="icon icon--sm">apartment</span><select id="tdp-tpa" aria-label="Administrator"><option value="">Any administrator</option>${tpas.all().map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="icon icon--sm">filter_list</span><select id="tdp-status" aria-label="Status"><option value="">Any status</option>${disputes.STATUSES.map((s) => `<option value="${s}">${esc(disputes.statusLabel(s))}</option>`).join('')}</select></label>
      <span class="spacer"></span>
      <button class="btn btn--ghost btn--sm" data-act="clear">Clear filters</button>
    </div>
    <div id="tdp-body"></div>`;
  const $ = (sel) => host.querySelector(sel);
  const fields = { q: $('#tdp-search'), tpaId: $('#tdp-tpa'), status: $('#tdp-status') };
  const syncFilters = () => { for (const [key, el] of Object.entries(fields)) el.value = state[key] || ''; };

  function drawBody() {
    const rows = disputes.search(state.q, state);
    const body = $('#tdp-body');
    if (!rows.length) {
      body.innerHTML = `
        <div class="state-view">
          <div class="state-view__glyph"><span class="icon">${state.q || state.tpaId || state.status ? 'search_off' : 'task_alt'}</span></div>
          <div class="state-view__title">${state.q || state.tpaId || state.status ? 'Nothing matches' : 'No disputes on file'}</div>
          <p class="state-view__body">${state.q || state.tpaId || state.status ? 'No dispute matches these filters.' : 'An overcharged accrual is disputed from the Accruals tab — tick the rows and dispute the selection, or Dispute on a row.'}</p>
        </div>`;
      return;
    }
    body.innerHTML = `
      <table class="tbl">
        <thead><tr><th>Dispute</th><th>Administrator</th><th>Accruals</th><th title="The overcharge raised — frozen as it was computed">Overcharge</th><th>Status</th><th>Raised</th><th>Settlement</th><th>Actions</th></tr></thead>
        <tbody>${rows.map((d) => rowHtml(d, state.focus === d.id)).join('')}</tbody>
      </table>`;
    if (state.focus) { body.querySelector(`[data-evidence="${state.focus}"]`)?.setAttribute('open', ''); state.focus = ''; }
  }

  for (const [key, el] of Object.entries(fields)) el.addEventListener(key === 'q' ? 'input' : 'change', () => { state[key] = el.value; drawBody(); });

  host.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    const { act, id } = btn.dataset;
    if (act === 'clear') { Object.assign(state, { q: '', tpaId: '', status: '' }); syncFilters(); return drawBody(); }
    if (act === 'acknowledge') return void (await openAcknowledgeDialog(id));
    if (act === 'settle') return void (await openSettleDialog(id));
    if (act === 'writeoff') return void (await openWriteOffDialog(id));
    if (act === 'accrual') return openAccrual(id);
    return undefined;
  });

  syncFilters();
  drawBody();
  return { redraw: drawBody, syncFilters };
}

function rowHtml(d, focus) {
  const isOpen = disputes.isOpen(d);
  const s = d.settlement;
  return `
    <tr data-id="${esc(d.id)}">
      <td><span class="t-mono-sm">${esc(d.id)}</span>${d.acknowledgment ? `<br><span class="t-body-sm" title="The administrator’s reference">${esc(d.acknowledgment.ref)}</span>` : ''}</td>
      <td>${esc(tpas.nameOf(d.tpaId))}</td>
      <td>${d.accrualIds.map((id) => `<button class="btn btn--ghost btn--sm" data-act="accrual" data-id="${esc(id)}" title="Open the accrual">${esc(id)}</button>`).join(' ')}</td>
      <td><span class="t-mono-sm">${esc(usd(d.totalOvercharge))}</span></td>
      <td>${disputeStatusHtml(d)}</td>
      <td class="t-body-sm">${esc(date(d.createdAt))}<br>${esc(d.createdBy || '')}</td>
      <td>${s ? `<span class="t-mono-sm">${esc(usd(s.recovered))}</span> <span class="t-body-sm">recovered ${esc(date(s.at))}</span>${s.remainder ? `<br><span class="t-body-sm">${esc(usd(s.remainder))} ${s.how === 'writeOff' ? `to <a class="crumb-link t-mono-sm" href="#/claima/writeoffs/${esc(d.writeOffRequestRef || '')}">${esc(d.writeOffRequestRef || 'a write-off request')}</a>` : 'accepted'}</span>` : ''}` : '<span class="t-body-sm">—</span>'}</td>
      <td>
        ${isOpen ? `
          ${d.status === 'Raised' ? `<button class="btn btn--secondary btn--sm" data-act="acknowledge" data-id="${esc(d.id)}" title="Record the administrator’s reference"><span class="icon icon--sm">mark_email_read</span>Acknowledge</button>` : ''}
          <button class="btn btn--primary btn--sm" data-act="settle" data-id="${esc(d.id)}" title="What came back, and what happens to the remainder"><span class="icon icon--sm">handshake</span>Settle</button>
          <button class="btn btn--ghost btn--sm" data-act="writeoff" data-id="${esc(d.id)}" title="Nothing came back — the whole overcharge to a write-off request"><span class="icon icon--sm">money_off</span>Write off</button>`
    : '<span class="t-body-sm">Closed</span>'}
      </td>
    </tr>
    <tr>
      <td colspan="8">
        <details data-evidence="${esc(d.id)}"${focus ? ' open' : ''}>
          <summary class="t-body-sm">Evidence and trail${d.note ? ` — ${esc(d.note)}` : ''}</summary>
          <table class="tbl">
            <thead><tr><th>Accrual</th><th>Claim</th><th>Remittance</th><th>Actual</th><th>Expected</th><th>Version</th><th>Overcharge</th></tr></thead>
            <tbody>${d.evidence.computedRefs.map((r) => `<tr><td class="t-mono-sm">${esc(r.accrualId)}</td><td class="t-mono-sm">${esc(r.claimNo || '—')}</td><td class="t-body-sm">${esc(r.remittanceRef || 'no record')} · ${esc(date(r.remittanceDate))}</td><td class="t-mono-sm">${esc(usd(r.actual))}</td><td class="t-mono-sm">${r.expected == null ? '—' : esc(usd(r.expected))}${r.rate != null ? ` <span class="t-body-sm">${esc(String(r.rate))}%</span>` : ''}</td><td class="t-mono-sm">${esc(r.versionRef || '—')}</td><td class="t-mono-sm">${esc(usd(r.overcharge))}</td></tr>`).join('')}</tbody>
          </table>
          ${(d.evidence.amendmentRefs || []).length ? `<p class="t-body-sm">Restated after it was raised by ${d.evidence.amendmentRefs.map((a) => `<a class="crumb-link t-mono-sm" href="#/defensio/tpa/amendments/${esc(a.amendmentId)}">${esc(a.amendmentId)}</a> (${esc(dateTime(a.at))})`).join(', ')} — the disputed figure stays what it was raised on.</p>` : ''}
          ${historyHtml(disputes.history(d.id))}
        </details>
      </td>
    </tr>`;
}
