// The Nullify dialog's markup — the form for an allowed path and the routing
// card for a blocked one — split from nullify-dialog.js so each file stays
// near the line cap. Every conditional block is a plain wrapper carrying
// `hidden`: a .field or a .toolbar sets its own display and would outrank
// the attribute.

import * as nullifications from '../../../../data/repositories/nullifications.js';
import * as charges from '../../../../data/repositories/charges.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { esc, usd } from '../../../../shared/format.js';

export function formHtml({ claim, resolved, lines, value, needsApprover, approvers, reclass, role, threshold }) {
  const path = resolved.path;
  return `
    ${pathBanner(resolved, claim)}
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">rule</span>
        <select id="nd-reason" aria-label="Reason">
          <option value="">Reason…</option>
          ${nullifications.NULLIFICATION_REASONS.map((r) => `<option value="${esc(r.code)}">${esc(r.code)} — ${esc(r.label)}</option>`).join('')}
        </select>
      </label>
    </div>
    <p class="t-body-sm" id="nd-reason-hint"></p>
    <div id="nd-reason-text" hidden>
      <label class="field">
        <span class="icon icon--sm">edit_note</span>
        <input id="nd-reason-text-input" placeholder="The reason, in words" aria-label="Reason text" maxlength="160">
      </label>
    </div>
    <label class="field field--area">
      <span class="icon icon--sm">notes</span>
      <textarea id="nd-justification" rows="3" placeholder="Justification — what the log will say about this withdrawal" aria-label="Justification" maxlength="600"></textarea>
    </label>

    ${path === 'PayerNotified' ? notificationHtml() : ''}

    <div class="toolbar">
      <span class="t-title-sm">Charge lines</span>
      <span class="badge">${lines.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${lines.length ? `${esc(usd(lines.reduce((n, l) => n + (Number(l.pricing?.allowed) || 0), 0)))} allowed` : 'none captured'}</span>
    </div>
    ${lines.length ? linesHtml(lines) : '<p class="t-body-sm">No captured charge lines are linked to this claim — a generated claim carries none — so nothing returns to the pool.</p>'}
    <div class="toolbar">
      <label class="field">
        <span class="icon icon--sm">undo</span>
        <select id="nd-disposition" aria-label="Disposition"${lines.length ? '' : ' title="No lines to return — recorded for the log"'}>
          ${nullifications.DISPOSITIONS.map((d) => `<option value="${esc(d)}">${esc(nullifications.DISPOSITION_LABELS[d])}</option>`).join('')}
        </select>
      </label>
      <div id="nd-hold" hidden>
        <label class="field">
          <span class="icon icon--sm">pause_circle</span>
          <select id="nd-hold-reason" aria-label="Hold reason">
            ${charges.HOLD_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
        </label>
      </div>
    </div>

    <div class="toolbar">
      <span class="t-title-sm">Replacement</span>
      <span class="segmented" role="group" aria-label="Assemble a replacement">
        <button type="button" data-replace="yes" aria-pressed="false">Assemble fresh</button>
        <button type="button" data-replace="no" aria-pressed="true">No replacement</button>
      </span>
    </div>
    <p class="t-body-sm" id="nd-replace-why"></p>
    <div id="nd-reclass" hidden>
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">swap_horiz</span>
          <select id="nd-reclass-policy" aria-label="Re-classify the visit to">
            <option value="">Re-classify the visit to…</option>
            ${reclass.map((o) => `<option value="${o.policyId === null ? 'self-pay' : esc(o.policyId)}">${esc(o.label)}</option>`).join('')}
          </select>
        </label>
      </div>
      ${reclass.length <= 1 ? '<p class="t-body-sm">The patient has no other active cover on file — add one on the Insurance tab first, or re-classify to Self-Pay.</p>' : ''}
    </div>

    ${needsApprover ? approverHtml(value, threshold, approvers, role) : `<p class="t-body-sm">${esc(usd(value))} is under the ${esc(usd(threshold))} threshold — your signature is enough.</p>`}
    <div id="nd-error"></div>`;
}

function pathBanner(resolved, claim) {
  const tone = resolved.path === 'EndChain' ? 'warning' : 'info';
  const icon = resolved.path === 'Direct' ? 'block' : resolved.path === 'PayerNotified' ? 'outgoing_mail' : 'stop_circle';
  return `
    <div class="alert alert--${tone}">
      <span class="icon">${icon}</span>
      <div><div class="title">${esc(nullifications.PATH_LABELS[resolved.path])} path</div>${esc(resolved.note)}${
        resolved.batch ? ` <a class="crumb-link t-mono-sm" href="#/claima/submission/${esc(resolved.batch.batchNo)}">${esc(resolved.batch.batchNo)}</a>` : ''}${
        claims_stale(claim)}</div>
    </div>`;
}

const claims_stale = (claim) => (claim?.stale?.flag ? ` Stale: ${esc(claim.stale.reason)}.` : '');

function notificationHtml() {
  return `
    <div class="toolbar">
      <span class="t-title-sm">Payer notification</span>
      <span class="spacer"></span>
      <span class="t-body-sm">The payer holds this claim — record how it was told the claim is withdrawn.</span>
    </div>
    <div class="toolbar">
      <label class="field">
        <span class="icon icon--sm">contact_phone</span>
        <select id="nd-method" aria-label="Method">
          ${nullifications.NOTIFICATION_METHODS.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
        </select>
      </label>
      <label class="field field--grow">
        <span class="icon icon--sm">tag</span>
        <input id="nd-reference" placeholder="Reference — portal ticket, email subject, call note" aria-label="Reference" maxlength="80">
      </label>
      <label class="field">
        <span class="icon icon--sm">event</span>
        <input type="date" id="nd-date" aria-label="Notified on">
      </label>
    </div>
    <label class="field">
      <span class="icon icon--sm">sticky_note_2</span>
      <input id="nd-note" placeholder="Note (optional) — who took it, what they said" aria-label="Note" maxlength="200">
    </label>`;
}

function linesHtml(lines) {
  return `
    <table class="tbl">
      <thead>
        <tr><th scope="col">Line</th><th scope="col">Charge</th><th scope="col">Qty</th><th scope="col">Allowed</th><th scope="col">Now</th></tr>
      </thead>
      <tbody>
        ${lines.map((l) => {
    const item = cdm.get(l.itemId);
    const tone = charges.statusTone(l.status);
    return `
        <tr>
          <td><span class="t-mono-sm">${esc(l.id)}</span></td>
          <td><span class="t-mono-sm">${esc(item?.chargeCode || l.itemId)}</span> ${esc(cdm.label(item) || '')}</td>
          <td>${esc(l.qty)}</td>
          <td><span class="t-mono-sm">${esc(usd(l.pricing?.allowed))}</span></td>
          <td><span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(l.status)}</span></td>
        </tr>`;
  }).join('')}
      </tbody>
    </table>`;
}

function approverHtml(value, threshold, approvers, role) {
  return `
    <div class="alert alert--warning">
      <span class="icon">verified_user</span>
      <div><div class="title">Second approver required</div>
        This claim bills ${esc(usd(value))}, at or above the ${esc(usd(threshold))} threshold — somebody other than ${esc(role.name)} signs it as well.</div>
    </div>
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">person</span>
        <select id="nd-approver" aria-label="Second approver">
          <option value="">Second approver…</option>
          ${approvers.map((r) => `<option value="${esc(r.name)}">${esc(r.name)} — ${esc(r.title)}</option>`).join('')}
        </select>
      </label>
    </div>`;
}

/** The blocked-path card: what stands in the way and the screen that clears it. */
export function routingHtml(claim, resolved) {
  return `
    <div class="alert alert--warning">
      <span class="icon">alt_route</span>
      <div><div class="title">${esc(claim.status)} — undo it where it happened first</div>${esc(resolved.why)}</div>
    </div>
    <dl class="dl dl--narrow">
      <dt>Claim</dt><dd class="t-mono-sm">${esc(claim.claimNo)}</dd>
      <dt>Status</dt><dd>${esc(claim.status)}</dd>
      ${claim.remittanceId ? `<dt>Remittance</dt><dd><a class="crumb-link t-mono-sm" href="#/claima/remittances/${esc(claim.remittanceId)}">${esc(claim.remittanceId)}</a></dd>` : ''}
      <dt>Then</dt><dd>${esc(claim.status === 'Denied' || claim.status === 'Appealed'
    ? 'Work the denial — an appeal, a correction and resubmission, or a write-off closes it. A denied claim is not nullified around its denial.'
    : `Once the posting is reversed the claim reads ${claim.statusBeforeRemittance || 'Acknowledged'} again and Nullify opens the payer-notified path, with a replacement assembled from the visit if you ask for one.`)}</dd>
    </dl>`;
}
