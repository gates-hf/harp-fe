// Defensio TPA amendments at #/defensio/tpa/amendments — the archive
// (every amendment, open first) and the four-step flow at /amendments/new
// and /amendments/<id>: the header, the computed impact, the tiered review
// and the posting. A Draft is edited in the flow; anything past it reads
// its steps done and its figures frozen. The ledger hands the mount over
// here on the deeper path.

import * as amendments from '../../../../data/repositories/tpa-amendments.js';
import * as tpas from '../../../../data/repositories/tpas.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { amendmentStatusHtml, reasonHtml } from './tpa-chips.js';
import { historyHtml } from './tpa-history.js';
import { headerHtml, impactHtml, postHtml, readHeader, reviewHtml } from './amendment-steps.js';

export const meta = { title: 'TPA amendments' };

const errorBox = (el, problems) => { if (el) el.innerHTML = problems.length ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : ''; };

export async function render(mount, ctx) {
  const id = ctx.params[1];
  if (!id) return renderArchive(mount, ctx);
  return renderFlow(mount, ctx, id === 'new' ? null : id);
}

// --- the archive ---------------------------------------------------------------------------

function renderArchive(mount, ctx) {
  ctx.setCrumb([{ label: 'Defensio', path: '/defensio/tpa' }, { label: 'TPA ledger', path: '/defensio/tpa' }, { label: 'Amendments' }]);
  const state = { q: '', tpaId: ctx.query?.tpaId || '', status: ctx.query?.status || '' };
  mount.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <span>Amendments</span>
        <span class="icon icon--sm" tabindex="0" role="img" aria-label="What an amendment is" title="The only path to a past period: a schedule is append-only, so a period already accrued is restated by an amendment — drafted, computed, signed at the write-off tiers by somebody other than the requester, and posted. A posted one is frozen.">info</span>
        <span class="spacer"></span>
        <a class="btn btn--secondary btn--sm" href="#/defensio/tpa"><span class="icon icon--sm">arrow_back</span>TPA ledger</a>
        <a class="btn btn--primary btn--sm" href="#/defensio/tpa/amendments/new"><span class="icon icon--sm">history_edu</span>New amendment</a>
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <label class="field field--grow"><span class="icon icon--sm">search</span><input type="search" id="aa-search" placeholder="Search amendment, administrator, version or reason" aria-label="Search amendments"></label>
          <label class="field"><span class="icon icon--sm">apartment</span><select id="aa-tpa" aria-label="Administrator"><option value="">Any administrator</option>${tpas.all().map((t) => `<option value="${esc(t.id)}"${t.id === state.tpaId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label class="field"><span class="icon icon--sm">filter_list</span><select id="aa-status" aria-label="Status"><option value="">Any status</option>${amendments.STATUSES.map((s) => `<option value="${s}"${s === state.status ? ' selected' : ''}>${esc(amendments.statusLabel(s))}</option>`).join('')}</select></label>
        </div>
        <div id="aa-body"></div>
      </div>
    </div>`;
  const $ = (sel) => mount.querySelector(sel);
  function draw() {
    const rows = amendments.search(state.q, state);
    $('#aa-body').innerHTML = rows.length ? `
      <table class="tbl">
        <thead><tr><th>Amendment</th><th>Administrator · payer</th><th>Period</th><th>Reason</th><th>Restates</th><th>Impact</th><th>Tier</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows.map((a) => `
          <tr data-id="${esc(a.id)}" tabindex="0" title="Open ${esc(a.id)}">
            <td><a class="crumb-link t-mono-sm" href="#/defensio/tpa/amendments/${esc(a.id)}">${esc(a.id)}</a><br><span class="t-body-sm">${esc(a.createdBy)} · ${esc(date(a.createdAt))}</span></td>
            <td>${esc(tpas.nameOf(a.tpaId))}<br><span class="t-body-sm">${esc(amendments.payerName(a))}</span></td>
            <td class="t-body-sm">${esc(date(a.period.from))} → ${esc(date(a.period.to))}</td>
            <td>${reasonHtml(a)}</td>
            <td class="t-mono-sm">${esc(a.supersedesRef || '—')} → ${esc(a.restatedVersionRef)}</td>
            <td>${a.totals ? `<span class="t-mono-sm">${esc(usd(a.totals.correction))}</span><br><span class="t-body-sm">${esc(String(a.totals.changed))} of ${esc(String(a.totals.accruals))} moved</span>` : '<span class="t-body-sm">—</span>'}</td>
            <td class="t-body-sm">${a.approval ? esc(amendments.tierLabel(a.approval.tier)) : '—'}</td>
            <td>${amendmentStatusHtml(a)}</td>
            <td><a class="btn btn--secondary btn--sm" href="#/defensio/tpa/amendments/${esc(a.id)}"><span class="icon icon--sm">open_in_new</span>Open</a></td>
          </tr>`).join('')}</tbody>
      </table>` : `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${state.q || state.tpaId || state.status ? 'search_off' : 'history_edu'}</span></div>
        <div class="state-view__title">${state.q || state.tpaId || state.status ? 'Nothing matches' : 'No amendment on file'}</div>
        <p class="state-view__body">${state.q || state.tpaId || state.status ? 'No amendment matches these filters.' : 'A past period is restated here — start one from a schedule version on the ledger, or with New amendment.'}</p>
      </div>`;
  }
  $('#aa-search').addEventListener('input', () => { state.q = $('#aa-search').value; draw(); });
  $('#aa-tpa').addEventListener('change', () => { state.tpaId = $('#aa-tpa').value; draw(); });
  $('#aa-status').addEventListener('change', () => { state.status = $('#aa-status').value; draw(); });
  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) ctx.navigate(`/defensio/tpa/amendments/${tr.dataset.id}`);
  });
  ctx.onData(draw);
  amendments.peersReady.then(() => { if (mount.isConnected) draw(); });
  draw();
  return undefined;
}

// --- the flow ------------------------------------------------------------------------------

async function renderFlow(mount, ctx, id) {
  const res = await fetch(new URL('./tpa-amendment.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load tpa-amendment.html (${res.status})`);
  mount.innerHTML = await res.text();
  const $ = (sel) => mount.querySelector(sel);
  // A new draft starts from the query (a version's Amend button fills it); an id opens the row.
  const state = {
    id, step: 0,
    prefill: { tpaId: ctx.query?.tpaId || '', payerId: ctx.query?.payerId || '', supersedesRef: ctx.query?.version || null, period: {}, reason: { code: 'TPA_ERROR', text: '' }, restatement: null, documentRef: null },
  };
  if (id && !amendments.get(id)) throw new Error(`No amendment ${id}`);
  if (id) state.step = Math.min(3, amendments.stepOf(amendments.get(id)));

  function draw() {
    const role = currentRole();
    const row = state.id ? amendments.get(state.id) : null;
    ctx.setCrumb([{ label: 'Defensio', path: '/defensio/tpa' }, { label: 'TPA ledger', path: '/defensio/tpa' }, { label: 'Amendments', path: '/defensio/tpa/amendments' }, { label: row ? row.id : 'New' }]);
    ctx.setHeader(row ? `${row.id} — ${tpas.nameOf(row.tpaId)}` : 'New amendment');
    $('#am-id').textContent = row ? row.id : 'New amendment';
    $('#am-meta').innerHTML = row ? `
      ${amendmentStatusHtml(row)}
      <span>${esc(tpas.nameOf(row.tpaId))} · ${esc(amendments.payerName(row))}</span>
      <span>·</span><span class="t-body-sm">${esc(date(row.period.from))} → ${esc(date(row.period.to))} · ${reasonHtml(row)}</span>
      <span>·</span><span class="t-mono-sm">${esc(row.supersedesRef || 'no version')} → ${esc(row.restatedVersionRef)}</span>` : '<span class="t-body-sm">Fill the header and save the draft; the impact is computed as you save.</span>';
    $('#am-actions').innerHTML = row && row.status === 'Draft' ? '<button class="btn btn--ghost btn--sm" data-act="discard" title="Drop the draft and its restatement"><span class="icon icon--sm">delete</span>Discard draft</button>' : '';
    $('#am-banners').innerHTML = row?.status === 'Rejected' ? `<div class="alert alert--critical"><span class="icon">block</span><div><div class="title">Refused</div>${esc(row.approval?.note || '')} — the restatement was dropped.</div></div>`
      : row?.status === 'Posted' ? `<div class="alert alert--success"><span class="icon">task_alt</span><div><div class="title">Posted ${esc(date(row.postedAt))}</div>${esc(row.restatedVersionRef)} is the version in force on its term; ${esc(String(row.totals?.changed || 0))} accrual${row.totals?.changed === 1 ? '' : 's'} restated, ${esc(String((row.postingRefs || []).length))} correction${(row.postingRefs || []).length === 1 ? '' : 's'} pending integration.</div></div>` : '';
    const reached = row ? amendments.stepOf(row) : 0;
    $('#am-stepper').innerHTML = amendments.STEPS.map((s, i) => {
      const done = row && (row.status === 'Posted' || i < reached);
      const cls = done ? 'stepper__step--done' : i === state.step ? 'stepper__step--current' : row?.status === 'Rejected' && i >= 2 ? 'stepper__step--blocked' : '';
      return `<button type="button" class="stepper__step ${cls}" data-step="${i}" aria-current="${i === state.step ? 'step' : 'false'}"><span class="stepper__n">${done ? '✓' : i + 1}</span><span class="stepper__label">${esc(s.label)}</span></button>${i < amendments.STEPS.length - 1 ? '<span class="stepper__line"></span>' : ''}`;
    }).join('');
    const host = document.createElement('div');
    $('#am-step').replaceChildren(host);
    if (state.step === 0) {
      host.innerHTML = headerHtml(row || state.prefill, { editable: !row || row.status === 'Draft' }) + (!row || row.status === 'Draft'
        ? `<div class="toolbar"><span class="spacer"></span><button class="btn btn--primary" data-act="save"><span class="icon icon--sm">save</span>${row ? 'Save and recompute' : 'Save draft'}</button></div>` : '');
      host.addEventListener('change', (e) => { if (e.target.id === 'ah-tpa' || e.target.id === 'ah-payer' || e.target.id === 'ah-from' || e.target.id === 'ah-to') { Object.assign(state.prefill, readHeader(host)); if (!row) draw(); } });
    } else if (state.step === 1) {
      host.innerHTML = impactHtml(row) + (row.status === 'Draft' ? `<div class="toolbar"><span class="spacer"></span><button class="btn btn--secondary" data-act="recompute"><span class="icon icon--sm">refresh</span>Recompute</button><button class="btn btn--primary" data-act="review"${row.impact?.length ? '' : ' disabled title="Nothing in the period to restate"'}><span class="icon icon--sm">send</span>Send for review</button></div>` : '');
    } else if (state.step === 2) host.innerHTML = reviewHtml(row, role);
    else host.innerHTML = postHtml(row) + `<div class="toolbar"><span class="t-title-sm">History</span></div>${historyHtml(amendments.history(row.id))}`;
  }

  mount.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const step = e.target.closest('[data-step]');
    if (step) { const n = Number(step.dataset.step); if (state.id || n === 0) { state.step = n; draw(); } return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const row = state.id ? amendments.get(state.id) : null;
    if (act === 'save') {
      const h = readHeader(mount);
      const r = row ? amendments.updateDraft(row.id, h) : amendments.draft(h);
      if (r?.error) return errorBox($('#ah-errors'), [r.error]);
      state.id = r.id;
      state.step = 1;
      toast(`${r.id} saved — ${r.totals?.accruals || 0} accrual${r.totals?.accruals === 1 ? '' : 's'} in the period`);
      if (!row) return ctx.navigate(`/defensio/tpa/amendments/${r.id}`);
      return draw();
    }
    if (act === 'recompute') { amendments.computeImpact(row.id); toast('Impact recomputed'); return draw(); }
    if (act === 'review') {
      const r = amendments.submitForReview(row.id);
      if (r?.error) return toast(r.error, 'warning');
      state.step = 2;
      toast(`${row.id} sent for review at ${amendments.tierLabel(r.approval.tier)}`);
      return draw();
    }
    if (act === 'approve' || act === 'reject') {
      const note = $('#ar-note')?.value || '';
      const r = act === 'approve' ? amendments.approve(row.id, { note }) : amendments.reject(row.id, { note });
      if (r?.error) return errorBox($('#ar-errors'), [r.error]);
      state.step = 3;
      toast(`${row.id} ${act === 'approve' ? 'approved' : 'refused'}`);
      return draw();
    }
    if (act === 'post') {
      const r = amendments.post(row.id);
      if (r?.error) return toast(r.error, 'warning');
      toast(`${row.id} posted — ${r.totals.changed} accrual${r.totals.changed === 1 ? '' : 's'} restated`);
      return draw();
    }
    if (act === 'discard') {
      if (amendments.discard(row.id)) { toast(`${row.id} discarded`); return ctx.navigate('/defensio/tpa/amendments'); }
    }
    return undefined;
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  amendments.peersReady.then(() => { if (mount.isConnected) draw(); });
  draw();
  return undefined;
}
