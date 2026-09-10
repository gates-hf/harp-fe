// The estimate document at #/frontis/estimates/<no>. Read-only and printable:
// what the configuration answered, when, under which agreement, and what the
// patient was told they would owe.
//
// Nothing on this page recomputes anything. Every figure comes out of the
// result frozen when the estimate was issued, which is what makes it a document
// rather than a screen — the same rule the eligibility snapshot follows.

import * as estimates from '../../../../data/repositories/estimates.js';
import * as patients from '../../../../data/repositories/patients.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import {
  contractChipHtml, disclaimerHtml, exclusionsHtml, flagsHtml, limitsHtml, linesTableHtml, totalsRailHtml,
} from './estimate-doc.js';
import { statusHtml, validityHtml } from './estimate-chips.js';
import { handleAction } from './estimate-actions.js';

export const meta = { title: 'Cost estimate' };

export async function render(mount, ctx) {
  const no = ctx.params[0];
  if (!estimates.get(no)) throw new Error(`No estimate ${no}`);

  const res = await fetch(new URL('./estimate-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load estimate-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const row = estimates.get(no);
    if (!row) return;
    const role = currentRole();
    const patient = estimates.isProspect(row)
      ? null
      : patients.view(patients.get(row.subject.mrn), role);

    ctx.setHeader(`${row.no} — ${row.status}`);
    ctx.setCrumb([
      { label: 'Frontis', path: '/frontis/patients' },
      { label: 'Estimates', path: '/frontis/estimates' },
      { label: row.no },
    ]);

    $('#ev-title').textContent = `${estimates.subjectName(row)} — ${row.status}`;
    $('#ev-meta').innerHTML = metaHtml(row);
    $('#ev-actions').innerHTML = actionsHtml(row);
    $('#ev-banners').innerHTML = bannersHtml(row);

    // An estimate names the payer, the plan and the money, so it is withheld on
    // a restricted record for the reason the Insurance and Eligibility tabs
    // withhold theirs.
    if (patient?.masked) {
      $('#ev-summary').innerHTML = maskedHtml(role);
      $('#ev-body').innerHTML = '';
      $('#ev-priced').textContent = '';
      return;
    }

    $('#ev-summary').innerHTML = summaryHtml(row, patient);
    $('#ev-priced').textContent = row.result?.contract
      ? `${row.result.contract.no} v${row.result.contract.version}`
      : 'Self-Pay';
    $('#ev-body').innerHTML = bodyHtml(row);
  }

  function metaHtml(row) {
    return `
      <span class="t-mono-sm">${esc(row.no)}</span>
      ${statusHtml(row)}
      ${estimates.isProspect(row) ? '<span class="badge">Prospect</span>' : ''}
      <span>·</span>
      <span>${esc(estimates.coverLabel(row))}</span>
      <span>·</span>
      <span>${esc(row.context.visitType)} · ${esc(row.context.department)}</span>
      ${row.issuedAt ? `<span>·</span><span class="t-body-sm">issued ${date(row.issuedAt)} by ${esc(row.issuedBy)}</span>` : ''}`;
  }

  function actionsHtml(row) {
    const live = estimates.isLive(row);
    const closed = row.status === 'Cancelled' || row.status === 'Converted';
    return `
      <a class="btn btn--secondary btn--sm" href="#/frontis/estimates">
        <span class="icon icon--sm">arrow_back</span>Back
      </a>
      <button class="btn btn--secondary btn--sm" data-act="duplicate" title="Copy this estimate into a new draft">
        <span class="icon icon--sm">content_copy</span>Duplicate
      </button>
      ${live
        ? `<button class="btn btn--secondary btn--sm" data-act="convert">
             <span class="icon icon--sm">move_up</span>Convert to encounter</button>`
        : `<button class="btn btn--secondary btn--sm" disabled title="${esc(convertWhy(row))}">
             <span class="icon icon--sm">move_up</span>Convert to encounter</button>`}
      ${row.status === 'Issued'
        ? `<button class="btn btn--secondary btn--sm" data-act="cancel">
             <span class="icon icon--sm">cancel</span>Cancel</button>`
        : `<button class="btn btn--secondary btn--sm" disabled
             title="${esc(closed ? `A ${row.status.toLowerCase()} estimate is closed` : `A ${row.status.toLowerCase()} estimate cannot be withdrawn`)}">
             <span class="icon icon--sm">cancel</span>Cancel</button>`}
      <button class="btn btn--secondary btn--sm" data-act="history">
        <span class="icon icon--sm">history</span>History
      </button>
      <button class="btn btn--primary btn--sm" data-act="print">
        <span class="icon icon--sm">print</span>Print
      </button>`;
  }

  const convertWhy = (row) =>
    (row.status === 'Converted'
      ? `Already converted into ${row.encounterNo}`
      : row.status === 'Expired' ? 'This price has lapsed — duplicate it and issue the copy'
        : row.status === 'Superseded' ? `Replaced by ${row.supersededBy} — convert that one`
          : `A ${row.status.toLowerCase()} estimate cannot be converted`);

  function bannersHtml(row) {
    if (row.status === 'Expired') {
      return alertHtml('warning', 'schedule', `Expired on ${date(row.validUntil)}`,
        'This price has lapsed. It stays readable as a record of what was quoted; duplicate it to price the same '
        + 'services again under today’s agreement.');
    }
    if (row.status === 'Superseded') {
      return alertHtml('info', 'move_down', 'Replaced by a later estimate',
        `The same services were quoted again on <a class="crumb-link" href="#/frontis/estimates/${esc(row.supersededBy)}">${
          esc(row.supersededBy)}</a>, which is the price in force.`, true);
    }
    if (row.status === 'Converted') {
      return alertHtml('info', 'move_up', 'Accepted and converted',
        `This estimate became encounter <a class="crumb-link" href="#/frontis/encounters/${esc(row.encounterNo)}">${
          esc(row.encounterNo)}</a> on ${date(row.convertedAt)}.`, true);
    }
    if (row.status === 'Cancelled') {
      return alertHtml('critical', 'cancel', 'Withdrawn', esc(row.cancelReason || 'No reason recorded.'), true);
    }
    return '';
  }

  const alertHtml = (tone, icon, title, body, raw = false) => `
    <div class="alert alert--${tone}">
      <span class="icon">${icon}</span>
      <div><div class="title">${esc(title)}</div>${raw ? body : esc(body)}</div>
    </div>`;

  function summaryHtml(row, patient) {
    const t = row.result?.totals;
    return `
      <dl class="dl dl--narrow">
        <dt>Estimate no.</dt><dd class="t-mono-sm">${esc(row.no)}</dd>
        <dt>Quoted for</dt>
        <dd>${estimates.isProspect(row)
          ? `${esc(row.subject.name)}<br><span class="t-mono-sm">${esc(row.subject.phone || '')}</span>
             <br><span class="badge">Not registered</span>`
          : `<a class="crumb-link" href="#/frontis/patients/${esc(row.subject.mrn)}">${esc(patient?.nameEn || row.subject.mrn)}</a>
             <br><span class="t-mono-sm">${esc(row.subject.mrn)}</span>`}</dd>
        <dt>Cover</dt><dd>${esc(estimates.coverLabel(row))}</dd>
        <dt>Visit</dt><dd>${esc(row.context.visitType)} · ${esc(row.context.department)}</dd>
        <dt>Date of service</dt><dd class="t-mono-sm">${date(row.context.dateOfService)}</dd>
        <dt>Agreement</dt>
        <dd>${row.result?.contract
          ? `<a class="crumb-link" href="#/pactum/contracts/${esc(row.result.contract.id)}">${esc(row.result.contract.no)}</a>
             <span class="badge badge--accent">v${esc(row.result.contract.version)}</span>`
          : 'None — priced at standard rates'}</dd>
        <dt>Patient share</dt><dd class="t-mono-sm">${t ? usd(t.patientShare) : '—'}</dd>
        <dt>Issued by</dt><dd>${esc(row.issuedBy || '—')}</dd>
        <dt>Issued at</dt><dd class="t-mono-sm">${row.issuedAt ? dateTime(row.issuedAt) : '—'}</dd>
        <dt>Valid until</dt><dd>${validityHtml(row)}</dd>
        <dt>Created by</dt><dd>${esc(row.createdBy)}<br><span class="t-mono-sm">${dateTime(row.createdAt)}</span></dd>
        ${row.supersedes ? `<dt>Revises</dt>
          <dd><a class="crumb-link t-mono-sm" href="#/frontis/estimates/${esc(row.supersedes)}">${esc(row.supersedes)}</a></dd>` : ''}
        <dt>Linked encounter</dt>
        <dd>${row.encounterNo
          ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(row.encounterNo)}">${esc(row.encounterNo)}</a>`
          : '<span class="t-mono-sm">not linked</span>'}</dd>
      </dl>
      <p class="t-body-sm">This document is immutable. It records what the configuration answered on
        ${date(row.issuedAt || row.createdAt)} and is not recomputed when an agreement or a policy changes.</p>`;
  }

  /**
   * Where a flagged line goes when somebody acts on it: a request pre-filled
   * from this quotation and this charge. A prospect has no record to raise one
   * against, and a withdrawn estimate is not a thing to act on.
   */
  const authHref = (row) =>
    (estimates.isProspect(row) || row.status === 'Cancelled'
      ? null
      : (flag) => `#/frontis/preauth/new?estimate=${encodeURIComponent(row.no)}&item=${encodeURIComponent(flag.itemId)}`);

  function bodyHtml(row) {
    const result = row.result;
    if (!result) return '<p class="t-body-sm">This estimate was never priced.</p>';
    return `
      ${estimates.isProspect(row) ? watermarkHtml() : ''}
      ${contractChipHtml(result)}
      ${totalsRailHtml(result)}
      ${flagsHtml(result.preAuthFlags, { authHref: authHref(row) })}
      ${exclusionsHtml(result.exclusions)}
      <div class="toolbar">
        <span class="t-title-sm">Services quoted</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${result.rows.length} line${result.rows.length === 1 ? '' : 's'}, at the agreed rates</span>
      </div>
      ${linesTableHtml(result.rows)}
      ${limitsHtml(result.limits)}
      <div class="toolbar"><span class="t-title-sm">Terms</span></div>
      ${disclaimerHtml(result.disclaimer)}`;
  }

  /**
   * The prospect stamp. It is inline SVG rather than a rotated element, because
   * the design system ships no watermark and a module never writes CSS — the
   * same call perf-charts.js made for its shapes. It inherits the panel's text
   * colour, so it reads in both themes and survives the print stylesheet.
   */
  function watermarkHtml() {
    const words = 'PROSPECT ESTIMATE — NOT LINKED TO A PATIENT';
    return `
      <svg viewBox="0 0 800 96" width="100%" height="96" role="img"
           aria-label="${esc(words)}" preserveAspectRatio="none" focusable="false">
        <g fill="currentColor" opacity="0.16" font-family="inherit" font-size="26" font-weight="700">
          <text x="20" y="70" transform="rotate(-8 20 70)">${esc(words)}</text>
        </g>
      </svg>
      <div class="alert alert--warning">
        <span class="icon">person_search</span>
        <div>
          <div class="title">Quoted at the counter</div>
          This estimate is not linked to a patient record. Converting it registers the patient first, and the
          document is re-pointed at the record it creates.
        </div>
      </div>`;
  }

  function maskedHtml(role) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">lock</span></div>
        <div class="state-view__title">Estimate withheld</div>
        <p class="state-view__body">A restricted record's estimates name its payer, its plan and what it is
          expected to pay, so they are readable by roles with VIP access only. You are signed in as
          ${esc(role.title)}. The history still shows that an estimate was issued, and by whom.</p>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'print') return void window.print();
    await handleAction(act, no, ctx);
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  draw();
  // Print/Export from the list opens the document and sends it straight to the
  // printer: a print dialog needs the page it is printing to be on screen.
  if (ctx.query?.print === '1') setTimeout(() => window.print(), 0);
}
