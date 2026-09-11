// The tracking feature's own host for one case at
// #/defensio/appeal-tracking/<id>: a banner (case, status, payer, claim,
// denial, disputed) over the Tracking & outcome tab — the same tab
// modules/defensio/tabs.js registers for amendment 38's case view, which is
// where the case's preparation, bundle and letter live. Both hosts draw the
// tab into a fresh node and hand it a redraw, the shell's freshBody rule one
// level down.

import * as tracking from '../../../../data/repositories/appeal-tracking.js';
import * as denials from '../../../../data/repositories/denials.js';
import * as patients from '../../../../data/repositories/patients.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc, usd } from '../../../../shared/format.js';
import { coverLabel, payerName, statusHtml } from './tracking-chips.js';
import { render as renderTab } from './tracking-tab.js';

export const meta = { title: 'Appeal case' };

export async function render(mount, ctx) {
  const id = ctx.params[0];
  const first = tracking.get(id);
  if (!first) throw new Error(`No appeal case ${id}`);

  mount.innerHTML = `
    <div class="detail-banner">
      <div class="detail-banner__id">
        <h1 id="tp-id">Appeal case</h1>
        <div class="detail-banner__meta" id="tp-meta"></div>
      </div>
      <div class="detail-banner__actions" id="tp-actions"></div>
    </div>
    <div id="tp-body"></div>`;
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const c = tracking.get(id);
    if (!c) return;
    const role = currentRole();
    const claim = denials.claimOf({ claimId: c.claimId, claimNo: c.claimNo });
    const patient = claim ? patients.view(patients.get(claim.patientMrn), role) : null;
    ctx.setHeader(`${c.id} — tracking & outcome`);
    ctx.setCrumb([
      { label: 'Defensio', path: '/defensio/appeal-tracking' },
      { label: 'Appeal tracking', path: '/defensio/appeal-tracking' },
      { label: c.id },
    ]);
    $('#tp-id').textContent = c.id;
    $('#tp-actions').innerHTML = `
      <a class="btn btn--ghost btn--sm" href="#/defensio/appeals/${esc(c.id)}" title="The case's preparation, bundle and letter — the appeal feature's page"><span class="icon icon--sm">description</span>Case</a>
      <a class="btn btn--secondary btn--sm" href="#/defensio/appeal-tracking"><span class="icon icon--sm">arrow_back</span>Back to tracking</a>`;
    // A case names the payer, the claim and the money: withheld outright on a restricted record.
    if (patient?.masked) {
      $('#tp-meta').innerHTML = `<span class="t-mono-sm">${esc(c.id)}</span> ${statusHtml(c)}`;
      $('#tp-body').innerHTML = `
        <div class="perm-banner"><span class="icon">lock</span><div><div class="title">Withheld</div>
        An appeal case names the payer, the claim and the money, and ${esc(role.name)}’s role reads this record masked. Switch to a role with VIP access to read it.</div></div>`;
      return;
    }
    $('#tp-meta').innerHTML = `
      <span class="t-mono-sm">${esc(c.id)}</span>${c.level > 1 ? ` <span class="badge badge--accent">Level ${c.level}</span>` : ''}
      ${statusHtml(c)}
      <span>·</span>
      ${tracking.denialIdsOf(c).map((d) => `<a class="crumb-link t-mono-sm" href="#/defensio/denials/${esc(d)}">${esc(d)}</a>`).join(' ')}
      <span>·</span>
      <a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(c.claimNo)}">${esc(c.claimNo || '—')}</a>
      <span>·</span>
      <span>${claim ? `<a class="crumb-link" href="#/frontis/patients/${esc(claim.patientMrn)}">${esc(patient?.nameEn || claim.patientMrn)}</a> · ${esc(coverLabel(claim))}` : esc(payerName(c))}</span>
      <span>·</span>
      <span class="t-body-sm">${esc(usd(tracking.disputedOf(c)))} disputed</span>`;
    const host = document.createElement('div');
    $('#tp-body').replaceChildren(host);
    renderTab(host, { caseId: c.id, redraw: draw });
  }

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  tracking.seedReady.then(() => { if (mount.isConnected) draw(); });
  draw();
}
