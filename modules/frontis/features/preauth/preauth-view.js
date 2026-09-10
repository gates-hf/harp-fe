// The request page at #/frontis/preauth/<no>, and any tab id after it. What was
// asked for, what came back, who was spoken to, and what the request became.
//
// The printable form sits below everything else and is the only thing on the
// page without data-print="hide", so Print hands the printer the form and
// nothing else — the call the referral letter and the cost estimate made.

import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as patients from '../../../../data/repositories/patients.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, fileSize, usd } from '../../../../shared/format.js';
import { doctorName } from '../../../../data/seed/reference.js';
import { priorityHtml, statusHtml, validityHtml } from './preauth-chips.js';
import { askCancel, askCommunication, askRenew, askResubmit, askSubmit } from './preauth-actions.js';
import { askDecision } from './preauth-decision.js';
import { historyHtml } from './preauth-history.js';
import { notYetHtml, requestFormHtml } from './preauth-doc.js';
import { servicesTableHtml } from './preauth-services.js';

export const meta = { title: 'Pre-authorisation' };

const TABS = [
  { id: 'request', label: 'Request' },
  { id: 'documents', label: 'Documents' },
  { id: 'history', label: 'History' },
];

export async function render(mount, ctx) {
  const no = ctx.params[0];
  if (!preauth.get(no)) throw new Error(`No pre-authorisation request ${no}`);

  const res = await fetch(new URL('./preauth-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load preauth-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { tab: TABS.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : TABS[0].id, filter: 'all' };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const row = preauth.get(no);
    if (!row) return;
    const patient = patients.view(patients.get(row.patientMrn), role);

    ctx.setHeader(`${row.no} — ${patient?.nameEn || row.patientMrn}`);
    ctx.setCrumb([
      { label: 'Frontis', path: '/frontis/patients' },
      { label: 'Pre-auths', path: '/frontis/preauth' },
      { label: row.no },
    ]);

    $('#pv-no').textContent = row.no;
    $('#pv-meta').innerHTML = metaHtml(row, patient);
    $('#pv-actions').innerHTML = actionsHtml(row, patient);
    $('#pv-banners').innerHTML = bannersHtml(row);
    $('#pv-record').href = `#/frontis/patients/${row.patientMrn}`;

    // A request names the payer, the plan, the diagnosis and the money, so it is
    // withheld on a restricted record for the reason the Insurance, Eligibility
    // and Financial tabs withhold theirs.
    if (patient?.masked) {
      $('#pv-summary').innerHTML = maskedHtml(role);
      $('#pv-tabs').innerHTML = '';
      $('#pv-panel').innerHTML = '';
      $('#pv-form').innerHTML = '';
      return;
    }

    $('#pv-summary').innerHTML = summaryHtml(row, patient);
    $('#pv-tabs').innerHTML = TABS.map((t) => {
      const count = t.id === 'documents' ? row.documents.length : 0;
      return `
        <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab"
                aria-selected="${t.id === state.tab}" data-tab="${t.id}">
          ${t.label}${count ? ` <span class="badge">${count}</span>` : ''}
        </button>`;
    }).join('');
    drawPanel(row);
    $('#pv-form').innerHTML = preauth.isDraft(row)
      ? `<div data-print="hide">${notYetHtml()}</div>`
      : requestFormHtml(row, patient);
  }

  function drawPanel(row) {
    const panel = $('#pv-panel');
    if (state.tab === 'history') return void (panel.innerHTML = historyHtml(no, state.filter));
    if (state.tab === 'documents') return void (panel.innerHTML = documentsHtml(row));
    panel.innerHTML = `
      ${servicesTableHtml(row)}
      <div class="toolbar"><span class="t-title-sm">Clinical</span></div>
      <dl class="dl dl--narrow">
        <dt>Diagnosis</dt><dd>${esc(row.diagnosis || '—')}</dd>
        <dt>Justification</dt><dd>${esc(row.justification || '—')}</dd>
        <dt>Treating doctor</dt><dd>${esc(doctorName(row.doctorId))}</dd>
        <dt>Priority</dt><dd>${priorityHtml(row)}</dd>
      </dl>
      ${decisionHtml(row)}
      ${chainHtml(row)}
      ${communicationsHtml(row)}`;
  }

  function metaHtml(row, patient) {
    return `
      <span class="t-mono-sm">${esc(row.no)}</span>
      ${statusHtml(row)}
      ${priorityHtml(row)}
      <span>·</span>
      <span>${esc(patient?.masked ? 'cover withheld' : preauth.coverLabel(row))}</span>
      <span>·</span>
      <span class="t-body-sm">raised ${date(row.createdAt)} by ${esc(row.createdBy)}</span>
      ${row.decision?.validTo
        ? `<span>·</span><span class="t-body-sm">${esc(preauth.validityLabel(row))}</span>` : ''}`;
  }

  function actionsHtml(row, patient) {
    if (patient?.masked) {
      return `<button class="btn btn--secondary btn--sm" disabled
                title="Your role reads this record masked, so it cannot act on its requests">
                <span class="icon icon--sm">lock</span>Withheld</button>`;
    }
    const draft = preauth.isDraft(row);
    const pending = preauth.isPending(row);
    const authorized = preauth.isAuthorized(row);
    return `
      ${draft
        ? `<a class="btn btn--secondary btn--sm" href="#/frontis/preauth/${esc(row.no)}">
             <span class="icon icon--sm">edit</span>Edit</a>
           <button class="btn btn--primary btn--sm" data-act="submit">
             <span class="icon icon--sm">send</span>Submit</button>`
        : ''}
      ${pending
        ? `<button class="btn btn--primary btn--sm" data-act="decide">
             <span class="icon icon--sm">fact_check</span>Capture response</button>`
        : ''}
      ${authorized || row.status === 'Expired'
        ? `<button class="btn btn--${authorized ? 'secondary' : 'primary'} btn--sm" data-act="renew">
             <span class="icon icon--sm">more_time</span>Renew</button>`
        : ''}
      ${row.status === 'Denied'
        ? `<button class="btn btn--primary btn--sm" data-act="resubmit">
             <span class="icon icon--sm">restart_alt</span>Resubmit</button>`
        : ''}
      ${draft
        ? ''
        : `<button class="btn btn--secondary btn--sm" data-act="log">
             <span class="icon icon--sm">forum</span>Log communication</button>`}
      ${draft || pending
        ? `<button class="btn btn--secondary btn--sm" data-act="cancel">
             <span class="icon icon--sm">cancel</span>Cancel</button>`
        : ''}
      ${draft
        ? `<button class="btn btn--secondary btn--sm" disabled
             title="The form exists once the request has been sent — submitting is what freezes it">
             <span class="icon icon--sm">print</span>Print request form</button>`
        : `<button class="btn btn--secondary btn--sm" data-act="print">
             <span class="icon icon--sm">print</span>Print request form</button>`}`;
  }

  function bannersHtml(row) {
    if (row.status === 'Expired') {
      return alertHtml('warning', 'schedule', `Lapsed on ${date(row.decision?.validTo)}`,
        'This authorisation has run out. It stays readable as a record of what the payer allowed; renew it to '
        + 'ask for what was never used.');
    }
    if (row.status === 'Denied') {
      return alertHtml('critical', 'block',
        `Denied — ${preauth.denialLabel(row.decision?.denialReasonCode)}`,
        row.decision?.note || 'No note was recorded with the refusal.');
    }
    if (row.status === 'Cancelled') {
      return alertHtml('critical', 'cancel', 'Withdrawn', row.cancelReason || 'No reason recorded.');
    }
    if (preauth.isOverdue(row)) {
      return alertHtml('critical', 'priority_high',
        `Urgent, and ${preauth.pendingDays(row)} days with no answer`,
        'The payer agreed to answer an urgent request inside three working days. Chase it and log the call — the '
        + 'log is what a dispute is argued from.');
    }
    if (preauth.isExpiring(row)) {
      return alertHtml('warning', 'timelapse',
        `${preauth.daysLeft(row)} day${preauth.daysLeft(row) === 1 ? '' : 's'} left on this authorisation`,
        'Renew it before it lapses. A renewal asks for what is left on it, and this request stays exactly as the '
        + 'payer left it.');
    }
    return '';
  }

  const alertHtml = (tone, icon, title, body) => `
    <div class="alert alert--${tone}">
      <span class="icon">${icon}</span>
      <div><div class="title">${esc(title)}</div>${esc(body)}</div>
    </div>`;

  function summaryHtml(row, patient) {
    return `
      <dl class="dl dl--narrow">
        <dt>Request no.</dt><dd class="t-mono-sm">${esc(row.no)}</dd>
        <dt>Patient</dt>
        <dd><a class="crumb-link" href="#/frontis/patients/${esc(row.patientMrn)}">${esc(patient?.nameEn || row.patientMrn)}</a>
          <br><span class="t-mono-sm">${esc(row.patientMrn)}</span></dd>
        <dt>Cover</dt><dd>${esc(preauth.coverLabel(row))}</dd>
        <dt>Asked for</dt><dd class="t-mono-sm">${usd(preauth.requestedTotal(row))}</dd>
        <dt>Approved</dt>
        <dd class="t-mono-sm">${row.decision && row.status !== 'Denied' ? usd(preauth.approvedTotal(row)) : '—'}</dd>
        <dt>Auth number</dt><dd class="t-mono-sm">${esc(row.decision?.authNumber || '—')}</dd>
        <dt>Valid until</dt><dd>${validityHtml(row)}</dd>
        <dt>Submitted</dt>
        <dd>${row.submittedAt
          ? `<span class="t-mono-sm">${dateTime(row.submittedAt)}</span><br><span class="t-body-sm">${esc(row.submittedBy)}</span>`
          : '<span class="t-body-sm">not sent yet</span>'}</dd>
        <dt>Encounter</dt>
        <dd>${row.encounterNo
          ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(row.encounterNo)}">${esc(row.encounterNo)}</a>`
          : '<span class="t-body-sm">not linked</span>'}</dd>
        <dt>Estimate</dt>
        <dd>${row.estimateNo
          ? `<a class="crumb-link t-mono-sm" href="#/frontis/estimates/${esc(row.estimateNo)}">${esc(row.estimateNo)}</a>`
          : '<span class="t-body-sm">none</span>'}</dd>
        <dt>Eligibility check</dt>
        <dd>${row.snapshotRef
          ? `<a class="crumb-link t-mono-sm" href="#/frontis/eligibility/${esc(row.snapshotRef)}">${esc(row.snapshotRef)}</a>`
          : '<span class="t-body-sm">none</span>'}</dd>
        <dt>Raised by</dt>
        <dd>${esc(row.createdBy)}<br><span class="t-mono-sm">${dateTime(row.createdAt)}</span></dd>
      </dl>`;
  }

  /** What the payer said, exactly as it was recorded. Never recomputed. */
  function decisionHtml(row) {
    const d = row.decision;
    if (!d) {
      return `
        <div class="toolbar"><span class="t-title-sm">Decision</span></div>
        <p class="t-body-sm">${preauth.isDraft(row)
          ? 'Nothing has been sent, so there is nothing to answer yet.'
          : 'The payer has not answered. Capture the response the moment it arrives — a decision taken by phone '
            + 'and never recorded is a decision nobody can bill against.'}</p>`;
    }
    const response = row.documents.find((doc) => doc.kind === 'Payer response');
    return `
      <div class="toolbar">
        <span class="t-title-sm">Decision</span>
        <span class="spacer"></span>
        ${statusHtml(row)}
      </div>
      <dl class="dl dl--narrow">
        <dt>Result</dt><dd>${esc(d.result)}</dd>
        <dt>Authorisation no.</dt><dd class="t-mono-sm">${esc(d.authNumber || '—')}</dd>
        <dt>Valid</dt>
        <dd class="t-mono-sm">${d.validFrom ? `${date(d.validFrom)} – ${date(d.validTo)}` : '—'}</dd>
        ${d.denialReasonCode
          ? `<dt>Reason</dt><dd>${esc(preauth.denialLabel(d.denialReasonCode))}</dd>` : ''}
        ${d.note ? `<dt>Note</dt><dd>${esc(d.note)}</dd>` : ''}
        <dt>Captured by</dt>
        <dd>${esc(d.capturedBy)}<br><span class="t-mono-sm">${dateTime(d.capturedAt)}</span></dd>
        <dt>Payer response</dt>
        <dd>${response
          ? `<span class="icon icon--sm">description</span> ${esc(response.fileName)}
             <span class="t-body-sm">${fileSize(response.size)}</span>`
          : '<span class="t-body-sm">nothing attached</span>'}</dd>
      </dl>`;
  }

  /** The renewals and resubmissions this request sits between. */
  function chainHtml(row) {
    const chain = preauth.chainOf(row.no);
    if (chain.length < 2) return '';
    const index = chain.findIndex((r) => r.no === row.no) + 1;
    return `
      <div class="toolbar">
        <span class="t-title-sm">Chain</span>
        <span class="spacer"></span>
        <span class="t-body-sm">request ${index} of ${chain.length}</span>
      </div>
      ${chain.map((r) => `
        <div class="rule-child-row">
          <span class="icon">${r.no === row.no ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
          <div>
            <div>${r.no === row.no
              ? `<span class="t-mono-sm">${esc(r.no)}</span> <span class="t-body-sm">this one</span>`
              : `<a class="crumb-link t-mono-sm" href="#/frontis/preauth/${esc(r.no)}">${esc(r.no)}</a>`}
              ${statusHtml(r)}</div>
            <span class="t-body-sm">${esc(preauth.servicesLabel(r))} · raised ${date(r.createdAt)}${
              r.decision?.authNumber ? ` · ${esc(r.decision.authNumber)}` : ''}</span>
          </div>
        </div>`).join('')}`;
  }

  /** Every call, portal note and fax about this request, oldest first. */
  function communicationsHtml(row) {
    return `
      <div class="toolbar">
        <span class="t-title-sm">Communication log</span>
        <span class="spacer"></span>
        <button class="btn btn--secondary btn--sm" data-act="log">
          <span class="icon icon--sm">add_comment</span>Log communication
        </button>
      </div>
      ${row.communications.length
        ? `<ol class="journey">${row.communications.map((entry) => `
            <li class="journey__row">
              <span class="journey__at t-mono-sm">${dateTime(entry.at)}</span>
              <span class="journey__action">${esc(entry.channel)} ${entry.direction === 'Out' ? 'out' : 'in'}</span>
              <span class="journey__actor">${esc(entry.by)}</span>
              <span class="journey__detail">${esc(entry.note)}</span>
            </li>`).join('')}</ol>`
        : '<p class="t-body-sm">Nothing logged. Every call about this request belongs here — it is what a payer dispute is argued from.</p>'}`;
  }

  function documentsHtml(row) {
    return `
      <p class="t-body-sm">What was sent with the request, and what came back. Supporting documents are attached
        on the draft; the payer's own response is filed with the decision.</p>
      ${row.documents.length
        ? row.documents.map((doc) => `
          <div class="rule-child-row">
            <span class="icon">description</span>
            <div>
              <div>${esc(doc.fileName)}
                <span class="badge${doc.kind === 'Payer response' ? ' badge--accent' : ''}">${esc(doc.kind)}</span></div>
              <span class="t-body-sm">${fileSize(doc.size)} · ${esc(doc.uploadedBy)} · ${dateTime(doc.uploadedAt)}</span>
            </div>
          </div>`).join('')
        : `<div class="state-view">
             <div class="state-view__glyph"><span class="icon">folder_off</span></div>
             <div class="state-view__title">Nothing attached</div>
             <p class="state-view__body">Most refusals turn out to have been missing a report. A draft takes
               supporting documents on the form itself.</p>
           </div>`}`;
  }

  function maskedHtml(role) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">lock</span></div>
        <div class="state-view__title">Request withheld</div>
        <p class="state-view__body">A restricted record's pre-authorisations name its payer, its plan, its
          diagnosis and its money, so they are readable by roles with VIP access only. You are signed in as
          ${esc(role.title)}. The history still shows that a request was raised, and by whom.</p>
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
    if (chip) {
      state.filter = chip.dataset.filter;
      $('#pv-panel').innerHTML = historyHtml(no, state.filter);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'print') return void window.print();
    if (act === 'submit') return void (await askSubmit(no, ctx));
    if (act === 'decide') return void (await askDecision(no));
    if (act === 'renew') return void (await askRenew(no, ctx));
    if (act === 'resubmit') return void (await askResubmit(no, ctx));
    if (act === 'log') return void (await askCommunication(no));
    if (act === 'cancel') return void (await askCancel(no));
  });

  // The page is live on both axes: an answer captured on the worklist and the
  // expiry sweep land without a reload, and switching demo role re-reads the
  // masking.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  draw();

  // Submitting opens the page on the form it just froze.
  if (ctx.query?.print === '1') {
    setTimeout(() => mount.querySelector('#pv-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }
}
