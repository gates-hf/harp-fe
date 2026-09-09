// Bulk import patients — four steps: template, upload, preview, import.
// Reached at #/frontis/patients/import; patient-list.js hands off the mount.
// The stepper is the charge-line importer's, with the registration columns and
// rules in patient-import-csv.js. MRNs are assigned as the rows are written.

import * as patients from '../../../../data/repositories/patients.js';
import { esc, fileSize } from '../../../../shared/format.js';
import { metricRailHtml, metricKey } from '../../../../shared/metric-card.js';
import { toast } from '../../../../shared/toast.js';
import * as csv from './patient-import-csv.js';

export const meta = { title: 'Bulk import' };

const STEPS = [
  { title: 'Download template', hint: 'Start from the template so the columns match.' },
  { title: 'Upload file', hint: 'CSV or XLSX, up to 5 MB.' },
  { title: 'Validation and preview', hint: 'Only valid rows are imported.' },
  { title: 'Import', hint: 'Each imported row is registered with the next MRN.' },
];

export async function render(mount, ctx) {
  const res = await fetch(new URL('./patient-import.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load patient-import.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader('Bulk import');
  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Patients', path: '/frontis/patients' },
    { label: 'Bulk import' },
  ]);

  const state = { step: 0, fileName: '', rows: [], preview: 'all', result: null };
  const $ = (sel) => mount.querySelector(sel);

  const valid = () => state.rows.filter((r) => r.valid);
  const invalid = () => state.rows.filter((r) => !r.valid);

  function draw() {
    $('#pi-stepper').innerHTML = STEPS.map(stepHtml).join('<span class="stepper__line"></span>');
    $('#pi-title').textContent = STEPS[state.step].title;
    $('#pi-hint').textContent = STEPS[state.step].hint;
    $('#pi-body').innerHTML = [stepTemplate, stepUpload, stepPreview, stepDone][state.step]();
    drawFooter();
  }

  function stepHtml(step, i) {
    const cls = i === state.step ? ' stepper__step--current' : i < state.step ? ' stepper__step--done' : '';
    return `
      <button class="stepper__step${cls}" data-step="${i}" ${i > state.step ? 'aria-disabled="true"' : ''}
              title="${i > state.step ? 'Finish the current step first' : esc(step.title)}">
        <span class="stepper__n">${i < state.step ? '<span class="icon icon--sm">check</span>' : i + 1}</span>
        <span class="stepper__label">${esc(step.title)}</span>
      </button>`;
  }

  function drawFooter() {
    const back = $('#pi-back');
    const next = $('#pi-next');
    const last = state.step === 3;

    back.disabled = state.step === 0 || last;
    back.title = state.step === 0 ? 'You are on the first step' : last ? 'The import is done' : '';

    next.innerHTML = last
      ? 'Back to Patient Master<span class="icon icon--sm">arrow_forward</span>'
      : state.step === 2
        ? `Import ${valid().length} ${valid().length === 1 ? 'patient' : 'patients'}<span class="icon icon--sm">chevron_right</span>`
        : 'Next<span class="icon icon--sm">chevron_right</span>';
    next.disabled = (state.step === 1 && !state.rows.length) || (state.step === 2 && !valid().length);
    next.title = next.disabled
      ? state.step === 1 ? 'Upload a file or load the sample first' : 'No valid rows to import'
      : '';
  }

  // --- steps ----------------------------------------------------------------

  function stepTemplate() {
    return `
      <p class="t-body">The template carries the ten registration columns in the order the importer reads them:
        ${csv.COLUMNS.map(([label]) => esc(label)).join(', ')}. One row per patient, dates as YYYY-MM-DD, and at
        least one of Civil ID or Passport on every row.</p>
      <div class="toolbar">
        <button class="btn btn--secondary btn--sm" data-action="template">
          <span class="icon icon--sm">download</span>Download template
        </button>
      </div>`;
  }

  function stepUpload() {
    return `
      <div class="rule-child-row">
        <label class="field">
          <span class="icon icon--sm">attach_file</span>
          <input type="file" id="pi-file" aria-label="Patient file" accept=".csv,.xlsx">
        </label>
        <button class="btn btn--ghost btn--sm" data-action="sample">
          <span class="icon icon--sm">description</span>Load sample file
        </button>
      </div>
      <div class="field-error" id="pi-upload-error" hidden></div>
      ${state.fileName
        ? `<div class="alert alert--info"><span class="icon">info</span><div>
             <div class="title">${esc(state.fileName)}</div>${state.rows.length} rows read. Continue to validation.</div></div>`
        : '<p class="t-body-sm">An XLSX file is accepted and read as the built-in sample; CSV is parsed in the browser.</p>'}`;
  }

  function stepPreview() {
    return `
      <div class="metric-rail">
        ${metricRailHtml([
          { value: state.rows.length, label: 'Rows in file', key: 'all', pressed: state.preview === 'all',
            title: 'Every row read from the file — select to list them all' },
          { value: valid().length, label: 'Valid', key: valid().length ? 'valid' : '',
            pressed: valid().length ? state.preview === 'valid' : undefined,
            title: `Rows that will register${valid().length ? ' — select to list them' : ''}` },
          { value: invalid().length, label: 'Errors', key: invalid().length ? 'error' : '',
            pressed: invalid().length ? state.preview === 'error' : undefined,
            tone: invalid().length ? 'critical' : '',
            title: `Rows that will be skipped${invalid().length ? ' — select to list them' : ''}` },
        ])}
      </div>
      <table class="tbl">
        <thead>
          <tr><th>#</th><th>Name EN</th><th>DOB</th><th>Gender</th><th>Identifier</th><th>Phone</th><th>Result</th><th>Reason</th></tr>
        </thead>
        <tbody>${previewRows().map(previewRow).join('')}</tbody>
      </table>`;
  }

  // A KPI card selects the rows it counts; the row number stays the line the
  // row came from, so an error still names its place in the file.
  const PREVIEW = { all: () => true, valid: (r) => r.valid, error: (r) => !r.valid };

  const previewRows = () =>
    state.rows.map((r, i) => ({ ...r, n: i + 1 })).filter(PREVIEW[state.preview] || PREVIEW.all);

  function previewRow(r) {
    return `
      <tr>
        <td class="t-mono-sm">${r.n}</td>
        <td>${esc(r.nameEn) || '—'}</td>
        <td class="t-mono-sm">${esc(r.dob) || '—'}</td>
        <td>${esc(r.gender) || '—'}</td>
        <td class="t-mono-sm">${esc(r.civilId || r.passportNo) || '—'}</td>
        <td class="t-mono-sm">${esc(r.phone) || '—'}</td>
        <td><span class="badge badge--${r.valid ? 'success' : 'critical'}"><span class="dot"></span>${r.valid ? 'Valid' : 'Error'}</span></td>
        <td>${r.valid ? '—' : esc(r.reason)}</td>
      </tr>`;
  }

  function stepDone() {
    const { imported, skipped, first, last } = state.result || { imported: 0, skipped: 0 };
    return `
      <div class="alert alert--${skipped ? 'warning' : 'success'}">
        <span class="icon">${skipped ? 'priority_high' : 'check_circle'}</span>
        <div>
          <div class="title">${imported} registered, ${skipped} skipped</div>
          ${esc(state.fileName)} — ${imported ? `MRNs ${esc(first)} to ${esc(last)} are in the register now, and the trail records the run.` : 'nothing was written.'}
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn--secondary btn--sm" data-action="report" ${skipped ? '' : 'disabled'}
                title="${skipped ? 'Download the skipped rows with their reason' : 'Every row registered'}">
          <span class="icon icon--sm">download</span>Download error report
        </button>
      </div>`;
  }

  // --- actions --------------------------------------------------------------

  async function readFile(file) {
    const box = $('#pi-upload-error');
    const fail = (message) => {
      box.textContent = message;
      box.hidden = false;
      state.fileName = '';
      state.rows = [];
      drawFooter();
    };

    if (file.size > csv.MAX_UPLOAD_BYTES) return fail(`${file.name} is ${fileSize(file.size)}. The limit is 5 MB.`);
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx'].includes(ext)) return fail(`${file.name} is not a CSV or XLSX file.`);

    load(file.name, ext === 'xlsx' ? csv.SAMPLE_CSV : await file.text());
  }

  function load(fileName, text) {
    const rows = csv.validateRows(csv.toRecords(text));
    if (!rows.length) {
      const box = $('#pi-upload-error');
      box.textContent = 'No data rows found. Check that the file keeps the template header.';
      box.hidden = false;
      state.fileName = '';
      state.rows = [];
      drawFooter();
      return;
    }
    state.fileName = fileName;
    state.rows = rows;
    draw();
  }

  function runImport() {
    const rows = valid();
    const created = rows.map((row) =>
      patients.create(
        {
          nameEn: row.nameEn,
          nameAr: row.nameAr,
          dob: row.dob,
          gender: row.gender,
          nationality: row.nationality,
          civilId: row.civilId || null,
          passportNo: row.passportNo || null,
          phone: row.phone,
          email: row.email,
          city: row.city,
        },
        { action: 'Imported', details: `Registered from ${state.fileName}` },
      ));

    state.result = {
      imported: created.length,
      skipped: invalid().length,
      first: created[0]?.mrn || '',
      last: created[created.length - 1]?.mrn || '',
    };
    patients.logImport(state.fileName, state.result.imported, state.result.skipped);
    state.step = 3;
    draw();
    toast(`${state.result.imported} patients registered`, 'success');
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', (e) => {
    const kpi = metricKey(e);
    if (kpi) {
      state.preview = state.preview === kpi ? 'all' : kpi;
      return draw();
    }

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'template') {
      csv.download('patients-import-template.csv', csv.templateCsv());
      toast('Template downloaded', 'info');
      return;
    }
    if (action === 'sample') {
      load(csv.SAMPLE_FILE, csv.SAMPLE_CSV);
      toast('Sample file loaded', 'info');
      return;
    }
    if (action === 'report') {
      csv.download('patients-import-errors.csv', csv.errorReportCsv(invalid()));
      toast('Error report downloaded', 'info');
      return;
    }

    const step = e.target.closest('[data-step]');
    if (step && Number(step.dataset.step) < state.step && !state.result) {
      state.step = Number(step.dataset.step);
      draw();
      return;
    }

    if (e.target.closest('#pi-back') && !$('#pi-back').disabled) {
      state.step -= 1;
      draw();
      return;
    }
    if (e.target.closest('#pi-next') && !$('#pi-next').disabled) {
      if (state.step === 3) return ctx.navigate('/frontis/patients');
      if (state.step === 2) return runImport();
      state.step += 1;
      draw();
    }
  });

  mount.addEventListener('change', (e) => {
    if (e.target.id !== 'pi-file') return;
    const file = e.target.files?.[0];
    if (file) readFile(file);
  });

  draw();
}
