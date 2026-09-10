// The batch page at #/claima/submission/<no>, and any tab id after it: what
// the batch holds, the files it generated, how it went out, what the payer
// said, and what happened to it. The six tabs draw into a node of their own
// inside the panel, so a tab that owns buttons binds its listener there and
// it retires when the tab is redrawn.

import * as batches from '../../../../data/repositories/batches.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { contentsHtml, modeHtml, payerName, statusHtml, timelineHtml } from './batch-chips.js';
import { askAdd, askClose, askReject, askSubmit, runGenerate } from './batch-actions.js';
import { askAcknowledge } from './acknowledge-dialog.js';
import { historyHtml } from './batch-history.js';
import * as claimsTab from './batch-tab-claims.js';
import * as filesTab from './batch-tab-files.js';

export const meta = { title: 'Batch' };

const TABS = [
  { id: 'claims', label: 'Claims' },
  { id: 'files', label: 'Files' },
  { id: 'submission', label: 'Submission' },
  { id: 'acknowledgment', label: 'Acknowledgment' },
  { id: 'rejections', label: 'Rejections' },
  { id: 'history', label: 'History' },
];

export async function render(mount, ctx) {
  const batch0 = batches.get(ctx.params[0]);
  if (!batch0) throw new Error(`No batch ${ctx.params[0]}`);
  const no = batch0.batchNo;

  const res = await fetch(new URL('./batch-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load batch-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = {
    tab: TABS.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : TABS[0].id,
    filter: 'all',
  };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const row = batches.get(no);
    if (!row) return;
    ctx.setHeader(`${row.batchNo} — ${payerName(row.payerId)}`);
    ctx.setCrumb([
      { label: 'Claima', path: '/claima/submission' },
      { label: 'Submission', path: '/claima/submission' },
      { label: row.batchNo },
    ]);
    $('#bv-no').textContent = row.batchNo;
    $('#bv-meta').innerHTML = metaHtml(row);
    $('#bv-actions').innerHTML = actionsHtml(row);
    $('#bv-timeline').innerHTML = timelineHtml(row);
    $('#bv-banners').innerHTML = bannersHtml(row);
    $('#bv-payer').href = `#/pactum/payers/${row.payerId}/contracts`;
    $('#bv-summary').innerHTML = summaryHtml(row);
    $('#bv-tabs').innerHTML = TABS.map((t) => `
      <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab"
              aria-selected="${t.id === state.tab}" data-tab="${t.id}">
        ${t.label}${tabCount(row, t.id)}
      </button>`).join('');
    drawPanel(row);
  }

  function tabCount(row, tab) {
    const n = tab === 'claims' ? row.claimNos.length
      : tab === 'files' ? row.files.length
        : tab === 'rejections' ? row.rejections.length : 0;
    return n ? ` <span class="badge">${n}</span>` : '';
  }

  /** Each tab draws into a node of its own — the shell's freshBody rule one level down. */
  function drawPanel(row) {
    const panel = $('#bv-panel');
    const host = document.createElement('div');
    panel.replaceChildren(host);
    const tabCtx = { batchNo: no, redraw: draw, navigate: ctx.navigate, setTab: (id) => { state.tab = id; draw(); } };
    if (state.tab === 'history') host.innerHTML = historyHtml(row.batchNo, state.filter);
    else if (state.tab === 'files') filesTab.renderFiles(host, tabCtx);
    else if (state.tab === 'submission') filesTab.renderSubmission(host, tabCtx);
    else if (state.tab === 'acknowledgment') filesTab.renderAcknowledgment(host, tabCtx);
    else if (state.tab === 'rejections') claimsTab.renderRejections(host, tabCtx);
    else claimsTab.renderClaims(host, tabCtx);
  }

  function metaHtml(row) {
    const gen = batches.latestGeneration(row);
    return `
      <span class="t-mono-sm">${esc(row.batchNo)}</span>
      ${statusHtml(row)}
      ${modeHtml(row.mode)}
      <span>·</span>
      <span>${esc(payerName(row.payerId))}</span>
      <span>·</span>
      ${contentsHtml(row)}
      ${gen ? `<span>·</span><span class="t-body-sm">files v${gen.version}</span>` : ''}`;
  }

  function actionsHtml(row) {
    const open = batches.isOpen(row);
    const gen = batches.latestGeneration(row);
    const submitWhy = batches.submitBlocker(row);
    const ackable = ['Submitted', 'Partially Rejected'].includes(row.status) && !row.acknowledgment;
    const closeWhy = batches.closeBlocker(row);
    const queue = batches.readyQueue(row.payerId).filter((c) => !row.exclusions.some((x) => x.claimNo === c.claimNo));
    if (row.status === 'Closed') return '<span class="badge badge--success">Closed</span>';
    return `
      ${open ? btn('add', 'playlist_add', `Add ready${queue.length ? ` (${queue.length})` : ''}`, queue.length > 0,
    queue.length ? `Add the ${queue.length} Ready claim${queue.length === 1 ? '' : 's'} waiting for this payer` : 'Nothing Ready for this payer outside the batch', 'secondary') : ''}
      ${open ? btn('generate', 'description', gen ? `Generate v${gen.version + 1}` : 'Generate', row.claimNos.length > 0,
    row.claimNos.length ? (gen ? 'Generate the files again — the earlier version is kept' : 'Validate the batch and generate the files') : 'Nothing in the batch to generate', gen ? 'secondary' : 'primary') : ''}
      ${open ? btn('submit', 'send', 'Mark submitted', !submitWhy, submitWhy || 'Record the method, the reference and the date', 'primary') : ''}
      ${!open && batches.ANSWERABLE.includes(row.status) ? btn('acknowledge', 'mark_email_read', 'Acknowledge', ackable,
    ackable ? 'Record the payer’s acknowledgment against the claims sent' : row.acknowledgment ? `Acknowledged ${date(row.acknowledgment.at)}` : 'Not acknowledged', ackable ? 'primary' : 'secondary') : ''}
      ${!open && batches.ANSWERABLE.includes(row.status) ? btn('reject', 'assignment_return', 'Add rejection', true, 'Record a rejection the payer sent on one claim', 'secondary') : ''}
      ${!open && batches.ANSWERABLE.includes(row.status) ? btn('close', 'inventory_2', 'Close', !closeWhy, closeWhy || 'Close the batch — every rejection has been taken up', 'secondary') : ''}`;
  }

  const btn = (act, icon, label, enabled, title, kind) => `
    <button class="btn btn--${kind} btn--sm" data-act="${act}"${enabled ? '' : ' disabled'} title="${esc(title)}">
      <span class="icon icon--sm">${icon}</span>${label}</button>`;

  function bannersHtml(row) {
    const out = [];
    if (row.status === 'Open' && row.files.length) {
      out.push(alertHtml('warning', 'sync_problem', 'The files no longer describe the batch',
        'A claim was added, excluded or ejected after the last generation. Generate again before marking the batch submitted.'));
    }
    if (row.status === 'Generated') {
      out.push(alertHtml('info', 'description', `Files generated — v${batches.latestGeneration(row).version}`,
        row.mode === 'Electronic'
          ? 'Download the submission file and the manifest from the Files tab, send them, then record the method and the reference under Submission.'
          : 'Print the claim forms, the cover sheets and the batch cover from the Files tab, send them, then record the courier reference under Submission.'));
    }
    if (row.status === 'Submitted') {
      out.push(alertHtml('info', 'schedule', `With ${payerName(row.payerId)} since ${dateTime(row.submission.at)}`,
        'Record the acknowledgment when it arrives — what was received, accepted and rejected has to add up to what was sent.'));
    }
    const open = batches.claimsOf(row).filter((c) => c.status === 'Rejected');
    if (open.length) {
      out.push(alertHtml('critical', 'assignment_return', `${open.length} rejected claim${open.length === 1 ? '' : 's'} still to fix`,
        'Each is on the rejections worklist with the fix its code points at. A fixed claim goes round again on its next cycle.',
        '<a class="btn btn--primary btn--sm" href="#/claima/submission/rejections"><span class="icon icon--sm">build</span>Open the worklist</a>'));
    }
    return out.join('');
  }

  const alertHtml = (tone, icon, title, body, action = '') => `
    <div class="alert alert--${tone}">
      <span class="icon">${icon}</span>
      <div><div class="title">${esc(title)}</div>${esc(body)}</div>
      ${action ? `<span class="spacer"></span>${action}` : ''}
    </div>`;

  function summaryHtml(row) {
    const profile = batches.profileOf(row.payerId);
    const gen = batches.latestGeneration(row);
    return `
      <dl class="dl dl--narrow">
        <dt>Batch no.</dt><dd class="t-mono-sm">${esc(row.batchNo)}</dd>
        <dt>Payer</dt><dd>${esc(payerName(row.payerId))}<br><span class="t-body-sm">${esc(profile.mode)} · ${esc(batches.cycleLabel(profile.cycle))}</span></dd>
        <dt>Status</dt><dd>${statusHtml(row)}</dd>
        <dt>Contents</dt><dd>${row.claimNos.length} claim${row.claimNos.length === 1 ? '' : 's'}<br><span class="t-mono-sm">${esc(usd(batches.valueOf(row)))}</span> payer share</dd>
        <dt>Excluded</dt><dd>${row.exclusions.length || '—'}</dd>
        <dt>Ejected</dt><dd>${row.ejected.length || '—'}</dd>
        <dt>Files</dt><dd>${gen ? `v${gen.version} · ${gen.files.length} file${gen.files.length === 1 ? '' : 's'}<br><span class="t-body-sm">${dateTime(gen.at)}</span>` : '—'}</dd>
        <dt>Submitted</dt><dd>${row.submission ? `${esc(row.submission.method)}${row.submission.reference ? ` · <span class="t-mono-sm">${esc(row.submission.reference)}</span>` : ''}<br><span class="t-body-sm">${dateTime(row.submission.at)} · ${esc(row.submission.by)}</span>` : '—'}</dd>
        <dt>Acknowledged</dt><dd>${row.acknowledgment ? `<span class="t-mono-sm">${esc(row.acknowledgment.payerRef || '—')}</span><br><span class="t-body-sm">${dateTime(row.acknowledgment.at)} · ${row.acknowledgment.acceptedCount} accepted, ${row.acknowledgment.rejectedCount} rejected</span>` : '—'}</dd>
        <dt>Created</dt><dd>${dateTime(row.createdAt)}<br><span class="t-body-sm">${esc(row.createdBy)}</span></dd>
        ${row.closedAt ? `<dt>Closed</dt><dd>${dateTime(row.closedAt)}</dd>` : ''}
      </dl>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab;
      return draw();
    }
    const chip = e.target.closest('[data-filter]');
    if (chip && state.tab === 'history') {
      state.filter = chip.dataset.filter;
      return draw();
    }
    const act = e.target.closest('#bv-actions [data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'add') return void (await askAdd(no));
    if (act === 'generate') { if (runGenerate(no, { navigate: ctx.navigate })) state.tab = 'files'; return; }
    if (act === 'submit') return void (await askSubmit(no));
    if (act === 'acknowledge') return void (await askAcknowledge(no));
    if (act === 'reject') return void (await askReject(no));
    if (act === 'close') return void (await askClose(no));
  });

  ctx.onData(draw);
  draw();
}
