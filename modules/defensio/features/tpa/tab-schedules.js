// The Schedules tab of the TPA ledger: the administrators on the register
// with who to call there, the payers each one administers and over which
// dates, and under every link the versions of its fee schedule — basis,
// rate, service-group rates, caps, term — append-only. Edit on a version is
// always blocked with the reason in its tooltip and the amendment flow
// beside it: a past period is restated, never rewritten. A retrospective
// version wears the amendment that posted it. Each administrator is a
// collapsible the design system needs no CSS for; which are open survives a
// redraw.

import * as tpas from '../../../../data/repositories/tpas.js';
import * as schedules from '../../../../data/repositories/tpa-fee-schedules.js';
import * as accruals from '../../../../data/repositories/tpa-fee-accruals.js';
import { date, esc, todayIso, usd } from '../../../../shared/format.js';
import { openAddLinkDialog, openAddVersionDialog, openEndLinkDialog } from './schedule-dialogs.js';

export function render(host, { state }) {
  function draw() {
    const rows = tpas.all();
    if (!state.open.size && rows.length) state.open.add(rows[0].id);
    host.innerHTML = rows.length ? rows.map((t) => tpaHtml(t, state.open.has(t.id))).join('') : `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">apartment</span></div>
        <div class="state-view__title">No administrator on the register</div>
        <p class="state-view__body">Register the third parties that stand between a payer and the hospital, link the payers they administer, and enter each fee schedule's versions.</p>
      </div>`;
  }

  host.addEventListener('toggle', (e) => {
    const d = e.target.closest('details[data-tpa]');
    if (!d) return;
    if (d.open) state.open.add(d.dataset.tpa); else state.open.delete(d.dataset.tpa);
  }, true);

  host.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    const { act, tpa, payer, schedule } = btn.dataset;
    if (act === 'add-link') await openAddLinkDialog(tpa);
    else if (act === 'end-link') await openEndLinkDialog(tpa, payer);
    else if (act === 'add-version') await openAddVersionDialog(schedule || schedules.ensureSchedule(tpa, payer).id);
    else if (act === 'toggle-status') tpas.setStatus(tpa, tpas.get(tpa)?.status === 'Active' ? 'Inactive' : 'Active');
  });

  draw();
  return { redraw: draw };
}

function tpaHtml(t, open) {
  const links = tpas.linksOf(t.id);
  const count = accruals.byTpa(t.id).length;
  return `
    <details class="panel panel--sunken" data-tpa="${esc(t.id)}"${open ? ' open' : ''}>
      <summary class="panel-header">
        <span>${esc(t.name)}</span>
        <span class="t-mono-sm">${esc(t.id)}</span>
        <span class="badge${t.status === 'Active' ? ' badge--success' : ''}">${esc(t.status)}</span>
        <span class="t-body-sm">${links.filter((l) => l.live).length} payer${links.filter((l) => l.live).length === 1 ? '' : 's'} · ${count} accrual${count === 1 ? '' : 's'}</span>
        <span class="spacer"></span>
        <button class="btn btn--secondary btn--sm" data-act="add-link" data-tpa="${esc(t.id)}" title="Link a payer this administrator stands in front of"><span class="icon icon--sm">link</span>Link payer</button>
        <button class="btn btn--ghost btn--sm" data-act="toggle-status" data-tpa="${esc(t.id)}" title="${t.status === 'Active' ? 'Mark the administrator inactive — its links and schedules stay for the accruals already read against them' : 'Mark the administrator active again'}">${t.status === 'Active' ? 'Deactivate' : 'Activate'}</button>
      </summary>
      <div class="panel-body">
        <dl class="dl dl--narrow">
          <dt>Contact</dt><dd>${t.contact?.name ? `${esc(t.contact.name)}${t.contact.role ? ` · ${esc(t.contact.role)}` : ''}<br><span class="t-body-sm">${esc([t.contact.email, t.contact.phone].filter(Boolean).join(' · '))}</span>` : '<span class="t-body-sm">Nobody named</span>'}</dd>
          ${t.payerRecordId ? `<dt>Payer master</dt><dd><a class="crumb-link t-mono-sm" href="#/pactum/payers/${esc(t.payerRecordId)}" title="The administrator’s own record on Pactum’s payer master">${esc(t.payerRecordId)}</a></dd>` : ''}
          ${t.note ? `<dt>Note</dt><dd class="t-body-sm">${esc(t.note)}</dd>` : ''}
        </dl>
        ${links.length ? links.map((l) => linkHtml(t, l)).join('') : '<p class="t-body-sm">No payer linked yet — a fee on one of its remittances would be read against nothing.</p>'}
      </div>
    </details>`;
}

function linkHtml(t, l) {
  const s = schedules.forLink(t.id, l.payerId);
  const versions = (s?.versions || []).slice().sort((a, b) => b.n - a.n);
  const inForce = s ? schedules.versionAt(t.id, l.payerId, todayIso()) : null;
  return `
    <div class="toolbar">
      <span class="t-title-sm">${esc(l.payer)}</span>
      <span class="badge${l.live ? ' badge--success' : ''}" title="${l.live ? 'Administered today' : 'Link closed'}">${esc(date(l.from))} → ${l.to ? esc(date(l.to)) : 'open'}</span>
      <span class="t-body-sm">${inForce ? `in force: ${esc(schedules.versionLabel(inForce))}` : 'no version in force today'}</span>
      <span class="spacer"></span>
      <button class="btn btn--primary btn--sm" data-act="add-version" data-tpa="${esc(t.id)}" data-payer="${esc(l.payerId)}"${s ? ` data-schedule="${esc(s.id)}"` : ''} title="Append a version starting today or later"><span class="icon icon--sm">post_add</span>New version</button>
      ${l.live && !l.to ? `<button class="btn btn--ghost btn--sm" data-act="end-link" data-tpa="${esc(t.id)}" data-payer="${esc(l.payerId)}" title="Close the link on a date"><span class="icon icon--sm">link_off</span>End link</button>` : ''}
    </div>
    ${versions.length ? `
    <table class="tbl">
      <thead><tr><th>Version</th><th>Fee</th><th>Caps</th><th>In force</th><th>Status</th><th>Note</th><th>Actions</th></tr></thead>
      <tbody>${versions.map((v) => versionHtml(t, l, v, inForce)).join('')}</tbody>
    </table>` : `<p class="t-body-sm">No version yet — a fee withheld on this payer's remittance reads Unscheduled until one covers its date.</p>`}`;
}

function versionHtml(t, l, v, inForce) {
  const today = todayIso();
  const status = v.retrospective && !v.posted ? '<span class="badge" title="Drafted by an amendment not yet posted — invisible to the matching">draft restatement</span>'
    : v.retrospective ? `<span class="badge badge--accent" title="${esc(`Restates ${v.supersedesRef || 'an uncovered period'}; posted ${date(v.postedAt)}`)}">restated by ${esc(v.amendmentId || '')}</span>`
      : inForce?.ref === v.ref ? '<span class="badge badge--success">in force</span>'
        : v.effectiveFrom > today ? '<span class="badge badge--info">future</span>'
          : v.effectiveTo && v.effectiveTo < today ? '<span class="badge">closed</span>'
            : '<span class="badge" title="A posted restatement stands on top of it">superseded</span>';
  const caps = [v.capPerClaim != null ? `${usd(v.capPerClaim)}/claim` : '', v.capPerPeriod != null ? `${usd(v.capPerPeriod)}/month` : ''].filter(Boolean).join(' · ') || '—';
  const blocker = schedules.editBlocker(v);
  return `
    <tr>
      <td><span class="t-mono-sm">${esc(v.ref)}</span></td>
      <td>${esc(schedules.describe(v))}</td>
      <td class="t-body-sm">${esc(caps)}</td>
      <td class="t-body-sm">${esc(date(v.effectiveFrom))} → ${v.effectiveTo ? esc(date(v.effectiveTo)) : 'open'}</td>
      <td>${status}</td>
      <td class="t-body-sm" title="${esc(v.note || '')}">${esc(v.note || '—')}${v.createdBy ? `<br>${esc(v.createdBy)} · ${esc(date(v.createdAt))}` : ''}</td>
      <td>
        <button class="btn btn--secondary btn--sm" disabled title="${esc(blocker)}"><span class="icon icon--sm">edit</span>Edit</button>
        ${v.retrospective ? `<a class="btn btn--ghost btn--sm" href="#/defensio/tpa/amendments/${esc(v.amendmentId || '')}" title="Open the amendment"><span class="icon icon--sm">history_edu</span>${esc(v.amendmentId || 'Amendment')}</a>`
    : `<a class="btn btn--ghost btn--sm" href="#/defensio/tpa/amendments/new?tpaId=${esc(t.id)}&payerId=${esc(l.payerId)}&version=${encodeURIComponent(v.ref)}" title="Restate the period this version covers through an amendment"><span class="icon icon--sm">history_edu</span>Amend</a>`}
      </td>
    </tr>`;
}
