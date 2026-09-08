// Bulk import for one fee schedule — the CDM importer's four steps (template,
// upload, preview, import) scoped to the methodology modal that opened it, and
// run inside a nested dialog. Nothing is written to the store: the run resolves
// with the rows it read and methodology-form.js merges them into the draft, so
// Cancel on the methodology still discards them. The columns, the rules and the
// sample file live in fee-schedule.js.

import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, fileSize, usd } from '../../../../shared/format.js';
import { metricRailHtml, metricKey } from '../../../../shared/metric-card.js';
import * as csv from './fee-schedule.js';

const STEPS = [
  { title: 'Download template', hint: 'Two columns, one charge line per row.' },
  { title: 'Upload file', hint: 'CSV or XLSX, up to 5 MB.' },
  { title: 'Validation and preview', hint: 'Only valid rows join the schedule.' },
  { title: 'Add to schedule', hint: 'The prices join the draft — save the methodology to keep them.' },
];

/**
 * openFeeScheduleImport({ existing }) -> Promise<[{ itemId, price }] | undefined>
 * `existing` is the draft schedule, so a code already priced is an error.
 */
export async function openFeeScheduleImport({ existing = [] } = {}) {
  const state = { step: 0, fileName: '', rows: [], preview: 'all', error: '' };
  const priced = new Set(existing.map((line) => line.itemId));

  const dialog = modal.open({
    title: 'Bulk import fee schedule',
    sub: `${existing.length} item${existing.length === 1 ? '' : 's'} in the schedule now`,
    icon: 'upload_file',
    size: 'xl',
    body: '<div class="stepper" id="fi-stepper"></div><div id="fi-body"></div>',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--secondary" data-act="back"><span class="icon icon--sm">chevron_left</span>Back</button>
      <button class="btn btn--primary" data-act="next">Next<span class="icon icon--sm">chevron_right</span></button>`,
  });

  const el = dialog.el;
  const $ = (sel) => el.querySelector(sel);
  const valid = () => state.rows.filter((r) => r.valid);
  const invalid = () => state.rows.filter((r) => !r.valid);

  function draw() {
    $('#fi-stepper').innerHTML = STEPS.map(stepHtml).join('<span class="stepper__line"></span>');
    $('#fi-body').innerHTML = `<p class="t-body-sm">${esc(STEPS[state.step].hint)}</p>
      ${[stepTemplate, stepUpload, stepPreview, stepDone][state.step]()}`;

    const back = $('[data-act="back"]');
    const next = $('[data-act="next"]');
    back.disabled = state.step === 0 || state.step === 3;
    back.title = back.disabled ? 'You are on the first step' : '';
    next.innerHTML = state.step === 2
      ? `Add ${valid().length} price${valid().length === 1 ? '' : 's'}<span class="icon icon--sm">chevron_right</span>`
      : state.step === 3
        ? 'Done<span class="icon icon--sm">check</span>'
        : 'Next<span class="icon icon--sm">chevron_right</span>';
    next.disabled = (state.step === 1 && !state.rows.length) || (state.step === 2 && !valid().length);
    next.title = next.disabled
      ? state.step === 1 ? 'Upload a file or load the sample first' : 'No valid rows to add'
      : '';
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

  function stepTemplate() {
    return `
      <p class="t-body">The template carries ${csv.COLUMNS.map(([label]) => esc(label)).join(' and ')}. The charge code
         has to exist in the charge master as an active item — a schedule prices lines, it never creates them.</p>
      <div class="toolbar">
        <button class="btn btn--secondary btn--sm" data-act="template">
          <span class="icon icon--sm">download</span>Download template
        </button>
      </div>`;
  }

  function stepUpload() {
    return `
      <div class="rule-child-row">
        <label class="field">
          <span class="icon icon--sm">attach_file</span>
          <input type="file" id="fi-file" aria-label="Fee schedule file" accept=".csv,.xlsx">
        </label>
        <button class="btn btn--ghost btn--sm" data-act="sample">
          <span class="icon icon--sm">description</span>Load sample file
        </button>
      </div>
      <div class="field-error" ${state.error ? '' : 'hidden'}>${esc(state.error)}</div>
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
            title: `Rows that will be added${valid().length ? ' — select to list them' : ''}` },
          { value: invalid().length, label: 'Errors', key: invalid().length ? 'error' : '',
            pressed: invalid().length ? state.preview === 'error' : undefined,
            tone: invalid().length ? 'critical' : '',
            title: `Rows that will be skipped${invalid().length ? ' — select to list them' : ''}` },
        ])}
      </div>
      <table class="tbl">
        <thead><tr><th>#</th><th>Charge code</th><th>Item</th><th class="num">Agreed price</th><th>Result</th><th>Reason</th></tr></thead>
        <tbody>${previewRows().map(previewRow).join('')}</tbody>
      </table>`;
  }

  // A KPI card selects the rows it counts; the row number stays the line the
  // row came from, so an error still names its place in the file.
  const PREVIEW = { all: () => true, valid: (r) => r.valid, error: (r) => !r.valid };

  const previewRows = () =>
    state.rows.map((r, i) => ({ ...r, n: i + 1 })).filter(PREVIEW[state.preview] || PREVIEW.all);

  function previewRow(r) {
    const item = cdm.getByCode(r.chargeCode);
    return `
      <tr>
        <td class="t-mono-sm">${r.n}</td>
        <td class="t-mono-sm">${esc(r.chargeCode) || '—'}</td>
        <td>${item ? esc(cdm.label(item)) : '—'}</td>
        <td class="num t-mono-sm">${esc(r.price) || '—'}</td>
        <td><span class="badge badge--${r.valid ? 'success' : 'critical'}"><span class="dot"></span>${r.valid ? 'Valid' : 'Error'}</span></td>
        <td>${r.valid ? '—' : esc(r.reason)}</td>
      </tr>`;
  }

  function stepDone() {
    const added = valid();
    const total = added.reduce((sum, r) => sum + Number(r.price), 0);
    return `
      <div class="alert alert--${invalid().length ? 'warning' : 'success'}">
        <span class="icon">${invalid().length ? 'priority_high' : 'check_circle'}</span>
        <div>
          <div class="title">${added.length} added, ${invalid().length} skipped</div>
          ${esc(state.fileName)} — ${usd(total)} across the added lines.
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn--secondary btn--sm" data-act="report" ${invalid().length ? '' : 'disabled'}
                title="${invalid().length ? 'Download the skipped rows with their reason' : 'Every row was added'}">
          <span class="icon icon--sm">download</span>Download error report
        </button>
      </div>`;
  }

  // --- reading --------------------------------------------------------------

  function fail(message) {
    Object.assign(state, { fileName: '', rows: [], error: message });
    draw();
  }

  async function readFile(file) {
    if (file.size > csv.MAX_UPLOAD_BYTES) return fail(`${file.name} is ${fileSize(file.size)}. The limit is 5 MB.`);
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx'].includes(ext)) return fail(`${file.name} is not a CSV or XLSX file.`);
    load(file.name, ext === 'xlsx' ? csv.SAMPLE_CSV : await file.text());
  }

  function load(fileName, text) {
    const rows = csv.validateRows(csv.toRecords(text), priced);
    if (!rows.length) return fail('No data rows found. Check that the file keeps the template header.');
    Object.assign(state, { fileName, rows, error: '' });
    draw();
  }

  // --- events ---------------------------------------------------------------

  el.addEventListener('change', (e) => {
    if (e.target.id !== 'fi-file') return;
    const file = e.target.files?.[0];
    if (file) readFile(file);
  });

  el.addEventListener('click', (e) => {
    const kpi = metricKey(e);
    if (kpi) {
      state.preview = state.preview === kpi ? 'all' : kpi;
      return draw();
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'template') {
      csv.download('fee-schedule-template.csv', csv.templateCsv());
      return toast('Template downloaded', 'info');
    }
    if (act === 'sample') {
      load(csv.SAMPLE_FILE, csv.SAMPLE_CSV);
      return toast('Sample file loaded', 'info');
    }
    if (act === 'report') {
      csv.download('fee-schedule-import-errors.csv', csv.errorReportCsv(invalid()));
      return toast('Error report downloaded', 'info');
    }

    const step = e.target.closest('[data-step]');
    if (step && Number(step.dataset.step) < state.step && state.step < 3) {
      state.step = Number(step.dataset.step);
      return draw();
    }

    const button = e.target.closest('[data-act]');
    if (!button || button.disabled) return;
    if (act === 'back') {
      state.step -= 1;
      return draw();
    }
    if (act !== 'next') return;
    if (state.step === 3) {
      const rows = valid().map((r) => ({ itemId: cdm.getByCode(r.chargeCode).id, price: Number(r.price) }));
      return dialog.close(rows);
    }
    state.step += 1;
    draw();
  });

  draw();
  return dialog.closed;
}
