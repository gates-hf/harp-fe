// The form's left rail and its banners, plus the two conversions between what
// the store holds and what the form holds. prereg-form.js owns the state and
// every write; this file draws the frame around it and keeps both near the line
// cap — the split prereg-form-panels.js already uses.
//
// The store keeps ISO instants and a `datetime-local` input wants local
// wall-clock time, so the pair of conversions lives here, next to the one
// function that reads a stored row into the form.

import * as prereg from '../../../../data/repositories/prereg.js';
import * as patients from '../../../../data/repositories/patients.js';
import { date, dateTime, esc } from '../../../../shared/format.js';

const BLANK_PATIENT = {
  nameEn: '', nameAr: '', dob: '', gender: 'Female', phone: '',
  nationality: 'Lebanese', civilId: '', passportNo: '',
};

/** Save · Convert · Cancel, or the way back out of a row that is closed. */
export function footerHtml(state, stored) {
  if (state.readOnly && stored) {
    return `
      <p class="t-body-sm">This pre-registration is ${esc(stored.status.toLowerCase())} and is kept as it was.</p>
      <div class="toolbar">
        ${stored.status === 'Expired'
          ? '<button class="btn btn--primary btn--sm" data-act="reactivate"><span class="icon icon--sm">event_repeat</span>Reactivate</button>'
          : ''}
        <a class="btn btn--secondary btn--sm" href="#/frontis/prereg">Back to expected arrivals</a>
      </div>`;
  }
  const why = state.no ? '' : 'Save the pre-registration first';
  return `
    <div class="toolbar">
      <button class="btn btn--primary btn--sm" data-act="save">
        <span class="icon icon--sm">save</span>Save
      </button>
      <button class="btn btn--secondary btn--sm" data-act="convert"${why ? ' disabled' : ''} title="${esc(why)}">
        <span class="icon icon--sm">move_up</span>Convert
      </button>
      <span class="spacer"></span>
      <button class="btn btn--ghost btn--sm" data-act="cancel"${why ? ' disabled' : ''} title="${esc(why)}">Cancel</button>
    </div>
    <p class="t-body-sm">Save keeps what is captured, however little that is — the row waits at Pending until the
      checklist is answered. Convert saves first, then walks the identity and the encounter.</p>`;
}

/** Why a closed row is closed, in its own words. */
export function bannerHtml(stored) {
  if (!stored) return '';
  if (stored.status === 'Converted') {
    const to = stored.convertedTo || {};
    return `
      <div class="alert alert--info">
        <span class="icon">move_up</span>
        <div>
          <div class="title">Converted on ${date(to.at)}</div>
          This arrival became
          <a class="crumb-link" href="#/frontis/encounters/${esc(to.encounterNo || '')}">${esc(to.encounterNo || '—')}</a>
          against <a class="crumb-link" href="#/frontis/patients/${esc(to.mrn || '')}">${esc(to.mrn || '—')}</a>.
          It is kept read-only, so the hand-off is still readable.
        </div>
      </div>`;
  }
  if (stored.status === 'Cancelled') {
    return `
      <div class="alert alert--warning">
        <span class="icon">event_busy</span>
        <div><div class="title">Cancelled</div>${esc(stored.cancelReason || 'No reason recorded.')}</div>
      </div>`;
  }
  if (stored.status === 'Expired') {
    return `
      <div class="alert alert--warning">
        <span class="icon">schedule</span>
        <div>
          <div class="title">Expired</div>
          The arrival was expected ${dateTime(stored.visit.expectedAt)} and nobody converted it within
          ${prereg.CONFIG.preregExpiryHours} hours. Reactivate it with a new arrival time to put it back on the
          worklist with everything it already captured.
        </div>
      </div>`;
  }
  return '';
}

// --- the form's own shape -------------------------------------------------------

/** The stored row as the form holds it, or a blank one prefilled from ?mrn=. */
export function readRow(row, query = {}) {
  if (!row) {
    const mrn = query.mrn && patients.get(query.mrn) ? query.mrn : null;
    return {
      no: '',
      patientMrn: mrn,
      newPatient: { ...BLANK_PATIENT },
      visit: {
        type: 'OP', expectedAt: soon(), department: '', doctorId: '',
        procedureItemId: '', admissionIntent: false,
      },
      insurance: { mode: null, policyId: null, pendingPolicy: null },
      precheck: { status: 'Pending', snapshotRef: null, at: null },
      q: '', dup: null, readOnly: false,
    };
  }
  return {
    no: row.no,
    patientMrn: row.patientMrn,
    newPatient: { ...BLANK_PATIENT, ...(row.newPatient || {}) },
    visit: {
      type: row.visit.type,
      expectedAt: localOf(row.visit.expectedAt),
      department: row.visit.department || '',
      doctorId: row.visit.doctorId || '',
      procedureItemId: row.visit.procedureItemId || '',
      admissionIntent: Boolean(row.visit.admissionIntent),
    },
    insurance: { ...row.insurance },
    precheck: { ...row.precheck },
    q: '', dup: null, readOnly: !prereg.isOpen(row),
  };
}

/** An ISO instant as the local wall-clock string `datetime-local` wants. */
export function localOf(at) {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return '';
  when.setMinutes(when.getMinutes() - when.getTimezoneOffset());
  return when.toISOString().slice(0, 16);
}

/** And back — what the store keeps. */
export const isoOf = (local) => {
  const at = Date.parse(local);
  return Number.isFinite(at) ? new Date(at).toISOString() : '';
};

/** Tomorrow at nine — the arrival a desk booking most often wants. */
function soon() {
  const when = new Date(Date.now() + 24 * 3600000);
  when.setHours(9, 0, 0, 0);
  return localOf(when.toISOString());
}
