// The Grounds & citations tab on the appeal page — Tab 2: the primary ground
// (one of the catalogue's), the secondary grounds beside it, and the
// citations: each a row on the contract version stamped on the claim,
// rendered by the citation engine when it was cited and stored as read,
// with the argument the desk makes from it. A contract ground with no
// citation is flagged here and refused at review. Everything is disabled
// with the reason once the case has left the preparer's hands.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import * as citations from '../../../../data/engines/citation-renderer.js';
import { esc } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { openCitationPicker } from './citation-picker.js';

export function render(host, { caseId, redraw }) {
  const row = appealCases.get(caseId);
  if (!row) return;
  const editable = appealCases.isEditable(row);
  const lock = editable ? '' : ` disabled title="${esc(`A ${appealCases.statusLabel(row.status).toLowerCase()} case is not edited`)}"`;
  const claim = appealCases.claimOf(row);
  const contractGround = appealCases.isContractGround(row.grounds.primary);
  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Grounds</span>
      <span class="spacer"></span>
      <button class="btn btn--primary btn--sm" data-act="save-grounds"${lock}><span class="icon icon--sm">save</span>Save grounds</button>
    </div>
    <div class="toolbar">
      <label class="field field--grow"><span class="icon icon--sm">flag</span>
        <select id="tg-primary" aria-label="Primary ground"${editable ? '' : ' disabled'}>
          <option value="">Pick the primary ground…</option>
          ${appealCases.GROUNDS.map((g) => `<option value="${g.id}"${g.id === row.grounds.primary ? ' selected' : ''}>${esc(g.label)} — ${g.kind}</option>`).join('')}
        </select>
      </label>
    </div>
    <p class="t-body-sm" id="tg-summary">${esc(appealCases.ground(row.grounds.primary)?.summary || 'The primary ground is what the letter argues first; a contract ground is argued from the agreement and needs a citation.')}</p>
    <div class="toolbar"><span class="t-title-sm">Secondary grounds</span><span class="spacer"></span><span class="t-body-sm">Argued after the primary; each expects its own evidence in the bundle.</span></div>
    <div class="rule-child-row" id="tg-secondary">${appealCases.GROUNDS.map((g) => `
      <label class="t-body-sm"><input type="checkbox" data-ground="${g.id}"${row.grounds.secondary.includes(g.id) ? ' checked' : ''}${g.id === row.grounds.primary || !editable ? ' disabled' : ''}> ${esc(g.label)}</label>`).join('')}</div>

    <div class="toolbar">
      <span class="t-title-sm">Contract citations</span>
      <span class="badge">${row.citations.length}</span>
      <span class="spacer"></span>
      ${claim?.contractId ? `<span class="t-body-sm">Read off ${esc(citations.chipText({ contractId: claim.contractId, section: 'term' }).replace(' · Term', ''))} — the version stamped on the claim, never the current one.</span>` : '<span class="t-body-sm">No agreement is stamped on the claim — nothing to cite.</span>'}
      <button class="btn btn--secondary btn--sm" data-act="cite"${!claim?.contractId ? ' disabled title="The claim carries no contract version"' : lock}><span class="icon icon--sm">gavel</span>Cite a contract term</button>
    </div>
    ${contractGround && !row.citations.length ? '<div class="alert alert--warning"><span class="icon">warning</span><div><div class="title">A contract ground needs a citation</div>The primary ground argues from the agreement; cite at least one row of the stamped version before the case goes to review.</div></div>' : ''}
    ${row.citations.length ? `
    <table class="tbl">
      <thead><tr><th scope="col">Citation</th><th scope="col">Rendered text</th><th scope="col">Argument</th><th scope="col"></th></tr></thead>
      <tbody>${row.citations.map((c) => `
        <tr data-cid="${esc(c.id)}">
          <td><span class="t-mono-sm">${esc(c.id)}</span><br><a class="badge" href="${esc(c.href || citations.hrefOf(c.sourceRef))}" title="Open the version on its Pactum page">${citations.chipText(c.sourceRef)}</a></td>
          <td class="t-body-sm">${esc(c.renderedText)}</td>
          <td>
            <label class="field field--area"><span class="icon icon--sm">notes</span>
              <textarea rows="2" data-argument aria-label="Argument" maxlength="400" placeholder="What this term shows"${editable ? '' : ' disabled'}>${esc(c.argument || '')}</textarea>
            </label>
          </td>
          <td>
            <button class="btn btn--secondary btn--sm" data-act="argue" title="Save the argument"${lock}><span class="icon icon--sm">save</span></button>
            <button class="btn btn--ghost btn--sm" data-act="uncite" title="Remove the citation"${lock}><span class="icon icon--sm">delete</span></button>
          </td>
        </tr>`).join('')}</tbody>
    </table>` : '<p class="t-body-sm">No citation yet.</p>'}`;

  host.querySelector('#tg-primary')?.addEventListener('change', (e) => {
    host.querySelector('#tg-summary').textContent = appealCases.ground(e.target.value)?.summary || '';
    for (const box of host.querySelectorAll('[data-ground]')) box.disabled = box.dataset.ground === e.target.value || !editable;
  });

  host.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'save-grounds') {
      const primary = host.querySelector('#tg-primary').value;
      const secondary = [...host.querySelectorAll('[data-ground]:checked')].map((b) => b.dataset.ground);
      const r = appealCases.setGrounds(caseId, { primary, secondary });
      if (r?.error) return void toast(r.error, 'critical');
      toast('Grounds saved');
      return;
    }
    if (act === 'cite') { await openCitationPicker(caseId); return; }
    const cid = e.target.closest('tr[data-cid]')?.dataset.cid;
    if (act === 'argue' && cid) {
      const r = appealCases.updateCitation(caseId, cid, { argument: e.target.closest('tr').querySelector('[data-argument]').value });
      if (r?.error) return void toast(r.error, 'critical');
      toast(`${cid} argued`);
      return;
    }
    if (act === 'uncite' && cid) {
      const r = appealCases.removeCitation(caseId, cid);
      if (r?.error) return void toast(r.error, 'critical');
      toast(`${cid} removed`);
      redraw();
    }
  });
}
