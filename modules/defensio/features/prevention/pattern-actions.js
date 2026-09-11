// The pattern's own dialogs: Acknowledge (a note, written by whoever read
// it), and the drawer a row opens — the pattern read whole: its counters,
// every denial it counts with the claim behind it, the plans and rules on
// it, and its trail. Everything writes through the repositories and the
// dashboard redraws on the commit.

import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import * as preventionPlans from '../../../../data/repositories/prevention-plans.js';
import * as riskRules from '../../../../data/repositories/risk-rules.js';
import * as denials from '../../../../data/repositories/denials.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as modal from '../../../../shared/modal.js';
import * as drawer from '../../../../shared/drawer.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { moneyHtml, occurrencesHtml, patternStatusHtml, planChipsHtml, ruleChipsHtml, trendHtml } from './prevention-chips.js';

const errorBox = (el, problems) => {
  el.innerHTML = problems.length ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : '';
};

export async function openAcknowledgeDialog(id) {
  const p = denialPatterns.get(id);
  if (!p) return undefined;
  const dialog = modal.open({
    title: `Acknowledge ${p.id}`,
    sub: denialPatterns.labelOf(p),
    icon: 'visibility',
    size: 'sm',
    body: `
      <p class="modal__lede">${p.counters.occurrences} in ${p.window?.days || denialPatterns.windowDays()} days, ${esc(usd(p.counters.deniedValue))} denied — ${esc(denialPatterns.trendLabel(p.counters.trend).toLowerCase())}. Acknowledging says somebody has read it; a plan or a rule is a separate act.</p>
      <label class="field field--area"><span class="icon icon--sm">notes</span>
        <textarea id="pa-note" rows="2" placeholder="What you make of it (optional)" aria-label="Note" maxlength="300"></textarea>
      </label>
      <div id="pa-error"></div>`,
    foot: '<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="pa-save">Acknowledge</button>',
  });
  dialog.el.querySelector('#pa-save').addEventListener('click', () => {
    const r = denialPatterns.acknowledge(id, { note: dialog.el.querySelector('#pa-note').value });
    if (r?.error) return errorBox(dialog.el.querySelector('#pa-error'), [r.error]);
    toast(`${id} acknowledged`);
    return dialog.close(true);
  });
  return dialog.closed;
}

/** The pattern read whole, in the shared drawer. Resolves when it closes. */
export async function openPatternDrawer(id) {
  const p = denialPatterns.get(id);
  if (!p) return undefined;
  const role = currentRole();
  const c = p.counters || {};
  const rows = denialPatterns.denialsOf(p).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const inWindow = new Set(p.windowDenialIds || []);
  const planned = preventionPlans.inForceFor(p).length > 0;
  const ruled = riskRules.activeFor(p.id).length > 0;
  const sheet = drawer.open({
    title: p.id,
    sub: denialPatterns.labelOf(p),
    icon: 'insights',
    body: `
      <div class="toolbar">
        ${patternStatusHtml(p)} ${trendHtml(p)}
        <span class="spacer"></span>
        <span class="t-body-sm">${denialPatterns.LEVEL_LABELS[p.dims.service?.level] || 'Any service'}${p.origin ? ` · origin ${esc(p.origin)}` : ''}</span>
      </div>
      <dl class="dl dl--narrow">
        <dt>In the window</dt><dd>${occurrencesHtml(p)}<br><span class="t-body-sm">${esc(date(p.window?.since))} – ${esc(date(p.window?.until))}${denialPatterns.codesLabel(p) ? ` · codes ${esc(denialPatterns.codesLabel(p))}` : ''}</span></dd>
        <dt>Denied</dt><dd>${moneyHtml(c.deniedValue)} <span class="t-body-sm">· ${esc(usd(c.recoveredValue || 0))} recovered · ${esc(usd(c.openValue || 0))} open · ${esc(usd(c.lifetimeValue || 0))} lifetime</span></dd>
        <dt>Seen</dt><dd><span class="t-body-sm">first ${esc(date(p.firstSeenAt))} · last ${esc(date(p.lastSeenAt))} · detected ${esc(date(p.firstDetectedAt))}${p.fadedAt ? ` · faded ${esc(date(p.fadedAt))}` : ''}${p.reactivatedAt ? ` · reactivated ${esc(date(p.reactivatedAt))}` : ''}</span></dd>
        <dt>Acknowledged</dt><dd>${p.acknowledged ? `${esc(p.acknowledged.by)} · ${esc(dateTime(p.acknowledged.at))}${p.acknowledged.note ? `<br><span class="t-body-sm">${esc(p.acknowledged.note)}</span>` : ''}` : '<span class="t-body-sm">Not yet</span>'}</dd>
        <dt>Plans</dt><dd>${planChipsHtml(p)}</dd>
        <dt>Rules</dt><dd>${ruleChipsHtml(p)}</dd>
      </dl>
      <div class="toolbar"><span class="t-title-sm">Denials</span><span class="badge">${rows.length}</span><span class="spacer"></span><span class="t-body-sm">Inside the window first; a masked record reads withheld.</span></div>
      <table class="tbl">
        <thead><tr><th scope="col">Denial</th><th scope="col">Landed</th><th scope="col">Claim</th><th scope="col">Code</th><th scope="col">Denied</th><th scope="col">Status</th><th scope="col">Window</th></tr></thead>
        <tbody>${rows.map((d) => {
    const claim = denials.claimOf(d);
    const withheld = claim && patients.view(patients.get(claim.patientMrn), role)?.masked;
    return `
          <tr>
            <td><a class="crumb-link t-mono-sm" href="#/defensio/denials/${esc(d.id)}">${esc(d.id)}</a></td>
            <td><span class="t-body-sm">${esc(date(d.createdAt))}</span></td>
            <td>${withheld ? '<span class="badge" title="Your role reads this record masked">Withheld</span>' : `<a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(d.claimNo)}">${esc(d.claimNo)}</a>`}</td>
            <td><span class="t-mono-sm" title="${esc(d.payerReason?.text || '')}">${esc(d.payerReason?.code || d.code || '—')}</span>${d.rootCauseId ? '' : ' <span class="badge" title="Counted under the cause the code usually comes down to">untriaged</span>'}</td>
            <td>${withheld ? '<span class="t-body-sm">—</span>' : moneyHtml(d.amounts?.denied)}</td>
            <td><span class="badge">${esc(d.status)}</span></td>
            <td>${inWindow.has(d.id) ? '<span class="badge badge--accent">in</span>' : '<span class="t-body-sm">aged out</span>'}</td>
          </tr>`;
  }).join('')}</tbody>
      </table>
      <div class="toolbar"><span class="t-title-sm">History</span><span class="spacer"></span></div>
      ${historyHtml(p.id)}`,
    foot: `
      ${denialPatterns.needsAcknowledgment(p) ? '<button class="btn btn--primary" data-act="acknowledge">Acknowledge</button>' : ''}
      <button class="btn btn--secondary" data-act="plan"${planned ? ' disabled title="A plan in force already targets this pattern"' : ''}>Create plan</button>
      <button class="btn btn--secondary" data-act="rule"${ruled ? ' disabled title="An active rule already warns on this pattern"' : ''}>Create rule</button>
      <a class="btn btn--ghost" href="${esc(denialPatterns.denialsHref(p))}" data-close>View denials</a>
      <button class="btn btn--secondary" data-close>Close</button>`,
  });
  sheet.el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) sheet.close(act);
  });
  return sheet.closed;
}

const TONE = { Detected: 'accent', Status: 'info', Acknowledged: 'success' };
export function historyHtml(id) {
  const entries = denialPatterns.history(id);
  if (!entries.length) return '<p class="t-body-sm">No trail yet.</p>';
  return `<ol class="journey">${entries.map((e) => `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(e.at)}</span>
      <span class="journey__action"><span class="badge${TONE[e.action] ? ` badge--${TONE[e.action]}` : ''}">${esc(e.action)}</span></span>
      <span class="journey__actor">${esc(e.user || '')}</span>
      <span class="journey__detail">${esc(e.details || '')}</span>
    </li>`).join('')}</ol>`;
}
