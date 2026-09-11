// The two pickers a plan is built with: a target (a pattern on the register,
// a root cause off the shared list with what it drew in the window, or a
// corrective action a concluded root-cause case raised) and an action to
// adopt from amendment 37's register — a link whose status is read from
// there. Both resolve with what was picked, or undefined; the plan page
// writes.

import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import * as preventionPlans from '../../../../data/repositories/prevention-plans.js';
import * as correctiveActions from '../../../../data/repositories/corrective-actions.js';
import { staffName } from '../../../../data/seed/staff.js';
import * as modal from '../../../../shared/modal.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { patternStatusHtml } from './prevention-chips.js';

/** openTargetPicker({ picked: [{ type, ref }] }) → { type, ref } | undefined. */
export async function openTargetPicker({ picked = [] } = {}) {
  const has = (type, ref) => picked.some((t) => t.type === type && t.ref === ref);
  const dialog = modal.open({
    title: 'Add a target',
    sub: 'What the plan is meant to stop — the baseline and the measurement count its denials',
    icon: 'ads_click',
    size: 'lg',
    body: `
      <div class="toolbar">
        <div class="segmented" id="tp-kind" role="group" aria-label="Target type">
          <button type="button" class="segmented__btn" data-kind="pattern" aria-pressed="true">Pattern</button>
          <button type="button" class="segmented__btn" data-kind="cause" aria-pressed="false">Root cause</button>
          <button type="button" class="segmented__btn" data-kind="f2Action" aria-pressed="false">Corrective action</button>
        </div>
        <label class="field field--grow"><span class="icon icon--sm">search</span><input type="search" id="tp-q" placeholder="Search" aria-label="Search targets"></label>
      </div>
      <div id="tp-list"></div>`,
    foot: '<button class="btn btn--secondary" data-close>Cancel</button>',
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  let kind = 'pattern';
  function draw() {
    const q = $('#tp-q').value.trim().toLowerCase();
    const match = (...vals) => !q || vals.some((v) => String(v || '').toLowerCase().includes(q));
    let html = '';
    if (kind === 'pattern') {
      const rows = denialPatterns.search(q, {});
      html = rows.length ? `<table class="tbl"><thead><tr><th scope="col">Pattern</th><th scope="col">Status</th><th scope="col">In window</th><th scope="col">Denied</th><th scope="col"></th></tr></thead><tbody>${rows.map((p) => `
        <tr><td><span class="t-mono-sm">${esc(p.id)}</span><br>${esc(denialPatterns.labelOf(p))}</td><td>${patternStatusHtml(p)}</td><td><span class="t-mono-sm">${p.counters?.occurrences ?? 0}</span></td><td><span class="t-mono-sm">${esc(usd(p.counters?.deniedValue || 0))}</span></td>
        <td>${has('pattern', p.id) ? '<span class="badge">Picked</span>' : `<button class="btn btn--primary btn--sm" data-pick="pattern" data-ref="${esc(p.id)}">Pick</button>`}</td></tr>`).join('')}</tbody></table>` : '<p class="t-body-sm">No pattern matches.</p>';
    } else if (kind === 'cause') {
      const drew = new Map(denialPatterns.rankedCauses().map((c) => [c.causeId, c]));
      const rows = denialPatterns.ROOT_CAUSES.filter((c) => match(c.id, c.label, c.group));
      html = `<table class="tbl"><thead><tr><th scope="col">Root cause</th><th scope="col">Origin</th><th scope="col">In window</th><th scope="col">Denied</th><th scope="col"></th></tr></thead><tbody>${rows.map((c) => { const d = drew.get(c.id); return `
        <tr><td>${esc(c.label)}<br><span class="t-mono-sm">${esc(c.id)}</span></td><td><span class="t-body-sm">${esc(c.group)}</span></td><td><span class="t-mono-sm">${d?.count || 0}</span></td><td><span class="t-mono-sm">${esc(usd(d?.deniedValue || 0))}</span></td>
        <td>${has('cause', c.id) ? '<span class="badge">Picked</span>' : `<button class="btn btn--primary btn--sm" data-pick="cause" data-ref="${esc(c.id)}">Pick</button>`}</td></tr>`; }).join('')}</tbody></table>`;
    } else {
      const rows = preventionPlans.adoptableActions().filter((a) => match(a.id, a.action, a.caseId, a.type));
      html = rows.length ? `<table class="tbl"><thead><tr><th scope="col">Action</th><th scope="col">Case</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col"></th></tr></thead><tbody>${rows.map((a) => `
        <tr><td><span class="t-mono-sm">${esc(a.id)}</span><br>${esc(a.action)}</td><td><a class="crumb-link t-mono-sm" href="#/defensio/rca/${esc(a.caseId)}/actions">${esc(a.caseId)}</a><br><span class="t-body-sm">${esc(a.rootCauseId ? denialPatterns.rootCauseLabel(a.rootCauseId) : '')}</span></td><td><span class="badge">${esc(correctiveActions.typeLabel(a.type))}</span></td><td><span class="badge badge--${correctiveActions.statusTone(a.status)}">${esc(a.status)}</span></td>
        <td>${has('f2Action', a.id) ? '<span class="badge">Picked</span>' : `<button class="btn btn--primary btn--sm" data-pick="f2Action" data-ref="${esc(a.id)}">Pick</button>`}</td></tr>`).join('')}</tbody></table>` : '<p class="t-body-sm">No concluded root-cause case has raised an action yet — or the register is not on disk.</p>';
    }
    $('#tp-list').innerHTML = html;
  }
  $('#tp-q').addEventListener('input', draw);
  dialog.el.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-kind]');
    if (seg) { kind = seg.dataset.kind; for (const b of dialog.el.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b === seg)); return draw(); }
    const pick = e.target.closest('[data-pick]');
    if (pick) return dialog.close({ type: pick.dataset.pick, ref: pick.dataset.ref });
    return undefined;
  });
  draw();
  return dialog.closed;
}

/** openAdoptPicker({ adopted: [ids] }) → the corrective-action id to adopt, or undefined. */
export async function openAdoptPicker({ adopted = [] } = {}) {
  const rows = preventionPlans.adoptableActions();
  const dialog = modal.open({
    title: 'Adopt a corrective action',
    sub: 'From a concluded root-cause case — its status is read from there, never copied',
    icon: 'link',
    size: 'lg',
    body: rows.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">Action</th><th scope="col">Case</th><th scope="col">Type</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col"></th></tr></thead>
        <tbody>${rows.map((a) => `
          <tr>
            <td><span class="t-mono-sm">${esc(a.id)}</span><br>${esc(a.action)}</td>
            <td><a class="crumb-link t-mono-sm" href="#/defensio/rca/${esc(a.caseId)}/actions">${esc(a.caseId)}</a><br><span class="t-body-sm">${esc(a.rootCauseId ? denialPatterns.rootCauseLabel(a.rootCauseId) : '')}</span></td>
            <td><span class="badge">${esc(correctiveActions.typeLabel(a.type))}</span></td>
            <td>${esc(staffName(a.row?.ownerId))}</td>
            <td><span class="t-body-sm">${esc(date(a.row?.dueDate))}</span></td>
            <td><span class="badge badge--${correctiveActions.statusTone(a.status)}">${esc(a.status)}</span></td>
            <td>${adopted.includes(a.id) ? '<span class="badge">Adopted</span>' : `<button class="btn btn--primary btn--sm" data-adopt="${esc(a.id)}">Adopt</button>`}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<p class="t-body-sm">No concluded root-cause case has raised an action yet — or the register is not on disk.</p>',
    foot: '<button class="btn btn--secondary" data-close>Cancel</button>',
  });
  dialog.el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-adopt]');
    if (btn) dialog.close(btn.dataset.adopt);
  });
  return dialog.closed;
}
