// The Defensio appeal case page at #/defensio/appeals/<id>: the banner and
// its actions, the Draft → In review → Approved → Submitted stepper, the
// case summary and the review rounds in the bounded pane, and the
// preparation tabs beside them — Case (what the registers say), Grounds &
// citations, Evidence bundle, Letter, History, then whatever another
// Defensio feature registered for this screen in modules/defensio/tabs.js
// (amendment 39's Tracking & outcome). Each tab draws into a node of its own
// and the page redraws whole on every commit.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import * as patients from '../../../../data/repositories/patients.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { coverLabel, deadlineHtml, lateHtml, levelHtml, payerName, statusHtml, tierHtml } from './appeal-chips.js';
import { actionsHtml, handleAction } from './appeal-actions.js';
import { historyHtml } from './appeal-history.js';

export const meta = { title: 'Appeal case' };

const OWN_TABS = [
  { id: 'case', label: 'Case', load: () => import('./tab-case.js') },
  { id: 'grounds', label: 'Grounds & citations', load: () => import('./tab-grounds.js') },
  { id: 'bundle', label: 'Evidence bundle', load: () => import('./tab-bundle.js') },
  { id: 'letter', label: 'Letter', load: () => import('./tab-letter.js') },
  { id: 'history', label: 'History', load: () => Promise.resolve({ render: (host, { caseId }) => { host.innerHTML = historyHtml(caseId); } }) },
];

/** The tabs another feature registered for this screen — feature-detected, so the page renders before the registry lands. */
async function registeredTabs() {
  try {
    const m = await import('../../tabs.js');
    return (m.tabsFor?.('appeal-case') || []).filter((t) => t?.id && !OWN_TABS.some((o) => o.id === t.id));
  } catch {
    return [];
  }
}

const STEPS = [
  { id: 'Draft', label: 'Draft' }, { id: 'InReview', label: 'In review' }, { id: 'ApprovedToSubmit', label: 'Approved' }, { id: 'Submitted', label: 'Submitted' },
];

export async function render(mount, ctx) {
  const id = ctx.params[0];
  const first = appealCases.get(id);
  if (!first) throw new Error(`No appeal case ${id}`);

  const res = await fetch(new URL('./appeal-case.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load appeal-case.html (${res.status})`);
  mount.innerHTML = await res.text();

  const extra = await registeredTabs();
  const tabs = [...OWN_TABS, ...extra.sort((a, b) => (a.order || 0) - (b.order || 0))];
  const state = { tab: tabs.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : 'case' };
  const $ = (sel) => mount.querySelector(sel);
  let drawing = 0;

  async function draw() {
    const role = currentRole();
    const row = appealCases.get(id);
    if (!row) return;
    const claim = appealCases.claimOf(row);
    const denial = appealCases.denialOf(row);
    const patient = claim ? patients.view(patients.get(claim.patientMrn), role) : null;

    ctx.setHeader(`${row.id} — ${row.claimNo || ''}`);
    ctx.setCrumb([
      { label: 'Defensio', path: '/defensio/appeals' },
      { label: 'Appeals', path: '/defensio/appeals' },
      { label: row.id },
    ]);
    $('#ac-id').textContent = row.id;
    $('#ac-denial').href = `#/defensio/denials/${row.denialId || ''}`;
    $('#ac-status').innerHTML = statusHtml(row);
    $('#ac-tier').innerHTML = tierHtml(row);

    // An appeal names the payer, the claim and the money: withheld outright on a restricted record.
    if (patient?.masked) {
      $('#ac-meta').innerHTML = `<span class="t-mono-sm">${esc(row.id)}</span> ${statusHtml(row)}`;
      $('#ac-actions').innerHTML = '<button class="btn btn--secondary btn--sm" disabled title="Your role reads this record masked, so it cannot work its appeal"><span class="icon icon--sm">lock</span>Withheld</button>';
      $('#ac-banners').innerHTML = '';
      $('#ac-stepper').innerHTML = '';
      $('#ac-summary').innerHTML = maskedHtml(role);
      $('#ac-review').innerHTML = '';
      $('#ac-tabs').innerHTML = '';
      $('#ac-panel').innerHTML = '';
      return;
    }

    $('#ac-meta').innerHTML = metaHtml(row, claim, denial, patient);
    $('#ac-actions').innerHTML = actionsHtml(row, role);
    $('#ac-banners').innerHTML = bannersHtml(row);
    $('#ac-stepper').innerHTML = stepperHtml(row);
    $('#ac-summary').innerHTML = summaryHtml(row, claim, denial);
    $('#ac-review').innerHTML = reviewHtml(row);
    $('#ac-tabs').innerHTML = tabs.map((t) => `
      <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab" aria-selected="${t.id === state.tab}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join('');
    const panel = $('#ac-panel');
    const host = document.createElement('div');
    panel.replaceChildren(host);
    const tab = tabs.find((t) => t.id === state.tab) || tabs[0];
    const n = ++drawing;
    const m = await tab.load();
    if (n !== drawing || !host.isConnected) return;
    m.render(host, { caseId: id, redraw: draw, ctx });
  }

  function metaHtml(row, claim, denial, patient) {
    return `
      <span class="t-mono-sm">${esc(row.id)}</span>
      ${levelHtml(row)}
      ${statusHtml(row)}${lateHtml(row)}
      ${tierHtml(row)}
      <span>·</span>
      ${(row.denialIds || []).map((d) => `<a class="crumb-link t-mono-sm" href="#/defensio/denials/${esc(d)}">${esc(d)}</a>`).join(' ')}
      <span>·</span>
      <a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(row.claimNo)}">${esc(row.claimNo || '—')}</a>
      <span>·</span>
      <span>${claim ? `<a class="crumb-link" href="#/frontis/patients/${esc(claim.patientMrn)}">${esc(patient?.nameEn || claim.patientMrn)}</a> · ${esc(coverLabel(claim))}` : esc(payerName(row))}</span>
      <span>·</span>
      <span class="t-body-sm">${esc(usd(row.disputedAmount))} disputed · ${denial ? `${esc(denial.payerReason?.code || denial.code || '')} ${esc(denial.payerReason?.text || '')} · ` : ''}file by ${deadlineHtml(row)}</span>
      ${row.parentCaseId ? `<span>·</span><a class="crumb-link t-mono-sm" href="#/defensio/appeals/${esc(row.parentCaseId)}" title="The level-1 case this one follows">after ${esc(row.parentCaseId)}</a>` : ''}
      ${row.childCaseId ? `<span>·</span><a class="crumb-link t-mono-sm" href="#/defensio/appeals/${esc(row.childCaseId)}" title="The level-2 case raised after this one">escalated as ${esc(row.childCaseId)}</a>` : ''}`;
  }

  function bannersHtml(row) {
    const out = [];
    const dl = appealCases.deadlineOf(row);
    if (row.status === 'Withdrawn') {
      out.push(alert('info', 'undo', `Withdrawn ${date(row.withdrawal?.at)}`, `${row.withdrawal?.reason || ''} The denial went back to the worklist for re-triage.`));
    } else if (dl.passed) {
      out.push(alert('critical', 'timer_off', `Filing deadline passed ${date(dl.at)}`, `The payer's window closed ${Math.abs(dl.daysLeft)} day${Math.abs(dl.daysLeft) === 1 ? '' : 's'} ago. Only the CMO can file late, with the reason recorded on the submission.`));
    } else if (dl.warn) {
      out.push(alert('warning', 'timer', dl.daysLeft === 0 ? 'Filing due today' : `${dl.daysLeft} day${dl.daysLeft === 1 ? '' : 's'} to file`, `The payer's appeal window closes ${date(dl.at)}. Review and submission both have to happen before then.`));
    }
    if (row.status === 'Returned') {
      const last = (row.review?.rounds || []).filter((r) => r.action === 'return').pop();
      out.push(alert('warning', 'assignment_return', `Returned by ${last?.reviewerId || 'the reviewer'} ${date(last?.at)}`, last?.note || 'Make the changes asked for and send it for review again.'));
    }
    if (row.status === 'InReview') {
      const check = appealCases.canReview(row, currentRole());
      out.push(alert('info', 'rate_review', `Waiting on a ${appealCases.requiredTierOf(row)} reviewer`, check.ok ? 'You can sign this case: approve it, or return it with a note.' : check.why));
    }
    if (row.status === 'ApprovedToSubmit') {
      out.push(alert('info', 'send', 'Approved — ready to file', `The letter is locked. Generate the package, print it, and record how it went to the payer${dl.at ? ` before ${date(dl.at)}` : ''}.`));
    }
    return out.join('');
  }

  const alert = (tone, icon, title, body) => `
    <div class="alert alert--${tone}"><span class="icon">${icon}</span><div><div class="title">${esc(title)}</div>${esc(body)}</div></div>`;

  function stepperHtml(row) {
    const reached = row.status === 'Returned' ? 0 : row.status === 'Withdrawn' ? -1 : Math.max(0, STEPS.findIndex((s) => s.id === row.status));
    const beyond = !appealCases.beforeSubmission(row) && row.status !== 'Withdrawn';
    return STEPS.map((s, i) => {
      const cls = beyond || i < reached ? 'stepper__step--done' : i === reached ? 'stepper__step--current' : row.status === 'Withdrawn' ? 'stepper__step--blocked' : '';
      const n = beyond || i < reached ? '✓' : row.status === 'Withdrawn' ? '!' : i + 1;
      return `<span class="stepper__step ${cls}" aria-current="${i === reached ? 'step' : 'false'}"><span class="stepper__n">${n}</span><span class="stepper__label">${s.label}</span></span>${
        i < STEPS.length - 1 ? '<span class="stepper__line"></span>' : ''}`;
    }).join('') + (beyond && row.status !== 'Submitted' ? `<span class="stepper__line"></span><span class="stepper__step stepper__step--current"><span class="stepper__n">→</span><span class="stepper__label">${esc(appealCases.statusLabel(row.status))}</span></span>` : '');
  }

  function summaryHtml(row, claim, denial) {
    const pkg = appealCases.latestPackage(row);
    return `
      <dl class="dl dl--narrow">
        <dt>Disputed</dt><dd><span class="t-mono-sm">${esc(usd(row.disputedAmount))}</span>${denial ? `<br><span class="t-body-sm">${esc(usd(denial.amounts.open))} still open on ${esc(denial.id)}</span>` : ''}</dd>
        <dt>Payer</dt><dd>${esc(payerName(row))}</dd>
        <dt>File by</dt><dd>${deadlineHtml(row)}<br><span class="t-body-sm">${esc(date(row.filingDeadline))} — the denial's appeal window</span></dd>
        <dt>Ground</dt><dd>${row.grounds?.primary ? esc(appealCases.groundLabel(row.grounds.primary)) : '<span class="t-body-sm">Not chosen</span>'}${
      row.grounds?.secondary?.length ? `<br><span class="t-body-sm">+ ${row.grounds.secondary.map(appealCases.groundLabel).map(esc).join(', ')}</span>` : ''}</dd>
        <dt>Citations</dt><dd>${row.citations.length} <span class="t-body-sm">· ${appealCases.includedBundle(row).length} enclosure${appealCases.includedBundle(row).length === 1 ? '' : 's'} · letter v${row.letter.versions.length || '—'}${row.letter.finalLockedAt ? ' locked' : ''}</span></dd>
        <dt>Preparer</dt><dd>${esc(row.createdBy)}<br><span class="t-body-sm">opened ${dateTime(row.createdAt)}</span></dd>
        ${row.submission ? `<dt>Filed</dt><dd>${esc(row.method)} · <span class="t-mono-sm">${esc(row.reference)}</span><br><span class="t-body-sm">${esc(date(row.submittedAt))}${row.submission.lateOverride ? ` · late — ${esc(row.submission.lateOverride.reason)}` : ''}</span></dd>` : ''}
        ${pkg ? `<dt>Package</dt><dd><a class="crumb-link t-mono-sm" href="#/defensio/appeals/${esc(row.id)}/package">${esc(pkg.ref)}</a><br><span class="t-body-sm">${dateTime(pkg.generatedAt)} · ${esc(pkg.by)}</span></dd>` : ''}
      </dl>`;
  }

  function reviewHtml(row) {
    const rounds = row.review?.rounds || [];
    return `
      <p class="t-body-sm">${appealCases.requiredTierOf(row) === 'senior'
        ? `Disputed ${esc(usd(row.disputedAmount))} is at or above ${esc(usd(appealCases.seniorAbove()))}: the CMO signs.`
        : `Below ${esc(usd(appealCases.seniorAbove()))}: the RCM coder or the CMO signs.`} The preparer never reviews their own case.</p>
      ${rounds.length ? `<ol class="journey">${rounds.map((r) => `
        <li class="journey__row">
          <span class="journey__at t-mono-sm">${dateTime(r.at)}</span>
          <span class="journey__action"><span class="badge badge--${r.action === 'approve' ? 'success' : 'warning'}">${r.action === 'approve' ? 'Approved' : 'Returned'}</span></span>
          <span class="journey__actor">${esc(r.reviewerId)}</span>
          <span class="journey__detail">Round ${r.n} · ${esc(r.tier)} tier${r.note ? ` — ${esc(r.note)}` : ''}</span>
        </li>`).join('')}</ol>` : '<p class="t-body-sm">No review round yet.</p>'}`;
  }

  function maskedHtml(role) {
    return `
      <div class="perm-banner">
        <span class="icon">lock</span>
        <div>
          <div class="title">Withheld</div>
          An appeal names the payer, the claim and the money, and ${esc(role.name)}’s role reads this record masked. Switch to a role with VIP access to read it.
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; return draw(); }
    const act = e.target.closest('#ac-actions [data-act]')?.dataset.act;
    if (!act) return undefined;
    const r = await handleAction(act, id, ctx);
    if (r?.error) toast(r.error, 'critical');
    return undefined;
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  appealCases.peersReady.then(() => { if (mount.isConnected) draw(); });
  draw();
}
