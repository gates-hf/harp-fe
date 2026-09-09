// The referral form at #/frontis/referrals/new?direction=&mrn=&encounterNo= and
// #/frontis/referrals/<no> while it is still New or Scheduled — one page, three
// panels, one Save.
//
// The direction is fixed by the way in: an inbound referral and an outbound one
// ask opposite questions of the same fields, and a form that let you swap them
// halfway would be asking neither. Everything typed is held in state and
// written by Save; the only thing that escapes that is a facility or a doctor
// nobody had, which is created by the repository as the referral is saved.

import * as referrals from '../../../../data/repositories/referrals.js';
import * as sources from '../../../../data/repositories/referral-sources.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { departmentOf } from '../../../../data/seed/reference.js';
import { toast } from '../../../../shared/toast.js';
import { isPhone, todayIso } from '../../../../shared/format.js';
import { current as currentRole } from '../../../../shared/roles.js';
import {
  NEW, bannerHtml, detailsPanel, footerHtml, partiesPanel, patientPanel, summaryHtml,
} from './referral-form-panels.js';
import { askCancel, askSchedule } from './referral-actions.js';

export const meta = { title: 'Referral' };

/** The demo keeps a letter's name and size, never the bytes. 10 MB, as asked. */
const MAX_LETTER = 10 * 1024 * 1024;

export async function render(mount, ctx) {
  const no = ctx.params[0] === 'new' ? '' : ctx.params[0];
  const row = no ? referrals.get(no) : null;
  if (no && !row) throw new Error(`No referral ${no}`);
  // A closed referral is read on its own page, never in the form.
  if (row && !referrals.isOpen(row)) return ctx.navigate(`/frontis/referrals/${no}/view`);

  const res = await fetch(new URL('./referral-form.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load referral-form.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = readRow(row, ctx.query);
  ctx.setHeader(row ? `Referral ${row.no}` : `New ${state.direction.toLowerCase()} referral`);
  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Referrals', path: '/frontis/referrals' },
    { label: row ? row.no : 'New' },
  ]);

  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const stored = state.no ? referrals.get(state.no) : null;
    $('#rf-no').textContent = state.no || 'Number assigned on save';
    $('#rf-summary').innerHTML = summaryHtml(state, stored);
    $('#rf-footer').innerHTML = footerHtml(state, stored);
    $('#rf-banner').innerHTML = bannerHtml(stored);
    $('#rf-patient-hint').textContent = state.direction === 'Inbound'
      ? 'The clinic may not have a record here yet.'
      : 'An outbound referral is written from a visit, so the patient is on the register.';
    $('#rf-parties-hint').textContent = state.direction === 'Inbound'
      ? 'Where the referral came from, and which of our services it wants.'
      : 'Which of our departments is asking, and who is being asked.';
    $('#rf-patient').innerHTML = patientPanel(state, role);
    $('#rf-parties').innerHTML = partiesPanel(state);
    $('#rf-details').innerHTML = detailsPanel(state);
    clearError();
  }

  const showError = (message) => {
    const box = $('#rf-error');
    box.textContent = message;
    box.hidden = !message;
  };
  const clearError = () => showError('');

  // --- writes ---------------------------------------------------------------

  /** The referral as the repository stores it, with new sources created first. */
  function payload() {
    const inbound = state.direction === 'Inbound';
    const internal = state.type === 'Internal';
    const facilityId = inbound && !internal
      ? sources.upsertFromForm({ kind: 'Facility', id: real(state.src.facilityId), name: state.src.facilityNew })
      : null;
    const doctorId = inbound && !internal
      ? sources.upsertFromForm({
        kind: 'Doctor',
        id: real(state.src.doctorId),
        name: state.src.doctorNew,
        facilityId,
        specialty: state.dst.specialty,
      })
      : state.src.ourDoctorId || null;
    const destFacilityId = inbound
      ? null
      : sources.upsertFromForm({ kind: 'Facility', id: real(state.dst.facilityId), name: state.dst.facilityNew });

    return {
      direction: state.direction,
      type: state.type,
      patientMrn: state.patientMrn || null,
      unregistered: !state.patientMrn && state.unregistered.name
        ? { name: state.unregistered.name.trim(), phone: state.unregistered.phone.trim() }
        : null,
      source: {
        facilityId,
        doctorId,
        internalDepartment: inbound && !internal ? null : state.src.department || null,
      },
      destination: {
        facilityId: destFacilityId,
        doctorName: inbound ? null : state.dst.doctorName.trim() || null,
        specialty: state.dst.specialty,
        department: inbound ? state.dst.department || departmentOf(state.dst.specialty) || null : null,
      },
      reason: state.reason.trim(),
      referralDate: state.referralDate,
      validUntil: state.validUntil || null,
      payerRef: state.payerRef.trim() || null,
      letter: state.letter,
      visits: { total: Math.max(1, Number(state.visitsTotal) || 1) },
    };
  }

  function save() {
    const message = validate();
    if (message) {
      showError(message);
      return '';
    }
    const data = payload();
    if (state.no) {
      referrals.update(state.no, data);
      toast(`${state.no} saved`, 'success');
      return state.no;
    }
    const created = referrals.create(data);
    state.no = created.no;
    // An outbound referral names the visit it was written from. It spends no
    // visit and is not written into the encounter's linked.referralId: that
    // field holds the inbound referral the payer asked for, and only that one
    // answers the missing-referral flag.
    if (state.sourceEncounterNo && encounters.get(state.sourceEncounterNo)) {
      referrals.attachEncounter(created.no, state.sourceEncounterNo);
    }
    toast(`${created.no} created`, 'success');
    return created.no;
  }

  function validate() {
    if (!state.patientMrn) {
      if (state.direction === 'Outbound') return 'Choose the patient this referral is for.';
      if (!state.unregistered.name.trim()) return 'Enter the patient name, or choose the record they already have.';
      if (!state.unregistered.phone.trim()) return 'Enter a phone number — it is how registration finds this referral later.';
      if (!isPhone(state.unregistered.phone)) return 'Enter the phone number in full, for example +961 3 447 219.';
    }
    if (state.direction === 'Inbound' && state.type === 'External') {
      if (!state.src.facilityId) return 'Choose the referring facility, or type a new name.';
      if (state.src.facilityId === NEW && !state.src.facilityNew.trim()) return 'Type the name of the referring facility.';
      if (state.src.doctorId === NEW && !state.src.doctorNew.trim()) return 'Type the name of the referring doctor.';
    } else if (!state.src.department) {
      return 'Choose the referring department.';
    }
    if (state.direction === 'Outbound') {
      if (!state.dst.facilityId) return 'Choose the destination facility, or type a new name.';
      if (state.dst.facilityId === NEW && !state.dst.facilityNew.trim()) return 'Type the name of the destination facility.';
    }
    if (!state.dst.specialty) return 'Choose the specialty this referral is about.';
    if (!state.reason.trim()) return 'Enter the reason. It is the question the referral is asking.';
    if (!state.referralDate) return 'Enter the date the referral was written.';
    if (state.validUntil && state.validUntil < state.referralDate) {
      return 'A referral cannot lapse before it was written.';
    }
    if (!(Number(state.visitsTotal) >= 1)) return 'A referral is written for at least one visit.';
    return '';
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('input', (e) => {
    if (e.target.id === 'rf-q') {
      state.q = e.target.value;
      $('#rf-patient').innerHTML = patientPanel(state, currentRole());
      mount.querySelector('#rf-q')?.focus();
      return;
    }
    readField(e.target, { redraw: false });
  });

  mount.addEventListener('change', (e) => {
    if (e.target.id === 'rf-q') return;
    if (e.target.name === 'letter') return readLetter(e.target);
    readField(e.target, { redraw: true });
  });

  /** One named field into state. The dotted names are the two party groups. */
  function readField(target, { redraw }) {
    const name = target.name;
    if (!name) return;
    if (name.startsWith('src.') || name.startsWith('dst.')) {
      const [group, key] = name.split('.');
      state[group][key] = target.value;
      // Changing the facility changes which doctors the picker offers, and a
      // department changes which of ours it offers.
      if (key === 'facilityId') state[group].doctorId = '';
      if (key === 'department') state.src.ourDoctorId = '';
      return redraw ? draw() : undefined;
    }
    if (name in state.unregistered) {
      state.unregistered[name] = target.value;
      return redraw ? draw() : undefined;
    }
    if (!(name in state)) return;
    state[name] = target.value;
    if (redraw && (name === 'type' || name === 'referralDate')) {
      // A referral written on another day is valid from that day.
      if (name === 'referralDate' && state.validUntil) {
        state.validUntil = referrals.defaultValidUntil(state.referralDate);
      }
      draw();
    }
  }

  /** The letter, as metadata. The demo never holds the bytes. */
  function readLetter(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_LETTER) {
      input.value = '';
      return showError('That letter is over 10 MB. Scan it again at a lower resolution.');
    }
    state.letter = { fileName: file.name, size: file.size };
    draw();
  }

  mount.addEventListener('click', async (e) => {
    const mode = e.target.closest('[data-mode]');
    if (mode) {
      state.mode = mode.dataset.mode;
      return draw();
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;

    if (act === 'pick') {
      state.patientMrn = e.target.closest('[data-mrn]')?.dataset.mrn || '';
      state.q = '';
      return draw();
    }
    if (act === 'unpick') {
      state.patientMrn = '';
      return draw();
    }
    if (act === 'drop-letter') {
      state.letter = null;
      return draw();
    }
    if (act === 'save') {
      const saved = save();
      if (saved) ctx.navigate(`/frontis/referrals/${saved}`);
      return;
    }
    if (act === 'schedule') return void (await askSchedule(state.no, ctx));
    if (act === 'cancel') {
      if (await askCancel(state.no)) ctx.navigate('/frontis/referrals');
    }
  });

  draw();

  // A record merged, a visit linked from registration or the expiry sweep
  // running all change what this form is holding.
  ctx.onData(() => {
    const stored = state.no ? referrals.get(state.no) : null;
    if (state.no && !stored) return ctx.navigate('/frontis/referrals');
    if (stored && !referrals.isOpen(stored)) return ctx.navigate(`/frontis/referrals/${state.no}/view`);
    draw();
  });
}

/** The stored row, or a blank one filled from the way in. */
function readRow(row, query = {}) {
  if (!row) {
    const direction = query.direction === 'Outbound' ? 'Outbound' : 'Inbound';
    const mrn = query.mrn && patients.get(query.mrn) ? query.mrn : '';
    const encounter = query.encounterNo ? encounters.get(query.encounterNo) : null;
    return {
      no: '',
      direction,
      type: 'External',
      patientMrn: encounter?.patientMrn || mrn,
      unregistered: { name: '', phone: '' },
      mode: 'patient',
      q: '',
      src: {
        facilityId: '', facilityNew: '', doctorId: '', doctorNew: '',
        department: encounter?.department || '', ourDoctorId: encounter?.doctorId || '',
      },
      dst: { facilityId: '', facilityNew: '', doctorName: '', specialty: '', department: '' },
      reason: '',
      referralDate: todayIso(),
      validUntil: direction === 'Inbound' ? referrals.defaultValidUntil() : '',
      payerRef: '',
      letter: null,
      visitsTotal: 1,
      sourceEncounterNo: encounter?.no || '',
    };
  }
  return {
    no: row.no,
    direction: row.direction,
    type: row.type,
    patientMrn: row.patientMrn || '',
    unregistered: { name: row.unregistered?.name || '', phone: row.unregistered?.phone || '' },
    mode: row.unregistered ? 'unregistered' : 'patient',
    q: '',
    src: {
      facilityId: row.source.facilityId || '',
      facilityNew: '',
      doctorId: row.direction === 'Inbound' && row.type === 'External' ? row.source.doctorId || '' : '',
      doctorNew: '',
      department: row.source.internalDepartment || '',
      ourDoctorId: row.direction === 'Inbound' && row.type === 'External' ? '' : row.source.doctorId || '',
    },
    dst: {
      facilityId: row.destination.facilityId || '',
      facilityNew: '',
      doctorName: row.destination.doctorName || '',
      specialty: row.destination.specialty || '',
      department: row.destination.department || '',
    },
    reason: row.reason || '',
    referralDate: row.referralDate,
    validUntil: row.validUntil || '',
    payerRef: row.payerRef || '',
    letter: row.letter ? { ...row.letter } : null,
    visitsTotal: row.visits.total,
    sourceEncounterNo: row.direction === 'Outbound' ? (row.encounterNos || [])[0] || '' : '',
  };
}

/** The picker's "type a new name" sentinel is not an id. */
const real = (value) => (value === NEW ? '' : value || '');
