// The Evidence bundle tab on the appeal page — Tab 3: what the registers
// suggest (the claim, the denial notice, the remittance, the contract
// extracts, the visit's authorisations, referral, eligibility check,
// documents, coding — each attached by reference in one click, never
// copied), the uploads the desk adds, and the bundle itself in the order
// the package will list it, with an include toggle and up/down controls. A
// ground argued with nothing behind it is warned about at the top.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import { BUNDLE_ICONS } from '../../../../data/seed/appeal-grounds.js';
import { esc, fileSize } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';

export function render(host, { caseId, redraw }) {
  const row = appealCases.get(caseId);
  if (!row) return;
  const editable = appealCases.isEditable(row);
  const lock = editable ? '' : ` disabled title="${esc(`A ${appealCases.statusLabel(row.status).toLowerCase()} case is not edited`)}"`;
  const suggested = appealCases.suggestedBundle(row);
  const bundle = [...row.bundle].sort((a, b) => a.order - b.order);
  const warnings = appealCases.evidenceWarnings(row);
  const icon = (type) => `<span class="icon icon--sm" aria-hidden="true">${BUNDLE_ICONS[type] || 'attach_file'}</span>`;
  host.innerHTML = `
    ${warnings.length ? `<div class="alert alert--warning"><span class="icon">warning</span><div><div class="title">Evidence the grounds expect and the bundle does not carry</div>${
    warnings.map((w) => `<strong>${esc(w.label)}</strong>: ${w.missing.map(esc).join(', ')}`).join('<br>')}</div></div>` : ''}
    <div class="toolbar">
      <span class="t-title-sm">Bundle</span>
      <span class="badge">${bundle.filter((b) => b.included).length} of ${bundle.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">In the order the package lists them; an item left out stays on the case and off the index.</span>
    </div>
    ${bundle.length ? `
    <table class="tbl">
      <thead><tr><th scope="col">#</th><th scope="col">Include</th><th scope="col">Type</th><th scope="col">Item</th><th scope="col">Source</th><th scope="col">Order</th><th scope="col"></th></tr></thead>
      <tbody>${bundle.map((b, i) => `
        <tr data-bid="${esc(b.id)}"${b.included ? '' : ' aria-disabled="true"'}>
          <td><span class="t-mono-sm">${b.included ? bundle.filter((x) => x.included && x.order <= b.order).length : '—'}</span></td>
          <td><input type="checkbox" data-include${b.included ? ' checked' : ''}${editable ? '' : ' disabled'} aria-label="Include ${esc(b.id)}"></td>
          <td>${icon(b.type)} ${esc(b.type)}</td>
          <td>${b.href ? `<a class="crumb-link" href="${esc(b.href)}">${esc(b.description)}</a>` : esc(b.description)}${b.file ? `<br><span class="t-body-sm">${esc(b.file.name)} · ${esc(fileSize(b.file.size))}</span>` : b.ref ? `<br><span class="t-mono-sm">${esc(b.ref)}</span>` : ''}</td>
          <td><span class="badge${b.source === 'upload' ? ' badge--info' : ''}" title="${b.source === 'upload' ? 'A file the desk added' : 'A reference into a register — read live, never copied'}">${b.source === 'upload' ? 'Upload' : 'System'}</span></td>
          <td>
            <button class="btn btn--ghost btn--sm" data-act="up" title="Move up"${i === 0 ? ' disabled' : lock}><span class="icon icon--sm">arrow_upward</span></button>
            <button class="btn btn--ghost btn--sm" data-act="down" title="Move down"${i === bundle.length - 1 ? ' disabled' : lock}><span class="icon icon--sm">arrow_downward</span></button>
          </td>
          <td><button class="btn btn--ghost btn--sm" data-act="remove" title="Remove from the case"${lock}><span class="icon icon--sm">delete</span></button></td>
        </tr>`).join('')}</tbody>
    </table>` : '<p class="t-body-sm">Nothing in the bundle yet — attach what the registers suggest below, or add a file.</p>'}

    <div class="toolbar">
      <span class="t-title-sm">Suggested from the registers</span>
      <span class="badge">${suggested.filter((s) => !s.attached).length}</span>
      <span class="spacer"></span>
      <button class="btn btn--secondary btn--sm" data-act="attach-all"${suggested.some((s) => !s.attached) ? lock : ' disabled title="Everything suggested is already attached"'}><span class="icon icon--sm">playlist_add</span>Attach all</button>
    </div>
    ${suggested.length ? `
    <table class="tbl">
      <thead><tr><th scope="col">Type</th><th scope="col">Item</th><th scope="col"></th></tr></thead>
      <tbody>${suggested.map((s) => `
        <tr data-suggest="${esc(`${s.type}|${s.ref}`)}">
          <td>${icon(s.type)} ${esc(s.type)}</td>
          <td>${s.href ? `<a class="crumb-link" href="${esc(s.href)}">${esc(s.description)}</a>` : esc(s.description)}<br><span class="t-mono-sm">${esc(s.ref)}</span></td>
          <td>${s.attached ? '<span class="badge badge--success">Attached</span>' : `<button class="btn btn--secondary btn--sm" data-act="attach" title="Attach by reference"${lock}><span class="icon icon--sm">attach_file</span>Attach</button>`}</td>
        </tr>`).join('')}</tbody>
    </table>` : '<p class="t-body-sm">The registers hold nothing on this claim beyond the denial.</p>'}

    <div class="toolbar">
      <span class="t-title-sm">Add a file</span>
      <span class="spacer"></span>
      <span class="t-body-sm">A physician's statement, a protocol extract, a payer letter — the name and size are kept, the file stays with the desk.</span>
    </div>
    <div class="toolbar">
      <label class="field"><span class="icon icon--sm">category</span>
        <select id="tb-type" aria-label="Evidence type"${editable ? '' : ' disabled'}>${appealCases.BUNDLE_TYPES.filter((t) => t !== 'Prior appeal package').map((t) => `<option value="${esc(t)}"${t === 'Upload' ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
      </label>
      <label class="field field--grow"><span class="icon icon--sm">description</span>
        <input id="tb-desc" placeholder="What the file shows" aria-label="Description" maxlength="120"${editable ? '' : ' disabled'}>
      </label>
      <label class="field"><span class="icon icon--sm">upload_file</span>
        <input type="file" id="tb-file" aria-label="File"${editable ? '' : ' disabled'}>
      </label>
      <button class="btn btn--secondary btn--sm" data-act="upload"${lock}><span class="icon icon--sm">add</span>Add file</button>
    </div>`;

  host.addEventListener('change', (e) => {
    const box = e.target.closest('[data-include]');
    if (!box) return;
    const bid = box.closest('tr[data-bid]')?.dataset.bid;
    const r = appealCases.setBundleIncluded(caseId, bid, box.checked);
    if (r?.error) toast(r.error, 'critical');
  });

  host.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const fresh = appealCases.get(caseId);
    if (act === 'attach' || act === 'attach-all') {
      const keys = act === 'attach' ? [e.target.closest('tr[data-suggest]')?.dataset.suggest] : null;
      const items = appealCases.suggestedBundle(fresh).filter((s) => !s.attached && (!keys || keys.includes(`${s.type}|${s.ref}`)));
      let n = 0;
      for (const s of items) {
        const r = appealCases.addBundleItem(caseId, { type: s.type, source: 'system', ref: s.ref, description: s.description, href: s.href });
        if (r?.error) toast(r.error, 'critical'); else n += 1;
      }
      if (n) toast(`${n} item${n === 1 ? '' : 's'} attached`);
      return;
    }
    if (act === 'upload') {
      const file = host.querySelector('#tb-file').files?.[0];
      if (!file) return void toast('Pick a file first', 'warning');
      const r = appealCases.addBundleItem(caseId, { type: host.querySelector('#tb-type').value, source: 'upload', file: { name: file.name, size: file.size }, description: host.querySelector('#tb-desc').value });
      if (r?.error) return void toast(r.error, 'critical');
      toast(`${file.name} added`);
      return;
    }
    const bid = e.target.closest('tr[data-bid]')?.dataset.bid;
    if (!bid) return;
    const r = act === 'remove' ? appealCases.removeBundleItem(caseId, bid) : appealCases.moveBundleItem(caseId, bid, act);
    if (r?.error) toast(r.error, 'critical');
    else if (act === 'remove') { toast(`${bid} removed`); redraw(); }
  });
}
