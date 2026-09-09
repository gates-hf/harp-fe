// The patient record, at #/frontis/patients/<mrn>. Everything downstream —
// encounters, eligibility, pre-auth, clearance, billing — starts here, so the
// page answers three questions at a glance: who this is, whether an encounter
// can be opened against them, and what has been done to the record.
//
// Every field is drawn through patients.view(), so a restricted record reads
// masked for a role without VIP access without this screen knowing the rule.

import * as patients from '../../../../data/repositories/patients.js';
import * as duplicates from '../../../../data/repositories/duplicates.js';
import { age, date, dateTime, esc } from '../../../../shared/format.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { documentsHtml, addDocument, handleDocument } from './patient-documents.js';
import { historyHtml } from './patient-history.js';
import { askDeceased, askBlock, askUnblock, askVip } from './patient-status.js';

export const meta = { title: 'Patient' };

const TABS = [
  { id: 'documents', label: 'Documents' },
  { id: 'history', label: 'History' },
];

export async function render(mount, ctx) {
  const mrn = ctx.params[0];
  if (!patients.get(mrn)) throw new Error(`No patient ${mrn}`);

  const res = await fetch(new URL('./patient-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load patient-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { tab: TABS.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : 'documents', filter: 'all' };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const raw = patients.get(mrn);
    if (!raw) return;
    const p = patients.view(raw, role);
    const readOnly = p.status === 'Merged' || p.status === 'Deceased';

    ctx.setHeader(`${p.mrn} — ${p.nameEn}`);
    ctx.setCrumb([
      { label: 'Frontis', path: '/frontis/patients' },
      { label: 'Patients', path: '/frontis/patients' },
      { label: p.mrn },
    ]);

    $('#pv-name').textContent = p.nameEn;
    $('#pv-meta').innerHTML = metaHtml(p);
    $('#pv-actions').innerHTML = actionsHtml(p, role, readOnly);
    $('#pv-banners').innerHTML = bannersHtml(p, role);
    $('#pv-summary').innerHTML = summaryHtml(p);
    $('#pv-tabs').innerHTML = TABS.map((t) => `
      <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab"
              aria-selected="${t.id === state.tab}" data-tab="${t.id}">
        ${t.label}${t.id === 'documents' && p.documents.length ? ` <span class="badge">${p.documents.length}</span>` : ''}
      </button>`).join('');
    $('#pv-panel').innerHTML = state.tab === 'history'
      ? historyHtml(mrn, state.filter)
      : p.masked
        ? maskedDocumentsHtml()
        : documentsHtml(p, { readOnly });
  }

  function metaHtml(p) {
    const tone = patients.statusTone(p.status);
    const years = age(p.dob);
    const pairs = duplicates.forPatient(p.mrn).filter((row) => row.status === 'Open');
    return `
      <span class="t-mono-sm">${esc(p.mrn)}</span>
      <span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${p.status}</span>
      ${p.vip && !p.masked ? '<span class="badge badge--accent">VIP</span>' : ''}
      ${p.masked ? '<span class="badge">Restricted</span>' : ''}
      <span>·</span>
      <span>${esc(p.gender)}${years === '—' ? '' : `, ${years}`}</span>
      <span>·</span>
      <span>${esc(p.nationality)}</span>
      ${p.lastVisitAt ? `<span>·</span><span class="t-mono-sm">last visit ${date(p.lastVisitAt)}</span>` : ''}
      ${pairs.length
        ? `<a class="badge badge--warning" href="#/frontis/patients/duplicates">
             <span class="dot"></span>${pairs.length} open duplicate ${pairs.length === 1 ? 'pair' : 'pairs'}</a>`
        : ''}`;
  }

  function actionsHtml(p, role, readOnly) {
    const encounterWhy = patients.canOpenEncounter(p)
      ? 'Encounters open with the Encounter feature'
      : `A ${p.status.toLowerCase()} record cannot start an encounter`;
    // A role that reads the record masked changes nothing on it: it cannot see
    // what it would be changing.
    const masked = 'Your role reads this record masked and cannot change it';

    return `
      ${readOnly || p.masked
        ? button('edit', 'Edit', 'edit', p.masked ? 'Your role reads this record masked and cannot edit it' : `A ${p.status.toLowerCase()} record is read-only`)
        : `<a class="btn btn--secondary btn--sm" href="#/frontis/patients/${esc(p.mrn)}/edit">
             <span class="icon icon--sm">edit</span>Edit</a>`}

      ${p.status === 'Blocked'
        ? action('unblock', 'Unblock', 'lock_open', role.canBlockPatients && !p.masked,
            p.masked ? masked : `Your role cannot lift a block. ${role.title} is not a registration role.`)
        : action('block', 'Block', 'block', role.canBlockPatients && !readOnly && !p.masked,
            p.masked ? masked
              : readOnly ? `A ${p.status.toLowerCase()} record cannot be blocked`
                : `Your role cannot block patients. ${role.title} is not a registration role.`)}

      ${action('deceased', 'Mark deceased', 'sentiment_very_dissatisfied', !readOnly && !p.masked,
        p.masked ? masked : `This record is already ${p.status.toLowerCase()}`)}

      ${action(p.vip ? 'vip-off' : 'vip-on', p.vip ? 'Remove VIP' : 'Mark VIP', 'shield_person',
        role.canViewVip && !readOnly,
        role.canViewVip ? `A ${p.status.toLowerCase()} record is read-only` : 'Your role cannot read a VIP record, so it cannot set one')}

      ${button('encounter', 'New encounter', 'add_circle', encounterWhy)}`;
  }

  function bannersHtml(p, role) {
    const out = [];
    if (p.mergedInto) {
      out.push(`
        <div class="alert alert--info">
          <span class="icon">merge</span>
          <div>
            <div class="title">Merged into ${esc(p.mergedInto)} on ${date(p.updatedAt)}</div>
            This record is kept so an old wristband or claim still resolves. It is read-only —
            <a class="crumb-link" href="#/frontis/patients/${esc(p.mergedInto)}">open the record that survived</a>.
          </div>
        </div>`);
    }
    if (p.status === 'Deceased') {
      out.push(`
        <div class="alert alert--critical">
          <span class="icon">sentiment_very_dissatisfied</span>
          <div>
            <div class="title">Deceased on ${date(p.deceasedAt)}</div>
            The record is read-only and no encounter can be opened against it.
          </div>
        </div>`);
    }
    if (p.status === 'Blocked') {
      out.push(`
        <div class="alert alert--warning">
          <span class="icon">block</span>
          <div>
            <div class="title">Blocked</div>
            ${esc(p.blockReason || 'No reason recorded.')}
          </div>
        </div>`);
    }
    if (p.masked) {
      out.push(`
        <div class="perm-banner">
          <span class="icon">lock</span>
          <div><b>Restricted record.</b> You are signed in as ${esc(role.title)}, which reads a VIP patient masked:
            the name shows as initials, the identifiers as their last two digits, and the phone, address,
            photo and documents are withheld. A role with VIP access reads it in full.</div>
        </div>`);
    }
    return out.join('');
  }

  function summaryHtml(p) {
    return `
      ${p.photo ? `<img class="avatar avatar--lg" src="${esc(p.photo)}" alt="">` : ''}
      <dl class="dl dl--narrow">
        <dt>Name (AR)</dt><dd dir="rtl">${esc(p.nameAr)}</dd>
        <dt>Date of birth</dt><dd class="t-mono-sm">${date(p.dob)}${age(p.dob) === '—' ? '' : ` (${age(p.dob)})`}</dd>
        <dt>Gender</dt><dd>${esc(p.gender)}</dd>
        <dt>Nationality</dt><dd>${esc(p.nationality)}</dd>
        <dt>Civil ID</dt><dd class="t-mono-sm">${p.civilId ? esc(p.civilId) : '—'}</dd>
        <dt>Passport no.</dt><dd class="t-mono-sm">${p.passportNo ? esc(p.passportNo) : '—'}</dd>
        <dt>Phone</dt><dd class="t-mono-sm">${p.phone ? esc(p.phone) : withheld(p)}</dd>
        <dt>Email</dt><dd>${p.email ? esc(p.email) : withheld(p)}</dd>
        <dt>Address</dt><dd>${p.address ? esc(p.address) : withheld(p)}</dd>
        <dt>City</dt><dd>${p.city ? esc(p.city) : '—'}</dd>
        <dt>Last visit</dt><dd class="t-mono-sm">${date(p.lastVisitAt)}</dd>
        <dt>Registered</dt><dd class="t-mono-sm">${dateTime(p.createdAt)}</dd>
        <dt>Last updated</dt><dd class="t-mono-sm">${dateTime(p.updatedAt)}</dd>
      </dl>`;
  }

  const withheld = (p) => (p.masked ? '<span class="badge">withheld</span>' : '—');

  function maskedDocumentsHtml() {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">lock</span></div>
        <div class="state-view__title">Documents withheld</div>
        <p class="state-view__body">A restricted record's documents are readable by roles with VIP access only.
          The history tab still shows that a document was added or removed, and by whom.</p>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab;
      return draw();
    }

    const chip = e.target.closest('[data-filter]');
    if (chip) {
      state.filter = chip.dataset.filter;
      $('#pv-panel').innerHTML = historyHtml(mrn, state.filter);
      return;
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const patient = patients.get(mrn);

    if (act === 'doc-add') return void (addDocument(mount, mrn) && draw());
    if (act === 'doc-download' || act === 'doc-delete') {
      const id = e.target.closest('[data-doc]')?.dataset.doc;
      if (id && (await handleDocument(act, mrn, id))) draw();
      return;
    }
    if (act === 'deceased') return void (await askDeceased(patient));
    if (act === 'block') return void (await askBlock(patient));
    if (act === 'unblock') return void (await askUnblock(patient));
    if (act === 'vip-on') return void (await askVip(patient, true));
    if (act === 'vip-off') return void (await askVip(patient, false));
  });

  // The record is live on both axes: a status change or an upload redraws it,
  // and switching demo role re-reads the masking. The role subscription retires
  // itself once this screen has left the document.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  draw();
}

/** An action the role or the record's state allows, or the reason it does not. */
function action(act, label, icon, allowed, why) {
  return allowed
    ? `<button class="btn btn--secondary btn--sm" data-act="${act}">
         <span class="icon icon--sm">${icon}</span>${label}
       </button>`
    : button(act, label, icon, why);
}

const button = (act, label, icon, why) => `
  <button class="btn btn--secondary btn--sm" disabled title="${esc(why)}" data-act="${act}">
    <span class="icon icon--sm">${icon}</span>${label}
  </button>`;
