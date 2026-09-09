// Patient documents — the upload row and the list, shared by the Documents tab
// on the record page and the one on the edit form. They are the same panel: a
// document is written to the record as it is uploaded, so leaving either screen
// never loses one and the trail carries an entry per file.
//
// The demo stores the file's details, not the file — Download says so.

import * as patients from '../../../../data/repositories/patients.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { dateTime, esc, fileSize } from '../../../../shared/format.js';

const ACCEPT = ['pdf', 'jpg', 'jpeg', 'png'];

/** The whole panel. `patient` is null while registering: nothing to hang a file on. */
export function documentsHtml(patient, { readOnly = false } = {}) {
  if (!patient) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">upload_file</span></div>
        <div class="state-view__title">Save first</div>
        <p class="state-view__body">Documents attach to an MRN, and this patient has none yet. Save the registration and the tab opens.</p>
      </div>`;
  }

  const docs = patient.documents || [];
  return `
    ${readOnly ? '' : uploadHtml()}
    ${docs.length ? tableHtml(docs, readOnly) : emptyHtml(readOnly)}`;
}

function uploadHtml() {
  return `
    <div class="rule-child-row">
      <label class="field">
        <span class="icon icon--sm">description</span>
        <select name="docType" aria-label="Document type">
          ${patients.DOCUMENT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <input type="file" name="docFile" aria-label="File" accept=".pdf,.jpg,.jpeg,.png">
      </label>
      <label class="field">
        <input name="docDescription" aria-label="Description" placeholder="Description">
      </label>
      <button class="btn btn--secondary btn--sm" data-act="doc-add">
        <span class="icon icon--sm">upload_file</span>Upload document
      </button>
    </div>
    <div class="field-error" data-error="documents" hidden></div>
    <p class="t-body-sm">PDF, JPG or PNG, up to 10 MB. The demo stores the file details, not the file.</p>`;
}

function tableHtml(docs, readOnly) {
  return `
    <table class="tbl">
      <thead>
        <tr><th>Type</th><th>File</th><th>Description</th><th>Uploaded by</th><th>Uploaded</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${docs.map((d) => `
          <tr data-doc="${esc(d.id)}">
            <td>${esc(d.type)}</td>
            <td>${esc(d.fileName)}<br><span class="t-body-sm">${fileSize(d.size)}</span></td>
            <td>${d.description ? esc(d.description) : '—'}</td>
            <td>${esc(d.uploadedBy)}</td>
            <td class="t-mono-sm">${dateTime(d.uploadedAt)}</td>
            <td>
              <button class="btn btn--ghost btn--icon btn--sm" data-act="doc-download" title="Download ${esc(d.fileName)}">
                <span class="icon icon--sm">download</span>
              </button>
              ${readOnly ? '' : `
                <button class="btn btn--ghost btn--icon btn--sm" data-act="doc-delete" title="Delete ${esc(d.fileName)}">
                  <span class="icon icon--sm">delete</span>
                </button>`}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function emptyHtml(readOnly) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">folder_open</span></div>
      <div class="state-view__title">No documents yet</div>
      <p class="state-view__body">${readOnly
        ? 'Nothing was attached to this record.'
        : 'Attach the civil ID copy, the passport copy or a signed consent form, and each upload is recorded in the trail.'}</p>
    </div>`;
}

// --- actions ------------------------------------------------------------------

/** Read the upload row, validate it, write the document. Returns true on save. */
export function addDocument(root, mrn) {
  const box = root.querySelector('[data-error="documents"]');
  const type = root.querySelector('[name="docType"]')?.value;
  const input = root.querySelector('[name="docFile"]');
  const description = root.querySelector('[name="docDescription"]')?.value.trim() || '';
  const file = input?.files?.[0];

  const fail = (message) => {
    box.textContent = message;
    box.hidden = false;
    return false;
  };
  box.hidden = true;

  if (!file) return fail('Choose a file to upload.');
  const ext = file.name.split('.').pop().toLowerCase();
  if (!ACCEPT.includes(ext)) return fail(`${file.name} is not a PDF, JPG or PNG.`);
  if (file.size > patients.MAX_DOCUMENT_BYTES) {
    return fail(`${file.name} is ${fileSize(file.size)}. The limit is 10 MB.`);
  }

  patients.addDocument(mrn, {
    type,
    fileName: file.name,
    size: file.size,
    description,
    uploadedBy: currentRole().name,
  });
  toast(`Attached ${file.name}`, 'success');
  return true;
}

/** Download and delete. Returns true when the record changed. */
export async function handleDocument(action, mrn, docId) {
  const patient = patients.get(mrn);
  const doc = patient?.documents.find((d) => d.id === docId);
  if (!doc) return false;

  if (action === 'doc-download') {
    toast(`Downloaded ${doc.fileName}`, 'info');
    return false;
  }

  const ok = await modal.confirm({
    title: 'Delete document',
    body: `${doc.fileName} is removed from ${patient.mrn}. The audit trail keeps the record of both the upload and this deletion.`,
    confirmLabel: 'Delete document',
    tone: 'critical',
    icon: 'delete',
  });
  if (!ok) return false;

  patients.removeDocument(mrn, docId);
  toast(`Removed ${doc.fileName}`, 'success');
  return true;
}
