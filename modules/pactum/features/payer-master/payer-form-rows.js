// The repeatable parts of the payer modal: contact rows, plan rows and the
// document list. The DOM is the source of truth while the modal is open;
// payer-form.js reads it back on save and hands the result to the repository.

import * as payers from '../../../../data/repositories/payers.js';
import { date, esc, fileSize, isEmail, isPhone } from '../../../../shared/format.js';

const MAX_DOC_BYTES = 10 * 1024 * 1024;
const DOC_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx'];

const options = (list, selected) =>
  list.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');

const cell = (name, label, value, placeholder = '') =>
  `<label class="field"><input name="${name}" aria-label="${esc(label)}" placeholder="${esc(placeholder)}" value="${esc(value ?? '')}"></label>`;

// --- contacts ----------------------------------------------------------------

export function renderContacts(root, contacts) {
  root.innerHTML = contacts.map(contactRow).join('');
}

export function contactRow(contact = {}) {
  return `
    <div class="rule-child-row" data-row="contact" data-id="${esc(contact.id || payers.newId('CT-'))}">
      ${cell('name', 'Contact name', contact.name, 'Full name')}
      <label class="field">
        <select name="role" aria-label="Role">${options(payers.CONTACT_ROLES, contact.role || 'Claims Manager')}</select>
      </label>
      ${cell('email', 'Contact email', contact.email, 'name@payer.com')}
      ${cell('phone', 'Contact phone', contact.phone, '+961 3 214 587')}
      <button class="btn btn--ghost btn--icon btn--sm" data-remove="contact" title="Delete this contact">
        <span class="icon icon--sm">delete</span>
      </button>
    </div>`;
}

export function validateContacts(rows) {
  const errors = [];
  rows.forEach((row, i) => {
    if (row.name.trim().length < 2) errors.push(err(i, 'name', 'enter the contact name'));
    if (!payers.CONTACT_ROLES.includes(row.role)) errors.push(err(i, 'role', 'choose a role'));
    if (!isEmail(row.email)) errors.push(err(i, 'email', 'enter a valid email'));
    if (!isPhone(row.phone)) errors.push(err(i, 'phone', 'enter a number like +961 3 214 587'));
  });
  return errors;
}

// --- plans -------------------------------------------------------------------

export function renderPlans(root, plans) {
  root.innerHTML = plans.map(planRow).join('');
}

export function planRow(plan = {}) {
  return `
    <div class="rule-child-row" data-row="plan" data-id="${esc(plan.id || payers.newId('PL-'))}">
      ${cell('name', 'Plan name', plan.name, 'Blue class A')}
      ${cell('code', 'Plan code', plan.code, 'BNK-A')}
      <label class="field">
        <select name="status" aria-label="Plan status">${options(payers.STATUSES, plan.status || 'Active')}</select>
      </label>
      <button class="btn btn--ghost btn--icon btn--sm" data-remove="plan" title="Delete this plan">
        <span class="icon icon--sm">delete</span>
      </button>
    </div>`;
}

export function validatePlans(rows) {
  const errors = [];
  const seen = new Map();
  rows.forEach((row, i) => {
    if (row.name.trim().length < 2) errors.push(err(i, 'name', 'enter the plan name'));
    const code = row.code.trim().toUpperCase();
    if (!code) errors.push(err(i, 'code', 'enter the plan code'));
    else if (seen.has(code)) errors.push(err(i, 'code', `code ${code} is already used on this payer`));
    else seen.set(code, i);
    if (!payers.STATUSES.includes(row.status)) errors.push(err(i, 'status', 'choose a status'));
  });
  return errors;
}

// --- documents ---------------------------------------------------------------

export function renderDocuments(root, documents) {
  if (!documents.length) {
    root.innerHTML = '<p class="t-body-sm">No documents attached to this payer.</p>';
    return;
  }
  root.innerHTML = `
    <table class="tbl">
      <thead>
        <tr><th>File</th><th>Type</th><th>Description</th><th>Uploaded by</th><th>Date</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${documents.map(documentRow).join('')}
      </tbody>
    </table>`;
}

function documentRow(doc) {
  return `
    <tr data-doc="${esc(doc.id)}">
      <td>${esc(doc.fileName)}<br><span class="t-mono-sm">${fileSize(doc.size)}</span></td>
      <td><span class="badge">${esc(doc.type)}</span></td>
      <td>${doc.description ? esc(doc.description) : '—'}</td>
      <td>${esc(doc.uploadedBy)}</td>
      <td class="t-mono-sm">${date(doc.uploadedAt)}</td>
      <td>
        <button class="btn btn--ghost btn--icon btn--sm" data-doc-act="download" title="Download ${esc(doc.fileName)}">
          <span class="icon icon--sm">download</span>
        </button>
        <button class="btn btn--ghost btn--icon btn--sm" data-doc-act="delete" title="Delete ${esc(doc.fileName)}">
          <span class="icon icon--sm">delete</span>
        </button>
      </td>
    </tr>`;
}

/** Reads the upload row. Returns { doc } or { message } when it cannot. */
export function readDocumentForm(root, uploadedBy) {
  const type = root.querySelector('[name="docType"]').value;
  const input = root.querySelector('[name="docFile"]');
  const description = root.querySelector('[name="docDescription"]').value.trim();
  const file = input.files?.[0];

  if (!payers.DOCUMENT_TYPES.includes(type)) return { message: 'Choose a document type.' };
  if (!file) return { message: 'Choose a file to upload.' };

  const ext = file.name.split('.').pop().toLowerCase();
  if (!DOC_EXTENSIONS.includes(ext)) {
    return { message: `${file.name} is not a PDF, JPG, PNG, DOCX or XLSX file.` };
  }
  if (file.size > MAX_DOC_BYTES) {
    return { message: `${file.name} is ${fileSize(file.size)}. The limit is 10 MB.` };
  }

  return {
    doc: {
      id: payers.newId('DOC-'),
      type,
      fileName: file.name,
      size: file.size,
      description,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
    },
  };
}

// --- shared ------------------------------------------------------------------

/** Reads every child row of one container back into plain objects. */
export function readRows(root) {
  return [...root.querySelectorAll('[data-row]')].map((rowEl) => {
    const row = { id: rowEl.dataset.id };
    for (const el of rowEl.querySelectorAll('[name]')) row[el.name] = el.value.trim();
    return row;
  });
}

/** Paints the invalid fields of a row list and returns the first message. */
export function markRowErrors(root, errors) {
  for (const field of root.querySelectorAll('.field')) field.classList.remove('field--invalid');
  if (!errors.length) return '';
  const rows = [...root.querySelectorAll('[data-row]')];
  for (const e of errors) {
    const input = rows[e.index]?.querySelector(`[name="${e.field}"]`);
    input?.closest('.field')?.classList.add('field--invalid');
  }
  const first = errors[0];
  rows[first.index]?.querySelector(`[name="${first.field}"]`)?.focus();
  return `Row ${first.index + 1}: ${first.message}.`;
}

const err = (index, field, message) => ({ index, field, message });
