// The Defensio root-cause case page at #/defensio/rca/<id>: the banner
// (status, trigger, nature, target, the denials it covers, the analyst), the
// actions (assign, conclude, close — each carrying the register's own gate
// in its tooltip), the totals rail, and five tabs — Evidence (the origin
// trail), Analysis (the whys), Causer (the person named, with evidence),
// Actions (the corrective actions) and History. Each tab draws into a node
// of its own and binds its own listener, so both retire when the page
// redraws it — the shell's freshBody rule one level down.

import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as denials from '../../../../data/repositories/denials.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as accountabilityCases from '../../../../data/repositories/accountability-cases.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { toast } from '../../../../shared/toast.js';
import { analystHtml, causeHtml, causerHtml, denialChipsHtml, natureHtml, statusHtml, targetHtml, triggerHtml } from './rca-chips.js';
import { evidenceHtml, originTrail } from './rca-evidence.js';
import * as analysisTab from './rca-analysis.js';
import * as causerTab from './rca-causer.js';
import * as actionsTab from './rca-actions-tab.js';
import { historyHtml } from './rca-history.js';
import { openAssignDialog, openCloseDialog, openConcludeDialog } from './rca-dialogs.js';

export const meta = { title: 'Root-cause case' };

const TABS = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'causer', label: 'Causer' },
  { id: 'actions', label: 'Corrective actions' },
  { id: 'history', label: 'History' },
];

export async function render(mount, ctx) {
  const id = ctx.params[0];
  const first = rcaCases.get(id);
  if (!first) throw new Error(`No root-cause case ${id}`);

  const res = await fetch(new URL('./rca-case.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load rca-case.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { tab: TABS.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : 'evidence' };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const row = rcaCases.get(id);
    if (!row) return;
    const withheld = rcaCases.denialsOf(row).some((d) => { const c = denials.claimOf(d); return c && patients.view(patients.get(c.patientMrn), role)?.masked; });

    ctx.setHeader(`${row.id} — ${rcaCases.statusLabel(row.status)}`);
    ctx.setCrumb([
      { label: 'Defensio', path: '/defensio/rca' },
      { label: 'Root cause', path: '/defensio/rca' },
      { label: row.id },
    ]);
    $('#rc-id').textContent = row.id;
    $('#rc-title').textContent = row.detail || row.id;

    if (withheld) {
      $('#rc-meta').innerHTML = `<span class="t-mono-sm">${esc(row.id)}</span> ${statusHtml(row)}`;
      $('#rc-actions').innerHTML = '<button class="btn btn--secondary btn--sm" disabled title="Your role reads a record behind this case masked, so it cannot work the case"><span class="icon icon--sm">lock</span>Withheld</button>';
      $('#rc-banners').innerHTML = '';
      $('#rc-amounts').innerHTML = '';
      $('#rc-tabs').innerHTML = '';
      $('#rc-panel').innerHTML = `
        <div class="perm-banner">
          <span class="icon">lock</span>
          <div>
            <div class="title">Withheld</div>
            A root-cause case names the payer, the claim and the money, and ${esc(role.name)}’s role reads a record behind it masked. Switch to a role with VIP access to read it.
          </div>
        </div>`;
      return;
    }

    $('#rc-meta').innerHTML = metaHtml(row, role);
    $('#rc-actions').innerHTML = actionsHtml(row);
    $('#rc-banners').innerHTML = bannersHtml(row);
    $('#rc-amounts').innerHTML = amountsHtml(row);
    $('#rc-tabs').innerHTML = TABS.map((t) => `
      <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab" aria-selected="${t.id === state.tab}" data-tab="${t.id}"${
      t.id === 'causer' && row.analysis?.causeNature !== 'individual' ? ' title="Enabled once the analysis says the cause was one person’s act"' : ''}>${t.label}${
      t.id === 'causer' && row.analysis?.causeNature !== 'individual' ? ' <span class="icon icon--sm">lock</span>' : ''}</button>`).join('');
    const panel = $('#rc-panel');
    const host = document.createElement('div');
    panel.replaceChildren(host);
    if (state.tab === 'evidence') host.innerHTML = evidenceHtml(originTrail(row));
    else if (state.tab === 'analysis') analysisTab.render(host, { id, redraw: draw });
    else if (state.tab === 'causer') causerTab.render(host, { id, redraw: draw });
    else if (state.tab === 'actions') actionsTab.render(host, { id, redraw: draw });
    else host.innerHTML = historyHtml(row.id);
  }

  function metaHtml(row, role) {
    return `
      <span class="t-mono-sm">${esc(row.id)}</span>
      ${statusHtml(row)}
      ${triggerHtml(row)}
      ${row.analysis?.causeNature ? natureHtml(row) : ''}
      <span>·</span>
      ${denialChipsHtml(row)}
      <span>·</span>
      <span class="t-body-sm">opened ${date(row.openedAt)} by ${esc(row.openedBy)} · target ${targetHtml(row)} · analyst ${analystHtml(row)}</span>
      ${row.causer ? `<span>·</span><span class="t-body-sm">named ${causerHtml(row, role)}</span>` : ''}`;
  }

  function actionsHtml(row) {
    if (row.status === 'Closed') return `<span class="badge badge--success">Closed ${date(row.closedAt)}</span>`;
    const conclude = rcaCases.concludeBlockers(row);
    const close = rcaCases.closeBlockers(row);
    const me = currentRole().id;
    return `
      ${rcaCases.isOpen(row) ? `
      <button class="btn btn--secondary btn--sm" data-act="assign" title="${row.analystId ? `Analyst ${esc(rcaCases.analystName(row))} — hand it on` : 'Take it, or hand it to a colleague'}">
        <span class="icon icon--sm">person</span>${row.analystId === me ? 'Mine' : row.analystId ? esc(rcaCases.analystName(row)) : 'Assign'}
      </button>
      ${row.analystId === me ? '' : '<button class="btn btn--secondary btn--sm" data-act="take" title="Make yourself the analyst"><span class="icon icon--sm">person_add</span>Take</button>'}
      <button class="btn btn--primary btn--sm" data-act="conclude"${conclude.length ? ' aria-disabled="true"' : ''} title="${esc(conclude.length ? conclude.join(' ') : 'Confirm the cause on every covered denial and, for a person named, open the accountability case')}">
        <span class="icon icon--sm">task_alt</span>Conclude
      </button>` : `
      <button class="btn btn--primary btn--sm" data-act="close"${close.length ? ' aria-disabled="true"' : ''} title="${esc(close.length ? close.join(' ') : 'Every action is verified — close the case')}">
        <span class="icon icon--sm">lock</span>Close
      </button>`}`;
  }

  function bannersHtml(row) {
    const out = [];
    const t = rcaCases.target(row);
    if (rcaCases.isOpen(row) && t.passed) {
      out.push(alert('critical', 'timer_off', `Overdue — target was ${date(t.due)}`, `${Math.abs(t.daysLeft)} day${Math.abs(t.daysLeft) === 1 ? '' : 's'} past the ${row.targetDays}-day target. Conclude it, or say why on the analysis.`));
    }
    if (row.status === 'Open') {
      out.push(alert('info', 'troubleshoot', 'Opened, nothing analysed yet', `${rcaCases.triggerLabel(row.trigger)} trigger — ${row.detail}. Read the evidence, then state the problem and work the whys on the Analysis tab.`));
    }
    if (row.status === 'Concluded') {
      const blockers = rcaCases.closeBlockers(row);
      out.push(alert(blockers.length ? 'warning' : 'success', 'task_alt', `Concluded ${date(row.concludedAt)} — ${denials.rootCauseLabel(row.analysis.confirmedRootCause)}`,
        blockers.length ? `Waiting to close: ${blockers.join(' ')}` : 'Every corrective action is verified — the case can close.'));
    }
    if (row.retags?.length) {
      out.push(alert('info', 'sell', `${row.retags.length} denial${row.retags.length === 1 ? '' : 's'} retagged at conclusion`,
        row.retags.map((r) => `${r.denialId}: ${r.from ? denials.rootCauseLabel(r.from) : 'untagged'} → ${denials.rootCauseLabel(r.to)}`).join(' · ')));
    }
    if (row.accountabilityCaseId) {
      const acc = accountabilityCases.get(row.accountabilityCaseId);
      const role = currentRole();
      out.push(alert('warning', 'gavel', `Accountability case ${accountabilityCases.canRead(role) ? row.accountabilityCaseId : accountabilityCases.maskedLabel(acc)}`,
        acc ? `${accountabilityCases.stageOf(acc)}${accountabilityCases.canRead(role) ? ` — ${row.causer?.roleInFailure || ''}` : ' — names are read by the authorised roles only'}` : 'Opened at conclusion'));
    }
    return out.join('');
  }

  const alert = (tone, icon, title, body) => `
    <div class="alert alert--${tone}"><span class="icon">${icon}</span><div><div class="title">${esc(title)}</div>${esc(body)}</div></div>`;

  function amountsHtml(row) {
    const rows = rcaCases.denialsOf(row);
    const recovered = rows.reduce((n, d) => n + (d.amounts.recovered || 0), 0);
    const lost = rows.reduce((n, d) => n + (d.amounts.lost || 0) + (d.amounts.writtenOff || 0), 0);
    const open = rcaCases.openTotal(row);
    return metricRailHtml([
      { value: rows.length, label: 'Denials covered', title: rows.map((d) => d.id).join(', ') },
      { value: usd(rcaCases.deniedTotal(row)), label: 'Denied', title: 'What the payers refused across the covered denials' },
      { value: usd(recovered), label: 'Recovered', tone: recovered ? 'success' : '', title: 'Paid back since, across the covered denials' },
      { value: usd(lost), label: 'Lost or written off', tone: lost ? 'critical' : '', title: 'Given up on or written off across the covered denials' },
      { value: usd(open), label: 'Still open', tone: open ? 'warning' : '', title: 'What is still open on the covered denials' },
    ]);
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; return draw(); }
    const btn = e.target.closest('#rc-actions [data-act]');
    if (!btn) return undefined;
    const act = btn.dataset.act;
    if (act === 'assign') { await openAssignDialog(id); return undefined; }
    if (act === 'take') { const r = rcaCases.assign(id, 'me'); if (r?.error) toast(r.error, 'warning'); else toast(`${id} is yours`); return undefined; }
    if (act === 'conclude') { await openConcludeDialog(id); return undefined; }
    if (act === 'close') { await openCloseDialog(id); return undefined; }
    return undefined;
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}
