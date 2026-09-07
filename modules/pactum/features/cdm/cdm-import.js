// Bulk import charge lines — four steps: template, upload, preview, import.
// Reached at #/pactum/cdm/import; cdm-list.js hands off the mount. The stepper
// is the payer importer's, with the CDM columns and rules in cdm-import-csv.js.
// Items only: a bundle is composed in the builder, never imported.

import * as cdm from '../../../../data/repositories/cdm.js';
import { esc, fileSize } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import * as csv from './cdm-import-csv.js';

export const meta = { title: 'Bulk import' };

const STEPS = [
  { title: 'Download template', hint: 'Start from the template so the columns match.' },
  { title: 'Upload file', hint: 'CSV or XLSX, up to 5 MB.' },
  { title: 'Validation and preview', hint: 'Only valid rows are imported.' },
  { title: 'Import', hint: 'Imported lines are sellable straight away.' },
];

export async function render(mount, ctx) {
  const res = await fetch(new URL('./cdm-import.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load cdm-import.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader('Bulk import');
  ctx.setCrumb([
    { label: 'Pactum', path: '/pactum/payers' },
    { label: 'CDM', path: '/pactum/cdm' },
    { label: 'Bulk import' },
  ]);

  const state = { step: 0, fileName: '', rows: [], result: null };
  const $ = (sel) => mount.querySelector(sel);

  const valid = () => state.rows.filter((r) => r.valid);
  const invalid = () => state.rows.filter((r) => !r.valid);

  function draw() {
    $('#ci-stepper').innerHTML = STEPS.map(stepHtml).join('<span class="stepper__line"></span>');
    $('#ci-title').textContent = STEPS[state.step].title;
    $('#ci-hint').textContent = STEPS[state.step].hint;
    $('#ci-body').innerHTML = [stepTemplate, stepUpload, stepPreview, stepDone][state.step]();
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
    const back = $('#ci-back');
    const next = $('#ci-next');
    const last = state.step === 3;

    back.disabled = state.step === 0 || last;
    back.title = state.step === 0 ? 'You are on the first step' : last ? 'The import is done' : '';

    next.innerHTML = last
      ? 'Back to the charge master<span class="icon icon--sm">arrow_forward</span>'
      : state.step === 2
        ? `Import ${valid().length} ${valid().length === 1 ? 'line' : 'lines'}<span class="icon icon--sm">chevron_right</span>`
        : 'Next<span class="icon icon--sm">chevron_right</span>';
    next.disabled = (state.step === 1 && !state.rows.length) || (state.step === 2 && !valid().length);
    next.title = next.disabled
      ? state.step === 1 ? 'Upload a file or load the sample first' : 'No valid rows to import'
      : '';
  }

  // --- steps ----------------------------------------------------------------

  function stepTemplate() {
    return `
      <p class="t-body">The template carries the six charge-line columns in the order the importer reads them:
        ${csv.COLUMNS.map(([label]) => esc(label)).join(', ')}. One row per item — bundles are composed in the
        builder, not imported.</p>
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
          <input type="file" id="ci-file" aria-label="Charge line file" accept=".csv,.xlsx">
        </label>
        <button class="btn btn--ghost btn--sm" data-action="sample">
          <span class="icon icon--sm">description</span>Load sample file
        </button>
      </div>
      <div class="field-error" id="ci-upload-error" hidden></div>
      ${state.fileName
        ? `<div class="alert alert--info"><span class="icon">info</span><div>
             <div class="title">${esc(state.fileName)}</div>${state.rows.length} rows read. Continue to validation.</div></div>`
        : '<p class="t-body-sm">An XLSX file is accepted and read as the built-in sample; CSV is parsed in the browser.</p>'}`;
  }

  function stepPreview() {
    return `
      <div class="metric-rail">
        ${metric('Rows in file', state.rows.length, '')}
        ${metric('Valid', valid().length, '')}
        ${metric('Errors', invalid().length, invalid().length ? 'critical' : '')}
      </div>
      <table class="tbl">
        <thead>
          <tr><th>#</th><th>Charge code</th><th>Description</th><th>Category</th><th>Price</th><th>Result</th><th>Reason</th></tr>
        </thead>
        <tbody>${state.rows.map(previewRow).join('')}</tbody>
      </table>`;
  }

  function previewRow(r, i) {
    return `
      <tr>
        <td class="t-mono-sm">${i + 1}</td>
        <td class="t-mono-sm">${esc(r.chargeCode) || '—'}</td>
        <td>${esc(r.descriptionEn) || '—'}</td>
        <td>${esc(r.category) || '—'}</td>
        <td class="t-mono-sm">${esc(r.standardPrice) || '—'}</td>
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
          ${esc(state.fileName)} — imported lines are in the charge master now, and the trail records the run.
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn--secondary btn--sm" data-action="report" ${skipped ? '' : 'disabled'}
                title="${skipped ? 'Download the skipped rows with their reason' : 'Every row imported'}">
          <span class="icon icon--sm">download</span>Download error report
        </button>
      </div>`;
  }

  function metric(label, value, tone) {
    return `
      <div class="metric-rail-card${tone ? ` metric-rail-card--${tone}` : ''}" title="${esc(label)}">
        <span class="metric-rail-card__value">${value}</span>
        <span class="metric-rail-card__label">${esc(label)}</span>
      </div>`;
  }

  // --- actions --------------------------------------------------------------

  async function readFile(file) {
    const box = $('#ci-upload-error');
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
      const box = $('#ci-upload-error');
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
    for (const row of rows) {
      cdm.create(
        {
          kind: 'item',
          chargeCode: row.chargeCode,
          descriptionEn: row.descriptionEn,
          category: row.category,
          uom: row.uom,
          standardPrice: Number(row.standardPrice),
          status: row.status,
        },
        { details: `${row.chargeCode} — imported from ${state.fileName}` },
      );
    }
    state.result = { imported: rows.length, skipped: invalid().length };
    cdm.logImport(state.fileName, state.result.imported, state.result.skipped);
    state.step = 3;
    draw();
    toast(`${state.result.imported} charge lines imported`, 'success');
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'template') {
      csv.download('cdm-import-template.csv', csv.templateCsv());
      toast('Template downloaded', 'info');
      return;
    }
    if (action === 'sample') {
      load(csv.SAMPLE_FILE, csv.SAMPLE_CSV);
      toast('Sample file loaded', 'info');
      return;
    }
    if (action === 'report') {
      csv.download('cdm-import-errors.csv', csv.errorReportCsv(invalid()));
      toast('Error report downloaded', 'info');
      return;
    }

    const step = e.target.closest('[data-step]');
    if (step && Number(step.dataset.step) < state.step && !state.result) {
      state.step = Number(step.dataset.step);
      draw();
      return;
    }

    if (e.target.closest('#ci-back') && !$('#ci-back').disabled) {
      state.step -= 1;
      draw();
      return;
    }
    if (e.target.closest('#ci-next') && !$('#ci-next').disabled) {
      if (state.step === 3) return ctx.navigate('/pactum/cdm');
      if (state.step === 2) return runImport();
      state.step += 1;
      draw();
    }
  });

  mount.addEventListener('change', (e) => {
    if (e.target.id !== 'ci-file') return;
    const file = e.target.files?.[0];
    if (file) readFile(file);
  });

  draw();
}
