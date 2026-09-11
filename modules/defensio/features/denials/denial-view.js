// The Defensio denial page at #/defensio/denials/<id>: the banner and the
// amounts strip (six figures now — reclassified beside recovered, written
// off and lost), the one-pass triage and the resolution panels in the
// bounded pane, and the evidence — denied lines, the contract version, the
// linked records and the timeline excerpt — with the history beside it. The
// two panels own their nodes and listeners; the page redraws them whole on
// every commit.

import * as denials from '../../../../data/repositories/denials.js';
import * as patients from '../../../../data/repositories/patients.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { toast } from '../../../../shared/toast.js';
import {
  ageHtml, classHtml, coverLabel, deadlineHtml, payerName, repeatHtml, scopeHtml, separationHtml, statusHtml, tierHtml,
} from './denial-chips.js';
import { evidenceHtml } from './denial-evidence.js';
import * as triagePanel from './triage-panel.js';
import * as resolutionPanel from './resolution-panel.js';
import { historyHtml } from './denial-history.js';
import { openAssignDialog } from './denial-actions.js';
// A37 — the root-cause case covering this denial, when one does.
import { caseChipHtml } from '../rca/rca-chips.js';
// A38 hook: the appeal case a routed denial carries, read through appeal-cases.getAppealCaseForDenial().
import { denialAppealChipHtml } from '../appeals/appeal-chips.js';

export const meta = { title: 'Denial' };

const TABS = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'history', label: 'History' },
];

export async function render(mount, ctx) {
  const id = ctx.params[0];
  const first = denials.get(id);
  if (!first) throw new Error(`No denial ${id}`);

  const res = await fetch(new URL('./denial-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load denial-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { tab: TABS.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : 'evidence' };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const row = denials.get(id);
    if (!row) return;
    const claim = denials.claimOf(row);
    const patient = claim ? patients.view(patients.get(claim.patientMrn), role) : null;

    ctx.setHeader(`${row.id} — ${row.claimNo}`);
    ctx.setCrumb([
      { label: 'Defensio', path: '/defensio/denials' },
      { label: 'Denials', path: '/defensio/denials' },
      { label: row.id },
    ]);
    $('#dv-id').textContent = row.id;
    $('#dv-claim').href = `#/claima/claims/${row.claimNo}`;
    $('#dv-status').outerHTML = `<span id="dv-status">${statusHtml(row)}</span>`;

    // A denial names the payer, the claim and the money: withheld outright on a restricted record.
    if (patient?.masked) {
      $('#dv-meta').innerHTML = `<span class="t-mono-sm">${esc(row.id)}</span> ${statusHtml(row)}`;
      $('#dv-actions').innerHTML = '<button class="btn btn--secondary btn--sm" disabled title="Your role reads this record masked, so it cannot act on its denials"><span class="icon icon--sm">lock</span>Withheld</button>';
      $('#dv-banners').innerHTML = '';
      $('#dv-amounts').innerHTML = '';
      $('#dv-triage').innerHTML = maskedHtml(role);
      $('#dv-resolution').innerHTML = '';
      $('#dv-tabs').innerHTML = '';
      $('#dv-panel').innerHTML = '';
      return;
    }

    $('#dv-meta').innerHTML = metaHtml(row, claim, patient);
    $('#dv-actions').innerHTML = actionsHtml(row);
    $('#dv-banners').innerHTML = bannersHtml(row);
    $('#dv-amounts').innerHTML = amountsHtml(row);
    drawPanels(row);
    $('#dv-tabs').innerHTML = TABS.map((t) => `
      <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab" aria-selected="${t.id === state.tab}" data-tab="${t.id}">${t.label}</button>`).join('');
    const panel = $('#dv-panel');
    const host = document.createElement('div');
    panel.replaceChildren(host);
    host.innerHTML = state.tab === 'history' ? historyHtml(row.id) : evidenceHtml(row);
  }

  /** Each panel draws into a node of its own — the shell's freshBody rule one level down. */
  function drawPanels(row) {
    for (const [sel, panel] of [['#dv-triage', triagePanel], ['#dv-resolution', resolutionPanel]]) {
      const host = document.createElement('div');
      $(sel).replaceChildren(host);
      panel.render(host, { id: row.id, redraw: draw });
    }
  }

  function metaHtml(row, claim, patient) {
    return `
      <span class="t-mono-sm">${esc(row.id)}</span>${repeatHtml(row)}
      ${statusHtml(row)}
      ${row.separation || row.class ? separationHtml(row) : ''}
      ${row.tier ? tierHtml(row) : ''}
      ${row.class ? classHtml(row) : ''}
      ${scopeHtml(row)}
      ${caseChipHtml(row.id)}
      ${denialAppealChipHtml(row.id)}
      <span>·</span>
      <a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(row.claimNo)}">${esc(row.claimNo)}</a>
      <span>·</span>
      <span>${claim ? `<a class="crumb-link" href="#/frontis/patients/${esc(claim.patientMrn)}">${esc(patient?.nameEn || claim.patientMrn)}</a> · ${esc(coverLabel(claim))}` : esc(payerName(row))}</span>
      <span>·</span>
      <span class="t-body-sm">${esc(row.payerReason?.code || row.code || '')} ${esc(row.payerReason?.text || '')} · landed ${date(row.createdAt)} · ${ageHtml(row)} · appeal ${deadlineHtml(row)}</span>`;
  }

  function actionsHtml(row) {
    const me = currentRole().name;
    if (!denials.isOpen(row)) return `<span class="badge badge--info">${esc(row.status)} ${date(row.resolvedAt)}</span>`;
    return `
      <button class="btn btn--secondary btn--sm" data-act="assign" title="${row.assignee ? `Assigned to ${esc(row.assignee)} — hand it on` : 'Take it, or hand it to a colleague'}">
        <span class="icon icon--sm">person</span>${row.assignee === me ? 'Mine' : row.assignee ? esc(row.assignee) : 'Assign'}
      </button>
      ${row.assignee === me ? '' : `<button class="btn btn--primary btn--sm" data-act="take" title="Assign this denial to yourself"><span class="icon icon--sm">person_add</span>Take</button>`}`;
  }

  function bannersHtml(row) {
    const out = [];
    const dl = denials.deadline(row);
    if (row.status === 'Reclassified') {
      const rc = row.reclassification || {};
      out.push(alert('info', 'call_split', `${denials.separationLabel(row.separation)} — ${usd(row.amounts.reclassified)} separated out`,
        row.separation === 'TPA'
          ? `Accrued as ${rc.ref || 'a TPA fee'} on the TPA register; nothing is pursued. ${rc.note || ''}`
          : `Reconciled against ${row.claimNo} as ${rc.ref || 'a reconciliation note'} on the claim's trail; nothing is pursued. ${rc.note || ''}`));
    } else if (row.status === 'Deadline Passed') {
      out.push(alert('critical', 'timer_off', `Appeal deadline passed ${date(dl.appealBy)}`,
        `${usd(row.amounts.open)} is still open and nothing has been written off. A route can still be taken — a write-off request, or an appeal for a payer that reconsiders late.`));
    } else if (dl.binding && dl.warn) {
      out.push(alert('warning', 'timer', `${dl.daysLeft === 0 ? 'Appeal due today' : `${dl.daysLeft} day${dl.daysLeft === 1 ? '' : 's'} to appeal`}`,
        `The ${denials.appealWindowDays(row.payerId)}-day window closes ${date(dl.appealBy)}. Routing the denial meets it.`));
    }
    if (row.repeatCount >= 2 && denials.isOpen(row)) {
      out.push(alert('warning', 'repeat', `Repeat denial — ${row.repeatCount} times`,
        row.previousDenialId ? `Follows ${row.previousDenialId}; the triage was carried across. A second refusal on the same cause is the prevention feed's subject.` : 'The same line was refused again on a later remittance; the earlier route ended with it.'));
    }
    if (row.status === 'Untriaged') {
      out.push(alert('info', 'rule', 'Untriaged', 'Read the evidence, then answer in one pass: is it a denial at all, what kind and what tier, what caused it, and where it goes.'));
    }
    return out.join('');
  }

  const alert = (tone, icon, title, body) => `
    <div class="alert alert--${tone}"><span class="icon">${icon}</span><div><div class="title">${esc(title)}</div>${esc(body)}</div></div>`;

  function amountsHtml(row) {
    const a = row.amounts;
    return metricRailHtml([
      { value: usd(a.denied), label: 'Denied', title: 'What the payer refused on this denial' },
      { value: usd(a.recovered), label: 'Recovered', tone: a.recovered ? 'success' : '', title: 'Paid back by a remittance, an appeal, a hand-off or a manual close' },
      { value: usd(a.writtenOff), label: 'Written off', tone: a.writtenOff ? 'critical' : '', title: 'Written off through the write-off tiers' },
      { value: usd(a.lost), label: 'Lost', tone: a.lost ? 'critical' : '', title: 'Given up on — the appeal or the hand-off lost, or closed by hand as not recoverable' },
      { value: usd(a.reclassified || 0), label: 'Reclassified', tone: a.reclassified ? 'info' : '', title: 'Separated out as a contractual adjustment or a TPA fee — never a denial' },
      { value: usd(a.open), label: 'Open', tone: a.open ? 'warning' : '', sub: a.transferred ? `${usd(a.transferred)} carried forward` : 'denied − recovered − written off − lost − reclassified',
        title: a.transferred ? `${usd(a.transferred)} moved to the successor denial after a partial recovery` : 'What is still open on this denial' },
    ]);
  }

  function maskedHtml(role) {
    return `
      <div class="perm-banner">
        <span class="icon">lock</span>
        <div>
          <div class="title">Withheld</div>
          A denial names the payer, the claim and the money, and ${esc(role.name)}’s role reads this record masked. Switch to a role with VIP access to read it.
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; return draw(); }
    const act = e.target.closest('#dv-actions [data-act]')?.dataset.act;
    if (act === 'assign') { await openAssignDialog([id]); return undefined; }
    if (act === 'take') { denials.assign(id, 'me'); toast(`${id} is yours`); return undefined; }
    return undefined;
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  denials.peersReady.then(() => { if (mount.isConnected) draw(); });
  draw();
}
