// Frontis home — the module's landing screen. Everything on it is computed
// live from the repositories: there is no dashboard entity and nothing is
// cached, so a deposit taken in a dialog moves the number behind it on the same
// tick, and switching demo role re-masks the rows that name a payer.

import * as kpis from './home-kpis.js';
import * as attention from './home-attention.js';
import * as quick from './home-quick-actions.js';
import * as activity from '../../../../shared/activity-trail.js';
import { subscribe as onRole } from '../../../../shared/roles.js';

export const meta = { title: 'Frontis' };

const RECENT = 5;

export async function render(mount, ctx) {
  const res = await fetch(new URL('./home.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load home.html (${res.status})`);
  mount.innerHTML = await res.text();

  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    $('#fh-kpis').innerHTML = kpis.kpisHtml();
    $('#fh-attention-top').innerHTML = attention.topHtml();
    $('#fh-attention-bottom').innerHTML = attention.bottomHtml();
    $('#fh-attention-flags').innerHTML = attention.flagsHtml();
    $('#fh-activity').innerHTML = activity.activityHtml(RECENT);
  }

  mount.addEventListener('click', (e) => {
    // A link inside a row is the more specific answer — the MRN opens the
    // record, Convert opens the conversion — and it navigates on its own.
    if (e.target.closest('a')) return;

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) return void quick.handle(act, ctx);

    const go = e.target.closest('[data-go]');
    if (go) ctx.navigate(go.dataset.go);
  });

  mount.addEventListener('keydown', (e) => {
    const go = e.target.closest('[data-go]');
    if (go && e.target === go && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(go.dataset.go);
    }
  });

  // Live on both axes, the way every Frontis list is: anything written in the
  // session redraws the dashboard, and so does a change of demo role.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  draw();
}
