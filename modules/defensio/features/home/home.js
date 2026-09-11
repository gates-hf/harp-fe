// Defensio home at #/defensio (and /home) — the module's landing dashboard,
// amendment 43, replacing the placeholder amendment 36 bootstrapped with. The
// Claima dashboard's shape: six KPI cards, four attention tables, the trail's
// Defensio half, five quick actions in the panel header.
//
// Everything on it is read from the helpers the feature sessions published
// in modules/defensio/COORDINATION.md — there is no dashboard entity, nothing
// is cached and nothing is computed here. A card's number is the row count
// of the screen it opens, and home-reconcile.js asserts exactly that on every
// draw, so a demo can click through and reconcile. A change of demo role
// redraws the page: the accountability rows and the trail mask by role.

import * as kpis from './home-kpis.js';
import * as attention from './home-attention.js';
import * as quick from './home-quick-actions.js';
import { reconcile } from './home-reconcile.js';
import * as activity from '../../../../shared/activity-trail.js';
import { subscribe as onRole } from '../../../../shared/roles.js';

export const meta = { title: 'Defensio' };

const RECENT = 5;

/** The trail's Defensio half — what `#/pactum/activity?module=defensio` lists. */
const ENTITIES = activity.entitiesOf('defensio');

export async function render(mount, ctx) {
  const res = await fetch(new URL('./home.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load home.html (${res.status})`);
  mount.innerHTML = await res.text();

  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const cards = kpis.cards();
    $('#dh-header').innerHTML = quick.headerHtml();
    $('#dh-kpis').innerHTML = kpis.railHtml(cards);
    $('#dh-attention-top').innerHTML = attention.topHtml();
    $('#dh-attention-bottom').innerHTML = attention.bottomHtml();
    $('#dh-activity').innerHTML = activity.activityHtml(RECENT, { entities: ENTITIES });
    // The numbers-reconcile rule made executable: each card against the
    // dataset of the worklist it opens, read through that screen's own helper.
    reconcile(cards);
  }

  mount.addEventListener('click', (e) => {
    // A link inside a row is the more specific answer — the claim number
    // opens the claim, the case id the case — and it navigates on its own.
    if (e.target.closest('a')) return;
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

  // Live on both axes, the way every Defensio list is: anything written in
  // the session redraws the dashboard, and so does a change of demo role.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  draw();

  // The registers seed on first read behind one another; the first draw may
  // land before the last of them has settled, so redraw once they have.
  kpis.whenSettled().then(() => { if (mount.isConnected) draw(); });
}
