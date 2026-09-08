// Bulk import payers — four steps: template, upload, preview, import.
// Reached at #/pactum/payers/import; payer-list.js hands off the mount.
// Parsing and the row rules live in import-csv.js.

import * as payers from '../../../../data/repositories/payers.js';
import { esc, fileSize } from '../../../../shared/format.js';
import { metricRailHtml, metricKey } from '../../../../shared/metric-card.js';
import { toast } from '../../../../shared/toast.js';
import * as csv from './import-csv.js';

export const meta = { title: 'Bulk import' };

const STEPS = [
  { title: 'Download template', hint: 'Start from the template so the columns match.' },
  { title: 'Upload file', hint: 'CSV or XLSX, up to 5 MB.' },
  { title: 'Validation and preview', hint: 'Only valid rows are imported.' },
  { title: 'Import', hint: 'Imported payers are active straight away.' },
];

export async function render(mount, ctx) {
  const res = await fetch(new URL('./bulk-import.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load bulk-import.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader('Bulk import');
  ctx.setCrumb([
    { label: 'Pactum', path: '/pactum/payers' },
    { label: 'Payer Master', path: '/pactum/payers' },
    { label: 'Bulk import' },
  ]);

  const state = { step: 0, fileName: '', rows: [], preview: 'all', result: null };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    $('#bi-stepper').innerHTML = STEPS.map(stepHtml).join('<span class="stepper__line"></span>');
    $('#bi-title').textContent = STEPS[state.step].title;
    $('#bi-hint').textContent = STEPS[state.step].hint;
    $('#bi-body').innerHTML = [stepTemplate, stepUpload, stepPreview, stepDone][state.step]();
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
    const back = $('#bi-back');
    const next = $('#bi-next');
    const last = state.step === 3;

    back.disabled = state.step === 0 || last;
    back.title = state.step === 0 ? 'You are on the first step' : last ? 'The import is done' : '';

    next.innerHTML = last
      ? 'Back to payer list<span class="icon icon--sm">arrow_forward</span>'
      : state.step === 2
        ? `Import ${valid().length} ${valid().length === 1 ? 'payer' : 'payers'}<span class="icon icon--sm">chevron_right</span>`
        : 'Next<span class="icon icon--sm">chevron_right</span>';
    next.disabled = (state.step === 1 && !state.rows.length) || (state.step === 2 && !valid().length);
    next.title = next.disabled
      ? state.step === 1 ? 'Upload a file or load the sample first' : 'No valid rows to import'
      : '';
  }

  const valid = () => state.rows.filter((r) => r.valid);
  const invalid = () => state.rows.filter((r) => !r.valid);

  // --- steps ----------------------------------------------------------------

  function stepTemplate() {
    return `
      <p class="t-body">The template carries the eight payer columns in the order the importer reads them:
        ${csv.COLUMNS.map(([label]) => esc(label)).join(', ')}. Fill one row per payer, then upload it on the next step.</p>
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
          <input type="file" id="bi-file" aria-label="Payer file" accept=".csv,.xlsx">
        </label>
        <button class="btn btn--ghost btn--sm" data-action="sample">
          <span class="icon icon--sm">description</span>Load sample file
        </button>
      </div>
      <div class="field-error" id="bi-upload-error" hidden></div>
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
            title: `Rows that will import${valid().length ? ' — select to list them' : ''}` },
          { value: invalid().length, label: 'Errors', key: invalid().length ? 'error' : '',
            pressed: invalid().length ? state.preview === 'error' : undefined,
            tone: invalid().length ? 'critical' : '',
            title: `Rows that will be skipped${invalid().length ? ' — select to list them' : ''}` },
        ])}
      </div>
      <table class="tbl">
        <thead>
          <tr><th>#</th><th>Name (EN)</th><th>Type</th><th>Licence no.</th><th>Result</th><th>Reason</th></tr>
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
        <td>${esc(r.nameEn) || '—'}<br><span class="t-body-sm">${esc(r.nameAr) || '—'}</span></td>
        <td>${esc(r.type) || '—'}</td>
        <td class="t-mono-sm">${esc(r.licenseNo) || '—'}</td>
        <td><span class="badge badge--${r.valid ? 'success' : 'critical'}"><span class="dot"></span>${r.valid ? 'Valid' : 'Error'}</span></td>
        <td>${r.valid ? '—' : esc(r.reason)}</td>
      </tr>`;
  }

  function stepDone() {
    const { imported, skipped } = state.result || { imported: 0, skipped: 0 };
    return `
      <div class="alert alert--${skipped ? 'warning' : 'success'}">
        <span class="icon">${skipped ? 'priority_high' : 'check_circle'}</span>
        <div>
          <div class="title">${imported} imported, ${skipped} skipped</div>
          ${esc(state.fileName)} — imported payers are on the list now, and the trail records the run.
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn--secondary btn--sm" data-action="report" ${skipped ? '' : 'disabled'}
                title="${skipped ? 'Download the skipped rows with their reason' : 'Every row imported'}">
          <span class="icon icon--sm">download</span>Download error report
        </button>
      </div>`;
  }

  // --- actions --------------------------------------------------------------

  async function readFile(file) {
    const box = $('#bi-upload-error');
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

    const text = ext === 'xlsx' ? csv.SAMPLE_CSV : await file.text();
    load(file.name, text);
  }

  function load(fileName, text) {
    state.fileName = fileName;
    state.rows = csv.validateRows(csv.toRecords(text));
    if (!state.rows.length) {
      const box = $('#bi-upload-error');
      box.textContent = 'No data rows found. Check that the file keeps the template header.';
      box.hidden = false;
      state.fileName = '';
      drawFooter();
      return;
    }
    draw();
  }

  function runImport() {
    const rows = valid();
    for (const row of rows) {
      payers.create(
        {
          nameEn: row.nameEn, nameAr: row.nameAr, type: row.type, status: row.status,
          licenseNo: row.licenseNo, email: row.email, phone: row.phone, address: row.address,
          contacts: [], plans: [], documents: [],
        },
        { details: `Imported from ${state.fileName}` },
      );
    }
    state.result = { imported: rows.length, skipped: invalid().length };
    payers.logImport(state.fileName, state.result.imported, state.result.skipped);
    state.step = 3;
    draw();
    toast(`${state.result.imported} payers imported`, 'success');
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
      csv.download('payer-import-template.csv', csv.templateCsv());
      toast('Template downloaded', 'info');
      return;
    }
    if (action === 'sample') {
      load(csv.SAMPLE_FILE, csv.SAMPLE_CSV);
      toast('Sample file loaded', 'info');
      return;
    }
    if (action === 'report') {
      csv.download('payer-import-errors.csv', csv.errorReportCsv(invalid()));
      toast('Error report downloaded', 'info');
      return;
    }

    const step = e.target.closest('[data-step]');
    if (step && Number(step.dataset.step) < state.step && !state.result) {
      state.step = Number(step.dataset.step);
      draw();
      return;
    }

    if (e.target.closest('#bi-back') && !$('#bi-back').disabled) {
      state.step -= 1;
      draw();
      return;
    }
    if (e.target.closest('#bi-next') && !$('#bi-next').disabled) {
      if (state.step === 3) return ctx.navigate('/pactum/payers');
      if (state.step === 2) return runImport();
      state.step += 1;
      draw();
    }
  });

  mount.addEventListener('change', (e) => {
    if (e.target.id !== 'bi-file') return;
    const file = e.target.files?.[0];
    if (file) readFile(file);
  });

  draw();
}
