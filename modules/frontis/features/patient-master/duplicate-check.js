// Duplicate detection at registration — the three answers the register can
// give, in order of how sure it is. Exported on its own so a later
// pre-registration or kiosk screen asks the same questions the desk asks.
//
// 1. Hard    — the identifier is already on file. The same person on paper, so
//              registration stops and the clerk is sent to the record.
// 2. Fuzzy   — the name is a near match on the same date of birth. Shown side
//              by side; proceeding needs a justification and raises a pair.
// 3. Phone   — the same line as someone else. Common in a family, so this one
//              is a light confirm rather than a comparison.

import * as patients from '../../../../data/repositories/patients.js';
import * as modal from '../../../../shared/modal.js';
import { date, esc } from '../../../../shared/format.js';

const COMPARE_FIELDS = ['nameEn', 'nameAr', 'dob', 'gender', 'nationality', 'civilId', 'passportNo', 'phone', 'city'];

/**
 * checkDuplicates(candidate, excludeMrn)
 *   -> { proceed, justification, matches: [{ mrn, basis }] }
 *
 * `matches` is what the caller turns into worklist pairs once the patient has
 * an MRN of their own — the check never writes.
 */
export async function checkDuplicates(candidate, excludeMrn = null) {
  const { hard, fuzzy, phone } = patients.findDuplicates(candidate, excludeMrn);
  if (hard) {
    await hardDialog(hard);
    return { proceed: false, justification: '', matches: [] };
  }
  if (fuzzy.length) return compareDialog(candidate, fuzzy, phone);
  if (phone.length) return phoneDialog(phone);
  return { proceed: true, justification: '', matches: [] };
}

// --- 1. hard match -------------------------------------------------------------

function hardDialog(match) {
  const which = match.civilId ? `civil ID ${esc(match.civilId)}` : `passport ${esc(match.passportNo)}`;
  const dialog = modal.open({
    title: 'Patient already registered',
    sub: 'The identifier is on file against another record.',
    icon: 'person_search',
    tone: 'critical',
    size: 'md',
    body: `
      <p class="modal__lede">This ${which} belongs to <b>${esc(match.mrn)}</b> — ${esc(match.nameEn)},
        born ${date(match.dob)}. Registering a second record for the same identifier is what fills the
        duplicates worklist, so this one stops here.</p>
      <p class="t-body-sm">Open the record to admit, edit or merge. If the identifier was mistyped, correct it and save again.</p>`,
    note: 'Nothing has been saved.',
    foot: `
      <button class="btn btn--secondary" data-close>Back to the form</button>
      <a class="btn btn--primary" href="#/frontis/patients/${esc(match.mrn)}" data-close>
        <span class="icon icon--sm">open_in_new</span>Open record
      </a>`,
  });
  return dialog.closed;
}

// --- 2. fuzzy name + date of birth ---------------------------------------------

async function compareDialog(candidate, fuzzy, phone) {
  const dialog = modal.open({
    title: 'Similar patient already on file',
    sub: `${fuzzy.length} record${fuzzy.length === 1 ? '' : 's'} with a near-matching name and the same date of birth.`,
    icon: 'compare_arrows',
    tone: 'warning',
    size: 'xl',
    body: `
      ${compareTable(candidate, fuzzy)}
      ${phone.length ? phoneAlert(phone) : ''}
      <div class="toolbar"><span class="t-title-sm">Register anyway</span></div>
      <p class="t-body-sm">Say why this is a different person. The reason is recorded against the new record and
        the pair goes to the duplicates worklist for review.</p>
      <label class="field field--area">
        <textarea name="justification" rows="3" placeholder="Different person — a cousin of the same name, seen today with his own civil ID."></textarea>
      </label>
      <div class="field-error" data-error="justification" hidden></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Back to the form</button>
      <a class="btn btn--secondary" href="#/frontis/patients/${esc(fuzzy[0].mrn)}" data-close>
        <span class="icon icon--sm">open_in_new</span>Open existing
      </a>
      <button class="btn btn--primary" data-act="proceed">Proceed anyway</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="proceed"]')) return;
    const box = dialog.el.querySelector('[data-error="justification"]');
    const field = dialog.el.querySelector('[name="justification"]');
    const justification = field.value.trim();
    if (justification.length < 10) {
      box.textContent = 'Enter a reason — a sentence is enough. It is what the reviewer reads in the worklist.';
      box.hidden = false;
      field.closest('.field').classList.add('field--invalid');
      field.focus();
      return;
    }
    dialog.close({
      proceed: true,
      justification,
      matches: [
        ...fuzzy.map((p) => ({ mrn: p.mrn, basis: 'Name+DOB' })),
        ...phone.map((p) => ({ mrn: p.mrn, basis: 'Phone' })),
      ],
    });
  });

  return (await dialog.closed) || { proceed: false, justification: '', matches: [] };
}

/** New against existing, one column each, with the differing cells called out. */
function compareTable(candidate, matches) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th>Field</th>
          <th>Being registered</th>
          ${matches.map((p) => `<th>${esc(p.mrn)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${COMPARE_FIELDS.map((key) => `
          <tr>
            <td>${esc(patients.fieldLabel(key))}</td>
            <td>${cell(candidate[key], true)}</td>
            ${matches.map((p) => cell(p[key], same(candidate[key], p[key]))).join('')}
          </tr>`).join('')}
      </tbody>
    </table>`;
}

const same = (a, b) => String(a ?? '') === String(b ?? '');

function cell(value, plain) {
  const text = value === null || value === undefined || value === '' ? '—' : String(value);
  return plain
    ? `<td>${esc(text)}</td>`
    : `<td><span class="badge badge--warning">${esc(text)}</span></td>`;
}

function phoneAlert(phone) {
  return `
    <div class="alert alert--info">
      <span class="icon">info</span>
      <div>
        <div class="title">Same phone as ${phone.map((p) => esc(p.mrn)).join(', ')}</div>
        A shared line is normal in one household. Proceeding raises a phone pair as well.
      </div>
    </div>`;
}

// --- 3. phone only -------------------------------------------------------------

async function phoneDialog(phone) {
  const names = phone.map((p) => `${p.mrn} (${p.nameEn})`).join(', ');
  const ok = await modal.confirm({
    title: 'Same phone already on file',
    body: `This number is registered against ${names}. A shared line is normal in one household — continue if this is a different person, and the pair goes to the duplicates worklist.`,
    confirmLabel: 'Continue',
    icon: 'phone_forwarded',
  });
  return {
    proceed: ok,
    justification: ok ? 'Shared phone confirmed at the desk' : '',
    matches: ok ? phone.map((p) => ({ mrn: p.mrn, basis: 'Phone' })) : [],
  };
}
