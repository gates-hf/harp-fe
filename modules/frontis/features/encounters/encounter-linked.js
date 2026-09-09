// The Linked Records tab — the point of the encounter entity. Each row is a
// record a later feature creates and hangs off this encounter; until that
// feature lands the row says "None yet" and its Create button is disabled with
// the reason. Nothing here is typed by hand: F5–F10 register through
// encounters.linkRecord() and this tab fills in without changing.

import * as encounters from '../../../../data/repositories/encounters.js';
import { esc } from '../../../../shared/format.js';

/** The five records, in the order the workflow reaches them. */
const LINKS = [
  { kind: 'referral', label: 'Referral', icon: 'forward', feature: 'Referrals' },
  { kind: 'preAuth', label: 'Pre-authorisations', icon: 'gpp_maybe', feature: 'Pre-authorisation' },
  { kind: 'clearance', label: 'Financial clearance', icon: 'assignment_turned_in', feature: 'Clearance' },
  { kind: 'estimate', label: 'Estimates', icon: 'calculate', feature: 'Estimates' },
  { kind: 'account', label: 'Patient account', icon: 'account_balance_wallet', feature: 'Accounts' },
];

/** Two of the five fields are lists, so a kind reads back as ids either way. */
const idsOf = (enc, kind) => {
  const value = enc.linked?.[encounters.LINK_FIELDS[kind]];
  return Array.isArray(value) ? value : value ? [value] : [];
};

/** The tab's badge: how many records hang off this encounter in all. */
export const linkCount = (enc) => LINKS.reduce((n, link) => n + idsOf(enc, link.kind).length, 0);

export function linkedHtml(enc) {
  return `
    <p class="t-body-sm">Everything the rest of the workflow hangs off this encounter. Each is created in its own
      feature and registers itself here — nothing on this tab is typed by hand.</p>
    <table class="tbl">
      <thead><tr><th scope="col">Record</th><th scope="col">Linked</th><th scope="col">Actions</th></tr></thead>
      <tbody>
        ${LINKS.map((link) => {
          const ids = idsOf(enc, link.kind);
          return `
            <tr>
              <td><span class="icon icon--sm">${link.icon}</span> ${esc(link.label)}</td>
              <td class="t-mono-sm">${ids.length ? ids.map(esc).join(', ') : '<span class="t-body-sm">None yet</span>'}</td>
              <td>
                <button class="btn btn--secondary btn--sm" disabled
                        title="Available in a later feature — ${esc(link.feature)} is not built yet">
                  <span class="icon icon--sm">add</span>Create
                </button>
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}
