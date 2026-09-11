// The four step bodies of the TPA amendment flow — markup only, the screen
// owns the state and the listeners: the header form (administrator, payer,
// closed period, reason, the version to restate and the restated figures,
// the document), the computed impact with its totals, the tiered review
// with the signature gate, and the posting with its correction records.

import * as amendments from '../../../../data/repositories/tpa-amendments.js';
import * as schedules from '../../../../data/repositories/tpa-fee-schedules.js';
import * as tpas from '../../../../data/repositories/tpas.js';
import { date, dateTime, esc, todayIso, usd } from '../../../../shared/format.js';

const opt = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

/** Step 1 — the header. `h` is the draft on screen (a row, or the query's prefill for a new one). */
export function headerHtml(h, { editable }) {
  const links = h.tpaId ? tpas.linksOf(h.tpaId) : [];
  const versions = h.tpaId && h.payerId ? amendments.restatableVersions(h.tpaId, h.payerId, h.period || {}) : [];
  const base = h.supersedesRef ? schedules.versionByRef(h.supersedesRef) : null;
  const r = h.restatement || (base ? { basis: base.basis, rate: base.rate, scopes: base.scopes, capPerClaim: base.capPerClaim, capPerPeriod: base.capPerPeriod } : { basis: 'pctPaid', rate: 3, scopes: [], capPerClaim: null, capPerPeriod: null });
  const dis = editable ? '' : ' disabled';
  const lab = (r.scopes || []).find((s) => s.level === 'serviceGroup');
  return `
    <div class="toolbar">
      <label class="field"><span class="icon icon--sm">apartment</span><select id="ah-tpa" aria-label="Administrator"${dis}>${opt('', 'Pick the administrator…', !h.tpaId)}${tpas.all().map((t) => opt(t.id, t.name, t.id === h.tpaId)).join('')}</select></label>
      <label class="field"><span class="icon icon--sm">account_balance</span><select id="ah-payer" aria-label="Payer"${dis || (!links.length ? ' disabled' : '')}>${opt('', links.length ? 'Pick the payer…' : 'Link a payer first', !h.payerId)}${links.map((l) => opt(l.payerId, l.payer, l.payerId === h.payerId)).join('')}</select></label>
    </div>
    <div class="toolbar">
      <label class="field"><span class="icon icon--sm">event</span><input id="ah-from" type="date" value="${esc(h.period?.from || '')}" aria-label="Period from"${dis}></label>
      <label class="field"><span class="icon icon--sm">event</span><input id="ah-to" type="date" value="${esc(h.period?.to || '')}" max="${esc(dayBefore(todayIso()))}" aria-label="Period to"${dis}></label>
      <span class="t-body-sm">a closed period — the end is before today</span>
    </div>
    <div class="toolbar">
      <label class="field"><span class="icon icon--sm">help</span><select id="ah-reason" aria-label="Reason"${dis}>${amendments.REASONS.map((x) => opt(x.code, `${x.label} — ${x.hint}`, x.code === h.reason?.code)).join('')}</select></label>
    </div>
    <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="ah-reason-text" rows="2" placeholder="What happened, in the words the signer will read" aria-label="Reason text"${dis}>${esc(h.reason?.text || '')}</textarea></label>
    <div class="toolbar">
      <span class="t-title-sm">Restated version</span>
      <label class="field"><span class="icon icon--sm">history</span><select id="ah-supersedes" aria-label="Version to restate"${dis}>${opt('', 'No version covers the period — add one', !h.supersedesRef)}${versions.map((v) => opt(v.ref, `${schedules.versionLabel(v)} · ${v.effectiveFrom} → ${v.effectiveTo || 'open'}`, v.ref === h.supersedesRef)).join('')}</select></label>
    </div>
    <div class="toolbar">
      <label class="field"><span class="icon icon--sm">functions</span><select id="ah-basis" aria-label="Basis"${dis}>${schedules.BASES.map((b) => opt(b, schedules.basisLabel(b), b === r.basis)).join('')}</select></label>
      <label class="field"><span class="icon icon--sm">percent</span><input id="ah-rate" type="number" min="0" step="0.01" value="${esc(String(r.rate ?? ''))}" aria-label="Rate"${dis}></label>
      <label class="field"><span class="icon icon--sm">category</span><select id="ah-lab-group" aria-label="Group rate for"${dis}>${opt('', 'No group rate', !lab)}${schedules.SERVICE_GROUPS.map((g) => opt(g, g, g === lab?.ref)).join('')}</select></label>
      <label class="field"><span class="icon icon--sm">percent</span><input id="ah-lab-rate" type="number" min="0" step="0.01" value="${esc(lab?.rate != null ? String(lab.rate) : '')}" placeholder="Group rate" aria-label="Group rate"${dis}></label>
    </div>
    <div class="toolbar">
      <label class="field"><span class="icon icon--sm">vertical_align_top</span><input id="ah-cap-claim" type="number" min="0" step="0.01" value="${esc(r.capPerClaim ?? '')}" placeholder="Cap per claim" aria-label="Cap per claim"${dis}></label>
      <label class="field"><span class="icon icon--sm">date_range</span><input id="ah-cap-period" type="number" min="0" step="0.01" value="${esc(r.capPerPeriod ?? '')}" placeholder="Cap per month" aria-label="Cap per month"${dis}></label>
      <label class="field field--grow"><span class="icon icon--sm">attach_file</span><input id="ah-doc" value="${esc(h.documentRef?.fileName || '')}" placeholder="Document on file — the letter, the addendum" aria-label="Document"${dis}></label>
    </div>
    <div id="ah-errors"></div>`;
}

/** Read the header form back into the shape the repository takes. */
export function readHeader(root) {
  const $ = (sel) => root.querySelector(sel);
  const group = $('#ah-lab-group').value;
  return {
    tpaId: $('#ah-tpa').value, payerId: $('#ah-payer').value,
    period: { from: $('#ah-from').value, to: $('#ah-to').value },
    reason: { code: $('#ah-reason').value, text: $('#ah-reason-text').value },
    supersedesRef: $('#ah-supersedes').value || null,
    restatement: {
      basis: $('#ah-basis').value, rate: $('#ah-rate').value, scopes: group ? [{ level: 'serviceGroup', ref: group, rate: $('#ah-lab-rate').value }] : [],
      capPerClaim: $('#ah-cap-claim').value === '' ? null : $('#ah-cap-claim').value, capPerPeriod: $('#ah-cap-period').value === '' ? null : $('#ah-cap-period').value,
    },
    documentRef: $('#ah-doc').value.trim() ? { fileName: $('#ah-doc').value.trim(), size: 0 } : null,
  };
}

/** Step 2 — the impact list with its totals. */
export function impactHtml(row) {
  const t = row.totals;
  if (!row.impact?.length) return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">calculate</span></div>
      <div class="state-view__title">Nothing in the period</div>
      <p class="state-view__body">No accrual of ${esc(tpas.nameOf(row.tpaId))} on ${esc(amendments.payerName(row))} carries a remittance date between ${esc(date(row.period.from))} and ${esc(date(row.period.to))} — there is nothing to restate.</p>
    </div>`;
  return `
    <div class="metric-rail metric-rail--3">
      <div class="metric-rail-card"><span class="metric-rail-card__value">${esc(String(t.accruals))}</span><span class="metric-rail-card__label">Accruals in period</span><span class="metric-rail-card__sub">${esc(String(t.changed))} moved</span></div>
      <div class="metric-rail-card"><span class="metric-rail-card__value">${esc(usd(t.newExpected))}</span><span class="metric-rail-card__label">Expected after</span><span class="metric-rail-card__sub">was ${esc(usd(t.oldExpected))}</span></div>
      <div class="metric-rail-card${t.correction ? ' metric-rail-card--warning' : ''}"><span class="metric-rail-card__value">${esc(usd(t.correction))}</span><span class="metric-rail-card__label">Net correction</span><span class="metric-rail-card__sub">${t.correction > 0 ? 'owed back by the administrator' : t.correction < 0 ? 'owed to the administrator' : 'nothing to post'} · ${esc(amendments.tierLabel(t.tier))}</span></div>
    </div>
    <table class="tbl">
      <thead><tr><th>Accrual</th><th>Claim</th><th>Remittance</th><th>Actual</th><th>Expected before</th><th>Expected after</th><th>State</th><th title="Agreed before less agreed after — positive is money the administrator owes back">Correction</th></tr></thead>
      <tbody>${row.impact.map((r) => `
        <tr>
          <td><a class="crumb-link t-mono-sm" href="#/defensio/tpa/accruals/${esc(r.accrualId)}">${esc(r.accrualId)}</a></td>
          <td class="t-mono-sm">${esc(r.claimNo || '—')}</td>
          <td class="t-body-sm">${esc(date(r.remittanceDate))}</td>
          <td class="t-mono-sm">${esc(usd(r.actual))}</td>
          <td class="t-mono-sm">${r.oldExpected == null ? '—' : esc(usd(r.oldExpected))}</td>
          <td class="t-mono-sm">${r.newExpected == null ? '—' : esc(usd(r.newExpected))}</td>
          <td><span class="badge">${esc(r.oldState)}</span> → <span class="badge${r.changed ? ' badge--accent' : ''}">${esc(r.newState)}</span></td>
          <td><span class="badge${r.correction > 0 ? ' badge--warning' : r.correction < 0 ? ' badge--info' : ''}">${esc(usd(r.correction))}</span></td>
        </tr>`).join('')}</tbody>
    </table>`;
}

/** Step 3 — the tiered review. */
export function reviewHtml(row, role) {
  const a = row.approval;
  const gate = amendments.canApprove(row, role);
  const def = a ? amendments.tierDef(a.tier) : null;
  return `
    <dl class="dl dl--narrow">
      <dt>Tier</dt><dd>${a ? `${esc(amendments.tierLabel(a.tier))}<br><span class="t-body-sm">a role holding ${esc(def?.role || '')} signs — the write-off tiers, read from the config</span>` : '<span class="t-body-sm">Set when the amendment is sent for review</span>'}</dd>
      <dt>Requested by</dt><dd>${a ? `${esc(a.requestedBy)}<br><span class="t-body-sm">${esc(dateTime(a.requestedAt))} — never signs their own amendment</span>` : '<span class="t-body-sm">—</span>'}</dd>
      <dt>Decision</dt><dd>${a?.decision ? `<span class="badge badge--${a.decision === 'Approved' ? 'success' : 'critical'}">${esc(a.decision)}</span> ${esc(a.approvedBy || '')}<br><span class="t-body-sm">${esc(dateTime(a.approvedAt))}${a.note ? ` — ${esc(a.note)}` : ''}</span>` : row.status === 'InReview' ? '<span class="badge badge--warning">Waiting for a signature</span>' : '<span class="t-body-sm">Not yet sent</span>'}</dd>
    </dl>
    ${row.status === 'InReview' ? `
    <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="ar-note" rows="2" placeholder="A note for the record — required on a refusal" aria-label="Review note"></textarea></label>
    <div class="toolbar">
      <span class="t-body-sm">${esc(gate.ok ? `${role.name} may sign at this tier` : gate.why)}</span>
      <span class="spacer"></span>
      <button class="btn btn--secondary" data-act="reject"${gate.ok ? '' : ' disabled'} title="${esc(gate.ok ? 'Refuse the restatement — its version is dropped' : gate.why)}"><span class="icon icon--sm">block</span>Reject</button>
      <button class="btn btn--primary" data-act="approve"${gate.ok ? '' : ' disabled'} title="${esc(gate.ok ? 'Sign the restatement' : gate.why)}"><span class="icon icon--sm">task_alt</span>Approve</button>
    </div>
    <div id="ar-errors"></div>` : ''}`;
}

/** Step 4 — the posting. */
export function postHtml(row) {
  const refs = row.postingRefs || [];
  if (row.status !== 'Posted') return `
    <p class="t-body-sm">Posting makes ${esc(row.restatedVersionRef)} the version in force on its term, freezes each changed accrual with its pre-amendment figures, tells the disputes holding them, and records a correction per changed accrual. Claima publishes no creator that reposts a remittance at a different amount, so each correction is kept here as a pending-integration record with a reconciliation line on the claim's trail.</p>
    ${row.status === 'Approved' ? `<div class="toolbar"><span class="spacer"></span><button class="btn btn--primary" data-act="post"><span class="icon icon--sm">publish</span>Post amendment</button></div>` : `<div class="alert alert--info"><span class="icon">info</span><div>${esc(row.status === 'Rejected' ? 'Refused — nothing is posted.' : 'Posting waits on the signature.')}</div></div>`}`;
  return `
    <dl class="dl dl--narrow">
      <dt>Posted</dt><dd>${esc(row.postedBy || '')}<br><span class="t-body-sm">${esc(dateTime(row.postedAt))}</span></dd>
      <dt>Version</dt><dd><span class="t-mono-sm">${esc(row.restatedVersionRef)}</span> <span class="t-body-sm">in force on its term — ${esc(schedules.describe(schedules.versionByRef(row.restatedVersionRef)))}</span></dd>
      <dt>Corrections</dt><dd>${refs.length ? `${refs.length} record${refs.length === 1 ? '' : 's'} · ${esc(usd(row.totals?.correction || 0))} net` : 'None — nothing moved past the tolerance'}</dd>
    </dl>
    ${refs.length ? `
    <table class="tbl">
      <thead><tr><th>Record</th><th>Accrual</th><th>Claim</th><th>Amount</th><th>Direction</th><th>Posting</th></tr></thead>
      <tbody>${refs.map((p) => `
        <tr>
          <td class="t-mono-sm">${esc(p.id)}</td>
          <td><a class="crumb-link t-mono-sm" href="#/defensio/tpa/accruals/${esc(p.accrualId)}">${esc(p.accrualId)}</a></td>
          <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(p.claimNo || '')}/history">${esc(p.claimNo || '—')}</a></td>
          <td class="t-mono-sm">${esc(usd(Math.abs(p.amount)))}</td>
          <td class="t-body-sm">${esc(p.direction)}</td>
          <td><span class="badge badge--warning" title="Claima publishes no correction creator for a posted remittance; the record waits for one">Pending integration</span></td>
        </tr>`).join('')}</tbody>
    </table>` : ''}`;
}

function dayBefore(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
