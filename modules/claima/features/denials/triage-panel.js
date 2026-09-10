// The triage panel on the denial page: class and root cause (both required),
// the route the router suggests with the reason, the override select with
// every route it cannot take disabled and saying why, Route — which creates
// the work item and shows its link — and Re-route with a reason once one is
// active. It owns its node and its listener, so both retire when the page
// redraws it.

import * as denials from '../../../../data/repositories/denials.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc } from '../../../../shared/format.js';
import { askRerouteReason, classOptions, rootCauseOptions } from './denial-actions.js';
import { routeHtml } from './denial-chips.js';

/** render(host, { id, redraw }) — draws the panel for the denial and binds its listener on the host. */
export function render(host, { id, redraw }) {
  const denial = denials.get(id);
  if (!denial) return;
  const open = denials.isOpen(denial);
  const s = denials.suggest(denial);
  const options = denials.routeOptions(denial);
  const picked = denial.rootCauseId ? denials.rootCause(denial.rootCauseId) : null;
  const triaged = Boolean(denial.class && denial.rootCauseId);
  const suggestedRoute = triaged ? denials.suggest(denial).route : s.route;
  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Triage</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${triaged ? `Triaged${denial.assignee ? ` · ${esc(denial.assignee)}` : ''}` : 'Class and root cause are both required before a route'}</span>
    </div>
    <label class="field">
      <span class="icon icon--sm">category</span>
      <select id="tp-class" aria-label="Class"${open ? '' : ' disabled'}>${classOptions(denial.class || s.class)}</select>
    </label>
    <label class="field">
      <span class="icon icon--sm">troubleshoot</span>
      <select id="tp-cause" aria-label="Root cause"${open ? '' : ' disabled'}>${rootCauseOptions(denial.rootCauseId || s.rootCauseId)}</select>
    </label>
    <label class="field field--area">
      <span class="icon icon--sm">notes</span>
      <textarea id="tp-note" rows="2" placeholder="What the evidence says (optional)" aria-label="Triage note" maxlength="300"${open ? '' : ' disabled'}>${esc(denial.triageNote || '')}</textarea>
    </label>
    <p class="t-body-sm" id="tp-hint">${esc(hintFor(picked || denials.rootCause(s.rootCauseId), triaged))}</p>
    <div class="toolbar">
      <span class="spacer"></span>
      <button class="btn btn--primary btn--sm" data-act="triage"${open ? '' : ' disabled'} title="${open ? 'Save the class and the root cause' : 'A resolved denial is not retriaged'}">
        <span class="icon icon--sm">rule</span>${triaged ? 'Update triage' : 'Save triage'}
      </button>
    </div>
    <div class="toolbar">
      <span class="t-title-sm">Route</span>
      <span class="spacer"></span>
      ${denial.route ? routeHtml(denial) : `<span class="t-body-sm">Suggested: ${esc(denials.routeLabel(suggestedRoute))}</span>`}
    </div>
    ${denial.route ? activeHtml(denial) : ''}
    <p class="t-body-sm">${esc(triaged ? denials.suggest(denial).why : `Before triage the suggestion reads the payer's reason: ${s.why}`)}</p>
    <label class="field">
      <span class="icon icon--sm">route</span>
      <select id="tp-route" aria-label="Route"${open ? '' : ' disabled'}>
        ${options.map((o) => `<option value="${o.kind}"${o.kind === suggestedRoute ? ' selected' : ''}${o.ok ? '' : ' disabled'} title="${esc(o.ok ? denials.ROUTE_HINTS[o.kind] : o.why)}">${esc(o.label)}${o.ok ? '' : ' — not available'}</option>`).join('')}
      </select>
    </label>
    <p class="t-body-sm" id="tp-route-hint">${esc(denials.ROUTE_HINTS[suggestedRoute] || '')}</p>
    <div class="toolbar">
      <span class="spacer"></span>
      <button class="btn btn--${denial.route ? 'secondary' : 'primary'} btn--sm" data-act="route"${open && triaged ? '' : ' disabled'}
              title="${!open ? 'A resolved denial is not routed' : !triaged ? 'Save the triage first' : denial.route ? 'End the active route with a reason and start this one' : 'Create the work item and link it here'}">
        <span class="icon icon--sm">${denial.route ? 'alt_route' : 'send'}</span>${denial.route ? 'Re-route' : 'Route'}
      </button>
    </div>
    ${historyHtml(denial)}
    <div id="tp-error"></div>`;

  const $ = (sel) => host.querySelector(sel);
  $('#tp-cause').addEventListener('change', () => {
    const rc = denials.rootCause($('#tp-cause').value);
    if (!rc) return;
    $('#tp-class').value = rc.suggestedClass;
    $('#tp-hint').textContent = hintFor(rc, false);
    const opt = [...$('#tp-route').options].find((o) => o.value === rc.suggestedRoute);
    if (opt && !opt.disabled) { $('#tp-route').value = rc.suggestedRoute; $('#tp-route-hint').textContent = denials.ROUTE_HINTS[rc.suggestedRoute] || ''; }
  });
  $('#tp-route').addEventListener('change', () => { $('#tp-route-hint').textContent = denials.ROUTE_HINTS[$('#tp-route').value] || ''; });

  host.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const errors = (list) => { $('#tp-error').innerHTML = list.length ? `<div class="alert alert--critical"><span class="icon">error</span><div>${list.map(esc).join('<br>')}</div></div>` : ''; };
    if (act === 'triage') {
      const r = denials.triage(id, { class: $('#tp-class').value, rootCauseId: $('#tp-cause').value, note: $('#tp-note').value });
      if (r?.error) return errors([r.error]);
      toast(`${id} triaged — ${r.class} · ${denials.rootCauseLabel(r.rootCauseId)}`);
      return redraw();
    }
    if (act === 'route') {
      const kind = $('#tp-route').value;
      const current = denials.get(id);
      let reason = null;
      if (current.route?.active) {
        reason = await askRerouteReason(current, kind);
        if (!reason) return undefined;
      }
      const r = denials.route(id, kind, { reason });
      if (r?.error) return errors([r.error]);
      const link = denials.linkOf(r);
      toast(`${id} routed to ${denials.routeLabel(kind)}${link ? ` — ${link.label}` : ''}`);
      return redraw();
    }
    return undefined;
  });
}

function hintFor(rc, triaged) {
  if (!rc) return '';
  return `${rc.group} · usually ${rc.suggestedClass === 'Write-Off Candidate' ? 'a write-off candidate' : rc.suggestedClass.toLowerCase()}, routed to ${denials.routeLabel(rc.suggestedRoute)}${triaged ? '' : ' — override either below'}.`;
}

function activeHtml(denial) {
  const r = denial.route;
  const link = denials.linkOf(denial);
  const progress = denials.progressOf(denial);
  return `
    <div class="alert alert--info">
      <span class="icon">${denials.ROUTE_ICONS[r.kind] || 'route'}</span>
      <div>
        <div class="title">${esc(denials.routeLabel(r.kind))} since ${date(r.at)} — ${esc(r.by)}</div>
        ${esc(denials.ROUTE_HINTS[r.kind] || '')}${r.reason ? ` Re-routed because: ${esc(r.reason)}.` : ''}${progress ? ` ${esc(progress)}.` : ''}
        ${link ? `<br><a class="crumb-link" href="${esc(link.href)}">Open ${esc(link.label)}</a>` : ''}
      </div>
    </div>`;
}

function historyHtml(denial) {
  const past = denial.routeHistory || [];
  if (!past.length) return '';
  return `
    <div class="toolbar"><span class="t-title-sm">Earlier routes</span><span class="badge">${past.length}</span></div>
    <ol class="journey">${past.map((r) => `
      <li class="journey__row">
        <span class="journey__at t-mono-sm">${date(r.at)} – ${date(r.endedAt)}</span>
        <span class="journey__action"><span class="badge">${esc(denials.routeLabel(r.kind))}</span></span>
        <span class="journey__actor">${esc(r.by)}</span>
        <span class="journey__detail">${esc(r.ref || '')}${r.ref ? ' · ' : ''}${esc(r.endedReason || '')}</span>
      </li>`).join('')}</ol>`;
}
