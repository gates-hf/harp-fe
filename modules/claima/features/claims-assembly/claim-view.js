// The claim page at #/claima/claims/<no>, and any tab id after it: what the
// claim carries, what the scrub said, and what happened to it. The five tabs
// draw into a node of their own inside the panel, so a tab that owns buttons
// binds its listener there and it retires when the tab is redrawn.

import * as claims from '../../../../data/repositories/claims.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { doctorName } from '../../../../data/seed/reference.js';
import {
  ageHtml, contractHtml, coverLabel, kindHtml, scrubHtml, staleHtml, statusHtml,
} from './claim-chips.js';
import { askFinalize, askReopen, finalizeBlocker, runScrub } from './claim-actions.js';
import { askRefresh } from './claim-refresh.js';
import { historyHtml } from './claim-history.js';
import { codingHtml, linesHtml } from './claim-lines.js';
import * as attachmentsTab from './claim-attachments.js';
import * as scrubTab from './claim-scrub.js';
// A32: the Nullify action and the Void banner read the nullification record.
import * as nullifications from '../../../../data/repositories/nullifications.js';
import { askNullify } from '../nullification/nullify-dialog.js';

export const meta = { title: 'Claim' };

const TABS = [
  { id: 'lines', label: 'Lines' },
  { id: 'coding', label: 'Coding' },
  { id: 'attachments', label: 'Attachments' },
  { id: 'scrub', label: 'Scrub' },
  { id: 'history', label: 'History' },
];

export async function render(mount, ctx) {
  claims.ensureAssembled();
  const claim0 = claims.get(ctx.params[0]);
  if (!claim0) throw new Error(`No claim ${ctx.params[0]}`);
  const id = claim0.id;

  const res = await fetch(new URL('./claim-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load claim-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = {
    tab: TABS.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : TABS[0].id,
    filter: 'all',
    jump: ctx.query?.line || null,
  };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const row = claims.get(id);
    if (!row) return;
    const patient = patients.view(patients.get(row.patientMrn), role);

    ctx.setHeader(`${row.claimNo} — ${patient?.nameEn || row.patientMrn}`);
    ctx.setCrumb([
      { label: 'Claima', path: '/claima/claims' },
      { label: 'Claims', path: '/claima/claims' },
      { label: row.claimNo },
    ]);

    $('#cv-no').textContent = row.claimNo;
    $('#cv-meta').innerHTML = metaHtml(row, patient);
    $('#cv-actions').innerHTML = actionsHtml(row, patient);
    $('#cv-banners').innerHTML = bannersHtml(row);
    const enc = $('#cv-encounter');
    enc.href = row.encounterNo ? `#/frontis/encounters/${row.encounterNo}` : '#/frontis/encounters';

    // A claim names the payer, the plan and the money, so it is withheld on a
    // restricted record for the reason the Financial tab withholds its cover.
    if (patient?.masked) {
      $('#cv-summary').innerHTML = maskedHtml(role);
      $('#cv-tabs').innerHTML = '';
      $('#cv-panel').innerHTML = '';
      return;
    }

    $('#cv-summary').innerHTML = summaryHtml(row, patient);
    $('#cv-tabs').innerHTML = TABS.map((t) => `
      <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab"
              aria-selected="${t.id === state.tab}" data-tab="${t.id}">
        ${t.label}${tabCount(row, t.id)}
      </button>`).join('');
    drawPanel(row);
  }

  function tabCount(row, tab) {
    const n = tab === 'lines' ? row.lines.length
      : tab === 'attachments' ? (row.attachments || []).length
        : tab === 'scrub' ? (claims.scrubResult(row) ? claims.latestScrub(row).findings.length : 0)
          : 0;
    return n ? ` <span class="badge">${n}</span>` : '';
  }

  /** Each tab draws into a node of its own — the shell's freshBody rule one level down. */
  function drawPanel(row) {
    const panel = $('#cv-panel');
    const host = document.createElement('div');
    panel.replaceChildren(host);
    if (state.tab === 'history') host.innerHTML = historyHtml(row.id, state.filter);
    else if (state.tab === 'coding') host.innerHTML = codingHtml(row);
    else if (state.tab === 'attachments') attachmentsTab.render(host, { id: row.id, redraw: draw });
    else if (state.tab === 'scrub') scrubTab.render(host, { id: row.id, redraw: draw, jumpTo });
    else host.innerHTML = linesHtml(row, { highlight: state.jump });
    if (state.jump && state.tab === 'lines') {
      const target = host.querySelector(`[data-line="${CSS.escape(state.jump)}"]`);
      if (target) target.scrollIntoView({ block: 'center' });
      state.jump = null;
    }
  }

  /** A scrub finding names the tab it is read on, and the line or the anchor inside it. */
  function jumpTo(target) {
    if (!target) return;
    state.tab = TABS.some((t) => t.id === target.tab) ? target.tab : 'lines';
    state.jump = target.lineId || target.anchor || target.docType || null;
    draw();
    if (state.jump && state.tab !== 'lines') {
      const el = $('#cv-panel').querySelector(`[data-line="${CSS.escape(state.jump)}"], [data-doc="${CSS.escape(state.jump)}"]`);
      if (el) el.scrollIntoView({ block: 'center' });
      state.jump = null;
    }
  }

  function metaHtml(row, patient) {
    return `
      <span class="t-mono-sm">${esc(row.claimNo)}</span>
      ${kindHtml(row)}
      ${statusHtml(row)}
      ${staleHtml(row)}
      ${scrubHtml(row)}
      <span>·</span>
      <span>${esc(patient?.masked ? 'cover withheld' : coverLabel(row))}</span>
      <span>·</span>
      ${contractHtml(row)}
      <span>·</span>
      <span class="t-body-sm">${patient?.masked ? 'value withheld' : esc(usd(row.totals.payerShare))} · ${ageHtml(row)}</span>`;
  }

  function actionsHtml(row, patient) {
    if (patient?.masked) {
      return `<button class="btn btn--secondary btn--sm" disabled
                title="Your role reads this record masked, so it cannot act on its claims">
                <span class="icon icon--sm">lock</span>Withheld</button>`;
    }
    const draft = row.status === 'Draft';
    const ready = row.status === 'Ready';
    const secondary = claims.kindOf(row) === 'Secondary' && !row.activatedAt;
    const blocker = finalizeBlocker(row);
    const role = currentRole();
    if (row.status === 'Void') {
      const no = row.nullification?.no;
      return no
        ? `<a class="badge badge--critical" href="#/claima/nullifications/${esc(no)}" title="Open the nullification record"><span class="dot"></span>Nullified · ${esc(no)}</a>`
        : '<span class="badge badge--critical"><span class="dot"></span>Void</span>';
    }
    if (!claims.isEditable(row)) {
      return `<span class="badge badge--info">Managed in ${claims.isPending(row) ? 'Submission' : 'Remittance'}</span> ${nullifyBtn(row, role)}`;
    }
    return `
      ${btn('refresh', 'sync', 'Refresh', draft && !secondary, secondary
        ? 'A secondary claim is activated by the primary’s remittance'
        : draft ? 'Re-assemble from the visit and show what changed' : 'A Ready claim is locked — reopen it first', 'secondary')}
      ${btn('scrub', 'fact_check', 'Run scrub', draft, draft ? 'Run the six-category scrub' : 'A Ready claim is locked — reopen it first', 'secondary')}
      ${btn('finalize', 'lock', 'Finalize', !blocker, blocker || 'Mark Ready for submission and lock the claim', 'primary')}
      ${ready ? btn('reopen', 'lock_open', 'Reopen', role.canReopenClaim,
        role.canReopenClaim ? 'Back to draft, with a reason' : 'Only the RCM coder and the CMO can reopen a finalized claim', 'secondary') : ''}
      ${nullifyBtn(row, role)}`;
  }

  // A32: Nullify sits on every status but Void. A blocked status (paid,
  // denied) still opens the dialog — it shows the routing card there.
  const nullifyBtn = (row, role) => {
    const why = role[nullifications.requestFlag()] ? '' : 'Only the RCM coder and the CMO can nullify a claim';
    return btn('nullify', 'block', 'Nullify', !why, why || 'Withdraw the claim outright — with a reason, and a fresh replacement if you ask for one', 'secondary');
  };

  const btn = (act, icon, label, enabled, title, kind) => `
    <button class="btn btn--${kind} btn--sm" data-act="${act}"${enabled ? '' : ' disabled'} title="${esc(title)}">
      <span class="icon icon--sm">${icon}</span>${label}</button>`;

  function bannersHtml(row) {
    const out = [];
    if (row.status === 'Void') {
      const rec = row.nullification?.no ? nullifications.get(row.nullification.no) : null;
      const rep = row.replacedBy ? claims.get(row.replacedBy) : null;
      out.push(alertHtml('critical', 'block', `Nullified${rec ? ` — ${rec.no}` : ''}${row.nullification?.at ? ` · ${dateTime(row.nullification.at)}` : ''}`,
        `${rec ? `${rec.reasonCode} ${nullifications.nullificationLabel(rec.reasonCode)} — ${rec.justification}` : 'This claim was withdrawn and is void.'}${
          rep ? ` Replaced by ${rep.claimNo}.` : row.nullification?.via ? ` Defined behind ${row.nullification.via}, which was nullified.` : ''}`,
        `${rec ? `<a class="btn btn--secondary btn--sm" href="#/claima/nullifications/${esc(rec.no)}"><span class="icon icon--sm">receipt_long</span>Open record</a>` : ''}${
          rep ? ` <a class="btn btn--primary btn--sm" href="#/claima/claims/${esc(rep.claimNo)}"><span class="icon icon--sm">arrow_forward</span>${esc(rep.claimNo)}</a>` : ''}`));
    }
    if (row.replaces) {
      out.push(alertHtml('info', 'history', `Replaces ${row.replaces}`,
        'Assembled fresh from the visit after that claim was nullified — the lines were returned to the pool and released again for this one.',
        `<a class="btn btn--secondary btn--sm" href="#/claima/claims/${esc(row.replaces)}"><span class="icon icon--sm">arrow_back</span>${esc(row.replaces)}</a>`));
    }
    if (claims.isStale(row)) {
      out.push(alertHtml('warning', 'sync_problem', `Stale since ${dateTime(row.stale.at)}`,
        `${row.stale.reason}. The scrub is voided until the claim is refreshed — Refresh re-assembles it from the visit and shows what moved.`,
        row.status === 'Draft' ? '<button class="btn btn--primary btn--sm" data-act="refresh"><span class="icon icon--sm">sync</span>Refresh now</button>' : ''));
    }
    if (claims.kindOf(row) === 'Secondary' && !row.activatedAt) {
      out.push(alertHtml('info', 'account_tree', `Secondary claim behind ${row.parentClaimNo}`,
        'Defined at assembly for the next cover in the patient’s chain. It carries no lines yet: what the primary’s remittance leaves unpaid becomes its lines, and the remittance feature activates it.'));
    }
    if (claims.kindOf(row) === 'Supplementary') {
      out.push(alertHtml('info', 'add_circle', `Supplementary to ${row.parentClaimNo}`,
        'Charges that landed after the primary was finalized. It is scrubbed and finalized on its own and submitted beside the primary.'));
    }
    if (row.status === 'Ready') {
      out.push(alertHtml('success', 'lock', `Ready since ${dateTime(row.finalizedAt)}`,
        'Lines, coding snapshot and attachments are locked. The submission feature takes it from here; reopen it to change anything.'));
    }
    return out.join('');
  }

  const alertHtml = (tone, icon, title, body, action = '') => `
    <div class="alert alert--${tone}">
      <span class="icon">${icon}</span>
      <div><div class="title">${esc(title)}</div>${esc(body)}</div>
      ${action ? `<span class="spacer"></span>${action}` : ''}
    </div>`;

  function summaryHtml(row, patient) {
    const enc = encounters.get(row.encounterNo);
    const chain = claims.chainOf(row);
    const link = (c) => `<a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(c.claimNo)}">${esc(c.claimNo)}</a> ${kindHtml(c)} ${statusHtml(c)}`;
    return `
      <dl class="dl dl--narrow">
        <dt>Claim no.</dt><dd class="t-mono-sm">${esc(row.claimNo)}</dd>
        <dt>Kind</dt><dd>${esc(claims.kindOf(row))}</dd>
        <dt>Patient</dt>
        <dd><a class="crumb-link" href="#/frontis/patients/${esc(row.patientMrn)}">${esc(patient?.nameEn || row.patientMrn)}</a>
          <br><span class="t-mono-sm">${esc(row.patientMrn)}</span></dd>
        <dt>Encounter</dt>
        <dd>${row.encounterNo ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(row.encounterNo)}">${esc(row.encounterNo)}</a>` : '—'}
          ${enc ? `<br><span class="t-body-sm">${esc(encounters.typeLabel(enc.type))} · ${esc(enc.department)} · ${esc(doctorName(enc.doctorId))}</span>` : ''}</dd>
        <dt>Service</dt><dd>${date(row.dateOfService)}${row.dateOfServiceTo && row.dateOfServiceTo !== row.dateOfService ? ` – ${date(row.dateOfServiceTo)}` : ''}</dd>
        <dt>Payer / plan</dt><dd>${esc(coverLabel(row))}${row.policyId ? `<br><span class="t-mono-sm">${esc(row.policyId)}</span>` : ''}</dd>
        <dt>Contract</dt><dd>${contractHtml(row)}</dd>
        <dt>Eligibility</dt>
        <dd>${row.snapshotRef ? `<a class="crumb-link t-mono-sm" href="#/frontis/eligibility/${esc(row.snapshotRef)}">${esc(row.snapshotRef)}</a>` : '—'}</dd>
        <dt>Referral</dt>
        <dd>${row.referralNo ? `<a class="crumb-link t-mono-sm" href="#/frontis/referrals/${esc(row.referralNo)}/view">${esc(row.referralNo)}</a>` : '—'}</dd>
        <dt>Value</dt>
        <dd><span class="t-mono-sm">${esc(usd(row.totals.payerShare))}</span> payer
          <br><span class="t-body-sm">${esc(usd(row.totals.gross))} gross · ${esc(usd(row.totals.allowedExpected))} allowed · ${esc(usd(row.totals.patientShare))} patient</span></dd>
        <dt>Assembled</dt><dd>${dateTime(row.createdAt)}<br>${ageHtml(row)}</dd>
        ${chain.parent ? `<dt>Parent</dt><dd>${link(chain.parent)}</dd>` : ''}
        ${chain.children.length ? `<dt>Children</dt><dd>${chain.children.map(link).join('<br>')}</dd>` : ''}
      </dl>`;
  }

  function maskedHtml(role) {
    return `
      <div class="perm-banner">
        <span class="icon">lock</span>
        <div>
          <div class="title">Withheld</div>
          A claim names the payer, the plan and what the patient owes, and ${esc(role.name)}’s role reads this record masked.
          Switch to a role with VIP access to read it.
        </div>
      </div>`;
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
    const act = e.target.closest('#cv-actions [data-act], #cv-banners [data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'refresh') return void (await askRefresh(id));
    if (act === 'scrub') { runScrub(id); state.tab = 'scrub'; return draw(); }
    if (act === 'finalize') return void (await askFinalize(id));
    if (act === 'reopen') return void (await askReopen(id));
    if (act === 'nullify') return void (await askNullify(claims.get(id)?.claimNo, { navigate: ctx.navigate }));
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}
