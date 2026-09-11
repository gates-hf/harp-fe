// Defensio tab registry (amendment 39). A screen built by one session can
// carry a tab built by another without either importing the other's feature
// folder: the owner reads `tabsFor(screen)` and draws each entry after its
// own tabs, and the contributor adds one registration line here. A tab is
// `{ id, label, order, load }`, where `load()` is a dynamic import of a module
// exporting `render(host, ctx)`; the owner calls it into a fresh host node.
//
// Screens: 'appeal-case' — amendment 38's case view at #/defensio/appeals/<id>
// (ctx = { caseId, redraw }). Add a screen by naming it in a registration.

const registry = new Map();

export function registerTab(screen, tab) {
  const list = registry.get(screen) || [];
  if (!list.some((t) => t.id === tab.id)) list.push({ order: 100, ...tab });
  registry.set(screen, list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)));
}

export const tabsFor = (screen) => [...(registry.get(screen) || [])];

// --- registrations (one line per session) ---
// A39: the appeal case's Tracking & outcome tab — response clock, follow-ups, the payer's decision, the recoveries and the close.
registerTab('appeal-case', { id: 'tracking', label: 'Tracking & outcome', order: 10, load: () => import('./features/appeal-tracking/tracking-tab.js') });
