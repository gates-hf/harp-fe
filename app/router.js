// Hash router. Every screen is deep-linkable: #/<module>/<screen>/<...params>
// Nav is authored as real <a href="#/...">, so middle click and copy-link work.

let handler = null;

export function current() {
  const raw = location.hash.replace(/^#\/?/, '');
  // A screen may be deep-linked pre-filtered: #/pactum/contracts?expiring=60.
  // The query is not part of the path, so nav highlighting and the handoffs
  // features do on ctx.params never see it.
  const cut = raw.indexOf('?');
  const parts = (cut === -1 ? raw : raw.slice(0, cut)).split('/').filter(Boolean);
  return {
    module: parts[0] || null,
    screen: parts[1] || null,
    params: parts.slice(2),
    query: Object.fromEntries(new URLSearchParams(cut === -1 ? '' : raw.slice(cut + 1))),
    path: `/${parts.join('/')}`,
  };
}

export function href(module, screen, ...params) {
  return `#/${[module, screen, ...params].filter(Boolean).join('/')}`;
}

export function navigate(path) {
  const next = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (location.hash === next) {
    handler?.(current());
    return;
  }
  location.hash = next;
}

export function replace(path) {
  location.replace(`#${path.startsWith('/') ? path : `/${path}`}`);
}

export function start(fn) {
  handler = fn;
  addEventListener('hashchange', () => handler(current()));
  handler(current());
}

/** Force the current route through the handler again (after a data reset). */
export function reload() {
  handler?.(current());
}
