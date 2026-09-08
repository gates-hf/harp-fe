// Contract Performance — #/pactum/performance/contracts/<contract id>. One
// contract version read against its own configuration: what was charged, what
// the payer allowed, where the denials are and which claims came up short.
//
// Every number is a call into data/engines/performance-engine.js, which is why
// the service-line footer equals the cards above it — the same rollup runs over
// a subset of the same claims.

import * as perf from '../../../../data/engines/performance-engine.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import * as handoffs from '../../../../data/repositories/handoffs.js';
import { handOff } from './perf-defensio-handoff.js';
import { bar, columnsLegend, denialBar, denialTone, monthColumns, pct, scoreTone } from './perf-charts.js';
import { usd, date, esc } from '../../../../shared/format.js';
import { metricRailHtml, metricKey } from '../../../../shared/metric-card.js';

export const meta = { title: 'Contract performance' };

export async function render(mount, ctx) {
  const tracked = claims.trackedContracts();
  const wanted = contracts.get(ctx.params[1]);
  const contract = tracked.find((c) => c.id === wanted?.id) || wanted || tracked[0];
  if (!contract) return renderNone(mount);

  const res = await fetch(new URL('./contract-performance.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load contract-performance.html (${res.status})`);
  mount.innerHTML = await res.text();

  const $ = (sel) => mount.querySelector(sel);
  const id = contract.id;

  $('#cp-open').href = `#/pactum/contracts/${id}`;
  $('#cp-legend').innerHTML = columnsLegend();
  ctx.setHeader(`${contract.name} — performance`);

  function draw() {
    const m = perf.contractRollup(id);
    $('#cp-title').textContent = `${contract.name} · v${contract.version}`;
    $('#cp-head').innerHTML = headHtml(contract, m, tracked);
    $('#cp-kpis').innerHTML = kpisHtml(m);
    drawMonths();
    drawReasons();
    drawLines(m);
    drawUnderpayments();
  }

  function drawMonths() {
    const rows = perf.monthlyBilled(id);
    $('#cp-months').innerHTML = rows.some((r) => r.grossBilled)
      ? monthColumns(rows)
      : '<p class="t-body-sm">No claims fell inside this contract\'s term this year.</p>';
  }

  function drawReasons() {
    const rows = perf.denialReasons({ contractId: id });
    const total = rows.reduce((n, r) => n + r.count, 0);
    $('#cp-reasons-note').textContent = total ? `${total} denied claim${total === 1 ? '' : 's'}` : '';
    $('#cp-reasons').innerHTML = rows.length
      ? `<table class="tbl"><tbody>${rows.map(reasonRow).join('')}</tbody></table>`
      : '<p class="t-body-sm">Nothing was denied on this contract this year.</p>';
  }

  function reasonRow(r) {
    return `
      <tr>
        <td>${esc(r.label)}</td>
        <td style="width:45%">${bar({ value: r.share, max: 1, tone: 'critical', width: 160, label: `${r.label} ${pct(r.share, 0)}` })}</td>
        <td class="num t-mono-sm" title="${esc(usd(r.amount))} expected on those claims">${r.count}</td>
        <td class="num t-mono-sm">${pct(r.share, 0)}</td>
      </tr>`;
  }

  function drawLines(m) {
    const lines = perf.serviceLines(id);
    const worst = Math.max(0, ...lines.map((l) => l.metrics.variance));
    $('#cp-lines').innerHTML = lines.map((l) => lineRow(l, worst)).join('');
    $('#cp-lines-foot').innerHTML = lines.length
      ? `<tr>
          <td>Total</td>
          <td class="num t-mono-sm">${m.claims}</td>
          <td class="num t-mono-sm">${esc(usd(m.grossBilled))}</td>
          <td class="num t-mono-sm">${esc(usd(m.allowedPaid))}</td>
          <td class="num t-mono-sm">${pct(m.effectiveRate)}</td>
          <td>${denialBar(m.denialRate)}</td>
          <td class="num t-mono-sm">${esc(usd(m.variance))}</td>
        </tr>`
      : '';
    const empty = $('#cp-lines-empty');
    empty.hidden = lines.length > 0;
    if (!lines.length) empty.innerHTML = stateView('No claims on this contract', 'Nothing has billed under this version inside the reporting period.');
  }

  function lineRow(line, worst) {
    const m = line.metrics;
    const highest = worst > 0 && m.variance === worst;
    return `
      <tr>
        <td>${esc(line.serviceGroup)}</td>
        <td class="num t-mono-sm">${m.claims}</td>
        <td class="num t-mono-sm">${esc(usd(m.grossBilled))}</td>
        <td class="num t-mono-sm">${esc(usd(m.allowedPaid))}</td>
        <td class="num t-mono-sm" title="Contracted target ${pct(m.targetRate)}">${pct(m.effectiveRate)}</td>
        <td>${denialBar(m.denialRate)}</td>
        <td class="num t-mono-sm">${esc(usd(m.variance))}
          ${highest ? '<span class="badge badge--warning" title="Largest variance on this contract"><span class="dot"></span>highest</span>' : ''}
        </td>
      </tr>`;
  }

  function drawUnderpayments() {
    const rows = perf.underpayments(id);
    const open = rows.filter((r) => !r.handoff).length;
    $('#cp-under-note').textContent = rows.length
      ? `${rows.length} flagged · ${open} not handed off`
      : 'Nothing flagged on this contract';
    $('#cp-under').innerHTML = rows.map(underRow).join('');
    $('#cp-under-table').hidden = rows.length === 0;
    const empty = $('#cp-under-empty');
    empty.hidden = rows.length > 0;
    if (!rows.length) {
      empty.innerHTML = stateView(
        'Every paid claim matched the contract',
        `A claim is flagged when the payer allows more than ${usd(perf.CONFIG.flag.floor)} and more than ${pct(perf.CONFIG.flag.pct, 0)} below what this contract prices.`,
      );
    }
  }

  function underRow({ claim, variance, handoff }) {
    return `
      <tr>
        <td class="t-mono-sm">${esc(claim.claimNo)}</td>
        <td class="t-mono-sm">${esc(date(claim.dateOfService))}</td>
        <td>${esc(claims.itemName(claim))}<br><span class="t-body-sm">${esc(claim.serviceGroup)}</span></td>
        <td class="num t-mono-sm">${esc(usd(claim.allowedExpected))}</td>
        <td class="num t-mono-sm">${esc(usd(claim.allowedPaid))}</td>
        <td class="num t-mono-sm">${esc(usd(variance))}</td>
        <td><span class="badge badge--${claims.statusTone(claim.status)}"><span class="dot"></span>${esc(claim.status)}</span></td>
        <td>${handoff ? handoffChip(handoff) : `
          <button class="btn btn--secondary btn--sm" data-act="handoff" data-id="${esc(claim.id)}">
            <span class="icon icon--sm">forward_to_inbox</span>Hand off to Defensio
          </button>`}</td>
      </tr>`;
  }

  function handoffChip(h) {
    const recovered = h.status === 'Recovered' ? ` · ${usd(h.recoveredAmount)} recovered` : '';
    return `<a class="badge badge--${handoffs.statusTone(h.status)}" href="${handoffs.DEFENSIO_PATH}"
      title="${esc(h.status)}${esc(recovered)} — ${esc(h.reason)}. Opens Defensio, which is not built yet"><span class="dot"></span>${esc(h.status)} · Defensio ↗</a>`;
  }

  /** Picker, who the contract is with, and the version chip with its note. */
  function headHtml(c, m, options) {
    return `
      <label class="field">
        <span class="icon icon--sm">contract</span>
        <select id="cp-pick" aria-label="Contract">${pickerHtml(options, c.id)}</select>
      </label>
      <span class="t-title-sm">${esc(contracts.payerName(c))}</span>
      <span class="badge badge--${contracts.statusTone(c.status)}"><span class="dot"></span>${esc(c.status)}</span>
      <span class="t-mono-sm">${esc(c.contractNo)}</span>
      <span class="t-body-sm">${esc(date(c.startDate))} — ${esc(date(c.endDate))}</span>
      <span class="spacer"></span>
      <span class="badge" title="A claim is priced by the version live on its date of service, so one version's figures never borrow another's rates"><span class="dot"></span>v${c.version}</span>
      <span class="t-body-sm">expected amounts use the version active on each date of service</span>
      <span class="badge badge--${scoreTone(m.score)}" title="Calibrated score for this contract"><span class="dot"></span>Score ${m.score}</span>`;
  }

  /**
   * Nothing on this screen is a list of claims, so a card takes the reader to
   * the panel that breaks its number down rather than filtering anything: the
   * rate cards to the service lines, the denial card to the reasons, the
   * variance card to the flagged claims underneath.
   */
  const JUMP = {
    billed: '#cp-months-panel',
    allowed: '#cp-lines-panel',
    rate: '#cp-lines-panel',
    denials: '#cp-reasons-panel',
    variance: '#cp-under-panel',
  };

  function kpisHtml(m) {
    const short = m.effectiveRate < m.targetRate - 0.005;
    return metricRailHtml([
      {
        value: usd(m.grossBilled),
        label: 'Gross billed',
        sub: `${m.claims} claims`,
        title: `Charged under this version, 1 January to today, across ${m.claims} claims — select for the monthly trend`,
        key: 'billed',
      },
      {
        value: usd(m.allowedPaid),
        label: 'Allowed',
        sub: `${m.pending} still pending`,
        title: 'What the payer has allowed on this version — select for the service-line breakdown',
        key: 'allowed',
      },
      {
        value: pct(m.effectiveRate),
        label: 'Effective rate',
        sub: `contracted target ${pct(m.targetRate)}`,
        tone: short ? 'warning' : '',
        title: `Allowed over charged on the ${m.adjudicated} claims the payer has answered — select for the service line behind it`,
        key: 'rate',
      },
      {
        value: pct(m.denialRate),
        label: 'Denial rate',
        sub: `${m.denied} of ${m.adjudicated} adjudicated`,
        tone: denialTone(m.denialRate) === 'critical' ? 'critical' : denialTone(m.denialRate) === 'warning' ? 'warning' : '',
        title: 'Denied claims over adjudicated claims — select for the reasons they were denied',
        key: 'denials',
      },
      {
        value: usd(m.varianceCaptured),
        label: 'Variance captured',
        // The card is one line of footer wide, so the full sentence rides in
        // `title` — the design system's own answer to a longer footer line.
        sub: `${m.handoffs} handed off`,
        title: `Of ${usd(m.variance)} short on paid claims, this much is being chased — ${m.handoffs} claim${m.handoffs === 1 ? '' : 's'} handed off to Defensio. Select for the flagged claims`,
        key: 'variance',
      },
    ]);
  }

  // --- events ---------------------------------------------------------------

  // Delegated: the picker is redrawn with the rest of the header row.
  mount.addEventListener('change', (e) => {
    if (e.target.id === 'cp-pick') ctx.navigate(`/pactum/performance/contracts/${e.target.value}`);
  });

  mount.addEventListener('click', async (e) => {
    const kpi = metricKey(e);
    if (kpi) {
      // The panel takes focus as well as the scroll, so a keyboard reader lands
      // where the card sent it. Focus goes first: moving it cancels a smooth
      // scroll already under way, and then nothing moves at all.
      const panel = mount.querySelector(JUMP[kpi]);
      panel?.focus({ preventScroll: true });
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const btn = e.target.closest('[data-act="handoff"]');
    if (!btn) return;
    const claim = claims.get(btn.dataset.id);
    if (!claim) return;
    await handOff(claim, Math.round((claim.allowedExpected - claim.allowedPaid) * 100) / 100);
  });

  // A hand-off written in the dialog redraws the rail and the row it came from.
  ctx.onData(draw);
  draw();
}

function pickerHtml(rows, selected) {
  const byPayer = new Map();
  for (const row of rows) {
    const name = contracts.payerName(row);
    if (!byPayer.has(name)) byPayer.set(name, []);
    byPayer.get(name).push(row);
  }
  return [...byPayer.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([payer, list]) => `
      <optgroup label="${esc(payer)}">
        ${list.map((c) => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(c.name)} · v${c.version}</option>`).join('')}
      </optgroup>`)
    .join('');
}

function renderNone(mount) {
  mount.innerHTML = `
    <div class="panel"><div class="panel-body">${stateView(
      'No contract has claims yet',
      'Contract performance reads claims against the version that billed them. Activate a contract and the analytics follow.',
      '<a class="btn btn--primary" href="#/pactum/performance">Back to payer performance</a>',
    )}</div></div>`;
}

function stateView(title, body, actions = '') {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">monitoring</span></div>
      <div class="state-view__title">${esc(title)}</div>
      <p class="state-view__body">${esc(body)}</p>
      ${actions ? `<div class="state-view__actions">${actions}</div>` : ''}
    </div>`;
}
