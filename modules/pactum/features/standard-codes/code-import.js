// Bulk import codes — four steps: template, upload, preview, import — into one
// version of one code system. Reached at
// #/pactum/standard-codes/<id>/import?version=<versionId>; the system page
// hands off the mount. Parsing and the row rules live in code-import-csv.js;
// the write is the repository's createMany, one batch and one trail line on
// the version beside a line per code.

import * as systems from '../../../../data/repositories/code-systems.js';
import * as versions from '../../../../data/repositories/code-system-versions.js';
import * as codes from '../../../../data/repositories/standard-codes.js';
import { date, esc, fileSize } from '../../../../shared/format.js';
import { metricRailHtml, metricKey } from '../../../../shared/metric-card.js';
import { toast } from '../../../../shared/toast.js';
import * as csv from './code-import-csv.js';

export const meta = { title: 'Bulk import codes' };

const STEPS = [
  { title: 'Download template', hint: 'Start from the template so the columns match.' },
  { title: 'Upload file', hint: 'CSV or XLSX, up to 5 MB.' },
  { title: 'Validation and preview', hint: 'Only valid rows are imported.' },
  { title: 'Import', hint: 'Imported codes are active straight away.' },
];

export async function render(mount, ctx) {
  const systemId = ctx.params[0];
  const system = systems.get(systemId);
  if (!system) throw new Error(`No code system ${systemId}`);
  const list = versions.bySystem(systemId);
  const version = list.find((v) => v.id === ctx.query?.version) || versions.currentOf(systemId) || list[0];
  if (!version) {
    ctx.navigate(`/pactum/standard-codes/${systemId}/versions`);
    return;
  }
  const diagnosis = system.systemType === 'DIAGNOSIS';
  const back = `/pactum/standard-codes/${systemId}/codes?version=${version.id}`;

  const res = await fetch(new URL('./code-import.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load code-import.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader(`Bulk import — ${system.name} ${version.versionLabel}`);
  ctx.setCrumb([
    { label: 'Pactum', path: '/pactum/payers' },
    { label: 'Standard Codes', path: '/pactum/standard-codes' },
    { label: system.name, path: `/pactum/standard-codes/${systemId}` },
    { label: `Bulk import · ${version.versionLabel}` },
  ]);
  mount.querySelector('#ci-back-link').href = `#${back}`;

  const state = { step: 0, fileName: '', rows: [], preview: 'all', result: null };
  const $ = (sel) => mount.querySelector(sel);

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
    const backBtn = $('#ci-back');
    const next = $('#ci-next');
    const last = state.step === 3;
    backBtn.disabled = state.step === 0 || last;
    backBtn.title = state.step === 0 ? 'You are on the first step' : last ? 'The import is done' : '';
    next.innerHTML = last
      ? 'Back to codes<span class="icon icon--sm">arrow_forward</span>'
      : state.step === 2
        ? `Import ${valid().length} ${valid().length === 1 ? 'code' : 'codes'}<span class="icon icon--sm">chevron_right</span>`
        : 'Next<span class="icon icon--sm">chevron_right</span>';
    next.disabled = (state.step === 1 && !state.rows.length) || (state.step === 2 && !valid().length);
    next.title = next.disabled ? (state.step === 1 ? 'Upload a file or load the sample first' : 'No valid rows to import') : '';
  }

  const valid = () => state.rows.filter((r) => r.valid);
  const invalid = () => state.rows.filter((r) => !r.valid);

  // --- steps ----------------------------------------------------------------

  function stepTemplate() {
    return `
      <div class="alert alert--info"><span class="icon">layers</span><div>
        <div class="title">${esc(system.name)} · version ${esc(version.versionLabel)}</div>
        Valid ${date(version.validFrom)}${version.validTo ? ` – ${date(version.validTo)}` : ' onward'} · ${codes.counts(version.id).total} codes already in it. A code the version already holds is skipped.
      </div></div>
      <p class="t-body">The template carries the seven columns in the order the importer reads them:
        ${csv.COLUMNS.map(([label]) => esc(label)).join(', ')}. Code and Display are required; the rest are the sex, age band and charge-master category the coder's checks read, blank when a code has no such rule.</p>
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
          <input type="file" id="ci-file" aria-label="Code file" accept=".csv,.xlsx">
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
        <thead><tr><th>#</th><th>Code</th><th>Display</th><th>Attributes</th><th>Result</th><th>Reason</th></tr></thead>
        <tbody>${previewRows().map(previewRow).join('')}</tbody>
      </table>`;
  }

  const PREVIEW = { all: () => true, valid: (r) => r.valid, error: (r) => !r.valid };
  const previewRows = () => state.rows.map((r, i) => ({ ...r, n: i + 1 })).filter(PREVIEW[state.preview] || PREVIEW.all);

  function previewRow(r) {
    const attrs = [r.sex, r.ageMin && `≥ ${r.ageMin}`, r.ageMax && `≤ ${r.ageMax}`, r.category].filter(Boolean).join(' · ');
    return `
      <tr>
        <td class="t-mono-sm">${r.n}</td>
        <td class="t-mono-sm">${esc(r.code) || '—'}</td>
        <td>${esc(r.display) || '—'}</td>
        <td class="t-body-sm">${esc(attrs) || '—'}</td>
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
          ${esc(state.fileName)} — the codes are in version ${esc(version.versionLabel)} now, and the trail records the run on the version and on each code.
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
    const text = ext === 'xlsx' ? csv.sampleCsv(diagnosis) : await file.text();
    load(file.name, text);
  }

  function load(fileName, text) {
    state.fileName = fileName;
    state.rows = csv.validateRows(csv.toRecords(text), version.id);
    if (!state.rows.length) {
      const box = $('#ci-upload-error');
      box.textContent = 'No data rows found. Check that the file keeps the template header.';
      box.hidden = false;
      state.fileName = '';
      drawFooter();
      return;
    }
    draw();
  }

  function runImport() {
    const { created, skipped } = codes.createMany(version.id, valid().map(csv.toCode), { source: state.fileName });
    // A row the preview passed and the repository refused (a code added by
    // hand since the preview was drawn) joins the error report with its reason.
    for (const s of skipped) {
      const row = state.rows.find((r) => r.valid && r.code === codes.normalizeCode(s.code));
      if (row) Object.assign(row, { valid: false, reason: s.reason });
    }
    state.result = { imported: created.length, skipped: invalid().length };
    state.step = 3;
    draw();
    toast(`${created.length} codes imported into ${system.name} ${version.versionLabel}`, 'success');
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
      csv.download('codes-import-template.csv', csv.templateCsv(diagnosis));
      return toast('Template downloaded', 'info');
    }
    if (action === 'sample') {
      load(csv.SAMPLE_FILE, csv.sampleCsv(diagnosis));
      return toast('Sample file loaded', 'info');
    }
    if (action === 'report') {
      csv.download('codes-import-errors.csv', csv.errorReportCsv(invalid()));
      return toast('Error report downloaded', 'info');
    }
    const step = e.target.closest('[data-step]');
    if (step && Number(step.dataset.step) < state.step && !state.result) {
      state.step = Number(step.dataset.step);
      return draw();
    }
    if (e.target.closest('#ci-back') && !$('#ci-back').disabled) {
      state.step -= 1;
      return draw();
    }
    if (e.target.closest('#ci-next') && !$('#ci-next').disabled) {
      if (state.step === 3) return ctx.navigate(back);
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
