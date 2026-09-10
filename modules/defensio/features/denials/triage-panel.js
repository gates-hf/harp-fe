// The one-pass triage panel on the Defensio denial page: separation first
// (a true denial, a contractual adjustment, a TPA fee), then category and
// tier, and for a true denial the class, the root cause, the route the
// router suggests with every route it cannot take disabled and saying why,
// the assignee and the notes — one Save that triages and routes together.
// A separation other than a true denial hides the rest and the button reads
// what it will do: reconcile the money out. Once a route is active the form
// updates the triage and re-routes with a reason. It owns its node and its
// listener, so both retire when the page redraws it.

import * as denials from '../../../../data/repositories/denials.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { askRerouteReason, assigneeOptions, categoryOptions, classOptions, rootCauseOptions, tierOptions } from './denial-actions.js';
import { routeHtml } from './denial-chips.js';

/** render(host, { id, redraw }) — draws the panel for the denial and binds its listener on the host. */
export function render(host, { id, redraw }) {
  const denial = denials.get(id);
  if (!denial) return;
  const open = denials.isOpen(denial);
  const s = denials.suggest(denial);
  const options = denials.routeOptions(denial);
  const triaged = Boolean(denial.class && denial.rootCauseId);
  const activeKind = denial.route?.active ? denial.route.kind : null;
  const suggestedRoute = activeKind || s.route;
  const dis = open ? '' : ' disabled';
  const ui = { separation: denial.separation || s.separation };

  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Triage</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${esc(headline(denial, triaged))}</span>
    </div>
    <div class="toolbar">
      <span class="t-body-sm">Separation</span>
      <span class="segmented" role="group" aria-label="Separation">
        ${denials.SEPARATIONS.map((k) => `<button type="button" data-sep="${k}" aria-pressed="${ui.separation === k}"${dis} title="${esc(sepHint(k))}">${esc(denials.separationLabel(k))}</button>`).join('')}
      </span>
    </div>
    <p class="t-body-sm" id="tp-sep-hint">${esc(sepHint(ui.separation))}</p>
    <div class="toolbar">
      <label class="field"><span class="icon icon--sm">psychology</span><select id="tp-category" aria-label="Category"${dis}>${categoryOptions(denial.category || s.category)}</select></label>
      <label class="field"><span class="icon icon--sm">layers</span><select id="tp-tier" aria-label="Tier"${dis}>${tierOptions(denial.tier || s.tier)}</select></label>
    </div>
    <div id="tp-true">
      <div class="toolbar">
        <label class="field"><span class="icon icon--sm">category</span><select id="tp-class" aria-label="Class"${dis}>${classOptions(denial.class || s.class)}</select></label>
        <label class="field field--grow"><span class="icon icon--sm">troubleshoot</span><select id="tp-cause" aria-label="Root cause"${dis}>${rootCauseOptions(denial.rootCauseId || s.rootCauseId)}</select></label>
      </div>
      <p class="t-body-sm" id="tp-hint">${esc(hintFor(denials.rootCause(denial.rootCauseId || s.rootCauseId), triaged))}</p>
      <div class="toolbar">
        <span class="t-title-sm">Route</span>
        <span class="spacer"></span>
        ${denial.route ? routeHtml(denial) : `<span class="t-body-sm">Suggested: ${esc(denials.routeLabel(s.route))}</span>`}
      </div>
      ${denial.route ? activeHtml(denial) : ''}
      <p class="t-body-sm">${esc(s.why)}</p>
      <label class="field">
        <span class="icon icon--sm">route</span>
        <select id="tp-route" aria-label="Route"${dis}>
          <option value=""${suggestedRoute ? '' : ' selected'}>${activeKind ? 'Keep the active route' : 'Triage only — no route yet'}</option>
          ${options.map((o) => `<option value="${o.kind}"${o.kind === suggestedRoute ? ' selected' : ''}${o.ok || o.kind === activeKind ? '' : ' disabled'} title="${esc(o.ok ? denials.ROUTE_HINTS[o.kind] : o.why)}">${esc(o.label)}${o.kind === activeKind ? ' — active' : o.ok ? '' : ' — not available'}</option>`).join('')}
        </select>
      </label>
      <p class="t-body-sm" id="tp-route-hint">${esc(denials.ROUTE_HINTS[suggestedRoute] || '')}</p>
      <label class="field"><span class="icon icon--sm">person</span><select id="tp-assignee" aria-label="Assignee"${dis}>${assigneeOptions(denial.assignee || '')}</select></label>
    </div>
    <label class="field field--area">
      <span class="icon icon--sm">notes</span>
      <textarea id="tp-note" rows="2" placeholder="What the evidence says" aria-label="Notes" maxlength="300"${dis}>${esc(denial.triageNote || denial.reclassification?.note || '')}</textarea>
    </label>
    <div class="toolbar">
      <span class="spacer"></span>
      <button class="btn btn--primary btn--sm" data-act="save" id="tp-save"${dis}></button>
    </div>
    ${historyHtml(denial)}
    <div id="tp-error"></div>`;

  const $ = (sel) => host.querySelector(sel);

  function paint() {
    const sep = ui.separation;
    for (const b of host.querySelectorAll('[data-sep]')) b.setAttribute('aria-pressed', String(b.dataset.sep === sep));
    $('#tp-sep-hint').textContent = sepHint(sep);
    $('#tp-true').hidden = sep !== 'True';
    const btn = $('#tp-save');
    const route = $('#tp-route').value;
    let label;
    let icon;
    let title;
    if (!open) { label = 'Resolved'; icon = 'lock'; title = `A ${denial.status.toLowerCase()} denial is not retriaged`; }
    else if (sep === 'Contractual') { label = 'Reclassify as contractual adjustment'; icon = 'call_split'; title = `${usd(denial.amounts.open)} leaves the worklist as a contractual adjustment, with a reconciliation note on the claim`; }
    else if (sep === 'TPA') { label = 'Accrue as TPA fee'; icon = 'call_split'; title = `${usd(denial.amounts.open)} leaves the worklist as a TPA fee, accrued on the TPA register`; }
    else if (activeKind) {
      const moving = route && route !== activeKind;
      label = moving ? `Update triage & re-route` : 'Update triage';
      icon = moving ? 'alt_route' : 'rule';
      title = moving ? `End the ${denials.routeLabel(activeKind).toLowerCase()} route with a reason and start ${denials.routeLabel(route).toLowerCase()}` : 'Save the reading; the active route stays';
    } else {
      label = route ? 'Triage & route' : 'Save triage';
      icon = route ? 'send' : 'rule';
      title = route ? `Save the reading and create the ${denials.routeLabel(route).toLowerCase()} work item` : 'Save the reading without a route';
    }
    btn.innerHTML = `<span class="icon icon--sm">${icon}</span>${esc(label)}`;
    btn.title = title;
  }

  host.addEventListener('click', async (e) => {
    const sepBtn = e.target.closest('[data-sep]');
    if (sepBtn && !sepBtn.disabled) { ui.separation = sepBtn.dataset.sep; return paint(); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act !== 'save') return undefined;
    const errors = (list) => { $('#tp-error').innerHTML = list.length ? `<div class="alert alert--critical"><span class="icon">error</span><div>${list.map(esc).join('<br>')}</div></div>` : ''; };
    errors([]);
    const common = { category: $('#tp-category').value, tier: $('#tp-tier').value, note: $('#tp-note').value };
    if (ui.separation !== 'True') {
      const r = denials.triage(id, { ...common, separation: ui.separation });
      if (r?.error) return errors([r.error]);
      toast(`${id} reclassified — ${denials.separationLabel(ui.separation).toLowerCase()} · ${r.reclassification?.ref || ''}`);
      return redraw();
    }
    const assignee = $('#tp-assignee').value || null;
    const t = denials.triage(id, { ...common, separation: 'True', class: $('#tp-class').value, rootCauseId: $('#tp-cause').value, assignee });
    if (t?.error) return errors([t.error]);
    const kind = $('#tp-route').value;
    if (!kind || kind === activeKind) {
      toast(`${id} triaged — ${t.tier} · ${t.class} · ${denials.rootCauseLabel(t.rootCauseId)}`);
      return redraw();
    }
    let reason = null;
    if (activeKind) {
      reason = await askRerouteReason(denials.get(id), kind);
      if (!reason) return redraw();
    }
    const r = denials.route(id, kind, { reason });
    if (r?.error) { redraw(); toast(`${id} triaged; not routed — ${r.error}`, 'warning'); return undefined; }
    const link = denials.linkOf(r);
    toast(`${id} routed to ${denials.routeLabel(kind)}${link ? ` — ${link.label}` : ''}`);
    return redraw();
  });

  $('#tp-cause').addEventListener('change', () => {
    const rc = denials.rootCause($('#tp-cause').value);
    if (!rc) return;
    $('#tp-class').value = rc.suggestedClass;
    if (rc.tier) $('#tp-tier').value = rc.tier;
    if (rc.category) $('#tp-category').value = rc.category;
    $('#tp-hint').textContent = hintFor(rc, false);
    const opt = [...$('#tp-route').options].find((o) => o.value === rc.suggestedRoute);
    if (opt && !opt.disabled && !activeKind) { $('#tp-route').value = rc.suggestedRoute; $('#tp-route-hint').textContent = denials.ROUTE_HINTS[rc.suggestedRoute] || ''; }
    paint();
  });
  // The tier → class map: a tier moved by hand moves the class with it; the root cause still wins when re-picked.
  $('#tp-tier').addEventListener('change', () => {
    const cls = denials.TIER_CLASS[$('#tp-tier').value];
    if (cls) $('#tp-class').value = cls;
  });
  $('#tp-route').addEventListener('change', () => { $('#tp-route-hint').textContent = denials.ROUTE_HINTS[$('#tp-route').value] || ''; paint(); });
  paint();
}

function headline(denial, triaged) {
  if (denial.status === 'Reclassified') return `${denials.separationLabel(denial.separation)} · ${date(denial.resolvedAt)}`;
  if (!denials.isOpen(denial)) return `${denial.status} · ${date(denial.resolvedAt)}`;
  if (triaged) return `Triaged${denial.assignee ? ` · ${denial.assignee}` : ''}`;
  return 'Separation, category and tier first; a true denial takes a class, a root cause and a route';
}

function sepHint(sep) {
  if (sep === 'Contractual') return 'The payer applied the contract as written — the amount is reconciled against the claim with a note and never pursued.';
  if (sep === 'TPA') return 'The administrator withheld its fee from the remittance — the amount is accrued on the TPA register and never pursued.';
  return 'A denial to be worked: classed, routed to the feature that fixes it, and resolved by what the registers do next.';
}

function hintFor(rc, triaged) {
  if (!rc) return '';
  return `${rc.group} · usually ${rc.category ? `${rc.category.toLowerCase()}, ` : ''}${rc.tier ? `${rc.tier.toLowerCase()}, ` : ''}${
    rc.suggestedClass === 'Write-Off Candidate' ? 'a write-off candidate' : rc.suggestedClass.toLowerCase()}, routed to ${denials.routeLabel(rc.suggestedRoute)}${triaged ? '' : ' — override any of it above'}.`;
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
