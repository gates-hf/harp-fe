// The fee schedule report at #/pactum/contracts/<id>/fee-report: every active
// charge line priced through the version being viewed, so the whole contract
// can be read in one table. Export Excel writes a CSV the browser downloads;
// Export PDF prints the page, and app.css drops the shell for the printer.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { toast } from '../../../../shared/toast.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { csvLine, download } from './fee-schedule.js';

export const meta = { title: 'Fee schedule report' };

export async function render(mount, ctx) {
  const contract = contracts.get(ctx.params[0]);
  if (!contract) throw new Error(`No contract ${ctx.params[0]}`);

  const res = await fetch(new URL('./fee-report.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load fee-report.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { category: '', method: '', admission: '' };
  const $ = (sel) => mount.querySelector(sel);
  const generatedAt = new Date().toISOString();

  // Prices are read on a date the contract actually covers, so a future draft
  // reports the rates it will bill under rather than falling back to standard.
  const asOf = (() => {
    const now = contracts.today();
    if (contract.startDate && now < contract.startDate) return contract.startDate;
    if (contract.endDate && now > contract.endDate) return contract.endDate;
    return now;
  })();

  ctx.setHeader('Fee schedule report');
  ctx.setCrumb([
    { label: 'Pactum', path: '/pactum/payers' },
    { label: 'Contracts', path: '/pactum/contracts' },
    { label: `${contract.contractNo} v${contract.version}`, path: `/pactum/contracts/${contract.id}` },
    { label: 'Fee schedule report' },
  ]);
  $('#fr-back').href = `#/pactum/contracts/${contract.id}`;

  $('#fr-category').innerHTML =
    '<option value="">All categories</option>' +
    cdm.CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('#fr-method').innerHTML =
    '<option value="">All methodologies</option>' +
    [...contracts.METHODS, 'None'].map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  // Admission type is the one scope level no screen knows on its own: choose it
  // here and Admission Type rows join the precedence walk.
  $('#fr-admission').innerHTML =
    '<option value="">Admission type: none</option>' +
    contracts.ADMISSION_TYPES.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');

  function drawMeta() {
    $('#fr-meta').innerHTML = `
      <dt>Payer</dt><dd>${esc(contracts.payerName(contract))} — ${esc(contracts.payerOf(contract)?.type || '')}</dd>
      <dt>Contract</dt><dd>${esc(contract.contractNo)} — ${esc(contract.name)}</dd>
      <dt>Version</dt><dd>${contract.version} of ${contracts.versionsOf(contract.lineageId).length} · ${esc(contract.status)}</dd>
      <dt>Term</dt><dd class="t-mono-sm">${date(contract.startDate)} – ${date(contract.endDate)}</dd>
      <dt>Rates as of</dt><dd class="t-mono-sm">${date(asOf)}</dd>
      <dt>Admission type</dt><dd>${esc(state.admission || 'None — admission-type rows are skipped')}</dd>
      <dt>Generated</dt><dd class="t-mono-sm">${dateTime(generatedAt)}</dd>`;
  }

  /** Every active charge line — items and bundles — priced through this version. */
  function lines() {
    const admission = state.admission || null;
    return cdm
      .findActive()
      .sort((a, b) => a.chargeCode.localeCompare(b.chargeCode))
      .map((item) => {
        const methodology = contracts.resolveMethodology(contract, item, asOf, admission);
        return {
          item,
          methodology,
          method: methodology?.method || 'None',
          scope: methodology ? contracts.scopeLabel(methodology) : 'Standard price',
          price: contracts.resolvedPrice(contract, item, asOf, admission),
        };
      })
      .filter((line) => !state.category || line.item.category === state.category)
      .filter((line) => !state.method || line.method === state.method);
  }

  function draw() {
    drawMeta();
    const rows = lines();
    $('#fr-count').textContent = `${rows.length} charge line${rows.length === 1 ? '' : 's'}`;
    $('#fr-rows').innerHTML = rows.length
      ? rows.map(rowHtml).join('')
      : '<tr><td colspan="6">No charge line matches these filters.</td></tr>';
  }

  function rowHtml({ item, method, scope, price }) {
    const cut = Number(item.standardPrice) - price;
    return `
      <tr>
        <td class="t-mono-sm">${esc(item.chargeCode)}</td>
        <td>${esc(cdm.label(item))}${cdm.isBundle(item) ? ' <span class="badge badge--accent">Bundle</span>' : ''}</td>
        <td>${esc(item.category)}</td>
        <td class="num t-mono-sm">${usd(item.standardPrice)}</td>
        <td>${esc(method === 'None' ? 'None — standard price' : `${method} · ${scope}`)}</td>
        <td class="num t-mono-sm" title="${cut > 0 ? `${usd(cut)} under standard` : cut < 0 ? `${usd(-cut)} over standard` : 'Standard price'}">
          ${usd(price)}
        </td>
      </tr>`;
  }

  function exportCsv() {
    const header = ['Charge Code', 'Description', 'Category', 'Standard Price', 'Resolved Methodology', 'Contract Price'];
    const body = lines().map(({ item, method, scope, price }) =>
      csvLine([
        item.chargeCode, cdm.label(item), item.category,
        Number(item.standardPrice).toFixed(2),
        method === 'None' ? 'None — standard price' : `${method} · ${scope}`,
        Number(price).toFixed(2),
      ]));
    const title = csvLine([`${contract.contractNo} v${contract.version} — ${contracts.payerName(contract)}`]);
    const stamp = csvLine([`Rates as of ${asOf} · admission type ${state.admission || 'none'}`
      + ` · generated ${generatedAt.slice(0, 16).replace('T', ' ')}`]);
    download(`fee-schedule-${contract.contractNo}-v${contract.version}.csv`,
      [title, stamp, '', header.join(','), ...body].join('\r\n'));
    toast('Fee schedule exported', 'success');
  }

  // --- events ---------------------------------------------------------------

  for (const [id, key] of [['#fr-category', 'category'], ['#fr-method', 'method'], ['#fr-admission', 'admission']]) {
    $(id).addEventListener('change', (e) => {
      state[key] = e.target.value;
      draw();
    });
  }

  mount.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'excel') return exportCsv();
    if (act === 'pdf') {
      toast('Printing — choose Save as PDF in the print dialog', 'info');
      window.print();
    }
  });

  draw();
}
