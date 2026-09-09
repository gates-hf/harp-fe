// The module registry. Manifests are imported eagerly (they are a few lines
// each and the sidebar needs them at boot); every feature behind them is a
// lazy import() declared in the manifest's `routes`.
//
// Adding a module: copy modules/_template, then add one line here.

import pactum from '../modules/pactum/module.js';
import frontis from '../modules/frontis/module.js';
import template from '../modules/_template/module.js';

export const modules = [pactum, frontis, template];

export const byId = new Map(modules.map((m) => [m.id, m]));

/** First screen of the first module — where "/" lands. */
export function homePath() {
  const first = modules[0];
  return `/${first.id}/${first.nav[0].screen}`;
}
