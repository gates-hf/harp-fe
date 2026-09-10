// Claim timeline at #/claima/timeline/<claim no> — the banner naming the
// claim, then the family strip and the events, drawn by timeline-tab.js. The
// claim page's own Timeline tab draws the same file; this route is the page a
// board card, a queue row and a payer-stats drill open.

import * as lifecycle from '../../../../data/engines/claim-events.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as patients from '../../../../data/repositories/patients.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc, usd } from '../../../../shared/format.js';
import { coverLabel, daysChip, escalatedFlag, kindChip, statusHtml } from './lifecycle-chips.js';
import * as tab from './timeline-tab.js';

export const meta = { title: 'Timeline' };

export async function render(mount, ctx) {
  claims.ensureAssembled?.();
  const claim0 = claims.get(ctx.params[0]);
  if (!claim0) throw new Error(`No claim ${ctx.params[0]}`);
  const claimNo = claim0.claimNo;

  mount.innerHTML = `
    <div class="detail-banner">
      <div class="detail-banner__id">
        <h1 id="tl-no">${esc(claimNo)}</h1>
        <div class="detail-banner__meta" id="tl-meta"></div>
      </div>
      <div class="detail-banner__actions">
        <a class="btn btn--secondary btn--sm" href="#/claima/claims/${esc(claimNo)}">
          <span class="icon icon--sm">description</span>Open claim
        </a>
        <a class="btn btn--ghost btn--sm" href="#/claima/pipeline">
          <span class="icon icon--sm">view_kanban</span>Pipeline
        </a>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <span>Timeline</span>
        <span class="spacer"></span>
        <span class="t-body-sm" id="tl-peers"></span>
      </div>
      <div class="panel-body" id="tl-body"></div>
    </div>`;
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const claim = claims.get(claimNo);
    if (!claim) return;
    const patient = patients.view(patients.get(claim.patientMrn), role);
    ctx.setHeader(`${claim.claimNo} — timeline`);
    ctx.setCrumb([
      { label: 'Claima', path: '/claima/pipeline' },
      { label: 'Pipeline', path: '/claima/pipeline' },
      { label: claim.claimNo },
    ]);
    const [a] = lifecycle.annotate([claim]);
    $('#tl-meta').innerHTML = `
      ${kindChip(claim)} ${statusHtml(claim)} ${daysChip(a.days, lifecycle.statusSince(claim, a.events), claim.status)} ${escalatedFlag(a)}
      <span>·</span>
      <span>${esc(patient?.nameEn || claim.patientMrn || '—')}</span>
      <span>·</span>
      <span>${patient?.masked ? 'cover withheld' : esc(coverLabel(claim))}</span>
      <span>·</span>
      <span class="t-body-sm">${patient?.masked ? 'value withheld' : esc(usd(claim.totals?.payerShare))}</span>`;
    const peers = lifecycle.peerStatus();
    const missing = Object.entries(peers).filter(([, ok]) => !ok).map(([k]) => k);
    $('#tl-peers').textContent = missing.length
      ? `Not loaded yet: ${missing.join(', ')} — their events appear when those registers exist`
      : 'Trail, batches, remittances, denials, hand-offs and follow-ups';
    // A claim names the payer, the plan and the money, so it is withheld on a
    // restricted record the way the claim page withholds it.
    if (patient?.masked) {
      $('#tl-body').innerHTML = `
        <div class="perm-banner">
          <span class="icon">lock</span>
          <div><div class="title">Withheld</div>
            A timeline names the payer and what it paid, and ${esc(role.name)}’s role reads this record masked.
            Switch to a role with VIP access to read it.</div>
        </div>`;
      return;
    }
    tab.render($('#tl-body'), { claimNo });
  }

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  lifecycle.peersReady.then(() => { if (mount.isConnected) draw(); });
  draw();
}
