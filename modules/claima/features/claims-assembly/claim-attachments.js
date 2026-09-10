// The Attachments tab of the claim page: what the contract asks for and
// whether it is there, what the claim carries (pulled from the chart or
// uploaded by hand), the visit's other clinical documents, and the upload
// form. It owns its own node and its own listener; claim-view.js hands it a
// div and a redraw.

import * as claims from '../../../../data/repositories/claims.js';
import * as claimAttachments from '../../../../data/repositories/claim-attachments.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, fileSize } from '../../../../shared/format.js';

/** render(host, { id, redraw }) */
export function render(host, { id, redraw }) {
  const claim = () => claims.get(id);

  function draw() {
    const row = claim();
    const editable = row.status === 'Draft';
    const status = claimAttachments.requirementStatus(row);
    const docs = claims.clinicalDocsOf(row.encounterNo);
    const onClaim = new Set((row.attachments || []).map((a) => a.docId).filter(Boolean));
    const spare = (docs || []).filter((d) => !onClaim.has(d.id));
    host.innerHTML = `
      ${requirementsHtml(status)}
      <div class="toolbar">
        <span class="t-title-sm">Attached</span>
        <span class="badge">${(row.attachments || []).length}</span>
        <span class="spacer"></span>
        ${editable ? '<button class="btn btn--primary btn--sm" data-act="upload"><span class="icon icon--sm">upload_file</span>Upload</button>'
    : '<span class="t-body-sm">Locked — reopen the claim to change attachments</span>'}
      </div>
      ${(row.attachments || []).length ? attachedTable(row, editable) : '<p class="t-body-sm">Nothing attached yet.</p>'}
      ${docs === undefined
        ? '<p class="t-body-sm">The clinical record is not loaded, so nothing can be pulled from the chart yet.</p>'
        : spare.length ? spareHtml(spare, editable) : ''}`;
  }

  function requirementsHtml(status) {
    if (!status.length) {
      return `
        <div class="alert alert--info"><span class="icon">info</span>
          <div>The contract asks for no documents on this claim. Anything attached rides along as support.</div></div>`;
    }
    const missing = status.filter((r) => !r.met).length;
    return `
      <div class="toolbar">
        <span class="t-title-sm">Required by the contract</span>
        <span class="badge badge--${missing ? 'critical' : 'success'}">${missing ? `${missing} missing` : 'complete'}</span>
      </div>
      <table class="tbl">
        <thead><tr><th>Document</th><th>Why</th><th>Lines</th><th>Status</th></tr></thead>
        <tbody>${status.map((r) => `
          <tr data-doc="${esc(r.docType)}">
            <td>${esc(r.docType)}</td>
            <td class="t-body-sm">${esc(r.reason)}</td>
            <td class="t-mono-sm">${(r.lineIds || []).join(', ') || 'whole claim'}</td>
            <td>${r.met
    ? `<span class="badge badge--success"><span class="dot"></span>Attached</span> <span class="t-body-sm">${r.satisfiedBy.map((a) => esc(a.fileName)).join(', ')}</span>`
    : '<span class="badge badge--critical"><span class="dot"></span>Missing</span>'}</td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  function attachedTable(row, editable) {
    return `
      <table class="tbl">
        <thead><tr><th>File</th><th>Type</th><th>Origin</th><th>Linked lines</th><th>Required</th><th></th></tr></thead>
        <tbody>${row.attachments.map((a) => {
    const file = a.fileId ? claimAttachments.get(a.fileId) : null;
    return `
          <tr data-att="${esc(a.id)}" data-doc="${esc(a.type)}">
            <td><span class="t-mono-sm">${esc(a.id)}</span> ${esc(a.fileName)}${file
    ? `<br><span class="t-body-sm">${esc(fileSize(file.size))} · ${date(file.uploadedAt)} · ${esc(file.uploadedBy)}</span>` : ''}</td>
            <td>${esc(a.type)}</td>
            <td><span class="badge${a.origin === 'Auto' ? ' badge--info' : ''}" title="${a.origin === 'Auto'
      ? 'Pulled from the chart by reference' : 'Uploaded by the biller'}">${esc(a.origin)}</span></td>
            <td class="t-mono-sm">${(a.lineIds || []).join(', ') || '—'}</td>
            <td>${a.required ? '<span class="badge badge--success">Yes</span>' : '<span class="t-body-sm">Support</span>'}</td>
            <td>${editable ? `
              <button class="btn btn--ghost btn--icon btn--sm" data-act="link" title="Link to lines">
                <span class="icon icon--sm">link</span></button>
              <button class="btn btn--ghost btn--icon btn--sm" data-act="remove" title="Remove from the claim">
                <span class="icon icon--sm">delete</span></button>` : ''}</td>
          </tr>`;
  }).join('')}</tbody>
      </table>`;
  }

  function spareHtml(docs, editable) {
    return `
      <div class="toolbar"><span class="t-title-sm">On the chart, not attached</span><span class="badge">${docs.length}</span></div>
      <table class="tbl">
        <thead><tr><th>Document</th><th>Type</th><th>Date</th><th>Author</th><th></th></tr></thead>
        <tbody>${docs.map((d) => `
          <tr data-cdoc="${esc(d.id)}">
            <td>${esc(d.title || d.fileName || d.id)}</td>
            <td>${esc(d.type)}</td>
            <td>${d.date ? date(d.date) : '—'}</td>
            <td>${esc(d.author || '—')}</td>
            <td>${editable
    ? '<button class="btn btn--secondary btn--sm" data-act="attach"><span class="icon icon--sm">attach_file</span>Attach</button>' : ''}</td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  // --- dialogs ----------------------------------------------------------------

  async function askUpload() {
    const row = claim();
    const dialog = modal.open({
      title: 'Upload a document',
      sub: `${esc(row.claimNo)} · PDF, JPG or PNG up to ${fileSize(claimAttachments.MAX_BYTES)}`,
      icon: 'upload_file',
      body: `
        <dl class="dl dl--narrow">
          <dt><label for="cu-file">File *</label></dt>
          <dd><label class="field"><input id="cu-file" type="file" accept=".pdf,.jpg,.jpeg,.png"></label></dd>
          <dt><label for="cu-type">Type *</label></dt>
          <dd><label class="field"><select id="cu-type">${claimAttachments.TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label></dd>
          <dt>Link to lines</dt>
          <dd>${row.lines.length ? row.lines.map((l) => `
            <label class="rule-child-row">
              <input type="checkbox" data-line-pick="${esc(l.id)}">
              <span><span class="t-mono-sm">${esc(l.id)}</span> ${esc(l.chargeCode || '')} ${esc(l.description || '')}</span>
            </label>`).join('') : '<span class="t-body-sm">No lines on the claim.</span>'}</dd>
        </dl>
        <div class="field-error" id="cu-error" hidden></div>`,
      foot: `
        <button class="btn btn--secondary" data-close>Cancel</button>
        <button class="btn btn--primary" data-act="save">Attach</button>`,
    });
    dialog.el.addEventListener('click', (e) => {
      if (!e.target.closest('[data-act="save"]')) return;
      const file = dialog.el.querySelector('#cu-file').files[0];
      const box = dialog.el.querySelector('#cu-error');
      if (!file) { box.textContent = 'Choose a file.'; box.hidden = false; return; }
      if (file.size > claimAttachments.MAX_BYTES) { box.textContent = `Too large — the limit is ${fileSize(claimAttachments.MAX_BYTES)}.`; box.hidden = false; return; }
      const lineIds = [...dialog.el.querySelectorAll('[data-line-pick]:checked')].map((el) => el.dataset.linePick);
      const att = claims.addUpload(id, { fileName: file.name, type: dialog.el.querySelector('#cu-type').value, size: file.size, lineIds });
      dialog.close(att);
      if (att) toast(`${file.name} attached`, 'success');
    });
    await dialog.closed;
    redraw();
  }

  async function askLink(attId) {
    const row = claim();
    const att = row.attachments.find((a) => a.id === attId);
    if (!att) return;
    const dialog = modal.open({
      title: `Link ${att.fileName}`,
      sub: 'Which lines this document supports',
      icon: 'link',
      body: `${row.lines.map((l) => `
        <label class="rule-child-row">
          <input type="checkbox" data-line-pick="${esc(l.id)}"${att.lineIds.includes(l.id) ? ' checked' : ''}>
          <span><span class="t-mono-sm">${esc(l.id)}</span> ${esc(l.chargeCode || '')} ${esc(l.description || '')}</span>
        </label>`).join('') || '<p class="t-body-sm">No lines on the claim.</p>'}`,
      foot: `
        <button class="btn btn--secondary" data-close>Cancel</button>
        <button class="btn btn--primary" data-act="save">Save links</button>`,
    });
    dialog.el.addEventListener('click', (e) => {
      if (!e.target.closest('[data-act="save"]')) return;
      const lineIds = [...dialog.el.querySelectorAll('[data-line-pick]:checked')].map((el) => el.dataset.linePick);
      dialog.close(claims.linkAttachment(id, attId, lineIds));
      toast('Links saved', 'success');
    });
    await dialog.closed;
    redraw();
  }

  async function askRemove(attId) {
    const att = claim().attachments.find((a) => a.id === attId);
    if (!att) return;
    const ok = await modal.confirm({
      title: 'Remove attachment',
      body: `${att.fileName} comes off the claim${att.required ? ', and the contract still asks for a document of this type' : ''}. ${
        att.origin === 'Auto' ? 'The document stays on the chart.' : 'The uploaded file is discarded.'}`,
      confirmLabel: 'Remove',
      tone: 'critical',
      icon: 'delete',
    });
    if (!ok) return;
    claims.removeAttachment(id, attId);
    toast('Attachment removed', 'success');
    redraw();
  }

  host.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'upload') return void askUpload();
    const attId = e.target.closest('tr[data-att]')?.dataset.att;
    if (act === 'link') return void askLink(attId);
    if (act === 'remove') return void askRemove(attId);
    if (act === 'attach') {
      const docId = e.target.closest('tr[data-cdoc]')?.dataset.cdoc;
      const att = claims.attachDoc(id, docId);
      toast(att ? `${att.fileName} attached from the chart` : 'Could not attach that document', att ? 'success' : 'warning');
      return redraw();
    }
  });

  draw();
}
