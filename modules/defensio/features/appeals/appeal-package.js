// The printable appeal package at #/defensio/appeals/<id>/package (and
// /package/<ref> for an earlier one): the cover sheet, the locked letter and
// the enclosures index, rendered from the frozen copy the case stores — a
// package generated at approval and printed after the payer answered is the
// same document. Everything but the package itself carries
// data-print="hide", so Print hands the printer the three sheets and nothing
// else, the way the pre-authorisation form and the referral letter print.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import * as patients from '../../../../data/repositories/patients.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, fileSize, usd } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';

export const meta = { title: 'Appeal package' };

export async function render(mount, ctx) {
  const id = ctx.params[0];
  if (!appealCases.get(id)) throw new Error(`No appeal case ${id}`);
  const wanted = ctx.params[2] || null;

  function draw() {
    const row = appealCases.get(id);
    if (!row) return;
    const role = currentRole();
    const claim = appealCases.claimOf(row);
    const patient = claim ? patients.view(patients.get(claim.patientMrn), role) : null;
    const pkg = (wanted && appealCases.packageOf(row, wanted)) || appealCases.latestPackage(row);
    ctx.setHeader(`${row.id} — package`);
    ctx.setCrumb([
      { label: 'Defensio', path: '/defensio/appeals' },
      { label: 'Appeals', path: '/defensio/appeals' },
      { label: row.id, path: `/defensio/appeals/${row.id}` },
      { label: pkg?.ref || 'Package' },
    ]);
    if (patient?.masked) {
      mount.innerHTML = `
        <div class="perm-banner"><span class="icon">lock</span><div><div class="title">Withheld</div>An appeal package names the patient, the payer and the money, and ${esc(role.name)}’s role reads this record masked.</div></div>`;
      return;
    }
    mount.innerHTML = `
      <div class="toolbar" data-print="hide">
        <a class="btn btn--secondary btn--sm" href="#/defensio/appeals/${esc(row.id)}"><span class="icon icon--sm">arrow_back</span>Back to ${esc(row.id)}</a>
        ${row.packages.length > 1 ? `<div class="segmented" role="group" aria-label="Package version">${row.packages.map((p) => `
          <a href="#/defensio/appeals/${esc(row.id)}/package/${esc(p.ref)}" aria-pressed="${p.ref === pkg?.ref}" title="${esc(`Generated ${dateTime(p.generatedAt)} by ${p.by}`)}">${esc(p.ref.replace(`PKG-${row.id}-`, ''))}</a>`).join('')}</div>` : ''}
        <span class="spacer"></span>
        ${pkg ? `<span class="t-body-sm">${esc(pkg.ref)} · frozen ${dateTime(pkg.generatedAt)} by ${esc(pkg.by)}${row.packageRef === pkg.ref ? ' · as filed' : ''}</span>
        <button class="btn btn--primary btn--sm" data-act="print" title="Print the cover sheet, the letter and the enclosures index"><span class="icon icon--sm">print</span>Print</button>`
    : row.status === 'ApprovedToSubmit' ? '<button class="btn btn--primary btn--sm" data-act="generate" title="Freeze the letter, the bundle index and the cover sheet"><span class="icon icon--sm">inventory_2</span>Generate package</button>' : ''}
      </div>
      ${pkg ? packageHtml(pkg, row) : `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">inventory_2</span></div>
        <div class="state-view__title">No package yet</div>
        <p class="state-view__body">${row.status === 'ApprovedToSubmit' ? 'The case is approved — generate the package to freeze the letter, the enclosures and the cover sheet.' : 'A package is generated once the case is approved to submit; until then the letter is still being written.'}</p>
      </div>`}`;
  }

  mount.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'print') return window.print();
    if (act === 'generate') {
      const r = appealCases.generatePackage(id);
      if (r?.error) return toast(r.error, 'critical');
      return toast(`${r.ref} ready`);
    }
    return undefined;
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}

/** The three sheets, from the frozen copy alone. */
export function packageHtml(pkg, row) {
  const c = pkg.cover;
  const h = c.hospital || {};
  return `
    <div class="panel">
      <div class="panel-header" data-print="hide"><span>Cover sheet</span><span class="spacer"></span><span class="t-body-sm">Sheet 1 of 3</span></div>
      <div class="panel-body">
        <div class="toolbar"><span class="t-title">${esc(h.name || 'Hospital')}</span><span class="spacer"></span><span class="t-mono-sm">${esc(pkg.ref)}</span></div>
        <p class="t-body-sm">${esc(h.line || '')}</p>
        <div class="toolbar"><span class="t-title-sm">Appeal — level ${c.level}</span><span class="spacer"></span><span class="badge">${esc(c.caseId)}</span></div>
        <dl class="dl dl--narrow">
          <dt>To</dt><dd>${esc(c.payer)} — claims appeals</dd>
          <dt>Claim</dt><dd class="t-mono-sm">${esc(c.claimNo || '—')}</dd>
          <dt>Patient</dt><dd>${esc(c.patient)} <span class="t-mono-sm">${esc(c.patientMrn || '')}</span></dd>
          <dt>Date of service</dt><dd class="t-mono-sm">${esc(date(c.dateOfService))}</dd>
          <dt>Denial</dt><dd><span class="t-mono-sm">${esc(c.denialId || '—')}</span>${c.denialCode ? ` · ${esc(c.denialCode)}` : ''}</dd>
          <dt>Disputed</dt><dd class="t-mono-sm">${esc(usd(c.disputedAmount))}</dd>
          <dt>Ground</dt><dd>${esc(c.primaryGround)}</dd>
          <dt>File by</dt><dd class="t-mono-sm">${esc(date(c.filingDeadline))}</dd>
          <dt>Prepared by</dt><dd>${esc(c.preparedBy)}${c.approvedBy ? ` · approved by ${esc(c.approvedBy)}` : ''}</dd>
          ${row.submission ? `<dt>Filed</dt><dd>${esc(row.method)} · <span class="t-mono-sm">${esc(row.reference)}</span> · ${esc(date(row.submittedAt))}${row.submission.lateOverride ? ' · late filing' : ''}</dd>` : ''}
        </dl>
        ${c.citations?.length ? `<div class="toolbar"><span class="t-title-sm">Contract terms cited</span></div><ol>${c.citations.map((t) => `<li class="t-body-sm">${esc(t)}</li>`).join('')}</ol>` : ''}
        <p class="t-body-sm">Enclosed: the appeal letter (sheet 2) and ${pkg.bundle.length} enclosure${pkg.bundle.length === 1 ? '' : 's'} listed on sheet 3.</p>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header" data-print="hide"><span>Appeal letter</span><span class="spacer"></span><span class="t-body-sm">Sheet 2 of 3 · letter v${pkg.letter.version}${pkg.letter.manuallyEdited ? ' · edited by hand' : ''}</span></div>
      <div class="panel-body">${pkg.letter.html}</div>
    </div>
    <div class="panel">
      <div class="panel-header" data-print="hide"><span>Enclosures</span><span class="badge">${pkg.bundle.length}</span><span class="spacer"></span><span class="t-body-sm">Sheet 3 of 3</span></div>
      <div class="panel-body">
        ${pkg.bundle.length ? `
        <table class="tbl">
          <thead><tr><th scope="col">#</th><th scope="col">Type</th><th scope="col">Item</th><th scope="col">Reference</th></tr></thead>
          <tbody>${pkg.bundle.map((b) => `
            <tr>
              <td><span class="t-mono-sm">${b.n}</span></td>
              <td>${esc(b.type)}</td>
              <td>${esc(b.description)}</td>
              <td class="t-mono-sm">${b.file ? `${esc(b.file.name)} · ${esc(fileSize(b.file.size))}` : esc(b.ref || '—')}</td>
            </tr>`).join('')}</tbody>
        </table>` : '<p class="t-body-sm">No enclosures.</p>'}
      </div>
    </div>`;
}
