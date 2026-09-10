// Capture health at #/claima/charges/health — what the feeds are doing, the
// bed-nights nobody has charged for, and the lines that priced at nothing.
// Everything is computed live off the two repositories and redraws on every
// commit; nothing here decides anything. A gap opens the manual charge with
// the missing room already chosen; a zero-price line opens the charge master
// on its item, or the contract whose rule zeroed it.

import * as charges from '../../../../data/repositories/charges.js';
import * as feeds from '../../../../data/repositories/feeds.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { date, dateTime, esc, relativeTime, usd } from '../../../../shared/format.js';
import { metricRailHtml, metricKey } from '../../../../shared/metric-card.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { openManualCharge } from './manual-charge.js';
import { runFeedsNow } from './feed-simulator.js';

export const meta = { title: 'Capture health' };

export async function render(mount, ctx) {
  const res = await fetch(new URL('./capture-health.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load capture-health.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader('Capture health');
  ctx.setCrumb([
    { label: 'Claima', path: '/claima/home' },
    { label: 'Charges', path: '/claima/charges' },
    { label: 'Capture health' },
  ]);

  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    drawRail();
    drawFeeds();
    drawGaps();
    drawZero();
  }

  function drawRail() {
    const f = feeds.counts();
    const gaps = charges.gaps().length;
    const zero = charges.zeroPrice().length;
    $('#ch-metrics').innerHTML = metricRailHtml([
      { value: f.pending, label: 'Pending events', key: 'feeds', tone: f.pending ? 'accent' : '',
        sub: f.lastRunAt ? `last run ${relativeTime(f.lastRunAt)}` : 'never run',
        title: 'Feed events waiting for a run — jump to the feed status panel' },
      { value: f.failed, label: 'Failed events', key: 'feeds', tone: f.failed ? 'critical' : '',
        sub: `${f.capturedToday} captured today`,
        title: 'Events a run refused, with the reason kept on each — jump to the feed status panel' },
      { value: gaps, label: 'Gaps', key: 'gaps', tone: gaps ? 'warning' : '',
        sub: 'bed-nights without a room charge',
        title: 'Admissions whose nights on the ward outnumber the Room & Board captured — jump to the gaps panel' },
      { value: zero, label: 'Zero-price lines', key: 'zero', tone: zero ? 'critical' : '',
        sub: 'priced at nothing',
        title: 'Lines the charge master or the contract priced at nothing — jump to the panel' },
    ]);
  }

  function drawFeeds() {
    const last = feeds.lastRun();
    $('#ch-lastrun').textContent = last
      ? `Last run ${dateTime(last.at)} — ${last.captured} captured, ${last.failed} failed`
      : 'The feeds have not run yet';
    $('#ch-run').disabled = !feeds.pending().length;
    $('#ch-run').title = feeds.pending().length ? 'Process every pending event' : 'Nothing is waiting in the feeds';

    $('#ch-sources').innerHTML = feeds.bySource().map((s) => `
      <tr>
        <td><span class="badge badge--info">${esc(s.type)}</span> ${esc(s.label)}</td>
        <td class="t-body-sm">${esc(s.triggers.join(', ') || '—')}</td>
        <td class="t-body-sm" title="${esc(s.lastCapturedAt ? dateTime(s.lastCapturedAt) : '')}">${
          s.lastCapturedAt ? esc(relativeTime(s.lastCapturedAt)) : '—'}</td>
        <td class="num t-mono-sm">${s.pending}</td>
        <td class="num t-mono-sm">${s.capturedToday}</td>
        <td class="num t-mono-sm">${s.failed ? `<span class="badge badge--critical">${s.failed}</span>` : '0'}</td>
      </tr>`).join('');

    const failed = feeds.failed();
    $('#ch-failed').innerHTML = failed.length ? `
      <div class="toolbar"><span class="t-title-sm">Failed events</span></div>
      <table class="tbl">
        <thead><tr><th scope="col">Source</th><th scope="col">Reference</th><th scope="col">Encounter</th><th scope="col">Charge</th><th scope="col">Why</th><th scope="col">Actions</th></tr></thead>
        <tbody>${failed.map((ev) => {
    const item = cdm.get(ev.itemId);
    return `
          <tr data-event="${esc(ev.id)}">
            <td><span class="badge badge--info">${esc(ev.type)}</span></td>
            <td class="t-mono-sm">${esc(ev.ref)}</td>
            <td><a class="t-mono-sm" href="#/frontis/encounters/${esc(ev.encounterNo)}">${esc(ev.encounterNo)}</a></td>
            <td>${esc(item ? `${item.chargeCode} — ${cdm.label(item)}` : ev.itemId)}</td>
            <td><span class="badge badge--critical" title="${esc(ev.error || '')}">${esc(ev.error || 'Refused')}</span></td>
            <td>
              ${item ? `<a class="btn btn--ghost btn--sm" href="#/pactum/cdm/${esc(item.id)}" title="Open ${esc(item.chargeCode)} in the charge master">
                <span class="icon icon--sm">open_in_new</span>Open in CDM</a>` : ''}
              <button class="btn btn--ghost btn--sm" data-act="retry" title="Put the event back in the queue for the next run">
                <span class="icon icon--sm">replay</span>Retry
              </button>
            </td>
          </tr>`;
  }).join('')}</tbody>
      </table>` : '';
  }

  function drawGaps() {
    const gaps = charges.gaps();
    const role = currentRole();
    $('#ch-gaps-count').textContent = gaps.length ? `${gaps.length} admission${gaps.length === 1 ? '' : 's'}` : '';
    $('#ch-gaps-body').innerHTML = gaps.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">Encounter</th><th scope="col">Signal</th><th scope="col">Missing</th><th scope="col">Actions</th></tr></thead>
        <tbody>${gaps.map((g) => {
    const patient = patients.view(patients.get(g.encounter.patientMrn), role);
    const pending = feeds.pendingFor(g.encounterNo).filter((ev) => cdm.get(ev.itemId)?.category === 'Room & Board').length;
    return `
          <tr data-no="${esc(g.encounterNo)}" data-item="${esc(g.item?.id || '')}">
            <td><a class="t-mono-sm" href="#/frontis/encounters/${esc(g.encounterNo)}">${esc(g.encounterNo)}</a>
              <br><span class="t-body-sm">${esc(patient?.nameEn || g.encounter.patientMrn)} · ${esc(g.encounter.department)}</span></td>
            <td class="t-body-sm" title="Admitted ${esc(dateTime(g.encounter.startAt))}${g.encounter.endAt ? `, discharged ${esc(dateTime(g.encounter.endAt))}` : ''}">${esc(g.signal)}</td>
            <td><span class="badge badge--warning" title="${esc(g.item ? cdm.label(g.item) : '')}">${esc(g.missingLabel)}</span>${
              pending ? ` <span class="t-body-sm" title="A census event for this visit is waiting for the next run">feed pending</span>` : ''}</td>
            <td>
              <button class="btn btn--ghost btn--sm" data-act="fill-gap" title="Capture the missing night by hand">
                <span class="icon icon--sm">add_card</span>Manual charge
              </button>
              <a class="btn btn--ghost btn--sm" href="#/claima/charges?encounter=${esc(g.encounterNo)}" title="Open the visit's unreleased lines">
                <span class="icon icon--sm">list</span>Lines
              </a>
            </td>
          </tr>`;
  }).join('')}</tbody>
      </table>` : `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">hotel</span></div>
        <div class="state-view__title">Every night is charged</div>
        <p class="state-view__body">No admission has spent a night on the ward without a Room & Board line to show for it.</p>
      </div>`;
  }

  function drawZero() {
    const lines = charges.zeroPrice();
    const role = currentRole();
    $('#ch-zero-count').textContent = lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : '';
    $('#ch-zero-body').innerHTML = lines.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">Charge</th><th scope="col">Encounter</th><th scope="col">Why</th><th scope="col">Actions</th></tr></thead>
        <tbody>${lines.map((line) => {
    const item = cdm.get(line.itemId);
    const enc = encounters.get(line.encounterNo);
    const patient = patients.view(patients.get(line.patientMrn), role);
    const trace = line.pricing.trace || {};
    const fromContract = item && Number(item.standardPrice) > 0 && trace.contractId;
    return `
          <tr>
            <td><span class="t-mono-sm">${esc(item?.chargeCode || line.itemId)}</span> ${esc(cdm.label(item) || '')}
              <br><span class="t-body-sm">×${esc(line.qty)} on ${esc(date(line.dateOfService))} · ${esc(usd(line.pricing.gross))} gross ·
                <span class="badge badge--${charges.statusTone(line.status)}">${esc(line.status)}</span></span></td>
            <td><a class="t-mono-sm" href="#/frontis/encounters/${esc(line.encounterNo)}">${esc(line.encounterNo)}</a>
              <br><span class="t-body-sm">${esc(patient?.nameEn || line.patientMrn)}${enc ? ` · ${esc(enc.department)}` : ''}</span></td>
            <td class="t-body-sm">${esc(charges.zeroPriceReason(line))}</td>
            <td>
              ${item ? `<a class="btn btn--ghost btn--sm" href="#/pactum/cdm/${esc(item.id)}" title="Open ${esc(item.chargeCode)} in the charge master">
                <span class="icon icon--sm">open_in_new</span>Open in CDM</a>` : ''}
              ${fromContract ? `<a class="btn btn--ghost btn--sm" href="#/pactum/contracts/${esc(trace.contractId)}/rules" title="Open the rules of ${esc(trace.contractNo)} v${esc(trace.version)}">
                <span class="icon icon--sm">gavel</span>Rules</a>` : ''}
              ${charges.isUnreleased(line) ? `<a class="btn btn--ghost btn--sm" href="#/claima/charges?encounter=${esc(line.encounterNo)}" title="Open the visit's unreleased lines">
                <span class="icon icon--sm">list</span>Lines</a>` : ''}
            </td>
          </tr>`;
  }).join('')}</tbody>
      </table>` : `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">price_check</span></div>
        <div class="state-view__title">Every line has a price</div>
        <p class="state-view__body">Nothing captured has priced at nothing, under the charge master or under a contract.</p>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const kpi = metricKey(e);
    if (kpi) return jump(kpi);

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'run-feeds') return runFeedsNow();
    if (act === 'retry') {
      const id = e.target.closest('tr[data-event]')?.dataset.event;
      const ev = feeds.retry(id);
      toast(ev ? `${ev.ref} back in the queue` : 'The event could not be retried', ev ? 'success' : 'critical');
      return undefined;
    }
    if (act === 'fill-gap') {
      const tr = e.target.closest('tr[data-no]');
      const gap = charges.gaps().find((g) => g.encounterNo === tr.dataset.no);
      return openManualCharge({
        encounterNo: tr.dataset.no,
        itemId: tr.dataset.item,
        qty: gap?.missing || 1,
        dateOfService: gap?.encounter.endAt ? gap.encounter.endAt.slice(0, 10) : undefined,
      });
    }
    return undefined;
  });

  /** Focus first, then scroll — moving focus after cancels a smooth scroll. */
  function jump(key) {
    const panel = $(`#ch-${key}`);
    if (!panel) return;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}
