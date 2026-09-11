// The Letter tab on the appeal page — Tab 4: pick a template, generate the
// letter from the merge fields as they stand (a new version every time, so
// a regenerated letter never overwrites an edited one), edit the text in
// place and save it as a version flagged as edited by hand, and read any
// earlier version back. Once the case is in review the letter is read-only;
// once approved the locked version is the one the package carries. The
// editor is a contenteditable panel — the design system ships no editor and
// a module writes no CSS.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import { MERGE_FIELDS } from '../../../../data/seed/letter-templates.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';

const viewing = new Map(); // caseId -> version number on screen, kept across redraws

export function render(host, { caseId, redraw }) {
  const row = appealCases.get(caseId);
  if (!row) return;
  const editable = appealCases.isEditable(row);
  const versions = row.letter.versions;
  const locked = appealCases.lockedLetter(row);
  const shown = versions.find((v) => v.n === viewing.get(caseId)) || versions[versions.length - 1] || null;
  const latest = shown && shown.n === versions.length;
  const lock = editable ? '' : ` disabled title="${esc(`A ${appealCases.statusLabel(row.status).toLowerCase()} case is not edited`)}"`;
  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Template</span>
      <label class="field"><span class="icon icon--sm">description</span>
        <select id="tl-template" aria-label="Template"${editable ? '' : ' disabled'}>${appealCases.TEMPLATES.map((t) => `<option value="${t.id}"${t.id === (row.letter.templateId || appealCases.templateFor(row.grounds.primary).id) ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      </label>
      <button class="btn btn--${versions.length ? 'secondary' : 'primary'} btn--sm" data-act="generate"${lock}><span class="icon icon--sm">auto_awesome</span>${versions.length ? 'Regenerate' : 'Generate letter'}</button>
      <span class="spacer"></span>
      ${locked ? `<span class="badge badge--success" title="${esc(`Locked ${dateTime(row.letter.finalLockedAt)} — v${locked.n} is what the package carries`)}"><span class="icon icon--sm">lock</span>v${locked.n} locked</span>` : ''}
    </div>
    ${versions.length ? `
    <div class="toolbar">
      <span class="t-title-sm">Versions</span>
      <div class="segmented" role="group" aria-label="Letter version">${versions.map((v) => `
        <button type="button" data-version="${v.n}" aria-pressed="${shown?.n === v.n}" title="${esc(`${v.manuallyEdited ? 'Edited by hand' : 'Generated'} ${dateTime(v.generatedAt)} by ${v.by}`)}">v${v.n}${v.manuallyEdited ? ' · edited' : ''}${locked?.n === v.n ? ' · locked' : ''}</button>`).join('')}</div>
      <span class="t-body-sm">${shown ? `${shown.manuallyEdited ? 'Edited by hand' : 'Generated'} ${dateTime(shown.generatedAt)} · ${esc(shown.by)}${shown.manuallyEdited ? ' · <span class="badge badge--warning">manual edit</span>' : ''}` : ''}</span>
      <span class="spacer"></span>
      ${editable && latest ? `
      <button class="btn btn--ghost btn--sm" data-act="discard" title="Throw away the unsaved edits"><span class="icon icon--sm">undo</span>Discard</button>
      <button class="btn btn--primary btn--sm" data-act="save" title="Save the text as a new version, flagged as edited by hand"><span class="icon icon--sm">save</span>Save as v${versions.length + 1}</button>` : ''}
    </div>
    <div class="panel">
      <div class="panel-body">
        <div id="tl-editor" contenteditable="${editable && latest ? 'true' : 'false'}" role="textbox" aria-multiline="true" aria-label="Letter" spellcheck="true">${shown.html}</div>
      </div>
    </div>
    ${!latest ? `<p class="t-body-sm">Reading v${shown.n}; the latest is v${versions.length}. Only the latest version is edited.</p>` : ''}` : `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">drafts</span></div>
      <div class="state-view__title">No letter yet</div>
      <p class="state-view__body">Pick a template and generate the letter. The grounds, the citations, the lines in dispute and the enclosures are merged in as they stand — regenerate after they change.</p>
      ${editable ? '<div class="state-view__actions"><button class="btn btn--primary" data-act="generate">Generate letter</button></div>' : ''}
    </div>`}
    <details>
      <summary class="panel-header"><span>Merge fields</span><span class="badge">${MERGE_FIELDS.length}</span></summary>
      <div class="panel-body">
        <p class="t-body-sm">What a template may name, written as {{field}}. A table or a list arrives rendered; everything else is escaped.</p>
        <dl class="dl dl--narrow">${MERGE_FIELDS.map((f) => `<dt><span class="t-mono-sm">${esc(f.key)}</span></dt><dd>${esc(f.label)}${f.html ? ' <span class="badge">html</span>' : ''}</dd>`).join('')}</dl>
      </div>
    </details>`;

  host.querySelector('#tl-template')?.addEventListener('change', (e) => {
    const r = appealCases.setTemplate(caseId, e.target.value);
    if (r?.error) toast(r.error, 'critical');
  });

  host.addEventListener('click', (e) => {
    const v = e.target.closest('[data-version]');
    if (v) { viewing.set(caseId, Number(v.dataset.version)); return redraw(); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return undefined;
    if (act === 'generate') {
      const r = appealCases.generateLetter(caseId);
      if (r?.error) return void toast(r.error, 'critical');
      viewing.delete(caseId);
      return void toast(`Letter v${r.n} generated`);
    }
    if (act === 'save') {
      const r = appealCases.editLetter(caseId, host.querySelector('#tl-editor').innerHTML);
      if (r?.error) return void toast(r.error, 'critical');
      viewing.delete(caseId);
      return void toast(`Letter saved as v${r.n} — edited by hand`);
    }
    if (act === 'discard') return redraw();
    return undefined;
  });
}
