// The account page's header: the six figures, the meta line, the actions and
// the banners that explain a number the reader would otherwise have to work out
// for themselves. Markup only — account-view.js owns the state and the events.
//
// It is a file of its own because the page's five panels already fill
// account-tabs.js and account-receipts.js, and the screen has to stay near the
// line cap with them.

import * as accounts from '../../../../data/repositories/accounts.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { esc, usd } from '../../../../shared/format.js';

/**
 * The six figures. Two of them name a slice of the ledger and hold a pressed
 * state — `showing` is the page's answer for whether that slice is on screen —
 * and the rest jump to the tab that breaks the figure down.
 */
export function railHtml(b, showing) {
  return metricRailHtml([
    { value: usd(b.totalCharges), label: 'Total charges', key: 'charges',
      pressed: showing({ type: 'Charge' }), sub: 'at the agreed rates',
      title: 'Everything posted on this account — select the charge rows' },
    { value: usd(b.payerShare), label: 'Payer share', key: 'payer', sub: 'the agreement carries',
      title: 'What the payers are expected to carry — opens the visit-by-visit split' },
    { value: usd(b.patientShare), label: 'Patient share', key: 'patient', tone: 'warning',
      sub: 'the patient carries', title: 'What the patient was left with — opens the visit-by-visit split' },
    { value: usd(b.paid), label: 'Paid', key: 'paid', pressed: showing({ type: 'Payment' }),
      sub: 'received against it', title: 'Money taken on this account — select the payment rows' },
    { value: usd(b.depositsHeld), label: 'Deposits held', key: 'deposits', sub: 'taken, not yet applied',
      title: 'Money held against a visit and not yet put to a charge — opens the deposits' },
    { value: usd(b.outstanding), label: 'Outstanding', key: 'outstanding',
      tone: b.outstanding > 0 ? 'critical' : 'success', sub: 'still owed',
      title: 'Patient share less what has been paid and what a deposit answered — opens the visit breakdown' },
  ]);
}

export function metaHtml(mrn, view, account, b) {
  return `
    <span class="t-mono-sm">${esc(mrn)}</span>
    <span>·</span>
    <span class="badge${account?.status === 'Closed' ? '' : ' badge--success'}">
      <span class="dot"></span>${esc(account?.status || 'Open')}</span>
    ${view?.masked ? '' : `
      <span>·</span>
      <span title="What the patient still owes">${esc(usd(b.outstanding))} outstanding</span>`}
    ${(account?.flags || []).map((f) => `<span class="badge badge--warning">${esc(f)}</span>`).join('')}`;
}

export function actionsHtml(mrn, view, postable) {
  if (view?.masked) {
    return `<button class="btn btn--secondary btn--sm" disabled
              title="A restricted record is read by roles with VIP access only">
              <span class="icon icon--sm">lock</span>Restricted</button>`;
  }
  return `
    <a class="btn btn--ghost btn--sm" href="#/frontis/patients/${esc(mrn)}">
      <span class="icon icon--sm">open_in_new</span>Record
    </a>
    <button class="btn btn--secondary btn--sm" data-act="post"${postable.length ? '' : ' disabled'}
            title="${esc(postable.length ? 'Post charges against one of this patient’s visits'
    : 'This patient has no visit to post charges against')}">
      <span class="icon icon--sm">post_add</span>Post charges
    </button>
    <button class="btn btn--secondary btn--sm" data-act="soa" disabled
            title="The statement of account arrives with reconciliation in part B">
      <span class="icon icon--sm">description</span>Generate SOA
    </button>
    <button class="btn btn--primary btn--sm" data-act="pay">
      <span class="icon icon--sm">payments</span>Record payment
    </button>`;
}

/** The two figures a reader would otherwise have to work out for themselves. */
export function bannersHtml(view, b) {
  if (view?.masked) return '';
  const threshold = accounts.counts().threshold;
  const parts = [];
  if (b.undecided > 0) {
    parts.push(`
      <div class="alert alert--warning">
        <span class="icon">gpp_maybe</span>
        <div><b>Pending approval:</b> ${esc(usd(b.undecided))} of these charges is waiting on the payer, so
          nobody carries it yet — which is why the payer and patient shares do not add up to the total.</div>
      </div>`);
  }
  if (b.credit > 0) {
    parts.push(`
      <div class="alert alert--info">
        <span class="icon">savings</span>
        <div>${esc(usd(b.credit))} of what has been paid is not yet against a charge. It is applied
          automatically as charges are posted.</div>
      </div>`);
  }
  if (b.outstanding > threshold) {
    parts.push(`
      <div class="alert alert--warning">
        <span class="icon">priority_high</span>
        <div>This account is over the ${esc(usd(threshold))} follow-up threshold.</div>
      </div>`);
  }
  return parts.join('');
}
