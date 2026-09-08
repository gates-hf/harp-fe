// Add / edit payer — one modal, four tabs, one save. Cancel discards
// everything, documents included: nothing reaches the repository until Save
// validates every tab.

import * as payers from '../../../../data/repositories/payers.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { dateTime, esc, isEmail, isPhone } from '../../../../shared/format.js';
import * as rows from './payer-form-rows.js';

const TABS = ['general', 'contacts', 'plans', 'documents'];

/** Agreements, not rows: every version of one contract counts once. */
const agreementCount = (payerId) =>
  new Set(contracts.byPayer(payerId).map((c) => c.lineageId)).size;

/** openPayerForm(id | null) -> Promise<payer | undefined>. */
export async function openPayerForm(id) {
  const payer = id ? payers.get(id) : null;
  if (id && !payer) return undefined;

  const res = await fetch(new URL('./payer-form.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load payer-form.html (${res.status})`);

  const dialog = modal.open({
    title: payer ? esc(payer.nameEn) : 'Add payer',
    sub: payer
      ? `${esc(payer.type)} · ${esc(payer.status)} · updated ${dateTime(payer.updatedAt)}`
      : 'General info, contacts, plans and documents.',
    icon: payer ? 'account_balance' : 'add_business',
    size: 'xxl',
    body: await res.text(),
    note: 'Cancel discards every change on all four tabs.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Save payer</button>`,
  });

  const el = dialog.el;
  const $ = (sel) => el.querySelector(sel);
  const documents = (payer?.documents || []).map((d) => ({ ...d }));

  $('#pf-type').innerHTML = payers.TYPES.map(
    (t) => `<option value="${t}"${payer?.type === t ? ' selected' : ''}>${t}</option>`).join('');
  $('#pf-status').innerHTML = payers.STATUSES.map(
    (s) => `<option value="${s}"${(payer?.status || 'Active') === s ? ' selected' : ''}>${s}</option>`).join('');
  $('[name="docType"]').innerHTML = payers.DOCUMENT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('');

  for (const name of ['nameEn', 'nameAr', 'licenseNo', 'email', 'phone', 'address']) {
    $(`[name="${name}"]`).value = payer?.[name] ?? '';
  }

  // The contracts of this payer are a screen of their own — the editor links
  // to it rather than trying to hold a second list, and counts agreements the
  // way that screen does: every version of one agreement is a single line.
  $('#pf-contracts').innerHTML = payer
    ? `<a class="btn btn--secondary btn--sm" href="#/pactum/payers/${payer.id}/contracts" data-act="contracts">
         <span class="icon icon--sm">contract</span>Contracts (${agreementCount(payer.id)})
       </a>`
    : `<button class="btn btn--secondary btn--sm" disabled title="Save this payer before adding a contract">
         <span class="icon icon--sm">contract</span>Contracts (0)
       </button>`;

  rows.renderContacts($('#pf-contacts'), payer?.contacts || []);
  rows.renderPlans($('#pf-plans'), payer?.plans || []);
  rows.renderDocuments($('#pf-documents'), documents);
  markLicenceRequired();
  markContactWarning();

  // --- tabs -----------------------------------------------------------------

  function showTab(name) {
    for (const tab of el.querySelectorAll('[data-tab]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    }
    for (const panel of el.querySelectorAll('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== name;
    }
  }

  function markLicenceRequired() {
    const selfPay = $('#pf-type').value === payers.NO_LICENSE_TYPE;
    $('[data-req="licenseNo"]').hidden = selfPay;
  }

  // The design system's .alert and .icon set their own display, so [hidden]
  // cannot switch them off — these two are added and removed instead.
  function markContactWarning() {
    const none = el.querySelectorAll('#pf-contacts [data-row]').length === 0;
    $('#pf-contacts-warning').innerHTML = none
      ? `<div class="alert alert--warning"><span class="icon">priority_high</span>
           <div>No contacts added. You can save without one, and claims staff will have no one to call.</div></div>`
      : '';
  }

  // --- errors ---------------------------------------------------------------

  function clearErrors() {
    for (const box of el.querySelectorAll('.field-error')) {
      box.hidden = true;
      box.textContent = '';
    }
    for (const dot of el.querySelectorAll('[data-dot]')) dot.innerHTML = '';
    for (const field of el.querySelectorAll('[data-panel] .field')) field.classList.remove('field--invalid');
  }

  function showError(name, message) {
    const box = el.querySelector(`[data-error="${name}"]`);
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
  }

  function markTab(name) {
    el.querySelector(`[data-dot="${name}"]`).innerHTML =
      `<span class="icon icon--sm icon--filled" style="margin-left: 6px; color: var(--critical)"
             title="Fix the errors on this tab">error</span>`;
  }

  // --- save -----------------------------------------------------------------

  function readGeneral() {
    const values = {};
    for (const input of el.querySelectorAll('[data-panel="general"] [name]')) {
      values[input.name] = input.value.trim();
    }
    return values;
  }

  function save() {
    clearErrors();
    const values = readGeneral();
    const contacts = rows.readRows($('#pf-contacts'));
    const plans = rows.readRows($('#pf-plans'));

    const general = validateGeneral(values, id);
    const contactErrors = rows.validateContacts(contacts);
    const planErrors = rows.validatePlans(plans);

    const contactMessage = rows.markRowErrors($('#pf-contacts'), contactErrors);
    const planMessage = rows.markRowErrors($('#pf-plans'), planErrors);

    for (const [name, message] of Object.entries(general)) {
      showError(name, message);
      el.querySelector(`[data-panel="general"] [name="${name}"]`)?.closest('.field')?.classList.add('field--invalid');
      markTab('general');
    }
    if (contactMessage) {
      showError('contacts', contactMessage);
      markTab('contacts');
    }
    if (planMessage) {
      showError('plans', planMessage);
      markTab('plans');
    }

    const firstBad = TABS.find((tab) => el.querySelector(`[data-dot="${tab}"]`).innerHTML !== '');
    if (firstBad) {
      showTab(firstBad);
      if (firstBad === 'general') {
        el.querySelector(`[data-panel="general"] [name="${Object.keys(general)[0]}"]`)?.focus();
      }
      return;
    }

    const record = { ...values, contacts, plans, documents };
    const saved = id ? payers.update(id, record) : payers.create(record);
    dialog.close(saved);
  }

  // --- events ---------------------------------------------------------------

  el.addEventListener('click', async (e) => {
    // The link navigates on its own; the modal only has to get out of the way.
    if (e.target.closest('[data-act="contracts"]')) return dialog.close(undefined);

    const tab = e.target.closest('[data-tab]');
    if (tab) return showTab(tab.dataset.tab);

    const add = e.target.closest('[data-add]')?.dataset.add;
    if (add === 'contact') {
      $('#pf-contacts').insertAdjacentHTML('beforeend', rows.contactRow());
      markContactWarning();
      $('#pf-contacts [data-row]:last-child [name="name"]').focus();
      return;
    }
    if (add === 'plan') {
      $('#pf-plans').insertAdjacentHTML('beforeend', rows.planRow());
      $('#pf-plans [data-row]:last-child [name="name"]').focus();
      return;
    }
    if (add === 'document') return addDocument();

    const remove = e.target.closest('[data-remove]');
    if (remove) {
      remove.closest('[data-row]').remove();
      markContactWarning();
      return;
    }

    const docAct = e.target.closest('[data-doc-act]')?.dataset.docAct;
    if (docAct) return handleDocument(docAct, e.target.closest('[data-doc]').dataset.doc);

    if (e.target.closest('[data-act="save"]')) save();
  });

  el.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      showTab(tab.dataset.tab);
    }
  });

  $('#pf-type').addEventListener('change', markLicenceRequired);

  function addDocument() {
    const box = el.querySelector('[data-error="documents"]');
    const result = rows.readDocumentForm(el, currentRole().name);
    box.hidden = !result.message;
    box.textContent = result.message || '';
    if (!result.doc) return;

    documents.push(result.doc);
    rows.renderDocuments($('#pf-documents'), documents);
    el.querySelector('[name="docFile"]').value = '';
    el.querySelector('[name="docDescription"]').value = '';
    toast(`Attached ${result.doc.fileName}`, 'success');
  }

  async function handleDocument(action, docId) {
    const doc = documents.find((d) => d.id === docId);
    if (!doc) return;
    if (action === 'download') return void toast(`Downloaded ${doc.fileName}`, 'info');

    const ok = await modal.confirm({
      title: 'Delete document',
      body: `${doc.fileName} is removed from this payer when you save. The audit trail keeps the record.`,
      confirmLabel: 'Delete document',
      tone: 'critical',
      icon: 'delete',
    });
    if (!ok) return;
    documents.splice(documents.indexOf(doc), 1);
    rows.renderDocuments($('#pf-documents'), documents);
    toast(`Removed ${doc.fileName}`, 'success');
  }

  return dialog.closed;
}

/** Returns { field: message } for every invalid field, in tab order. */
function validateGeneral(v, excludeId) {
  const errors = {};
  const unique = payers.isNameUnique(v.nameEn, v.nameAr, excludeId);

  if (v.nameEn.length < 2) errors.nameEn = 'Enter the payer name in English.';
  else if (!unique.nameEn) errors.nameEn = 'Another payer already uses this English name.';

  if (!v.nameAr) errors.nameAr = 'Enter the payer name in Arabic.';
  else if (!unique.nameAr) errors.nameAr = 'Another payer already uses this Arabic name.';

  if (!payers.TYPES.includes(v.type)) errors.type = 'Choose a payer type.';
  if (!payers.STATUSES.includes(v.status)) errors.status = 'Choose a status.';
  if (!v.licenseNo && v.type !== payers.NO_LICENSE_TYPE) {
    errors.licenseNo = 'Enter the licence number. Only self-pay payers may leave it empty.';
  }
  if (!isEmail(v.email)) errors.email = 'Enter an email like claims@payer.com.lb.';
  if (!isPhone(v.phone)) errors.phone = 'Enter a Lebanese number, for example +961 1 999 555.';

  return errors;
}
