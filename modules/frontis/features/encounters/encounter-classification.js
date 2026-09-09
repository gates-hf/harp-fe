// The question "who pays for this visit?", asked the same way in both places
// that ask it: step 3 of registration and the Re-classify dialog. The chain as
// radios, the answer the payer gave read back, and the small machine that runs
// the check — reuse a valid one, cascade to the next policy, fall back to
// Self-Pay, or record an override.
//
// The markup is here rather than in encounter-steps.js because the dialog is
// not a step, and a second copy of the chain would be a second set of rules
// about which policy is asked first.

import * as policies from '../../../../data/repositories/policies.js';
import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { conditionsHtml, failuresHtml, resultBadge } from '../eligibility/eligibility-panel.js';
import { runAutoCheck } from '../eligibility/eligibility-check.js';
import { askOverride } from '../eligibility/eligibility-override.js';

/** The policy chain as radios, Self-Pay last — the whole question in one list. */
export function policyChainHtml(mrn, selected) {
  const chain = policies.chain(mrn);
  const row = (value, label, sub) => `
    <label class="rule-child-row">
      <input type="radio" name="policyId" value="${esc(value)}"${value === selected ? ' checked' : ''}>
      <div>
        <div>${label}</div>
        <span class="t-body-sm">${esc(sub)}</span>
      </div>
    </label>`;
  return `
    ${chain.map((p) => row(p.id,
      `${esc(policies.label(p))} <span class="badge">${esc(policies.priorityLabel(p.priority))}</span>`,
      `Member ${p.memberId} · valid to ${date(p.validTo)}`)).join('')}
    ${row('self', 'Self-Pay', chain.length
      ? 'The patient pays, whatever the chain says. Recorded as a decision.'
      : 'No policy on the chain — the patient pays.')}`;
}

/**
 * One eligibility answer, read back. `reuse` marks a snapshot registration found
 * rather than ran, which is what the Reuse · Re-check pair sits under.
 */
export function snapshotCardHtml(snapshot, { reuse = false } = {}) {
  if (!snapshot) return '';
  return `
    <div class="toolbar">
      <span class="t-title-sm">${reuse ? 'Valid check on file' : 'Checked just now'}</span>
      ${resultBadge(snapshot)}
      <span class="t-mono-sm">${esc(snapshot.ref)}</span>
      <span class="t-body-sm">${dateTime(snapshot.checkedAt)}${reuse ? ` · ${esc(snapshot.checkType)}` : ''}</span>
      <span class="spacer"></span>
      ${reuse ? `
        <button class="btn btn--secondary btn--sm" data-act="reuse">Reuse</button>
        <button class="btn btn--secondary btn--sm" data-act="recheck">Re-check</button>` : ''}
      <a class="btn btn--ghost btn--sm" href="#/frontis/eligibility/${esc(snapshot.ref)}">
        <span class="icon icon--sm">open_in_new</span>Snapshot
      </a>
    </div>
    ${failuresHtml(snapshot.failureReasons)}
    ${conditionsHtml(snapshot.conditions)}`;
}

/**
 * The machine behind step 3. It owns four fields of the screen's state —
 * policyId, snapshotRef, overrideRef, reuse — and redraws through the callback
 * it is handed, so the screen keeps one draw().
 */
export function classifier(state, redraw) {
  const snapshot = () => (state.snapshotRef ? eligibility.get(state.snapshotRef) : null);

  /** The policies below the one being tried — what "try the next one" means. */
  const remaining = () => {
    const chain = policies.chain(state.mrn);
    const at = chain.findIndex((p) => p.id === state.policyId);
    return at < 0 ? chain : chain.slice(at + 1);
  };

  /**
   * Choosing a cover asks the payer. A passing check made inside the reuse
   * window is offered rather than repeated — the desk verified this patient an
   * hour ago and nothing has changed since.
   */
  function classify(policyId, { force = false } = {}) {
    state.policyId = policyId === 'self' ? null : policyId;
    state.overrideRef = null;
    const found = force ? null : eligibility.latestValid(state.mrn, state.policyId);
    if (found) {
      state.snapshotRef = found.ref;
      state.reuse = true;
    } else {
      const row = runAutoCheck({
        mrn: state.mrn,
        policyId: state.policyId,
        visitType: encounters.VISIT_TYPE_OF[state.type] || null,
      });
      state.snapshotRef = row?.ref || '';
      state.reuse = false;
    }
    redraw();
  }

  /** A supervisor's answer, recorded beside the system's and never over it. */
  async function override() {
    const row = snapshot();
    if (!row || !(await askOverride(row.ref))) return false;
    state.overrideRef = row.ref;
    redraw();
    return true;
  }

  /**
   * Why the flow cannot go on, or ''. A refused check is not a classification:
   * the encounter opens under an answer, an override, or Self-Pay.
   */
  function blockingReason() {
    const row = snapshot();
    if (!row) return 'Choose who pays. The check runs as soon as you do.';
    if (eligibility.isPass(row.finalResult) || row.finalResult === 'Self-Pay') return '';
    return 'This cover was refused. Try the next policy, use Self-Pay, or record an override.';
  }

  return { snapshot, remaining, classify, override, blockingReason };
}
