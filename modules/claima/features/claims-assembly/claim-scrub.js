// The Scrub tab of the claim page: the latest run grouped by category, each
// finding with its severity and a jump to where it is read, acknowledge on a
// warning, and Run scrub. It owns its own node and its own listener;
// claim-view.js hands it a div, a redraw and the jump function.

import * as claims from '../../../../data/repositories/claims.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { askAcknowledge, runScrub } from './claim-actions.js';

const ICONS = {
  Completeness: 'checklist', Financial: 'payments', Authorization: 'verified_user', Referral: 'forward',
  Documentation: 'description', 'Code Logic': 'medical_information',
};

/** render(host, { id, redraw, jumpTo }) */
export function render(host, { id, redraw, jumpTo }) {
  function draw() {
    const row = claims.get(id);
    const run = claims.latestScrub(row);
    const valid = Boolean(row.scrubValid && run);
    const draft = row.status === 'Draft';
    const acked = new Set((run?.acknowledgments || []).map((a) => a.findingId));
    const role = currentRole();
    host.innerHTML = `
      <div class="toolbar">
        <span class="t-title-sm">Scrub</span>
        ${run ? `<span class="badge badge--${valid ? claims.scrubTone(run.result) : ''}"><span class="dot"></span>${valid ? esc(run.result) : 'Voided'}</span>
          <span class="t-body-sm">${valid ? 'run' : 'last run'} ${dateTime(run.at)} by ${esc(run.by)}${run.contractNo ? ` · ${esc(run.contractNo)} v${esc(run.contractVersion)}` : ''}</span>` : '<span class="badge">Not run</span>'}
        <span class="spacer"></span>
        <button class="btn btn--primary btn--sm" data-act="run"${draft ? '' : ' disabled'} title="${draft ? 'Run the six-category scrub' : 'A Ready claim is locked — reopen it to scrub again'}">
          <span class="icon icon--sm">fact_check</span>${run ? 'Run again' : 'Run scrub'}</button>
      </div>
      ${run ? bodyHtml(row, run, valid, acked, role) : introHtml()}
      ${(row.scrubRuns || []).length > 1 ? historyHtml(row) : ''}`;
  }

  function introHtml() {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">fact_check</span></div>
        <div class="state-view__title">Not scrubbed yet</div>
        <p class="state-view__body">The scrub checks six things: the header is complete, the money reconciles and matches the contract today,
          every authorisation the contract requires is on file and in date, the referral is there when the payer asks,
          the documents the contract names are attached, and the coding holds together. An error blocks finalizing; a
          warning can be acknowledged with a reason.</p>
        <div class="state-view__actions"><button class="btn btn--primary" data-act="run">Run scrub</button></div>
      </div>`;
  }

  function bodyHtml(row, run, valid, acked, role) {
    if (!valid) {
      return `
        <div class="alert alert--warning"><span class="icon">sync_problem</span>
          <div>This run was voided — the claim changed after it. Run the scrub again before finalizing.</div></div>
        ${groupsHtml(run, acked, role, false)}`;
    }
    if (!run.findings.length) {
      return `
        <div class="state-view">
          <div class="state-view__glyph"><span class="icon">task_alt</span></div>
          <div class="state-view__title">Pass — nothing found</div>
          <p class="state-view__body">Every check passed. The claim can be finalized.</p>
        </div>`;
    }
    const errors = run.findings.filter((f) => f.severity === 'Error').length;
    const left = claims.unacknowledged(row).length;
    return `
      <div class="alert alert--${claims.scrubTone(run.result)}"><span class="icon">${run.result === 'Fail' ? 'error' : 'warning'}</span>
        <div>${run.result === 'Fail'
    ? `${errors} error${errors === 1 ? '' : 's'} — fix ${errors === 1 ? 'it' : 'them'} and run the scrub again. ${run.findings.length - errors
      ? `${run.findings.length - errors} warning${run.findings.length - errors === 1 ? '' : 's'} beside ${errors === 1 ? 'it' : 'them'}.` : ''}`
    : `${run.findings.length} warning${run.findings.length === 1 ? '' : 's'} — ${left ? `${left} to acknowledge before the claim can be finalized` : 'all acknowledged; the claim can be finalized'}.`}</div>
      </div>
      ${groupsHtml(run, acked, role, true)}`;
  }

  function groupsHtml(run, acked, role, live) {
    return claims.groupedFindings(run.findings).map((g) => `
      <div class="toolbar">
        <span class="icon icon--sm">${ICONS[g.category] || 'info'}</span>
        <span class="t-title-sm">${esc(g.category)}</span>
        <span class="badge">${g.findings.length}</span>
      </div>
      <table class="tbl">
        <thead><tr><th>Severity</th><th>Finding</th><th>Line</th><th></th></tr></thead>
        <tbody>${g.findings.map((f) => findingHtml(f, run, acked, role, live)).join('')}</tbody>
      </table>`).join('');
  }

  function findingHtml(f, run, acked, role, live) {
    const ack = (run.acknowledgments || []).find((a) => a.findingId === f.id);
    return `
      <tr data-finding="${esc(f.id)}">
        <td><span class="badge badge--${f.severity === 'Error' ? 'critical' : 'warning'}"><span class="dot"></span>${esc(f.severity)}</span></td>
        <td>${esc(f.message)}${ack ? `<br><span class="t-body-sm">Acknowledged by ${esc(ack.by)} — ${esc(ack.reason)}</span>` : ''}</td>
        <td class="t-mono-sm">${esc(f.lineId || '—')}</td>
        <td>
          <button class="btn btn--ghost btn--sm" data-act="jump" title="Open where this is read">
            <span class="icon icon--sm">arrow_forward</span>${esc(f.jumpTo?.tab || 'lines')}</button>
          ${f.severity === 'Warning' && live && !acked.has(f.id) ? `
            <button class="btn btn--secondary btn--sm" data-act="ack"${role.canAcknowledgeScrubWarning ? '' : ' disabled'}
                    title="${role.canAcknowledgeScrubWarning ? 'Sign this warning off with a reason' : 'Only the RCM coder and the CMO can acknowledge a warning'}">
              <span class="icon icon--sm">task_alt</span>Acknowledge</button>` : ''}
        </td>
      </tr>`;
  }

  function historyHtml(row) {
    const runs = [...row.scrubRuns].reverse().slice(1);
    return `
      <details>
        <summary class="t-body-sm">${runs.length} earlier run${runs.length === 1 ? '' : 's'}</summary>
        <table class="tbl">
          <thead><tr><th>Run</th><th>When</th><th>By</th><th>Result</th><th>Findings</th></tr></thead>
          <tbody>${runs.map((r) => `
            <tr>
              <td class="t-mono-sm">${esc(r.id)}</td>
              <td>${dateTime(r.at)}</td>
              <td>${esc(r.by)}</td>
              <td><span class="badge badge--${claims.scrubTone(r.result)}">${esc(r.result)}</span></td>
              <td>${r.findings.length}${r.acknowledgments?.length ? ` · ${r.acknowledgments.length} acknowledged` : ''}</td>
            </tr>`).join('')}</tbody>
        </table>
      </details>`;
  }

  host.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'run') {
      runScrub(id);
      return redraw();
    }
    const fid = e.target.closest('tr[data-finding]')?.dataset.finding;
    const finding = claims.latestScrub(claims.get(id))?.findings.find((f) => f.id === fid);
    if (!finding) return;
    if (act === 'jump') return jumpTo(finding.jumpTo);
    if (act === 'ack') {
      await askAcknowledge(id, finding);
      redraw();
    }
  });

  draw();
}
