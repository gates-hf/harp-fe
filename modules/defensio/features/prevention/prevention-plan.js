// The Defensio prevention-plan page at #/defensio/prevention/plans/<id>
// (a tab id after it) and the new-plan form at /plans/new (?pattern=,
// ?cause= prefill the first target): the banner with the plan's chips and
// the actions its status allows — each carrying the repository's own gate in
// its tooltip — the Draft → Active → In measurement → Closed stepper, the
// summary in the bounded pane (targets, the frozen baseline, the window,
// owner and sponsor) and the tabs beside it: Targets, Actions, Evidence,
// Measurement, History. Each tab draws into a node of its own and binds its
// own listener, so both retire when the page redraws it.

import * as preventionPlans from '../../../../data/repositories/prevention-plans.js';
import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { ownerHtml, planStatusHtml, targetsHtml, verdictHtml } from './prevention-chips.js';
import { renderActions, renderEvidence, renderHistory, renderMeasurement, renderTargets } from './plan-tabs.js';
import { openActivateDialog, openCancelDialog, openCloseDialog, openEditDialog, openStartMeasurementDialog, staffOptions } from './plan-dialogs.js';
import { openTargetPicker } from './plan-pickers.js';

export const meta = { title: 'Prevention plan' };

const TABS = [
  { id: 'targets', label: 'Targets', render: renderTargets },
  { id: 'actions', label: 'Actions', render: renderActions },
  { id: 'evidence', label: 'Evidence', render: renderEvidence },
  { id: 'measurement', label: 'Measurement', render: renderMeasurement },
  { id: 'history', label: 'History', render: renderHistory },
];
const STEPS = [
  { id: 'Draft', label: 'Draft' }, { id: 'Active', label: 'Active' }, { id: 'InMeasurement', label: 'In measurement' }, { id: 'Closed', label: 'Closed' },
];

export async function render(mount, ctx) {
  const id = ctx.params[1];
  if (!id) return ctx.navigate('/defensio/prevention');
  const res = await fetch(new URL('./prevention-plan.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load prevention-plan.html (${res.status})`);
  mount.innerHTML = await res.text();
  return id === 'new' ? renderNew(mount, ctx) : renderPlan(mount, ctx, id);
}

// --- the new-plan form ----------------------------------------------------------------------

function renderNew(mount, ctx) {
  const $ = (sel) => mount.querySelector(sel);
  const targets = [];
  if (ctx.query?.pattern && denialPatterns.get(ctx.query.pattern)) targets.push({ type: 'pattern', ref: ctx.query.pattern });
  if (ctx.query?.cause && denialPatterns.rootCause(ctx.query.cause)) targets.push({ type: 'cause', ref: ctx.query.cause });
  ctx.setHeader('New prevention plan');
  ctx.setCrumb([{ label: 'Defensio', path: '/defensio/prevention' }, { label: 'Prevention', path: '/defensio/prevention' }, { label: 'New plan' }]);
  $('#pl-id').textContent = 'New prevention plan';
  $('#pl-meta').innerHTML = '<span class="badge">Draft</span> <span class="t-body-sm">A plan is a draft until it is activated; activation freezes the baseline.</span>';
  $('#pl-actions').innerHTML = '<a class="btn btn--secondary btn--sm" href="#/defensio/prevention"><span class="icon icon--sm">arrow_back</span>Back</a>';
  $('#pl-stepper').innerHTML = stepperHtml({ status: 'Draft' });
  const suggested = targets[0]?.type === 'pattern' ? `Stop ${denialPatterns.labelOf(denialPatterns.get(targets[0].ref)).toLowerCase()} denials` : targets[0]?.type === 'cause' ? `Prevent: ${denialPatterns.rootCauseLabel(targets[0].ref)}` : '';
  $('#pl-body').innerHTML = `
    <div class="split">
      <div>
        <div class="panel">
          <div class="panel-header"><span>The plan</span></div>
          <div class="panel-body">
            <label class="field"><span class="icon icon--sm">title</span><input id="pn-title" value="${esc(suggested)}" placeholder="Title" aria-label="Title" maxlength="140" autofocus></label>
            <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="pn-desc" rows="5" placeholder="What the plan changes and why" aria-label="Description" maxlength="800"></textarea></label>
            <label class="field"><span class="icon icon--sm">person</span><select id="pn-owner" aria-label="Owner">${staffOptions(currentRole().id)}</select></label>
            <label class="field"><span class="icon icon--sm">supervisor_account</span><select id="pn-sponsor" aria-label="Sponsor">${staffOptions('exec', { none: 'No sponsor' })}</select></label>
            <div id="pn-error"></div>
          </div>
        </div>
      </div>
      <div>
        <div class="panel">
          <div class="panel-header">
            <span>Targets</span><span class="badge" id="pn-count">${targets.length}</span>
            <span class="spacer"></span>
            <button class="btn btn--secondary btn--sm" data-act="add-target"><span class="icon icon--sm">add</span>Add target</button>
          </div>
          <div class="panel-body" id="pn-targets"></div>
        </div>
        <div class="panel">
          <div class="panel-body">
            <div class="toolbar">
              <span class="t-body-sm">Create the draft, then raise its actions and adopt what a root-cause case already decided. Activation freezes the baseline from the register.</span>
              <span class="spacer"></span>
              <button class="btn btn--primary" data-act="create"><span class="icon icon--sm">add_task</span>Create plan</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  function drawTargets() {
    $('#pn-count').textContent = targets.length;
    $('#pn-targets').innerHTML = targets.length ? `<table class="tbl"><tbody>${targets.map((t, i) => `
      <tr><td><span class="badge">${esc(preventionPlans.TARGET_LABELS[t.type])}</span></td><td>${esc(preventionPlans.targetLabel(t))}<br><span class="t-mono-sm">${esc(t.ref)}</span></td><td><button class="btn btn--ghost btn--sm" data-act="remove-target" data-index="${i}" title="Remove"><span class="icon icon--sm">close</span></button></td></tr>`).join('')}</tbody></table>`
      : '<p class="t-body-sm">No target yet — a pattern, a root cause or a corrective action. A plan activates with at least one.</p>';
  }
  drawTargets();
  mount.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add-target') { const t = await openTargetPicker({ picked: targets }); if (t) { targets.push(t); drawTargets(); } }
    if (act === 'remove-target') { targets.splice(Number(e.target.closest('[data-index]').dataset.index), 1); drawTargets(); }
    if (act === 'create') {
      const r = preventionPlans.create({ title: $('#pn-title').value, description: $('#pn-desc').value, targets, ownerId: $('#pn-owner').value || null, sponsorId: $('#pn-sponsor').value || null });
      if (r?.error) { $('#pn-error').innerHTML = `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(r.error)}</div></div>`; return; }
      toast(`${r.id} created`);
      ctx.navigate(`/defensio/prevention/plans/${r.id}/actions`);
    }
  });
  return undefined;
}

// --- the plan page --------------------------------------------------------------------------

function renderPlan(mount, ctx, id) {
  const first = preventionPlans.get(id);
  if (!first) throw new Error(`No prevention plan ${id}`);
  const state = { tab: TABS.some((t) => t.id === ctx.params[2]) ? ctx.params[2] : 'actions' };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const row = preventionPlans.get(id);
    if (!row) return;
    ctx.setHeader(`${row.id} — ${preventionPlans.statusLabel(row.status)}`);
    ctx.setCrumb([{ label: 'Defensio', path: '/defensio/prevention' }, { label: 'Prevention', path: '/defensio/prevention' }, { label: row.id }]);
    $('#pl-id').textContent = row.title;
    $('#pl-meta').innerHTML = `
      <span class="t-mono-sm">${esc(row.id)}</span> ${planStatusHtml(row)}
      <span>·</span> ${targetsHtml(row)}
      <span>·</span> <span class="t-body-sm">owner ${ownerHtml(row.ownerId)}${row.sponsorId ? ` · sponsor ${ownerHtml(row.sponsorId)}` : ''} · created ${date(row.createdAt)} by ${esc(row.createdBy)}</span>`;
    $('#pl-actions').innerHTML = actionsHtml(row);
    $('#pl-banners').innerHTML = bannersHtml(row);
    $('#pl-stepper').innerHTML = stepperHtml(row);
    $('#pl-body').innerHTML = `
      <div class="split">
        <div>
          <div class="panel">
            <div class="panel-header"><span>Summary</span><span class="spacer"></span>${verdictHtml(row.measurement?.result)}</div>
            <div class="panel-body" id="pl-summary"></div>
          </div>
        </div>
        <div>
          <div class="panel">
            <div class="panel-header">
              <span>${esc(row.title)}</span>
              <span class="spacer"></span>
              <a class="btn btn--secondary btn--sm" href="#/defensio/prevention"><span class="icon icon--sm">arrow_back</span>Back to prevention</a>
            </div>
            <div class="sections" id="pl-tabs" role="tablist"></div>
            <div class="panel-body" id="pl-panel"></div>
          </div>
        </div>
      </div>`;
    $('#pl-summary').innerHTML = summaryHtml(row);
    $('#pl-tabs').innerHTML = TABS.map((t) => `<button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab" aria-selected="${t.id === state.tab}" data-tab="${t.id}">${t.label}</button>`).join('');
    const host = document.createElement('div');
    $('#pl-panel').replaceChildren(host);
    (TABS.find((t) => t.id === state.tab) || TABS[0]).render(host, { id, redraw: draw, ctx });
  }

  function summaryHtml(row) {
    const b = row.baseline;
    const w = preventionPlans.windowOf(row);
    return `
      ${row.description ? `<p class="t-body-sm">${esc(row.description)}</p>` : ''}
      <dl class="dl dl--narrow">
        <dt>Targets</dt><dd>${row.targets.length ? row.targets.map((t) => `${esc(preventionPlans.targetLabel(t))}<br>`).join('') : '<span class="t-body-sm">None yet</span>'}</dd>
        <dt>Baseline</dt><dd>${b ? `<span class="t-mono-sm">${esc(usd(b.value))}</span> <span class="t-body-sm">· ${b.count} denial${b.count === 1 ? '' : 's'}</span><br><span class="t-body-sm">frozen ${esc(date(b.computedAt))} over the ${b.windowDays} days before${b.note ? ` — ${esc(b.note)}` : ''}</span>` : '<span class="t-body-sm">Frozen at activation from the register</span>'}</dd>
        <dt>Window</dt><dd>${w ? `<span class="t-body-sm">${esc(date(w.from))} – ${esc(date(w.to))} · ${w.days} days</span>` : `<span class="t-body-sm">${row.measurement?.windowDays || preventionPlans.measurementDays()} days from the day measurement starts</span>`}</dd>
        <dt>Owner</dt><dd>${ownerHtml(row.ownerId)}</dd>
        <dt>Sponsor</dt><dd>${ownerHtml(row.sponsorId)}</dd>
        ${row.activatedAt ? `<dt>Activated</dt><dd><span class="t-body-sm">${esc(dateTime(row.activatedAt))}</span></dd>` : ''}
        ${row.measurement?.closedAt ? `<dt>Closed</dt><dd><span class="t-body-sm">${esc(dateTime(row.measurement.closedAt))} by ${esc(row.measurement.closedBy || '')}</span></dd>` : ''}
        ${row.cancelled ? `<dt>Cancelled</dt><dd><span class="t-body-sm">${esc(dateTime(row.cancelled.at))} — ${esc(row.cancelled.reason)}</span></dd>` : ''}
      </dl>`;
  }

  function actionsHtml(row) {
    if (!preventionPlans.isOpen(row)) return `<span class="badge badge--${preventionPlans.statusTone(row.status)}">${esc(preventionPlans.statusLabel(row.status))}</span>`;
    const activate = preventionPlans.activateBlockers(row);
    const measure = preventionPlans.measurementBlockers(row);
    const close = preventionPlans.closeBlockers(row);
    const gated = (blockers, ok) => (blockers.length ? ` aria-disabled="true" title="${esc(blockers.join(' '))}"` : ` title="${esc(ok)}"`);
    return `
      <button class="btn btn--secondary btn--sm" data-act="edit" title="Title, description, owner, sponsor"><span class="icon icon--sm">edit</span>Edit</button>
      ${row.status === 'Draft' ? `<button class="btn btn--primary btn--sm" data-act="activate"${gated(activate, 'Freeze the baseline and put the plan in force')}><span class="icon icon--sm">play_arrow</span>Activate</button>` : ''}
      ${row.status === 'Active' ? `<button class="btn btn--primary btn--sm" data-act="measure"${gated(measure, 'Every action is done — start the window')}><span class="icon icon--sm">timer</span>Start measurement</button>` : ''}
      ${row.status === 'InMeasurement' ? `<button class="btn btn--primary btn--sm" data-act="close"${gated(close, 'Close the plan on the verdict')}><span class="icon icon--sm">lock</span>Close</button>` : ''}
      <button class="btn btn--ghost btn--sm" data-act="cancel" title="Drop the plan with a reason"><span class="icon icon--sm">block</span>Cancel</button>`;
  }

  function bannersHtml(row) {
    const out = [];
    const overdue = preventionPlans.overdueActions(row);
    if (overdue.length) out.push(alert('critical', 'timer_off', `${overdue.length} action${overdue.length === 1 ? '' : 's'} past due`, overdue.map((a) => `${a.id} · ${a.text} — due ${date(a.dueDate)}`).join(' · ')));
    const bare = (row.actions || []).filter(preventionPlans.doneWithoutEvidence);
    if (bare.length && preventionPlans.isOpen(row)) out.push(alert('warning', 'priority_high', 'Done without evidence', `${bare.map((a) => a.id).join(', ')} ${bare.length === 1 ? 'was' : 'were'} marked done with nothing attached — attach a note or a file on the Actions tab.`));
    if (row.status === 'InMeasurement' && preventionPlans.pastWindow(row)) out.push(alert('info', 'timer', 'The measurement window has passed', `${row.measurement.result ? `${row.measurement.result.verdict} so far — ` : ''}close the plan on the verdict.`));
    if (row.status === 'Draft') out.push(alert('info', 'edit_note', 'A draft', 'Name the targets and raise the actions, then activate: the baseline freezes from the register that day and the targets with it.'));
    if (row.status === 'ClosedIneffective' && row.measurement?.decision) out.push(alert('warning', row.measurement.decision.kind === 'reopen' ? 'restart_alt' : 'troubleshoot', row.measurement.decision.kind === 'reopen' ? `Reopened as ${row.measurement.decision.ref || 'a new draft'}` : `Escalated${row.measurement.decision.ref ? ` to ${row.measurement.decision.ref}` : ''}`, row.measurement.decision.note || 'The plan did not move the pattern.'));
    return out.join('');
  }
  const alert = (tone, icon, title, body) => `<div class="alert alert--${tone}"><span class="icon">${icon}</span><div><div class="title">${esc(title)}</div>${esc(body)}</div></div>`;

  mount.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; return draw(); }
    const btn = e.target.closest('#pl-actions [data-act]');
    if (!btn) return undefined;
    const act = btn.dataset.act;
    if (act === 'edit') await openEditDialog(id);
    if (act === 'activate') await openActivateDialog(id);
    if (act === 'measure') await openStartMeasurementDialog(id);
    if (act === 'close') await openCloseDialog(id);
    if (act === 'cancel') await openCancelDialog(id);
    return undefined;
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
  return undefined;
}

function stepperHtml(row) {
  const closed = row.status.startsWith('Closed');
  const cancelled = row.status === 'Cancelled';
  const reached = closed ? 3 : Math.max(0, STEPS.findIndex((s) => s.id === row.status));
  return STEPS.map((s, i) => {
    const done = i < reached || (closed && i === 3);
    const cls = done ? 'stepper__step--done' : i === reached && !cancelled ? 'stepper__step--current' : cancelled ? 'stepper__step--blocked' : '';
    const label = s.id === 'Closed' && closed ? preventionPlans.statusLabel(row.status) : s.label;
    return `<span class="stepper__step ${cls}" aria-current="${i === reached && !cancelled ? 'step' : 'false'}"><span class="stepper__n">${done ? '✓' : cancelled ? '!' : i + 1}</span><span class="stepper__label">${esc(label)}</span></span>${i < STEPS.length - 1 ? '<span class="stepper__line"></span>' : ''}`;
  }).join('');
}
