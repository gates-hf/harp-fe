// The snapshot page at #/frontis/eligibility/<ref>. Read-only and printable:
// what the platform answered, when, against which contract version, and — when
// a supervisor answered differently — both results side by side.
//
// Nothing on this page edits the check. The two things it can do are record an
// override, which is stored beside the system result, and start a fresh check.

import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as patients from '../../../../data/repositories/patients.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import {
  conditionsHtml, coverageHtml, failuresHtml, metaHtml, overrideHtml, resultBadge, stepsHtml,
} from './eligibility-panel.js';
import { askOverride } from './eligibility-override.js';
import { recheckPath } from './eligibility-worklist.js';

export const meta = { title: 'Eligibility snapshot' };

export async function render(mount, ctx) {
  const ref = ctx.params[0];
  if (!eligibility.get(ref)) throw new Error(`No eligibility check ${ref}`);

  const res = await fetch(new URL('./eligibility-result.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load eligibility-result.html (${res.status})`);
  mount.innerHTML = await res.text();

  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const row = eligibility.get(ref);
    if (!row) return;
    const role = currentRole();
    const patient = patients.view(patients.get(row.patientMrn), role);

    ctx.setHeader(`${row.ref} — ${row.finalResult}`);
    ctx.setCrumb([
      { label: 'Frontis', path: '/frontis/patients' },
      { label: 'Eligibility', path: '/frontis/eligibility' },
      { label: row.ref },
    ]);

    // A pre-registration check may have run before the patient existed, so the
    // page is titled by the pre-registration it belongs to.
    $('#er-title').textContent = `${patient?.nameEn || row.patientMrn || row.preregNo || '—'} — ${row.finalResult}`;
    $('#er-meta').innerHTML = metaHtml(row);
    $('#er-actions').innerHTML = actionsHtml(row, role);
    $('#er-banners').innerHTML = cascadeHtml(row);
    $('#er-summary').innerHTML = summaryHtml(row, patient);
    $('#er-result').innerHTML = resultBadge(row);
    $('#er-body').innerHTML = `
      ${overrideHtml(row)}
      ${failuresHtml(row.failureReasons)}
      ${conditionsHtml(row.conditions)}
      <div class="toolbar"><span class="t-title-sm">Steps</span></div>
      ${stepsHtml(row.steps)}
      ${coverageHtml(row.coverageSummary, { authHref: authHref(row) })}`;
  }

  /**
   * Where a flagged line goes when somebody acts on it. The request opens
   * carrying this snapshot and this charge — the evidence and the ask in one
   * link — and a check that never reached a patient record has nothing to raise
   * a request against.
   */
  const authHref = (row) =>
    (row.patientMrn
      ? (line) => `#/frontis/preauth/new?snapshot=${encodeURIComponent(row.ref)}&item=${encodeURIComponent(line.itemId)}`
      : null);

  function actionsHtml(row, role) {
    const override = eligibility.isOverridden(row)
      ? ''
      : role.canOverrideEligibility
        ? '<button class="btn btn--secondary btn--sm" data-act="override"><span class="icon icon--sm">flag</span>Override</button>'
        : `<button class="btn btn--secondary btn--sm" disabled
             title="Your role cannot override an eligibility result. ${esc(role.title)} is not a supervisory role.">
             <span class="icon icon--sm">flag</span>Override</button>`;
    return `
      <a class="btn btn--secondary btn--sm" href="#/frontis/eligibility">
        <span class="icon icon--sm">arrow_back</span>Back
      </a>
      ${row.patientMrn
        ? `<a class="btn btn--secondary btn--sm" href="#${esc(recheckPath(row))}">
             <span class="icon icon--sm">refresh</span>Re-check
           </a>`
        : `<button class="btn btn--secondary btn--sm" disabled
             title="This check ran before the patient was registered. Re-run it from the pre-registration.">
             <span class="icon icon--sm">refresh</span>Re-check</button>`}
      ${override}
      <button class="btn btn--primary btn--sm" data-act="print"><span class="icon icon--sm">print</span>Print</button>`;
  }

  /** A snapshot in a cascade says which attempt it was, and links to the rest. */
  function cascadeHtml(row) {
    const chain = eligibility.cascadeOf(row.ref);
    if (chain.length < 2) return '';
    const index = chain.findIndex((r) => r.ref === row.ref) + 1;
    return `
      <div class="alert alert--info">
        <span class="icon">low_priority</span>
        <div>
          <div class="title">Attempt ${index} of ${chain.length} in one cascade</div>
          ${chain.map((r) => (r.ref === row.ref
            ? `<span class="t-mono-sm">${esc(r.ref)}</span> — ${esc(r.finalResult)} · ${esc(eligibility.coverLabel(r))} (this one)`
            : `<a class="crumb-link t-mono-sm" href="#/frontis/eligibility/${esc(r.ref)}">${esc(r.ref)}</a> — ${
                esc(r.finalResult)} · ${esc(eligibility.coverLabel(r))}`)).join('<br>')}
        </div>
      </div>`;
  }

  function summaryHtml(row, patient) {
    const services = row.services || [];
    return `
      <dl class="dl dl--narrow">
        <dt>Reference no.</dt><dd class="t-mono-sm">${esc(row.ref)}</dd>
        <dt>Patient</dt>
        <dd>${row.patientMrn
          ? `<a class="crumb-link" href="#/frontis/patients/${esc(row.patientMrn)}">${esc(patient?.nameEn || row.patientMrn)}</a>
             <br><span class="t-mono-sm">${esc(row.patientMrn)}</span>`
          : `<span class="badge">Not registered</span>
             <br><a class="crumb-link t-mono-sm" href="#/frontis/prereg/${esc(row.preregNo || '')}">${esc(row.preregNo || '—')}</a>`}</dd>
        <dt>Cover</dt><dd>${esc(eligibility.coverLabel(row))}</dd>
        <dt>Check type</dt><dd>${esc(row.checkType)}</dd>
        <dt>Visit type</dt><dd>${esc(row.visitType || '—')}</dd>
        <dt>Contract</dt>
        <dd>${row.contract
          ? `<a class="crumb-link" href="#/pactum/contracts/${esc(row.contract.id)}">${esc(row.contract.no)}</a>
             <span class="badge badge--accent">v${row.contract.version}</span>`
          : '—'}</dd>
        <dt>System result</dt><dd>${esc(row.systemResult)}</dd>
        <dt>Final result</dt><dd>${esc(row.finalResult)}</dd>
        <dt>Checked by</dt><dd>${esc(row.checkedBy)}</dd>
        <dt>Checked at</dt><dd class="t-mono-sm">${dateTime(row.checkedAt)}</dd>
        <dt>Anticipated services</dt>
        <dd>${!services.length ? 'none named'
          : row.coverageSummary
            ? `${services.length} named — see the coverage table`
            : `${services.length} named, not priced — the check stopped before coverage`}</dd>
        <dt>Linked encounter</dt>
        <dd>${row.encounterId ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(row.encounterId)}">${esc(row.encounterId)}</a>` : '<span class="t-mono-sm">not linked</span>'}</dd>
        <dt>First attempt</dt>
        <dd>${row.attemptOf
          ? `<a class="crumb-link t-mono-sm" href="#/frontis/eligibility/${esc(row.attemptOf)}">${esc(row.attemptOf)}</a>`
          : 'this one'}</dd>
      </dl>
      <p class="t-body-sm">This snapshot is immutable. It records what the configuration answered on
        ${date(row.checkedAt)} and is not recomputed when a contract or a policy changes.</p>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'print') return void window.print();
    if (act === 'override' && (await askOverride(ref))) draw();
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  draw();
}
