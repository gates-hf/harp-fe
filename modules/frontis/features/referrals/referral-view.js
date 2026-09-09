// The referral page at #/frontis/referrals/<no>/view — the whole record,
// read-only, and for an outbound one the letter itself.
//
// The printable form is the point of this screen on the outbound side: a
// referral leaving this hospital is a piece of paper somebody signs, so it is
// laid out here as one and everything else on the page is marked
// data-print="hide". Export is window.print(), the call the fee report and the
// cost estimate already make.

import * as referrals from '../../../../data/repositories/referrals.js';
import * as sources from '../../../../data/repositories/referral-sources.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { doctorName } from '../../../../data/seed/reference.js';
import { age, date, dateTime, esc, fileSize } from '../../../../shared/format.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { directionHtml, encountersHtml, statusHtml, validHtml, visitsHtml } from './referral-chips.js';
import { askCancel, askExtend, askLink, askReject, askSchedule } from './referral-actions.js';
import { historyHtml } from './referral-history.js';

export const meta = { title: 'Referral' };

const HOSPITAL = { name: 'Harp Medical Centre', line: 'Rue de Damas, Beirut · +961 1 200 400' };

export async function render(mount, ctx) {
  const no = ctx.params[0];
  if (!referrals.get(no)) throw new Error(`No referral ${no}`);

  const res = await fetch(new URL('./referral-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load referral-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { filter: 'all' };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const row = referrals.get(no);
    if (!row) return;
    const patient = row.patientMrn ? patients.view(patients.get(row.patientMrn), role) : null;

    ctx.setHeader(`${row.no} — ${referrals.patientName(row)}`);
    ctx.setCrumb([
      { label: 'Frontis', path: '/frontis/patients' },
      { label: 'Referrals', path: '/frontis/referrals' },
      { label: row.no },
    ]);

    $('#rv-no').textContent = row.no;
    $('#rv-meta').innerHTML = metaHtml(row);
    $('#rv-actions').innerHTML = actionsHtml(row);
    $('#rv-banners').innerHTML = bannersHtml(row);
    $('#rv-summary').innerHTML = patientHtml(row, patient);
    $('#rv-detail').innerHTML = detailHtml(row);
    $('#rv-history').innerHTML = historyHtml(no, state.filter);
    $('#rv-letter').innerHTML = row.direction === 'Outbound' ? letterHtml(row, patient) : '';

    const record = $('#rv-record');
    // A referral taken for somebody with no record has no record to open, so
    // the link points at the register itself and says why.
    record.href = row.patientMrn ? `#/frontis/patients/${row.patientMrn}` : '#/frontis/patients';
    record.title = row.patientMrn ? '' : 'This referral has no record yet — register the patient to open one';
  }

  function metaHtml(row) {
    return `
      ${directionHtml(row)}
      ${statusHtml(row)}
      <span class="badge">${esc(row.type)}</span>
      <span>·</span>
      <span>${esc(referrals.partiesLabel(row))}</span>
      <span>·</span>
      <span>${esc(referrals.specialtyOf(row) || 'no specialty named')}</span>
      <span>·</span>
      <span class="t-mono-sm">${date(row.referralDate)}</span>`;
  }

  function actionsHtml(row) {
    const open = referrals.isOpen(row);
    const spendable = open && referrals.remaining(row) > 0 && row.direction === 'Inbound' && row.patientMrn;
    return `
      ${row.direction === 'Outbound'
        ? `<button class="btn btn--secondary btn--sm" data-act="print">
             <span class="icon icon--sm">print</span>Print referral form</button>
           ${open
             ? `<label class="btn btn--secondary btn--sm" title="Attach the signed letter">
                  <span class="icon icon--sm">upload_file</span>${row.letter ? 'Replace letter' : 'Upload signed letter'}
                  <input type="file" id="rv-letter-input" accept=".pdf,.jpg,.jpeg,.png" hidden>
                </label>`
             : ''}`
        : ''}
      ${open
        ? `<a class="btn btn--secondary btn--sm" href="#/frontis/referrals/${esc(row.no)}">
             <span class="icon icon--sm">edit</span>Edit</a>`
        : `<button class="btn btn--secondary btn--sm" disabled
             title="A ${esc(row.status.toLowerCase())} referral is closed — nothing on it moves">
             <span class="icon icon--sm">lock</span>Closed</button>`}
      ${spendable
        ? `<button class="btn btn--primary btn--sm" data-act="link">
             <span class="icon icon--sm">link</span>Link to encounter</button>`
        : ''}
      ${open && row.patientMrn && row.direction === 'Inbound'
        ? `<button class="btn btn--secondary btn--sm" data-act="schedule">
             <span class="icon icon--sm">event_upcoming</span>Schedule</button>`
        : ''}
      ${open
        ? `<button class="btn btn--secondary btn--sm" data-act="reject">
             <span class="icon icon--sm">thumb_down</span>Reject</button>
           <button class="btn btn--secondary btn--sm" data-act="cancel">
             <span class="icon icon--sm">cancel</span>Cancel</button>`
        : ''}
      ${row.status === 'Expired'
        ? `<button class="btn btn--primary btn--sm" data-act="extend">
             <span class="icon icon--sm">more_time</span>Extend validity</button>`
        : ''}`;
  }

  function bannersHtml(row) {
    if (row.status === 'Expired') {
      return `
        <div class="alert alert--warning">
          <span class="icon">schedule</span>
          <div>
            <div class="title">Lapsed on ${date(row.validUntil)}</div>
            ${referrals.remaining(row)} visit${referrals.remaining(row) === 1 ? '' : 's'} were never spent. Extend the
            validity to put it back on the worklist — the question it asks has not changed.
          </div>
        </div>`;
    }
    if (row.status === 'Rejected' || row.status === 'Cancelled') {
      return `
        <div class="alert alert--critical">
          <span class="icon">${row.status === 'Rejected' ? 'thumb_down' : 'cancel'}</span>
          <div><div class="title">${esc(row.status)} on ${date(row.updatedAt)}</div>
            ${esc(row.statusReason || 'No reason recorded.')}</div>
        </div>`;
    }
    if (!row.patientMrn) {
      return `
        <div class="alert alert--info">
          <span class="icon">person_search</span>
          <div>
            <div class="title">No patient record yet</div>
            This referral was taken for ${esc(referrals.patientName(row))} on ${esc(referrals.phoneOf(row) || 'no number')}.
            Registering that patient finds it by the phone number and attaches it, so it can be spent on a visit.
          </div>
        </div>`;
    }
    return '';
  }

  function patientHtml(row, patient) {
    if (!patient) {
      return `
        <dl class="dl dl--narrow">
          <dt>Name</dt><dd>${esc(referrals.patientName(row))} <span class="badge">Unregistered</span></dd>
          <dt>Phone</dt><dd class="t-mono-sm">${esc(referrals.phoneOf(row) || '—')}</dd>
        </dl>`;
    }
    return `
      <dl class="dl dl--narrow">
        <dt>Name</dt><dd>${esc(patient.nameEn)}${patient.masked ? ' <span class="badge">Restricted</span>' : ''}</dd>
        <dt>MRN</dt><dd class="t-mono-sm">${esc(patient.mrn)}</dd>
        <dt>Gender, age</dt><dd>${esc(patient.gender)}${age(patient.dob) === '—' ? '' : `, ${age(patient.dob)}`}</dd>
        <dt>Phone</dt><dd class="t-mono-sm">${esc(patient.phone || '—')}</dd>
        <dt>Status</dt><dd>${esc(patient.status)}</dd>
      </dl>`;
  }

  function detailHtml(row) {
    return `
      <dl class="dl dl--narrow">
        <dt>Direction</dt><dd>${directionHtml(row)} <span class="badge">${esc(row.type)}</span></dd>
        <dt>Referred by</dt><dd>${esc(referrals.sourceLabel(row))}${
          row.type !== 'External' || row.direction === 'Outbound'
            ? ` <span class="t-body-sm">${esc(doctorName(row.source.doctorId))}</span>` : ''}</dd>
        <dt>Referred to</dt><dd>${esc(referrals.destinationLabel(row))}</dd>
        <dt>Specialty</dt><dd>${esc(referrals.specialtyOf(row) || '—')}</dd>
        <dt>Reason</dt><dd>${esc(row.reason)}</dd>
        <dt>Referral date</dt><dd class="t-mono-sm">${date(row.referralDate)}</dd>
        <dt>Valid until</dt><dd>${validHtml(row)}</dd>
        <dt>Visits</dt><dd>${row.visits.total > 1
          ? `${visitsHtml(row)} <span class="t-body-sm">left of ${row.visits.total}</span>`
          : `One visit · ${referrals.remaining(row) ? 'not yet spent' : 'spent'}`}</dd>
        <dt>Payer reference</dt><dd class="t-mono-sm">${esc(row.payerRef || '—')}</dd>
        <dt>Letter</dt><dd>${row.letter
          ? `<span class="icon icon--sm">description</span> ${esc(row.letter.fileName)}
             <span class="t-body-sm">${fileSize(row.letter.size)}</span>`
          : '<span class="t-body-sm">None on file</span>'}</dd>
        <dt>${row.direction === 'Inbound' ? 'Encounters opened' : 'Written from'}</dt>
        <dd>${encountersHtml(row)}</dd>
        ${row.scheduledPreregNo ? `
          <dt>Held for</dt>
          <dd><a class="crumb-link t-mono-sm" href="#/frontis/prereg/${esc(row.scheduledPreregNo)}">${esc(row.scheduledPreregNo)}</a></dd>` : ''}
        <dt>Created</dt><dd class="t-mono-sm">${dateTime(row.createdAt)}</dd>
      </dl>`;
  }

  /**
   * The letter itself. It is the design system's own type and table classes on
   * a plain page — a module writes no CSS, and a referral form is a document,
   * not a component.
   */
  function letterHtml(row, patient) {
    const enc = (row.encounterNos || [])[0] ? encounters.get(row.encounterNos[0]) : null;
    return `
      <div class="panel">
        <div class="panel-header" data-print="hide">
          <span>Referral form</span>
          <span class="spacer"></span>
          <span class="t-body-sm">What Print hands the printer. Everything else on this page is left off it.</span>
        </div>
        <div class="panel-body">
          <div class="toolbar">
            <span class="t-title">${esc(HOSPITAL.name)}</span>
            <span class="spacer"></span>
            <span class="t-mono-sm">${esc(row.no)}</span>
          </div>
          <p class="t-body-sm">${esc(HOSPITAL.line)}</p>
          <div class="toolbar"><span class="t-title-sm">Referral letter</span></div>
          <dl class="dl dl--narrow">
            <dt>Date</dt><dd class="t-mono-sm">${date(row.referralDate)}</dd>
            <dt>Patient</dt>
            <dd>${esc(patient?.nameEn || referrals.patientName(row))}
              ${patient ? `<span class="t-mono-sm">${esc(patient.mrn)}</span>` : ''}
              ${patient && age(patient.dob) !== '—' ? `<span class="t-body-sm">${esc(patient.gender)}, ${age(patient.dob)}</span>` : ''}</dd>
            ${enc ? `<dt>Encounter</dt><dd class="t-mono-sm">${esc(enc.no)} — ${esc(enc.department)}, ${date(enc.startAt)}</dd>` : ''}
            <dt>From</dt>
            <dd>${esc(row.source.internalDepartment || HOSPITAL.name)}
              <br><span class="t-body-sm">${esc(doctorName(row.source.doctorId))}</span></dd>
            <dt>To</dt>
            <dd>${esc(sources.name(row.destination.facilityId) || '—')}
              <br><span class="t-body-sm">${esc(row.destination.doctorName || 'For the attention of the department')}
                · ${esc(row.destination.specialty || '')}</span></dd>
            <dt>Reason for referral</dt><dd>${esc(row.reason)}</dd>
            ${row.payerRef ? `<dt>Payer reference</dt><dd class="t-mono-sm">${esc(row.payerRef)}</dd>` : ''}
          </dl>
          <div class="toolbar"><span class="t-title-sm">Signature</span></div>
          <p class="t-body-sm">Referring physician: ${esc(doctorName(row.source.doctorId))}</p>
          <p class="t-body-sm">Signed: ______________________________&nbsp;&nbsp;&nbsp;Date: ______________</p>
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) {
      state.filter = chip.dataset.filter;
      $('#rv-history').innerHTML = historyHtml(no, state.filter);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'print') return window.print();
    if (act === 'link') return void (await askLink(no, ctx));
    if (act === 'schedule') return void (await askSchedule(no, ctx));
    if (act === 'reject') return void (await askReject(no));
    if (act === 'cancel') return void (await askCancel(no));
    if (act === 'extend') return void (await askExtend(no));
  });

  mount.addEventListener('change', (e) => {
    if (e.target.id !== 'rv-letter-input') return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('That letter is over 10 MB', 'warning');
    referrals.update(no, { letter: { fileName: file.name, size: file.size } });
    toast(`${file.name} attached to ${no}`, 'success');
  });

  // The page is live on both axes: a visit linked on the board and the expiry
  // sweep land without a reload, and switching demo role re-reads the masking.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  draw();
}
