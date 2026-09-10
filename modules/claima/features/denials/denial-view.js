// The denial page at #/claima/denials/<id> — a redirect stub since amendment
// 36. The page is #/defensio/denials/<id> now (a tab id after it carries
// over); this file keeps the old link alive and hands the reader across.
// The panels this page drew — triage-panel.js, resolution-panel.js,
// denial-evidence.js, denial-history.js, denial-actions.js — stay on disk
// unrouted, as the amendment asks; Defensio carries its own copies.

import { redirectTo } from './denials-worklist.js';

export const meta = { title: 'Denial' };

export async function render(mount, ctx) {
  return redirectTo(mount, ctx, `/defensio/denials/${ctx.params.join('/')}`);
}
