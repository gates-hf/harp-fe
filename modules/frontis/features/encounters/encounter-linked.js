// The Linked Records tab — the point of the encounter entity. Each row is a
// record a later feature creates and hangs off this encounter; until that
// feature lands the row says "None yet" and its Create button is disabled with
// the reason. Nothing here is typed by hand: F5–F10 register through
// encounters.linkRecord() and this tab fills in without changing.
//
// Estimates, referrals and pre-authorisations are the first of the five to
// land, so those rows read what the tab was always going to read: the ids as
// links, and a Create button that opens the feature already pointed at this
// encounter.

import * as encounters from '../../../../data/repositories/encounters.js';
import * as referrals from '../../../../data/repositories/referrals.js';
import * as clearance from '../../../../data/repositories/clearance.js';
import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as accounts from '../../../../data/repositories/accounts.js';
import { esc, usd } from '../../../../shared/format.js';

/** Where a built feature's record is read and made. The rest wait their turn. */
const LIVE = {
  estimate: {
    href: (id) => `#/frontis/estimates/${id}`,
    create: (enc) => `#/frontis/estimates/new?mrn=${enc.patientMrn}&encounterNo=${enc.no}`,
  },
  // A request opens pre-filled from the visit: its patient, its cover, its
  // doctor and the charges its own eligibility check flagged.
  preAuth: {
    href: (id) => `#/frontis/preauth/${id}`,
    create: (enc) => `#/frontis/preauth/new?mrn=${enc.patientMrn}&encounterNo=${enc.no}`,
    label: 'Request',
    // What the request is, beside its number: where it has got to and what is
    // holding it up.
    detail: (id) => {
      const row = preauth.get(id);
      if (!row) return '';
      const left = preauth.daysLeft(row);
      return `${row.status} · ${preauth.servicesLabel(row)}${
        row.decision?.authNumber ? ` · ${row.decision.authNumber}` : ''}${
        preauth.isAuthorized(row) && left !== null ? ` · ${left} day${left === 1 ? '' : 's'} left` : ''}`;
    },
  },
  // The account is the one record whose id is not its own: it is the patient's
  // MRN, because a patient has one account and every visit posts into it. So
  // the row reads what this visit has cost and what is left on it, and Create
  // is the screen that puts the charges there.
  account: {
    href: (mrn) => `#/frontis/accounts/${mrn}`,
    create: (enc) => `#/frontis/encounters/${enc.no}/post-charges`,
    label: 'Post charges',
    detail: (mrn, enc) => {
      const b = accounts.encounterBalance(mrn, enc.no);
      if (!b.totalCharges) return 'no charge posted on this visit yet';
      return `${usd(b.totalCharges)} charged · ${usd(b.patientShare)} patient · ${usd(b.unpaid)} unpaid`;
    },
  },
  // Creating a referral from a visit is referring out: an inbound one arrives
  // from a clinic and is linked as the encounter is registered.
  referral: {
    href: (id) => `#/frontis/referrals/${id}/view`,
    create: (enc) => `#/frontis/referrals/new?direction=Outbound&mrn=${enc.patientMrn}&encounterNo=${enc.no}`,
    label: 'Refer out',
    // What the referral is, beside its number: who sent it and what is left.
    detail: (id) => {
      const row = referrals.get(id);
      if (!row) return '';
      const left = row.visits.total > 1
        ? ` · ${referrals.remaining(row)} of ${row.visits.total} visits left` : '';
      return `${row.direction} · ${referrals.partiesLabel(row)}${left}`;
    },
  },
};

/** The five records, in the order the workflow reaches them. */
const LINKS = [
  { kind: 'referral', label: 'Referral', icon: 'forward', feature: 'Referrals' },
  { kind: 'preAuth', label: 'Pre-authorisations', icon: 'gpp_maybe', feature: 'Pre-authorisation' },
  // Clearance is the one row with no record to link: it is derived from the
  // other four and lives on the encounter as a stamp, so what it shows is the
  // answer itself and what it offers is the tab that explains it.
  { kind: 'clearance', label: 'Financial clearance', icon: 'assignment_turned_in', derived: true },
  { kind: 'estimate', label: 'Estimates', icon: 'calculate', feature: 'Estimates' },
  { kind: 'account', label: 'Patient account', icon: 'account_balance_wallet', feature: 'Accounts' },
];

/** Two of the five fields are lists, so a kind reads back as ids either way. */
const idsOf = (enc, kind) => {
  // A referral is the one record that can name an encounter without hanging off
  // it: an outbound one is written from the visit rather than answered by it,
  // so the row reads both and only the inbound one sits in linked.referralId.
  if (kind === 'referral') return referrals.forEncounter(enc.no).map((row) => row.no);
  const value = enc.linked?.[encounters.LINK_FIELDS[kind]];
  return Array.isArray(value) ? value : value ? [value] : [];
};

/** The tab's badge: how many records hang off this encounter in all. */
export const linkCount = (enc) =>
  LINKS.reduce((n, link) => n + (link.derived ? 0 : idsOf(enc, link.kind).length), 0);

export function linkedHtml(enc) {
  return `
    <p class="t-body-sm">Everything the rest of the workflow hangs off this encounter. Each is created in its own
      feature and registers itself here — nothing on this tab is typed by hand.</p>
    <table class="tbl">
      <thead><tr><th scope="col">Record</th><th scope="col">Linked</th><th scope="col">Actions</th></tr></thead>
      <tbody>
        ${LINKS.map((link) => (link.derived ? derivedRow(enc, link) : recordRow(enc, link))).join('')}
      </tbody>
    </table>`;
}

const recordRow = (enc, link) => `
  <tr>
    <td><span class="icon icon--sm">${link.icon}</span> ${esc(link.label)}</td>
    <td class="t-mono-sm">${idsHtml(idsOf(enc, link.kind), link.kind, enc)}</td>
    <td>${LIVE[link.kind]
      ? `<a class="btn btn--secondary btn--sm" href="${esc(LIVE[link.kind].create(enc))}">
           <span class="icon icon--sm">add</span>${esc(LIVE[link.kind].label || 'Create')}</a>`
      : `<button class="btn btn--secondary btn--sm" disabled
           title="Available in a later feature — ${esc(link.feature)} is not built yet">
           <span class="icon icon--sm">add</span>Create</button>`}
    </td>
  </tr>`;

/**
 * The derived row. There is no id to show and nothing to create, so the cell
 * carries the answer and its blocking items, and the button opens the checklist
 * the answer was computed from.
 */
function derivedRow(enc, link) {
  const indicator = clearance.indicator(enc);
  const blocking = clearance.stampOf(enc).blocking || [];
  return `
    <tr>
      <td><span class="icon icon--sm">${link.icon}</span> ${esc(link.label)}</td>
      <td>
        <span class="badge${indicator.tone ? ` badge--${indicator.tone}` : ''}"
              title="${esc(indicator.label)}"><span class="dot"></span>${esc(indicator.short)}</span>
        ${blocking.length ? `<br><span class="t-body-sm">${esc(blocking.join('; '))}</span>` : ''}
      </td>
      <td>
        <a class="btn btn--secondary btn--sm" href="#/frontis/encounters/${esc(enc.no)}/clearance">
          <span class="icon icon--sm">rule</span>Open checklist</a>
      </td>
    </tr>`;
}

/** A built feature's records are links; the rest are still bare ids. */
function idsHtml(ids, kind, enc) {
  if (!ids.length) return '<span class="t-body-sm">None yet</span>';
  const live = LIVE[kind];
  if (!live) return ids.map((id) => esc(id)).join(', ');
  return ids
    .map((id) => {
      // The account's detail is about this visit rather than about the record,
      // so it is the one that reads the encounter as well as the id.
      const detail = live.detail ? live.detail(id, enc) : '';
      return `<a class="crumb-link t-mono-sm" href="${esc(live.href(id))}">${esc(id)}</a>${
        detail ? `<br><span class="t-body-sm">${esc(detail)}</span>` : ''}`;
    })
    .join('<br>');
}
