// Defensio home at #/defensio (and /home) — the placeholder amendment 36
// bootstraps the module with; the dashboard (F0) replaces it last. Four
// cards read the register live and open the worklist on the slice they
// count, the KPI-card rule; the rest of the page says what is coming.

import * as denials from '../../../../data/repositories/denials.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { usd } from '../../../../shared/format.js';

export const meta = { title: 'Home' };

export async function render(mount, ctx) {
  const res = await fetch(new URL('./home.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load home.html (${res.status})`);
  mount.innerHTML = await res.text();

  function draw() {
    const c = denials.counts();
    mount.querySelector('#dh-metrics').innerHTML = metricRailHtml([
      { value: c.untriaged, label: 'Untriaged', tone: c.untriaged ? 'critical' : '', href: '#/defensio/denials?status=Untriaged',
        sub: c.nearDeadline ? `${c.nearDeadline} near the appeal deadline` : 'none near the appeal deadline',
        title: 'Denials nobody has given a category, a tier and a separation yet. Opens the worklist on them' },
      { value: usd(c.openValue), label: 'Open value', tone: c.openValue ? 'warning' : '', href: '#/defensio/denials?slice=open',
        sub: `${c.open} open denial${c.open === 1 ? '' : 's'}`, title: 'What is still open across every unresolved denial. Opens the worklist on the open ones' },
      { value: usd(c.recoveredMtd.amount), label: 'Recovered MTD', tone: c.recoveredMtd.amount ? 'success' : '', href: '#/defensio/denials?slice=recovered',
        sub: `${c.recoveredMtd.count} resolved this month`, title: 'Money recovered on denials resolved this month' },
      { value: usd(c.reclassifiedMtd.amount), label: 'Separated out MTD', href: '#/defensio/denials?slice=reclassified',
        sub: `${c.reclassifiedMtd.count} reclassified this month`, title: 'Contractual adjustments and TPA fees separated out this month — money that was never a denial' },
    ]);
  }

  ctx.onData(draw);
  denials.peersReady.then(() => { if (mount.isConnected) draw(); });
  draw();
}
