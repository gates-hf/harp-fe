// The decision page at #/claima/writeoffs/<id>, and a tab id after it: the
// request as it was raised, the approval ladder, and beside them the context
// the signer decides on, the chain from request to posting to reversal with
// every linked record, and the trail. The actions are the ones the request's
// state and the reader's role allow — the rest are disabled with the reason.

import * as writeoffs from '../../../../data/repositories/writeoffs.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as tiers from '../../../../data/engines/writeoff-tiers.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, fileSize, usd } from '../../../../shared/format.js';
import {
  amountHtml, classificationHtml, linkHtml, patientHtml, sideHtml, sourceHtml, statusHtml, tierHtml,
} from './writeoff-chips.js';
import { contextHtml } from './writeoff-context.js';
import { askDecide, askPost, askReverse } from './writeoff-actions.js';

export const meta = { title: 'Write-off' };

const TABS = [
  { id: 'context', label: 'Context' },
  { id: 'chain', label: 'Chain' },
  { id: 'history', label: 'History' },
];

export async function render(mount, ctx) {
  const id = ctx.params[0];
  await writeoffs.peersReady;
  if (!writeoffs.get(id)) throw new Error(`No write-off ${id}`);

  const res = await fetch(new URL('./writeoff-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load writeoff-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { tab: TABS.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : TABS[0].id };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const row = writeoffs.get(id);
    if (!row) return;
    const patient = patients.view(patients.get(row.source.mrn), role);
    const masked = Boolean(patient?.masked);

    ctx.setHeader(`${row.id} — ${usd(row.amountRequested)} ${writeoffs.reasonLabel(row.reasonCode)}`);
    ctx.setCrumb([
      { label: 'Claima', path: '/claima/writeoffs' },
      { label: 'Write-offs', path: '/claima/writeoffs' },
      { label: row.id },
    ]);

    $('#wv-no').textContent = row.id;
    $('#wv-meta').innerHTML = metaHtml(row, masked);
    $('#wv-actions').innerHTML = actionsHtml(row, role, masked);
    $('#wv-banners').innerHTML = bannersHtml(row);

    if (masked) {
      $('#wv-summary').innerHTML = maskedHtml(role);
      $('#wv-ladder').innerHTML = '';
      $('#wv-ladder-sub').textContent = '';
      $('#wv-tabs').innerHTML = '';
      $('#wv-panel').innerHTML = '';
      return;
    }

    $('#wv-summary').innerHTML = summaryHtml(row, role);
    $('#wv-ladder').innerHTML = ladderHtml(row);
    $('#wv-ladder-sub').textContent = `${row.tier.mode} · ${tiers.tierLabel(row.tier.required)}`;
    $('#wv-tabs').innerHTML = TABS.map((t) => `
      <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab"
              aria-selected="${t.id === state.tab}" data-tab="${t.id}">${t.label}</button>`).join('');
    const panel = $('#wv-panel');
    const host = document.createElement('div');
    panel.replaceChildren(host);
    if (state.tab === 'chain') host.innerHTML = chainHtml(row);
    else if (state.tab === 'history') host.innerHTML = historyHtml(row);
    else host.innerHTML = contextHtml(row.source, row.side, { excludeId: row.id, amount: row.amountRequested });
  }

  function metaHtml(row, masked) {
    return `
      ${statusHtml(row)}
      ${sideHtml(row.side)}
      ${classificationHtml(row.classification)}
      ${tierHtml(row)}
      <span>·</span>
      <span class="t-body-sm">${masked ? 'amount withheld' : amountHtml(row)} · ${esc(row.reasonCode)} ${esc(writeoffs.reasonLabel(row.reasonCode))}</span>
      <span>·</span>
      <span class="t-body-sm">raised by ${esc(row.requestedBy)} ${date(row.at)}</span>`;
  }

  function actionsHtml(row, role, masked) {
    if (masked) {
      return `<button class="btn btn--secondary btn--sm" disabled title="Your role reads this record masked, so it cannot act on its write-offs">
        <span class="icon icon--sm">lock</span>Withheld</button>`;
    }
    const out = [];
    if (row.status === 'Pending Approval') {
      const gate = writeoffs.canDecide(row, role);
      out.push(btn('approve', 'task_alt', 'Approve', gate.ok, gate.ok ? `Sign ${tiers.tierLabel(writeoffs.currentStep(row).tier)}` : gate.why, 'primary'));
      out.push(btn('reject', 'block', 'Reject', gate.ok, gate.ok ? 'Refuse with a note' : gate.why, 'secondary'));
    }
    if (row.status === 'Approved') {
      const may = tiers.highestTier(role) > 0;
      out.push(btn('post', 'publish', 'Post', may, may ? 'Re-check what is outstanding and post it' : 'Posting needs a role that signs write-offs', 'primary'));
    }
    if (row.status === 'Posted') {
      const gate = writeoffs.canReverse(row, role);
      out.push(btn('reverse', 'undo', 'Reverse', gate.ok, gate.ok ? 'Undo the posting with a linked reversal' : gate.why, 'secondary'));
    }
    if (row.status === 'Rejected') {
      out.push(row.rerequestId
        ? `<a class="btn btn--secondary btn--sm" href="#/claima/writeoffs/${esc(row.rerequestId)}"><span class="icon icon--sm">replay</span>Re-requested as ${esc(row.rerequestId)}</a>`
        : `<a class="btn btn--primary btn--sm" href="#/claima/writeoffs/new?rerequest=${esc(row.id)}" title="Raise it again with the case made since, linked to this refusal"><span class="icon icon--sm">replay</span>Re-request</a>`);
    }
    if (row.status === 'Reversed') out.push('<span class="badge">Reversed — nothing further</span>');
    return out.join('');
  }

  const btn = (act, icon, label, enabled, title, kind) => `
    <button class="btn btn--${kind} btn--sm" data-act="${act}"${enabled ? '' : ' disabled'} title="${esc(title)}">
      <span class="icon icon--sm">${icon}</span>${label}</button>`;

  function bannersHtml(row) {
    const out = [];
    if (row.status === 'Rejected' && row.decision) {
      out.push(alertHtml('critical', 'block', `Rejected by ${row.decision.by} · ${dateTime(row.decision.at)}`, row.decision.note || ''));
    }
    if (row.status === 'Approved') {
      out.push(alertHtml('info', 'task_alt', `Approved ${dateTime(row.decision?.at)} — not yet posted`,
        'Post re-checks what is outstanding now and never writes off more than that.'));
    }
    if (row.posting?.cappedNote) out.push(alertHtml('warning', 'content_cut', 'Posted below the amount requested', row.posting.cappedNote));
    if (row.status === 'Reversed' && row.reversal) {
      out.push(alertHtml('warning', 'undo', `Reversed by ${row.reversal.by} · ${dateTime(row.reversal.at)}`, row.reversal.reason));
    }
    if (row.rerequestOf) out.push(alertHtml('info', 'replay', `Re-request of ${row.rerequestOf}`, 'The earlier refusal and its note stay on that request; this one carries the case made since.'));
    return out.join('');
  }

  const alertHtml = (tone, icon, title, body) => `
    <div class="alert alert--${tone}">
      <span class="icon">${icon}</span>
      <div><div class="title">${esc(title)}</div>${esc(body)}</div>
    </div>`;

  function summaryHtml(row, role) {
    return `
      <dl class="dl dl--narrow">
        <dt>Request</dt><dd class="t-mono-sm">${esc(row.id)}</dd>
        <dt>Source</dt><dd>${sourceHtml(row)}</dd>
        <dt>Patient</dt><dd>${patientHtml(row, role)}</dd>
        ${row.source.encounterNo ? `<dt>Encounter</dt><dd><a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(row.source.encounterNo)}">${esc(row.source.encounterNo)}</a></dd>` : ''}
        <dt>Side</dt><dd>${sideHtml(row.side)} <span class="t-body-sm">${esc(writeoffs.payerName(row))}</span></dd>
        <dt>Requested</dt><dd><span class="t-mono-sm">${esc(usd(row.amountRequested))}</span></dd>
        ${row.amountPosted !== null ? `<dt>Posted</dt><dd><span class="t-mono-sm">${esc(usd(row.amountPosted))}</span>${row.posting?.cappedNote ? ' <span class="badge badge--warning">capped</span>' : ''}</dd>` : ''}
        <dt>Reason</dt><dd>${esc(row.reasonCode)} ${esc(writeoffs.reasonLabel(row.reasonCode))}<br>${classificationHtml(row.classification)}</dd>
        <dt>Justification</dt><dd>${esc(row.justification)}</dd>
        <dt>Evidence</dt><dd>${row.hardshipEvidence ? `<span class="icon icon--sm">attach_file</span> ${esc(row.hardshipEvidence.fileName)} <span class="t-body-sm">· ${esc(fileSize(row.hardshipEvidence.size || 0))}</span>` : '<span class="t-body-sm">None</span>'}</dd>
        <dt>Raised</dt><dd>${esc(row.requestedBy)}<br><span class="t-body-sm">${dateTime(row.at)}</span></dd>
        ${row.rerequestOf ? `<dt>Re-request of</dt><dd>${linkHtml(row.rerequestOf, 'The refused request this one answers')}</dd>` : ''}
        ${row.rerequestId ? `<dt>Re-requested as</dt><dd>${linkHtml(row.rerequestId, 'Raised again after this refusal')}</dd>` : ''}
      </dl>`;
  }

  /** The tier ladder: a step per signature the amount needs, in the design system's stepper. */
  function ladderHtml(row) {
    const steps = row.tier.steps;
    const waiting = writeoffs.currentStep(row);
    return `
      <div class="stepper" aria-label="Approval ladder">${steps.map((s, i) => {
        const done = s.decision === 'Approved';
        const blocked = s.decision === 'Rejected';
        const current = row.status === 'Pending Approval' && waiting === s;
        const cls = blocked ? ' stepper__step--blocked' : done ? ' stepper__step--done' : current ? ' stepper__step--current' : '';
        const title = s.decision ? `${s.decision} by ${s.approver} · ${dateTime(s.at)}${s.note ? ` — ${s.note}` : ''}`
          : current ? `Waiting for a signature at ${tiers.tierLabel(s.tier)}` : `${tiers.tierLabel(s.tier)} — not yet`;
        return `<span class="stepper__step${cls}" title="${esc(title)}" aria-disabled="${!done && !current && !blocked}">
          <span class="stepper__n">${done ? '<span class="icon icon--sm">check</span>' : blocked ? '!' : i + 1}</span>
          <span class="stepper__label">${esc(tiers.tierLabel(s.tier).split(' · ')[0])}${s.approver ? ` · ${esc(s.approver)}` : ''}</span>
        </span>`;
      }).join('<span class="stepper__line"></span>')}</div>
      ${steps.some((s) => s.decision) ? `
        <table class="tbl">
          <thead><tr><th scope="col">Step</th><th scope="col">Signed by</th><th scope="col">Decision</th><th scope="col">Note</th></tr></thead>
          <tbody>${steps.filter((s) => s.decision).map((s) => `
            <tr>
              <td>${esc(tiers.tierLabel(s.tier))}</td>
              <td>${esc(s.approver)}<br><span class="t-body-sm">${dateTime(s.at)}</span></td>
              <td><span class="badge badge--${s.decision === 'Approved' ? 'success' : 'critical'}"><span class="dot"></span>${esc(s.decision)}</span></td>
              <td>${esc(s.note || '—')}</td>
            </tr>`).join('')}</tbody>
        </table>` : `<p class="t-body-sm">${row.status === 'Pending Approval'
          ? `Waiting for ${esc(tiers.tierLabel(waiting.tier))}. The requester, ${esc(row.requestedBy)}, cannot sign it.`
          : 'No signature recorded.'}</p>`}`;
  }

  /** Request → decision → posting → reversal, each naming the record it wrote. */
  function chainHtml(row) {
    const links = [];
    links.push(step('Requested', row.at, row.requestedBy, `${usd(row.amountRequested)} against ${writeoffs.SOURCE_LABELS[row.source.kind]} ${row.source.ref}`, sourceHtml(row)));
    for (const s of row.tier.steps.filter((x) => x.decision)) {
      links.push(step(s.decision === 'Approved' ? 'Signed' : 'Refused', s.at, s.approver, `${tiers.tierLabel(s.tier)}${s.note ? ` — ${s.note}` : ''}`));
    }
    if (row.posting) {
      const targets = row.posting.txIds.map((tx) => (row.side === 'Payer'
        ? `<a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(row.source.claimNo)}">${esc(tx)}</a>`
        : `<a class="crumb-link t-mono-sm" href="#/frontis/accounts/${esc(row.source.mrn)}">${esc(tx)}</a>`)).join(', ');
      const denial = writeoffs.denialOf(row);
      links.push(step('Posted', row.posting.at, row.posting.by, `${usd(row.amountPosted)}${row.posting.cappedNote ? ` — ${row.posting.cappedNote}` : ''}`,
        `${targets}${denial ? ` · <a class="crumb-link t-mono-sm" href="#/claima/denials/${esc(denial.id)}">${esc(denial.id)} ${esc(denial.status || '')}</a>` : ''}`));
    }
    if (row.reversal) {
      const targets = row.reversal.txIds.map((tx) => (row.side === 'Payer'
        ? `<a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(row.source.claimNo)}">${esc(tx)}</a>`
        : `<a class="crumb-link t-mono-sm" href="#/frontis/accounts/${esc(row.source.mrn)}">${esc(tx)}</a>`)).join(', ');
      links.push(step('Reversed', row.reversal.at, row.reversal.by, `${row.reversal.reason} · signed at tier ${row.reversal.tier}`, targets));
    }
    if (row.rerequestId) links.push(step('Re-requested', writeoffs.get(row.rerequestId)?.at, writeoffs.get(row.rerequestId)?.requestedBy, 'Raised again after the refusal', linkHtml(row.rerequestId, 'Open the re-request')));
    return `
      <div class="toolbar">
        <span class="t-title-sm">Chain</span>
        <span class="spacer"></span>
        <span class="t-body-sm">request → decision → posting${row.reversal ? ' → reversal' : ''}, immutable</span>
      </div>
      <ol class="journey">${links.join('')}</ol>`;
  }

  const step = (action, at, actor, detail, links = '') => `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${at ? dateTime(at) : '—'}</span>
      <span class="journey__action">${esc(action)}</span>
      <span class="journey__actor">${esc(actor || '')}</span>
      <span class="journey__detail">${esc(detail)}${links ? ` · ${links}` : ''}</span>
    </li>`;

  function historyHtml(row) {
    const trail = writeoffs.history(row.id);
    return `
      <div class="toolbar">
        <span class="t-title-sm">History</span>
        <span class="badge">${trail.length}</span>
      </div>
      ${trail.length ? `<ol class="journey">${trail.map((e) => `
        <li class="journey__row">
          <span class="journey__at t-mono-sm">${dateTime(e.at)}</span>
          <span class="journey__action">${esc(e.action)}</span>
          <span class="journey__actor">${esc(e.user)}</span>
          <span class="journey__detail">${esc(e.details)}</span>
        </li>`).join('')}</ol>` : '<p class="t-body-sm">Nothing recorded yet.</p>'}`;
  }

  function maskedHtml(role) {
    return `
      <div class="perm-banner">
        <span class="icon">lock</span>
        <div>
          <div class="title">Withheld</div>
          A write-off names the payer, the balance and what the patient owes, and ${esc(role.name)}’s role reads this record masked.
          Switch to a role with VIP access to read it.
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; return draw(); }
    const act = e.target.closest('#wv-actions [data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'approve') return void (await askDecide(id, true));
    if (act === 'reject') return void (await askDecide(id, false));
    if (act === 'post') return void (await askPost(id));
    if (act === 'reverse') return void (await askReverse(id));
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}
