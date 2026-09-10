// Upload ERA — four steps: file, parse report, review, save as Unposted.
// Reached at #/claima/remittances/upload; workbench.js hands off the mount.
// The payer importer's stepper, with the parsing in the posting engine and
// the built-in sample in data/seed/remittances.js — so the file the demo
// loads is a remittance against claims that are actually in flight.

import * as remittances from '../../../../data/repositories/remittances.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as engine from '../../../../data/engines/posting-engine.js';
import { sampleEra } from '../../../../data/seed/remittances.js';
import { date, esc, fileSize, usd } from '../../../../shared/format.js';
import { metricRailHtml, metricKey } from '../../../../shared/metric-card.js';
import { toast } from '../../../../shared/toast.js';
import { matchHtml, money } from './remittance-chips.js';

export const meta = { title: 'Upload ERA' };

const MAX_BYTES = 5 * 1024 * 1024;

const STEPS = [
  { title: 'Upload file', hint: 'The payer’s ERA as a CSV: H, C and L records.' },
  { title: 'Parse report', hint: 'What was read, and the rows that were not.' },
  { title: 'Review', hint: 'The payment, and each claim matched to ours.' },
  { title: 'Saved', hint: 'Captured as Unposted — match and post from its page.' },
];

export async function render(mount, ctx) {
  const res = await fetch(new URL('./era-upload.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load era-upload.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader('Upload ERA');
  ctx.setCrumb([
    { label: 'Claima', path: '/claima/remittances' },
    { label: 'Remittances', path: '/claima/remittances' },
    { label: 'Upload ERA' },
  ]);

  const state = { step: 0, fileName: '', text: '', parsed: null, preview: 'all', saved: null };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    $('#eu-stepper').innerHTML = STEPS.map(stepHtml).join('<span class="stepper__line"></span>');
    $('#eu-title').textContent = STEPS[state.step].title;
    $('#eu-hint').textContent = STEPS[state.step].hint;
    $('#eu-body').innerHTML = [stepUpload, stepReport, stepReview, stepDone][state.step]();
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
    const back = $('#eu-back');
    const next = $('#eu-next');
    const last = state.step === 3;
    back.disabled = state.step === 0 || last;
    back.title = state.step === 0 ? 'You are on the first step' : last ? 'The remittance is saved' : '';
    const header = state.parsed?.header;
    next.innerHTML = last
      ? 'Open the remittance<span class="icon icon--sm">arrow_forward</span>'
      : state.step === 2 ? 'Save as Unposted<span class="icon icon--sm">save</span>'
        : 'Next<span class="icon icon--sm">chevron_right</span>';
    next.disabled = (state.step === 0 && !state.parsed) || (state.step === 1 && !header) || (state.step === 2 && !header);
    next.title = next.disabled
      ? state.step === 0 ? 'Choose a file or load the sample first' : 'The file has no payment header — nothing to capture'
      : '';
  }

  // --- steps ----------------------------------------------------------------

  function stepUpload() {
    return `
      <p class="t-body">One CSV, three record types by the first column: <span class="t-mono-sm">H</span> the payment
        (payer, reference, date, method, total), <span class="t-mono-sm">C</span> a claim the payer adjudicated
        (our claim number, the payer’s reference, member, date of service, billed) and <span class="t-mono-sm">L</span>
        one of its lines (claim, line, charge code, billed, paid, adjustment, adjustment code, denied, denial code).</p>
      <div class="rule-child-row">
        <label class="field">
          <span class="icon icon--sm">attach_file</span>
          <input type="file" id="eu-file" aria-label="ERA file" accept=".csv,.txt">
        </label>
        <button class="btn btn--ghost btn--sm" data-action="sample">
          <span class="icon icon--sm">description</span>Load sample file
        </button>
      </div>
      <div class="field-error" id="eu-upload-error" hidden></div>
      ${state.fileName
        ? `<div class="alert alert--info"><span class="icon">info</span><div>
             <div class="title">${esc(state.fileName)}</div>${state.parsed.read} record${state.parsed.read === 1 ? '' : 's'} read,
             ${state.parsed.failed.length} failed. Continue to the parse report.</div></div>`
        : '<p class="t-body-sm">The sample is Bupa’s answer to four of its claims still in flight, with two rows that fail to parse.</p>'}`;
  }

  function stepReport() {
    const p = state.parsed;
    const lines = p.claims.reduce((n, c) => n + c.lines.length, 0);
    const total = engine.parseCsv(state.text).filter((cells, i) => !(i === 0 && /^(type|#)/i.test(String(cells[0] || '')))).length;
    return `
      <div class="metric-rail">
        ${metricRailHtml([
          { value: total, label: 'Records in file', key: 'all', pressed: state.preview === 'all',
            title: 'Every record the file carries — select to list them all' },
          { value: p.read - p.failed.filter((f) => f.row > 0).length, label: 'Read', key: 'valid', pressed: state.preview === 'valid',
            sub: `${p.claims.length} claim${p.claims.length === 1 ? '' : 's'}, ${lines} line${lines === 1 ? '' : 's'}`,
            title: 'Records that were read — select to list them' },
          { value: p.failed.length, label: 'Failed', key: p.failed.length ? 'error' : '', pressed: p.failed.length ? state.preview === 'error' : undefined,
            tone: p.failed.length ? 'critical' : '',
            sub: p.failed.length ? 'enter these by hand on the remittance' : 'every record read',
            title: 'Records that could not be read — select to list them' },
        ])}
      </div>
      ${p.header ? '' : '<div class="alert alert--critical"><span class="icon">error</span><div><div class="title">No payment header</div>The file has no H record, so there is nothing to capture. Fix the file and upload it again.</div></div>'}
      <table class="tbl">
        <thead><tr><th>Row</th><th>Record</th><th>Result</th><th>Reason</th></tr></thead>
        <tbody>${reportRows().map((r) => `
          <tr>
            <td class="t-mono-sm">${r.row || '—'}</td>
            <td class="t-mono-sm">${esc(r.raw)}</td>
            <td><span class="badge badge--${r.ok ? 'success' : 'critical'}"><span class="dot"></span>${r.ok ? 'Read' : 'Failed'}</span></td>
            <td>${r.ok ? '—' : esc(r.reason)}</td>
          </tr>`).join('')}</tbody>
      </table>
      <div class="toolbar">
        <button class="btn btn--secondary btn--sm" data-action="failures" ${p.failed.length ? '' : 'disabled'}
                title="${p.failed.length ? 'Download the failed rows with their reason' : 'Every record was read'}">
          <span class="icon icon--sm">download</span>Download failures
        </button>
      </div>`;
  }

  /** Every record of the file with its result, filtered by the pressed card; the row number is the file's. */
  function reportRows() {
    const failed = new Map(state.parsed.failed.map((f) => [f.row, f]));
    const rows = engine.parseCsv(state.text).map((cells, i) => {
      const n = i + 1;
      const f = failed.get(n);
      return { row: n, raw: cells.slice(0, 6).join(',') + (cells.length > 6 ? ',…' : ''), ok: !f, reason: f?.reason || '' };
    }).filter((r) => !(r.row === 1 && /^(type|#)/i.test(r.raw)));
    if (failed.has(0)) rows.unshift({ row: 0, raw: '', ok: false, reason: failed.get(0).reason });
    return rows.filter((r) => state.preview === 'all' || (state.preview === 'valid' ? r.ok : !r.ok));
  }

  function stepReview() {
    const h = state.parsed.header;
    const payer = payers.get(h.payerId);
    const pool = remittances.inFlightClaims(h.payerId);
    const matched = state.parsed.claims.map((c) => ({ ...c, ...engine.matchClaim(c, pool) }));
    const paid = matched.reduce((n, c) => n + c.lines.reduce((m, l) => m + l.paid, 0), 0);
    return `
      ${payer ? '' : `<div class="alert alert--critical"><span class="icon">error</span><div><div class="title">Unknown payer</div>The file names ${esc(h.payerId)}, which is not on the Payer Master. It cannot be captured.</div></div>`}
      <dl class="dl dl--narrow">
        <dt>Payer</dt><dd>${esc(payer?.nameEn || h.payerId)}</dd>
        <dt>Payment</dt><dd><span class="t-mono-sm">${esc(h.paymentRef)}</span> · ${esc(date(h.paymentDate))} · ${esc(h.method)}</dd>
        <dt>Total</dt><dd>${money(h.total)} <span class="t-body-sm">· ${esc(usd(paid))} on the rows, ${esc(usd(Math.max(0, h.total - paid)))} residue</span></dd>
        <dt>File</dt><dd>${esc(state.fileName)} · ${fileSize(new Blob([state.text]).size)} · kept as received</dd>
      </dl>
      <table class="tbl">
        <thead><tr><th>Payer ref</th><th>Our claim</th><th>Service</th><th>Billed</th><th>Lines</th><th>Paid</th><th>Match</th></tr></thead>
        <tbody>${matched.map((c) => `
          <tr>
            <td class="t-mono-sm">${esc(c.payerClaimRef)}</td>
            <td class="t-mono-sm">${esc(c.claimNo || c.candidates.join(', ') || '—')}</td>
            <td>${c.dateOfService ? esc(date(c.dateOfService)) : '—'}</td>
            <td>${c.billed ? money(c.billed) : '—'}</td>
            <td>${c.lines.length}</td>
            <td>${money(c.lines.reduce((n, l) => n + l.paid, 0))}</td>
            <td>${matchHtml(c.matchStatus, c.matchStatus === 'Ambiguous' ? `${c.candidates.length} candidates` : '')}</td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  function stepDone() {
    const rem = state.saved;
    return `
      <div class="alert alert--success">
        <span class="icon">check_circle</span>
        <div>
          <div class="title">${esc(rem.remittanceNo)} captured as Unposted</div>
          ${rem.claims.length} claim row${rem.claims.length === 1 ? '' : 's'} from ${esc(state.fileName)} — ${esc(usd(rem.payment.total))} by ${esc(rem.payment.method)}.
          The file is stored with the remittance and can be read there; open it to match the rows that need it and post.
        </div>
      </div>`;
  }

  // --- actions --------------------------------------------------------------

  async function readFile(file) {
    const box = $('#eu-upload-error');
    const fail = (message) => { box.textContent = message; box.hidden = false; state.fileName = ''; state.parsed = null; drawFooter(); };
    if (file.size > MAX_BYTES) return fail(`${file.name} is ${fileSize(file.size)}. The limit is 5 MB.`);
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'txt'].includes(ext)) return fail(`${file.name} is not a CSV file.`);
    return load(file.name, await file.text());
  }

  function load(fileName, text) {
    const parsed = engine.parseEra(text);
    if (!parsed.read && !parsed.claims.length) {
      const box = $('#eu-upload-error');
      box.textContent = 'No H, C or L records found. Check that the first column carries the record type.';
      box.hidden = false;
      state.fileName = '';
      state.parsed = null;
      return drawFooter();
    }
    Object.assign(state, { fileName, text, parsed, preview: 'all' });
    return draw();
  }

  function save() {
    const { error, remittance } = remittances.createFromFile({ fileName: state.fileName, text: state.text, parsed: state.parsed });
    if (error) return toast(error, 'critical');
    state.saved = remittance;
    state.step = 3;
    draw();
    return toast(`${remittance.remittanceNo} captured`, 'success');
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', (e) => {
    const kpi = metricKey(e);
    if (kpi) { state.preview = state.preview === kpi ? 'all' : kpi; return draw(); }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'sample') {
      const sample = sampleEra();
      if (!sample.claims) return toast('Bupa has no claim in flight to answer', 'warning');
      load(sample.fileName, sample.text);
      return toast('Sample file loaded', 'info');
    }
    if (action === 'failures') {
      download('era-failed-rows.csv', engine.failuresCsv(state.parsed.failed));
      return toast('Failures downloaded', 'info');
    }
    const step = e.target.closest('[data-step]');
    if (step && Number(step.dataset.step) < state.step && !state.saved) { state.step = Number(step.dataset.step); return draw(); }
    if (e.target.closest('#eu-back') && !$('#eu-back').disabled) { state.step -= 1; return draw(); }
    if (e.target.closest('#eu-next') && !$('#eu-next').disabled) {
      if (state.step === 3) return ctx.navigate(`/claima/remittances/${state.saved.remittanceNo}`);
      if (state.step === 2) return save();
      state.step += 1;
      return draw();
    }
    return undefined;
  });

  mount.addEventListener('change', (e) => {
    if (e.target.id !== 'eu-file') return;
    const file = e.target.files?.[0];
    if (file) readFile(file);
  });

  draw();
}

/** Hands the browser a file. The demo never uploads anything. */
function download(fileName, text) {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
