// Conversion at #/frontis/prereg/<no>/convert — the pre-registration becoming
// the two records it was holding: a patient, and an encounter.
//
// Nothing here re-implements either. Step 1 mounts the real registration form,
// prefilled, so the duplicate check, the identifier rules and the MRN sequence
// all come with it; step 2 hands the visit to the encounter flow through
// ?prefill=, which is what fills its steps and writes the conversion back. The
// third step of the stepper is drawn but never becomes current: creating the
// encounter happens inside that flow, which is where it belongs.

import * as prereg from '../../../../data/repositories/prereg.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as eligibility from '../../../../data/repositories/eligibility.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { doctorName } from '../../../../data/seed/reference.js';
import { computeCompleteness } from './prereg-completeness.js';

export const meta = { title: 'Convert pre-registration' };

const STEPS = [
  { title: 'Complete identity', hint: 'The record the visit is opened against.' },
  { title: 'Encounter', hint: 'The visit itself, prefilled from what was captured.' },
  { title: 'Create', hint: 'Finished in the encounter flow.' },
];

/** What conversion needs and a phone call often does not carry. */
const MERGE_FIELDS = [
  { key: 'nameAr', label: 'Name (AR)' },
  { key: 'phone', label: 'Mobile' },
  { key: 'civilId', label: 'Civil ID' },
  { key: 'passportNo', label: 'Passport no.' },
];

export async function render(mount, ctx) {
  const no = ctx.params[0];
  const row = prereg.get(no);
  if (!row) throw new Error(`No pre-registration ${no}`);

  ctx.setHeader(`Convert ${no}`);
  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Expected arrivals', path: '/frontis/prereg' },
    { label: no, path: `/frontis/prereg/${no}` },
    { label: 'Convert' },
  ]);

  const state = { step: 0 };

  if (!prereg.isOpen(row)) return closed(mount, row);

  mount.innerHTML = `
    <div class="panel"><div class="panel-body"><div class="stepper" id="cv-stepper"></div></div></div>
    <div class="panel">
      <div class="panel-header">
        <span id="cv-title"></span>
        <span class="spacer"></span>
        <span class="t-body-sm" id="cv-hint"></span>
        <a class="btn btn--secondary btn--sm" href="#/frontis/prereg/${esc(no)}">
          <span class="icon icon--sm">arrow_back</span>Back to the pre-registration
        </a>
      </div>
      <div class="panel-body" id="cv-body"></div>
    </div>`;

  const $ = (sel) => mount.querySelector(sel);

  draw();

  function draw() {
    const current = prereg.get(no);
    $('#cv-stepper').innerHTML = stepperHtml();
    $('#cv-title').textContent = STEPS[state.step].title;
    $('#cv-hint').textContent = STEPS[state.step].hint;
    $('#cv-body').innerHTML = '';
    if (state.step === 0) return drawIdentity(current);
    $('#cv-body').innerHTML = encounterHtml(current);
  }

  /**
   * The third step is drawn but never reached: creating the encounter happens
   * in the encounter flow. It stays in the plain "not yet" state rather than
   * the blocked one, which the design system paints critical — nothing here is
   * wrong, the step is simply finished elsewhere.
   */
  function stepperHtml() {
    return STEPS.map((step, i) => {
      const cls = i === state.step ? ' stepper__step--current'
        : i < state.step ? ' stepper__step--done' : '';
      return `
        <button class="stepper__step${cls}" data-cv="step" data-step="${i}"
                ${i > state.step ? 'aria-disabled="true"' : ''}
                title="${i === 2 ? 'Created inside the encounter flow' : esc(step.title)}">
          <span class="stepper__n">${i < state.step ? '<span class="icon icon--sm">check</span>' : i + 1}</span>
          <span class="stepper__label">${esc(step.title)}</span>
        </button>`;
    }).join('<span class="stepper__line"></span>');
  }

  // --- step 1 ---------------------------------------------------------------

  function drawIdentity(current) {
    if (!current.patientMrn) return void drawRegister(current);
    const patient = patients.view(patients.get(current.patientMrn), currentRole());
    if (!patient) {
      $('#cv-body').innerHTML = '<p class="t-body-sm">The linked record is no longer on file.</p>';
      return;
    }
    const diffs = differences(current, patients.get(current.patientMrn));
    $('#cv-body').innerHTML = `
      <div class="rule-child-row">
        <span class="icon">person</span>
        <div>
          <a class="crumb-link" href="#/frontis/patients/${esc(patient.mrn)}">${esc(patient.nameEn)}</a>
          <br><span class="t-mono-sm">${esc(patient.mrn)}</span>
          <span class="t-body-sm">· ${date(patient.dob)} · ${esc(patient.phone || '—')}</span>
        </div>
        <span class="spacer"></span>
        <span class="badge${patients.statusTone(patient.status) ? ` badge--${patients.statusTone(patient.status)}` : ''}">
          <span class="dot"></span>${esc(patient.status)}</span>
      </div>
      ${patients.canOpenEncounter(patients.get(current.patientMrn)) ? '' : `
        <div class="alert alert--critical">
          <span class="icon">block</span>
          <div><div class="title">This record cannot open an encounter</div>
            A ${esc(patient.status.toLowerCase())} record is out of the encounter door, so the conversion stops here.</div>
        </div>`}
      ${patient.masked
        ? `<div class="perm-banner"><span class="icon">lock</span>
             <div><b>Restricted record.</b> You are signed in as ${esc(currentRole().title)}, which reads this
               patient masked, so nothing captured on the call is offered against it here. The visit can still
               be opened.</div></div>`
        : diffs.length ? mergeHtml(diffs)
          : '<p class="t-body-sm">Nothing was captured on the call that the record does not already say.</p>'}
      <div class="toolbar">
        <span class="spacer"></span>
        <button class="btn btn--primary btn--sm" data-cv="next"
                ${patients.canOpenEncounter(patients.get(current.patientMrn)) ? '' : 'disabled title="A closed record cannot open an encounter"'}>
          Next<span class="icon icon--sm">chevron_right</span>
        </button>
      </div>`;
  }

  /**
   * The design system ships no checkbox, so these are bare inputs in the row —
   * the same call the merge screen made for its Keep column.
   */
  function mergeHtml(diffs) {
    return `
      <div class="toolbar">
        <span class="t-title-sm">Merge new data into the record</span>
        <span class="spacer"></span>
        <button class="btn btn--secondary btn--sm" data-cv="merge">Merge ticked values</button>
      </div>
      <p class="t-body-sm">The call captured values the record does not carry. Tick the ones to keep — they are
        written to the record in one update, with this pre-registration as its reason.</p>
      ${diffs.map((d) => `
        <label class="rule-child-row">
          <input type="checkbox" data-merge="${esc(d.key)}">
          <div>
            <div class="t-title-sm">${esc(d.label)}</div>
            <span class="t-body-sm">${esc(d.was || 'not on the record')} → ${esc(d.now)}</span>
          </div>
        </label>`).join('')}`;
  }

  /** Everything ticked, in one write, so the trail carries one line for one act. */
  function merge() {
    const current = prereg.get(no);
    const taken = current.newPatient || {};
    const patch = {};
    for (const box of mount.querySelectorAll('[data-merge]:checked')) {
      patch[box.dataset.merge] = String(taken[box.dataset.merge] || '').trim();
    }
    if (!Object.keys(patch).length) return toast('Nothing ticked', 'warning');
    patients.update(current.patientMrn, patch, { reason: `Captured on pre-registration ${no}` });
    toast(`${current.patientMrn} updated`, 'success');
    draw();
  }

  /** Only what the call knows and the record does not, or says differently. */
  function differences(current, patient) {
    const taken = current.newPatient;
    if (!taken || !patient) return [];
    return MERGE_FIELDS
      .map(({ key, label }) => ({ key, label, was: patient[key] || '', now: String(taken[key] || '').trim() }))
      .filter((d) => d.now && d.now !== d.was);
  }

  /** The real registration form, prefilled, mounted in the step. */
  async function drawRegister(current) {
    const missing = computeCompleteness(current).missing;
    $('#cv-body').innerHTML = `
      <p class="t-body-sm">This visit was taken for a patient nobody has registered. The register asks for
        everything a record needs${missing.length ? `, and the call did not carry: ${esc(missing.join(', '))}` : ''}
        — the full duplicate check runs on save, and an identifier already on file stops it.</p>
      <div id="cv-register"></div>`;

    const host = $('#cv-register');
    const form = await import('../patient-master/patient-form.js');
    await form.render(host, {
      params: [],
      query: {},
      route: {},
      module: null,
      actions: document.createElement('div'),
      // patient-form.js reads this in register mode and fills its fields with it.
      prefill: current.newPatient,
      setHeader() {},
      setCrumb() {},
      href: (path) => `#${path}`,
      onData() {},
      navigate(path) {
        registered(String(path).split('/').pop());
      },
    });
    // Its own Cancel is a link back to Patient Master, which would take the page
    // out from under the conversion. The step has its own way back.
    host.querySelector('#pf-cancel')?.remove();
  }

  /** The register wrote the record: the cover follows it, then step 2. */
  function registered(mrn) {
    if (!mrn || !patients.get(mrn)) return;
    const current = prereg.get(no);
    const pending = current.insurance.pendingPolicy;
    const insurance = { ...current.insurance };
    if (pending && policies.canAddToChain(mrn)) {
      const saved = policies.create({ ...pending, patientMrn: mrn });
      insurance.policyId = saved.id;
      insurance.pendingPolicy = null;
      toast(`${policies.payerName(saved)} added to ${mrn}`, 'success');
    }
    prereg.update(no, { patientMrn: mrn, insurance }, {
      action: 'Linked',
      details: `Registered as ${mrn}${insurance.policyId ? ` · policy ${insurance.policyId}` : ''}`,
    });
    state.step = 1;
    draw();
  }

  // --- step 2 ---------------------------------------------------------------

  function encounterHtml(current) {
    const reuse = reusable(current);
    const cover = prereg.coverLabel(current);
    return `
      <p class="t-body-sm">The encounter flow opens with everything below already answered. Change any of it
        there — nothing is written until it is created, and creating it is what closes this pre-registration.</p>
      <dl class="dl">
        <dt>Patient</dt><dd>${esc(patients.get(current.patientMrn)?.nameEn || '—')}
          <span class="t-mono-sm">${esc(current.patientMrn || '')}</span></dd>
        <dt>Visit</dt><dd>${esc(prereg.typeLabel(current.visit.type))} · ${esc(current.visit.department)} ·
          ${esc(doctorName(current.visit.doctorId))}</dd>
        <dt>Start</dt><dd class="t-mono-sm">${dateTime(current.visit.expectedAt)}
          <span class="t-body-sm">${Date.parse(current.visit.expectedAt) > Date.now()
            ? '· booked ahead, so the encounter opens Planned'
            : '· already passed, so the encounter starts now'}</span></dd>
        ${current.visit.admissionIntent ? `<dt>Admission</dt><dd>Intended — the flow asks for the ward,
          the bed class and the expected length of stay.</dd>` : ''}
        <dt>Cover</dt><dd>${esc(cover)}</dd>
        <dt>Pre-check</dt><dd>${reuse
          ? `${esc(reuse.ref)} · ${esc(reuse.finalResult)}, ${dateTime(reuse.checkedAt)} — offered for reuse`
          : 'None on file for this cover inside the reuse window, so the flow runs a fresh check.'}</dd>
      </dl>
      <div class="toolbar">
        <button class="btn btn--secondary btn--sm" data-cv="back">
          <span class="icon icon--sm">chevron_left</span>Back
        </button>
        <span class="spacer"></span>
        <a class="btn btn--primary btn--sm"
           href="#/frontis/encounters/new?mrn=${esc(current.patientMrn)}&prefill=${esc(no)}">
          Continue to encounter<span class="icon icon--sm">chevron_right</span>
        </a>
      </div>`;
  }

  /**
   * The check the encounter flow would reuse — the same question its own
   * classification step asks, so this panel cannot promise something it does
   * not then do. A pre-check that ran before the patient was registered has
   * been re-pointed at the record by step 1, so it is found here too.
   */
  const reusable = (current) =>
    (current.patientMrn ? eligibility.latestValid(current.patientMrn, current.insurance.policyId) : null);

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', (e) => {
    const act = e.target.closest('[data-cv]')?.dataset.cv;
    if (!act) return;
    if (act === 'next' && state.step === 0) {
      state.step = 1;
      return draw();
    }
    if (act === 'back' && state.step === 1) {
      state.step = 0;
      return draw();
    }
    if (act === 'merge') return merge();
    if (act === 'step') {
      const to = Number(e.target.closest('[data-step]').dataset.step);
      if (to < state.step) {
        state.step = to;
        draw();
      }
    }
  });
}

function closed(mount, row) {
  const to = row.convertedTo;
  mount.innerHTML = `
    <div class="state-view state-view--tall">
      <div class="state-view__glyph"><span class="icon">${row.status === 'Converted' ? 'move_up' : 'event_busy'}</span></div>
      <div class="state-view__title">${esc(row.status)}</div>
      <p class="state-view__body">${row.status === 'Converted'
        ? `This pre-registration became encounter ${esc(to?.encounterNo || '—')} against ${esc(to?.mrn || '—')}. A pre-registration converts once.`
        : `A ${esc(row.status.toLowerCase())} pre-registration cannot be converted. Reactivate it from its own page if the visit is back on.`}</p>
      <div class="state-view__actions">
        <a class="btn btn--secondary" href="#/frontis/prereg/${esc(row.no)}">Open ${esc(row.no)}</a>
        ${to?.encounterNo
          ? `<a class="btn btn--primary" href="#/frontis/encounters/${esc(to.encounterNo)}">Open ${esc(to.encounterNo)}</a>`
          : '<a class="btn btn--primary" href="#/frontis/prereg">Back to expected arrivals</a>'}
      </div>
    </div>`;
}
