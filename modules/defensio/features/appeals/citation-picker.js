// The citation picker: every citable row on the contract version stamped on
// the claim — the term, the rate methodologies, the coverage rows on the
// claim's plan, the pre-authorisation, referral and documentation rules and
// the billing rules — grouped by section, each rendered by the citation
// engine at the claim's date of service and marked in force or not. Pick a
// row, say what it shows, and the rendered text is stored on the case as
// read. The engine asserts the version is the stamped one; this dialog
// never asks which contract covers the plan today.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import * as citations from '../../../../data/engines/citation-renderer.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc } from '../../../../shared/format.js';

export async function openCitationPicker(caseId) {
  const row = appealCases.get(caseId);
  const claim = appealCases.claimOf(row);
  if (!claim?.contractId) { toast('The claim carries no contract version to cite', 'warning'); return undefined; }
  let rows;
  try {
    rows = citations.browse(claim.contractId, { planId: claim.planId, dos: claim.dateOfService });
  } catch (err) {
    toast(err.message, 'critical');
    return undefined;
  }
  const version = citations.versionOf({ contractId: claim.contractId });
  const cited = new Set(row.citations.map((c) => JSON.stringify([c.sourceRef.section, c.sourceRef.rowId || null, c.sourceRef.planId || null])));
  const key = (r) => JSON.stringify([r.section, r.rowId || null, r.sourceRef.planId || null]);
  const groups = citations.grouped(rows);
  const dialog = modal.open({
    title: 'Cite a contract term',
    sub: `${version.contractNo} v${version.version} · ${version.name} · date of service ${date(claim.dateOfService)}`,
    icon: 'gavel',
    size: 'lg',
    body: `
      <p class="modal__lede">The version stamped on ${esc(claim.claimNo)} when it was assembled — its terms as they stood, read by their own id. A row not in force on the date of service is shown and says so.</p>
      ${groups.map((g, i) => `
      <details${i === 0 || g.id === 'coverage' ? ' open' : ''}>
        <summary class="panel-header"><span>${esc(g.label)}</span><span class="badge">${g.rows.length}</span></summary>
        <table class="tbl">
          <thead><tr><th scope="col">Row</th><th scope="col">Terms</th><th scope="col">On the DOS</th><th scope="col"></th></tr></thead>
          <tbody>${g.rows.map((r) => `
            <tr>
              <td><span class="t-mono-sm">${esc(r.rowId || 'Term')}</span></td>
              <td class="t-body-sm">${esc(r.summary)}</td>
              <td>${r.inForce == null ? '<span class="t-body-sm">—</span>' : r.inForce ? '<span class="badge badge--success">In force</span>' : '<span class="badge badge--warning" title="Dated outside the date of service — cite it only to say so">Not in force</span>'}</td>
              <td><button class="btn btn--${cited.has(key(r)) ? 'ghost' : 'secondary'} btn--sm" data-pick="${esc(key(r))}"${cited.has(key(r)) ? ' disabled title="Already cited on this case"' : ''}><span class="icon icon--sm">format_quote</span>${cited.has(key(r)) ? 'Cited' : 'Cite'}</button></td>
            </tr>`).join('')}</tbody>
        </table>
      </details>`).join('')}
      <div id="cp-pick"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Close</button>
      <button class="btn btn--primary" id="cp-add" disabled title="Pick a row first">Add citation</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  let picked = null;
  dialog.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    picked = rows.find((r) => key(r) === b.dataset.pick) || null;
    if (!picked) return;
    $('#cp-pick').innerHTML = `
      <div class="toolbar"><span class="t-title-sm">Citation</span><span class="spacer"></span><a class="crumb-link" href="${esc(citations.hrefOf(picked.sourceRef))}" target="_blank" rel="noopener">Open on Pactum</a></div>
      <div class="alert alert--info"><span class="icon">format_quote</span><div>${esc(picked.renderedText)}</div></div>
      <label class="field field--area"><span class="icon icon--sm">notes</span>
        <textarea id="cp-argument" rows="2" placeholder="What this term shows about the denial (optional now, wanted by the reviewer)" aria-label="Argument" maxlength="400"></textarea>
      </label>
      <div id="cp-error"></div>`;
    $('#cp-add').disabled = false;
    $('#cp-add').title = 'Store the rendered text and the argument on the case';
    $('#cp-argument').focus();
  });
  $('#cp-add').addEventListener('click', () => {
    if (!picked) return;
    const r = appealCases.addCitation(caseId, { sourceRef: picked.sourceRef, renderedText: picked.renderedText, argument: $('#cp-argument')?.value || '', href: citations.hrefOf(picked.sourceRef) });
    if (r?.error) { $('#cp-error').innerHTML = `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(r.error)}</div></div>`; return; }
    toast(`${r.id} cited`);
    dialog.close(true);
  });
  return dialog.closed;
}
