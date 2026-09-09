// The encounter page at #/frontis/encounters/<no>, and any tab id after it.
// What this visit is, who is paying for it, what has been hung off it, and what
// has happened to it.
//
// The Linked Records tab is the point of the entity: each row is a feature that
// does not exist yet, named with its Create button disabled. When F5–F10 land
// they register through encounters.linkRecord() and this tab fills in without
// changing.

import * as encounters from '../../../../data/repositories/encounters.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as eligibility from '../../../../data/repositories/eligibility.js';
import { doctorName } from '../../../../data/seed/reference.js';
import { age, date, dateTime, esc } from '../../../../shared/format.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { resultBadge } from '../eligibility/eligibility-panel.js';
import { askActivate, askCancel, askDischarge, askEdit, askReclassify } from './encounter-actions.js';
import { historyHtml } from './encounter-history.js';
import { linkCount, linkedHtml } from './encounter-linked.js';

export const meta = { title: 'Encounter' };

const TABS = [
  { id: 'visit', label: 'Visit info' },
  { id: 'financial', label: 'Financial' },
  { id: 'linked', label: 'Linked records' },
  { id: 'history', label: 'History' },
];

export async function render(mount, ctx) {
  const no = ctx.params[0];
  if (!encounters.get(no)) throw new Error(`No encounter ${no}`);

  const res = await fetch(new URL('./encounter-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load encounter-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { tab: TABS.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : TABS[0].id, filter: 'all' };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const enc = encounters.get(no);
    if (!enc) return;
    const patient = patients.view(patients.get(enc.patientMrn), role);

    ctx.setHeader(`${enc.no} — ${patient?.nameEn || enc.patientMrn}`);
    ctx.setCrumb([
      { label: 'Frontis', path: '/frontis/patients' },
      { label: 'Encounters', path: '/frontis/encounters' },
      { label: enc.no },
    ]);

    $('#ev-no').textContent = enc.no;
    $('#ev-meta').innerHTML = metaHtml(enc, patient);
    $('#ev-actions').innerHTML = actionsHtml(enc, role);
    $('#ev-banners').innerHTML = bannersHtml(enc);
    $('#ev-record').href = `#/frontis/patients/${enc.patientMrn}`;
    $('#ev-patient').innerHTML = patientHtml(patient, enc);
    $('#ev-tabs').innerHTML = TABS.map((t) => {
      const count = t.id === 'linked' ? linkCount(enc) : 0;
      return `
        <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab"
                aria-selected="${t.id === state.tab}" data-tab="${t.id}">
          ${t.label}${count ? ` <span class="badge">${count}</span>` : ''}
        </button>`;
    }).join('');
    drawPanel(enc, role);
  }

  function drawPanel(enc, role) {
    const panel = $('#ev-panel');
    if (state.tab === 'history') return void (panel.innerHTML = historyHtml(no, state.filter));
    // Who pays for a restricted patient is withheld the way the record's own
    // Insurance and Eligibility tabs withhold it. That the visit happened, and
    // everything clinical about it, is not what the restriction covers.
    if (state.tab === 'financial') {
      const patient = patients.view(patients.get(enc.patientMrn), role);
      panel.innerHTML = patient?.masked ? maskedFinancialHtml() : financialHtml(enc, role);
      return;
    }
    if (state.tab === 'linked') return void (panel.innerHTML = linkedHtml(enc));
    panel.innerHTML = visitHtml(enc);
  }

  function metaHtml(enc, patient) {
    const clearance = encounters.clearanceIndicator(enc);
    return `
      <span class="badge${enc.type === 'ER' ? ' badge--critical' : enc.type === 'IP' ? ' badge--accent' : ''}">
        ${esc(encounters.typeLabel(enc.type))}</span>
      <span class="badge${encounters.statusTone(enc.status) ? ` badge--${encounters.statusTone(enc.status)}` : ''}">
        <span class="dot"></span>${esc(enc.status)}</span>
      <span class="badge${clearance.tone ? ` badge--${clearance.tone}` : ''}" title="${esc(clearance.label)}">
        <span class="dot"></span>${esc(clearance.short)}</span>
      <span>·</span>
      <span>${esc(enc.department)}</span>
      <span>·</span>
      <span>${esc(doctorName(enc.doctorId))}</span>
      <span>·</span>
      <span class="t-mono-sm">${dateTime(enc.startAt)}</span>
      <span>·</span>
      ${patient?.masked
        ? '<span class="badge">cover withheld</span>'
        : `<span title="${esc(encounters.financialTitle(enc))}">${esc(encounters.financialLabel(enc))}</span>`}`;
  }

  function actionsHtml(enc, role) {
    if (!encounters.isOpen(enc)) {
      return `<button class="btn btn--secondary btn--sm" disabled
                title="A ${esc(enc.status.toLowerCase())} encounter is closed — nothing on it moves">
                <span class="icon icon--sm">lock</span>Closed</button>`;
    }
    const cancelWhy = encounters.cancelBlocked(enc, role);
    const bedded = enc.type !== 'OP';
    return `
      ${enc.status === 'Planned'
        ? `<button class="btn btn--primary btn--sm" data-act="activate">
             <span class="icon icon--sm">play_arrow</span>Activate</button>`
        : ''}
      <button class="btn btn--secondary btn--sm" data-act="edit">
        <span class="icon icon--sm">edit</span>Edit visit</button>
      <a class="btn btn--secondary btn--sm"
         href="#/frontis/referrals/new?direction=Outbound&mrn=${esc(enc.patientMrn)}&encounterNo=${esc(enc.no)}"
         title="Write a referral from this visit to another hospital">
        <span class="icon icon--sm">call_made</span>Refer out</a>
      ${enc.status === 'Active' && bedded
        ? `<button class="btn btn--secondary btn--sm" data-act="discharge">
             <span class="icon icon--sm">logout</span>Discharge</button>`
        : `<button class="btn btn--secondary btn--sm" disabled
             title="${esc(bedded ? 'Only an active admission is discharged' : 'An outpatient visit completes on its own')}">
             <span class="icon icon--sm">logout</span>Discharge</button>`}
      ${cancelWhy
        ? `<button class="btn btn--secondary btn--sm" disabled title="${esc(cancelWhy)}">
             <span class="icon icon--sm">cancel</span>Cancel</button>`
        : `<button class="btn btn--secondary btn--sm" data-act="cancel">
             <span class="icon icon--sm">cancel</span>Cancel</button>`}`;
  }

  function bannersHtml(enc) {
    if (enc.status === 'Cancelled') {
      return `
        <div class="alert alert--critical">
          <span class="icon">cancel</span>
          <div><div class="title">Cancelled ${date(enc.endAt)}</div>${esc(enc.cancelReason || 'No reason recorded.')}</div>
        </div>`;
    }
    if (enc.clearance?.status === 'Blocked') {
      return `
        <div class="alert alert--warning">
          <span class="icon">assignment_late</span>
          <div>
            <div class="title">Financial clearance blocked</div>
            ${esc((enc.clearance.items || []).join('; ') || 'No items recorded.')} — clearance is worked in its own
            screen; this is the stamp it leaves.
          </div>
        </div>`;
    }
    return '';
  }

  function patientHtml(patient, enc) {
    if (!patient) return `<p class="t-body-sm">${esc(enc.patientMrn)} is no longer on the register.</p>`;
    return `
      ${patient.photo ? `<img class="avatar avatar--lg" src="${esc(patient.photo)}" alt="">` : ''}
      <dl class="dl dl--narrow">
        <dt>Name</dt><dd>${esc(patient.nameEn)}${patient.vip && !patient.masked ? ' <span class="badge badge--accent">VIP</span>' : ''}</dd>
        <dt>MRN</dt><dd class="t-mono-sm">${esc(patient.mrn)}</dd>
        <dt>Gender, age</dt><dd>${esc(patient.gender)}${age(patient.dob) === '—' ? '' : `, ${age(patient.dob)}`}</dd>
        <dt>Status</dt><dd>${esc(patient.status)}</dd>
        <dt>Phone</dt><dd class="t-mono-sm">${patient.phone ? esc(patient.phone) : '—'}</dd>
      </dl>`;
  }

  function visitHtml(enc) {
    return `
      <dl class="dl dl--narrow">
        <dt>Type</dt><dd>${esc(encounters.typeLabel(enc.type))}</dd>
        <dt>Department</dt><dd>${esc(enc.department)}</dd>
        <dt>Doctor</dt><dd>${esc(doctorName(enc.doctorId))}</dd>
        ${enc.visitReason ? `<dt>Visit reason</dt><dd>${esc(enc.visitReason)}</dd>` : ''}
        ${enc.type === 'IP' ? `
          <dt>Ward</dt><dd>${esc(enc.ward || '—')}</dd>
          <dt>Bed class</dt><dd>${esc(enc.bedClass || '—')}</dd>
          <dt>Expected LOS</dt><dd>${enc.expectedLos ? `${enc.expectedLos} night${enc.expectedLos === 1 ? '' : 's'}` : '—'}</dd>` : ''}
        <dt>Start</dt><dd class="t-mono-sm">${dateTime(enc.startAt)}</dd>
        <dt>End</dt><dd class="t-mono-sm">${enc.endAt ? dateTime(enc.endAt) : '—'}</dd>
        ${enc.los ? `<dt>Length of stay</dt><dd>${enc.los} day${enc.los === 1 ? '' : 's'}</dd>` : ''}
        <dt>Charges posted</dt><dd>${enc.chargesPosted ? 'Yes' : 'Not yet'}</dd>
        <dt>Created</dt><dd class="t-mono-sm">${dateTime(enc.createdAt)}</dd>
      </dl>`;
  }

  function maskedFinancialHtml() {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">lock</span></div>
        <div class="state-view__title">Classification withheld</div>
        <p class="state-view__body">This encounter is for a restricted record, so who pays for it is readable by
          roles with VIP access only. The visit itself, and the trail of what was done to this encounter, are not
          withheld.</p>
      </div>`;
  }

  function financialHtml(enc, role) {
    const why = role.canReclassifyEncounter
      ? ''
      : `Your role cannot re-classify an encounter. ${role.title} is not a registration role.`;
    return `
      <div class="toolbar">
        <span class="t-title-sm">Current classification</span>
        <span class="spacer"></span>
        ${why
          ? `<button class="btn btn--secondary btn--sm" disabled title="${esc(why)}">
               <span class="icon icon--sm">published_with_changes</span>Re-classify</button>`
          : `<button class="btn btn--secondary btn--sm" data-act="reclassify">
               <span class="icon icon--sm">published_with_changes</span>Re-classify</button>`}
      </div>
      ${classificationHtml(enc.financial)}
      <div class="toolbar"><span class="t-title-sm">Previous classifications</span></div>
      ${enc.financialHistory?.length
        ? `<table class="tbl">
             <thead><tr><th scope="col">Cover</th><th scope="col">Check</th><th scope="col">Classified</th><th scope="col">Reason</th></tr></thead>
             <tbody>${enc.financialHistory.map(historyRow).join('')}</tbody>
           </table>`
        : '<p class="t-body-sm">Nothing has been replaced — the encounter opened under the classification above.</p>'}`;
  }

  function classificationHtml(financial) {
    const policy = financial.policyId ? policies.get(financial.policyId) : null;
    const snapshot = financial.snapshotRef ? eligibility.get(financial.snapshotRef) : null;
    return `
      <dl class="dl dl--narrow">
        <dt>Cover</dt><dd>${policy ? esc(policies.label(policy)) : 'Self-Pay'}</dd>
        ${policy ? `<dt>Policy no.</dt><dd class="t-mono-sm">${esc(policy.policyNo || policy.memberId)}</dd>` : ''}
        <dt>Eligibility check</dt>
        <dd>${snapshot
          ? `<a class="crumb-link t-mono-sm" href="#/frontis/eligibility/${esc(snapshot.ref)}">${esc(snapshot.ref)}</a>
             ${resultBadge(snapshot)}
             ${financial.overrideRef ? '<span class="badge badge--warning" title="A supervisor answered beside the system result">⚑ overridden</span>' : ''}`
          : 'None — the classification was recorded without a check'}</dd>
        <dt>Classified by</dt><dd>${esc(financial.classifiedBy || '—')}</dd>
        <dt>Classified at</dt><dd class="t-mono-sm">${financial.classifiedAt ? dateTime(financial.classifiedAt) : '—'}</dd>
        ${financial.reason ? `<dt>Reason</dt><dd>${esc(financial.reason)}</dd>` : ''}
      </dl>`;
  }

  function historyRow(financial) {
    const policy = financial.policyId ? policies.get(financial.policyId) : null;
    return `
      <tr>
        <td>${policy ? esc(policies.label(policy)) : 'Self-Pay'}</td>
        <td class="t-mono-sm">${financial.snapshotRef
          ? `<a class="crumb-link" href="#/frontis/eligibility/${esc(financial.snapshotRef)}">${esc(financial.snapshotRef)}</a>`
          : '—'}</td>
        <td class="t-mono-sm">${financial.classifiedAt ? dateTime(financial.classifiedAt) : '—'}<br>
          <span class="t-body-sm">${esc(financial.classifiedBy || '')}</span></td>
        <td>${esc(financial.reason || '—')}</td>
      </tr>`;
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
      $('#ev-panel').innerHTML = historyHtml(no, state.filter);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'activate') return void (await askActivate(no));
    if (act === 'edit') return void (await askEdit(no));
    if (act === 'discharge') return void (await askDischarge(no));
    if (act === 'cancel') return void (await askCancel(no));
    if (act === 'reclassify') return void (await askReclassify(no));
  });

  // The page is live on both axes: an action taken here or on the board lands
  // without a reload, and switching demo role re-reads the masking and the
  // re-classification gate.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  draw();
}
