// The nullification record at #/claima/nullifications/<no>: the whole record
// as it was written, the family strip with the nullified claim and its
// replacement side by side, the charge round trip — each line the claim
// handed back, where it is now, and the pool it is read in — and an excerpt
// of the two claims' timelines around the withdrawal. Read-only: a
// nullification is never edited, so the page has no actions beyond links.

import * as nullifications from '../../../../data/repositories/nullifications.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as charges from '../../../../data/repositories/charges.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as lifecycle from '../../../../data/engines/claim-events.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { coverLabel, kindHtml, statusHtml } from '../claims-assembly/claim-chips.js';
import {
  actorsHtml, dispositionHtml, notificationHtml, pathHtml, payerName, reasonHtml, replacementHtml, statusAtHtml, valueHtml,
} from './nullification-chips.js';

export const meta = { title: 'Nullification' };

const EXCERPT = 6;

export async function render(mount, ctx) {
  await nullifications.ready;
  const record0 = nullifications.get(ctx.params[0]);
  if (!record0) throw new Error(`No nullification ${ctx.params[0]}`);
  const no = record0.no;

  const res = await fetch(new URL('./nullification-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load nullification-view.html (${res.status})`);
  mount.innerHTML = await res.text();
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const n = nullifications.get(no);
    if (!n) return;
    const patient = patients.view(patients.get(n.patientMrn), role);
    const claim = claims.get(n.claimNo);
    const replacement = n.replacement?.claimNo ? claims.get(n.replacement.claimNo) : null;

    ctx.setHeader(`${n.no} — ${n.claimNo}`);
    ctx.setCrumb([
      { label: 'Claima', path: '/claima/nullifications' },
      { label: 'Nullifications', path: '/claima/nullifications' },
      { label: n.no },
    ]);

    $('#nv-no').textContent = n.no;
    $('#nv-meta').innerHTML = `
      <span class="t-mono-sm">${esc(n.no)}</span>
      ${pathHtml(n)}
      ${statusAtHtml(n)}
      <span>·</span>
      <a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(n.claimNo)}">${esc(n.claimNo)}</a>
      <span>·</span>
      <span>${patient?.masked ? 'cover withheld' : esc(payerName(n.payerId))}</span>
      <span>·</span>
      <span class="t-body-sm">${patient?.masked ? 'value withheld' : esc(usd(n.valueAtNullification))} · ${dateTime(n.at)}</span>`;
    $('#nv-actions').innerHTML = `<span class="badge" title="A nullification is never edited or removed"><span class="icon icon--sm">lock</span>Immutable</span>`;
    $('#nv-claim').href = `#/claima/claims/${n.claimNo}`;
    $('#nv-pool').href = n.encounterNo ? `#/claima/charges?encounter=${n.encounterNo}` : '#/claima/charges';
    $('#nv-timeline').href = `#/claima/timeline/${n.claimNo}`;

    // The record names the payer, the plan and the money: withheld on a
    // restricted record for the reason the claim page withholds its own.
    if (patient?.masked) {
      $('#nv-banners').innerHTML = '';
      $('#nv-summary').innerHTML = maskedHtml(role);
      $('#nv-family').innerHTML = '';
      $('#nv-lines').innerHTML = '';
      $('#nv-lines-count').textContent = '';
      $('#nv-events').innerHTML = '';
      return;
    }

    $('#nv-banners').innerHTML = bannersHtml(n, replacement);
    $('#nv-summary').innerHTML = summaryHtml(n, patient, claim);
    $('#nv-family').innerHTML = familyHtml(n, claim, replacement);
    $('#nv-lines-count').textContent = String((n.lines || []).length);
    $('#nv-lines').innerHTML = linesHtml(n);
    $('#nv-events').innerHTML = eventsHtml(n, replacement);
  }

  function bannersHtml(n, replacement) {
    const out = [];
    if (n.chainEnded) {
      out.push(alertHtml('warning', 'block', 'Chain ended',
        `${n.claimNo} was rejected on cycle ${claims.cycleOf(claims.get(n.claimNo))} and not resubmitted. No further cycle is opened and the balance is the write-off review’s.`));
    }
    if (n.reclassification) {
      out.push(alertHtml('info', 'swap_horiz', 'Visit re-classified',
        `${n.encounterNo} was moved from ${n.reclassification.from.label} to ${n.reclassification.to.label} before anything was assembled.${
          replacement ? ` ${replacement.claimNo} was assembled against the new cover.` : ` ${n.replacement?.reason || 'Nothing was assembled.'}`}`));
    }
    if (n.replacement && !n.replacement.claimNo && !n.reclassification) {
      out.push(alertHtml('info', 'info', 'No replacement was assembled', n.replacement.reason || 'Nothing to assemble.'));
    }
    if (n.batchRemoved) {
      out.push(alertHtml('info', 'outbox', `Removed from ${n.batchRemoved.batchNo}`,
        'The claim was waiting in an open batch and left it on nullification; the batch’s files no longer describe it.'));
    }
    return out.join('');
  }

  const alertHtml = (tone, icon, title, body) => `
    <div class="alert alert--${tone}">
      <span class="icon">${icon}</span>
      <div><div class="title">${esc(title)}</div>${esc(body)}</div>
    </div>`;

  function summaryHtml(n, patient, claim) {
    const notification = n.payerNotification;
    return `
      <dl class="dl dl--narrow">
        <dt>Nullification</dt><dd class="t-mono-sm">${esc(n.no)}</dd>
        <dt>Path</dt><dd>${pathHtml(n)}</dd>
        <dt>Claim</dt>
        <dd><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(n.claimNo)}">${esc(n.claimNo)}</a>${claim ? ` ${kindHtml(claim)} ${statusHtml(claim)}` : ''}
          <br><span class="t-body-sm">was ${esc(n.statusAtNullification)} · ${esc(usd(n.valueAtNullification))} to the payer</span></dd>
        <dt>Patient</dt>
        <dd><a class="crumb-link" href="#/frontis/patients/${esc(n.patientMrn)}">${esc(patient?.nameEn || n.patientMrn)}</a>
          <br><span class="t-mono-sm">${esc(n.patientMrn)}</span></dd>
        <dt>Encounter</dt>
        <dd>${n.encounterNo ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(n.encounterNo)}">${esc(n.encounterNo)}</a>` : '<span class="t-body-sm">none — a generated claim</span>'}</dd>
        <dt>Payer / plan</dt><dd>${claim ? esc(coverLabel(claim)) : esc(payerName(n.payerId))}</dd>
        <dt>Reason</dt><dd>${reasonHtml(n)}</dd>
        <dt>Justification</dt><dd>${esc(n.justification)}</dd>
        <dt>Payer notified</dt>
        <dd>${notificationHtml(n)}${notification
          ? `<br><span class="t-body-sm">${esc(notification.reference)} · ${date(notification.date)}${notification.note ? `<br>${esc(notification.note)}` : ''}</span>` : ''}</dd>
        <dt>Disposition</dt>
        <dd>${dispositionHtml(n)}${n.disposition?.reason ? `<br><span class="t-body-sm">${esc(n.disposition.reason)}</span>` : ''}</dd>
        ${n.batchRemoved ? `<dt>Batch</dt><dd><a class="crumb-link t-mono-sm" href="#/claima/submission/${esc(n.batchRemoved.batchNo)}">${esc(n.batchRemoved.batchNo)}</a> <span class="t-body-sm">removed</span></dd>` : ''}
        <dt>Replacement</dt><dd>${replacementHtml(n)}${n.replacement?.claimNo ? `<br><span class="t-body-sm">${esc(n.replacement.kind === 'WrongPayerReclass' ? 'Re-classified, then assembled fresh' : 'Assembled fresh')} · ${dateTime(n.replacement.at)}</span>` : ''}</dd>
        <dt>Requested by</dt><dd>${esc(n.actors?.requestedBy || '—')}</dd>
        <dt>Second approver</dt>
        <dd>${n.actors?.approvedBy ? `${esc(n.actors.approvedBy)}<br><span class="t-body-sm">required above ${esc(usd(nullifications.threshold()))}</span>` : `<span class="t-body-sm">not required under ${esc(usd(nullifications.threshold()))}</span>`}</dd>
        <dt>At</dt><dd>${dateTime(n.at)}</dd>
      </dl>`;
  }

  /** The nullified claim and its replacement as two chips, the one on screen pressed. */
  function familyHtml(n, claim, replacement) {
    const arrow = '<span class="icon icon--sm" aria-hidden="true">arrow_forward</span>';
    const chip = (c, role) => `
      <a class="btn btn--secondary btn--sm" href="#/claima/claims/${esc(c.claimNo)}" title="${esc(`${role} · ${c.status} · ${usd(c.totals?.payerShare)}`)}">
        <span class="t-mono-sm">${esc(c.claimNo)}</span> <span class="badge">${esc(role)}</span> ${statusHtml(c)}
      </a>`;
    const parts = [];
    if (claim) parts.push(chip(claim, 'Nullified'));
    if (replacement) parts.push(chip(replacement, n.replacement.kind === 'WrongPayerReclass' ? 'Replacement · new cover' : 'Replacement'));
    const cycles = claim && claims.cycleChain ? claims.cycleChain(claim) : [];
    return `
      <div class="rule-child-row">
        <span class="t-body-sm">Nullified ↔ replacement</span>
        ${parts.join(arrow) || '<span class="t-body-sm">—</span>'}
        ${!replacement ? `<span class="badge${n.chainEnded ? ' badge--warning' : ''}" title="${esc(n.replacement?.reason || (n.chainEnded ? 'The chain ends with the nullification' : 'No replacement was asked for'))}">${
          n.chainEnded ? 'Chain ended' : 'No replacement'}</span>` : ''}
      </div>
      ${cycles.length > 1 ? `
      <div class="rule-child-row">
        <span class="t-body-sm">Cycles</span>
        ${cycles.map((c) => `<span class="badge${c.rejection ? ' badge--critical' : c.current ? ' badge--info' : ''}" title="${esc(c.rejection ? `${c.rejection.code} — ${c.rejection.reason || ''}` : c.status)}">Cycle ${c.cycle} · ${
    esc(c.rejection ? `Rejected ${c.rejection.code}` : c.status)}</span>`).join(arrow)}
      </div>` : ''}`;
  }

  /** Each line the claim handed back, where it is now, and where to read it. */
  function linesHtml(n) {
    const lines = n.lines || [];
    if (!lines.length) {
      return `
        <div class="state-view">
          <div class="state-view__glyph"><span class="icon">inventory_2</span></div>
          <div class="state-view__title">No captured charge lines</div>
          <p class="state-view__body">A generated claim carries no lines from the capture register, so nothing went back to the pool.</p>
        </div>`;
    }
    const returned = new Set(n.disposition?.lineIds || []);
    const skipped = new Map((n.disposition?.skipped || []).map((s) => [s.id, s.why]));
    return `
      <table class="tbl">
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Charge</th>
            <th scope="col">Qty</th>
            <th scope="col">Allowed</th>
            <th scope="col">Disposition</th>
            <th scope="col">Now</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => {
    const live = charges.get(l.chargeLineId);
    const tone = live ? charges.statusTone(live.status) : '';
    const held = live?.status === 'Held';
    return `
            <tr>
              <td><a class="crumb-link t-mono-sm" href="#/claima/charges?encounter=${esc(n.encounterNo || '')}">${esc(l.chargeLineId)}</a></td>
              <td><span class="t-mono-sm">${esc(l.chargeCode || '')}</span> ${esc(l.description)}</td>
              <td>${esc(l.qty)}</td>
              <td><span class="t-mono-sm">${esc(usd(l.amount))}</span></td>
              <td>${returned.has(l.chargeLineId)
    ? `<span class="badge${n.disposition.kind === 'ReturnAndHold' ? ' badge--warning' : ''}">${esc(nullifications.DISPOSITION_LABELS[n.disposition.kind])}</span>`
    : `<span class="badge" title="${esc(skipped.get(l.chargeLineId) || 'Not returned')}">Kept</span>`}</td>
              <td>${live
    ? `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(held ? `Held: ${live.holdReason || ''}` : live.status)}"><span class="dot"></span>${esc(live.status)}</span>${
      live.status === 'Released' ? `<br><span class="t-body-sm">${releasedTo(live, n)}</span>` : ''}`
    : '<span class="t-body-sm">gone from the register</span>'}</td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>`;
  }

  /** What a re-released line is on now: the replacement when it carries the line, else the pool's word. */
  function releasedTo(line, n) {
    const rep = n.replacement?.claimNo ? claims.get(n.replacement.claimNo) : null;
    if (rep && rep.lines.some((l) => l.chargeLineId === line.id || (l.ledgerTxIds || []).some((tx) => (line.ledgerTxIds || []).includes(tx)))) {
      return `on <a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(rep.claimNo)}">${esc(rep.claimNo)}</a>`;
    }
    return `released ${line.releasedAt ? dateTime(line.releasedAt) : ''} — not on a claim`;
  }

  /** The last few events of the nullified claim up to the withdrawal, and the first of its replacement. */
  function eventsHtml(n, replacement) {
    const mine = lifecycle.byClaim(n.claimNo);
    // The withdrawal is the last status move; the batch removal names the
    // nullification too, so the status is what is looked for first.
    const voided = mine.findLastIndex((e) => e.status === 'Void');
    const cut = voided >= 0 ? voided : mine.findLastIndex((e) => /Voided|Nullified/i.test(e.summary));
    const tail = cut >= 0 ? mine.slice(Math.max(0, cut - EXCERPT + 1), cut + 1) : mine.slice(-EXCERPT);
    const fresh = replacement ? lifecycle.byClaim(replacement.claimNo).slice(0, 3) : [];
    const rows = [
      ...tail.map((e) => row(e, n.claimNo)),
      ...fresh.map((e) => row(e, replacement.claimNo)),
    ];
    if (!rows.length) return '<p class="t-body-sm">Nothing recorded on the claim.</p>';
    return `<ol class="journey">${rows.join('')}</ol>`;
  }

  const row = (ev, claimNo) => `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(ev.at)}</span>
      <span class="journey__action"><span class="badge">${esc(ev.type)}</span></span>
      <span class="journey__actor">${esc(ev.actor)}</span>
      <span class="journey__detail"><span class="t-mono-sm">${esc(claimNo)}</span> · ${esc(ev.summary)}${ev.link
        ? ` · <a class="crumb-link" href="${esc(ev.link.href)}">${esc(ev.link.label)}</a>` : ''}</span>
    </li>`;

  function maskedHtml(role) {
    return `
      <div class="perm-banner">
        <span class="icon">lock</span>
        <div>
          <div class="title">Withheld</div>
          A nullification names the payer, the plan and the money, and ${esc(role.name)}’s role reads this record masked.
          Switch to a role with VIP access to read it.
        </div>
      </div>`;
  }

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}
