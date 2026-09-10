// The account flags as the screens read them: a label, a sentence and a tone
// per flag, and the chips the accounts list, the account header and the Home
// panel draw. The flags themselves are computed and stored by
// data/repositories/accounts.js on every ledger write; this file only says
// what each one means.

import * as accounts from '../../../../data/repositories/accounts.js';
import { esc } from '../../../../shared/format.js';

export const FLAG_LABELS = {
  OutstandingOverThreshold: {
    label: 'Over threshold', tone: 'critical',
    title: 'The patient owes more than the follow-up threshold',
  },
  UnsettledCompleted: {
    label: 'Unsettled', tone: 'warning',
    title: 'A closed visit has sat with a residual of $25 or more past the days the policy allows',
  },
  UnappliedDeposit: {
    label: 'Deposit to apply', tone: 'accent',
    title: 'Money held on a visit that has closed or has nothing left to answer — apply it or refund it',
  },
  ExcessToResolve: {
    label: 'Excess', tone: 'warning',
    title: 'More was taken on a visit than its share — refund it or record the patient’s consent to hold it',
  },
};

export const FLAGS = accounts.FLAGS;

export const flagLabel = (flag) => FLAG_LABELS[flag]?.label || flag;

/** One chip per flag, the sentence in its tooltip. */
export function flagChipsHtml(flags = []) {
  return flags.map((f) => {
    const meta = FLAG_LABELS[f] || { label: f, tone: 'warning', title: f };
    return `<span class="badge badge--${meta.tone}" title="${esc(meta.title)}">${esc(meta.label)}</span>`;
  }).join(' ');
}

/** The Flags filter's options: the flags in use, labelled. */
export const flagOptionsHtml = (selected = '') => `<option value="">Any flag</option>${
  accounts.flagsInUse().map((f) => `<option value="${esc(f)}"${f === selected ? ' selected' : ''}>${esc(flagLabel(f))}</option>`).join('')}`;

export { flagged } from '../../../../data/repositories/accounts.js';
