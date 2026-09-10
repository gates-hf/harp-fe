// Recode — the dialog that reopens a coded chart as a new version, the one
// that asks for it to be reopened, and the list of requests a chart carries.
// A recode never edits the version that stands: it copies it, records why,
// and the claim built on the old one is told it is stale through the hooks
// the repository fires.

import * as coding from '../../../../data/repositories/coding.js';
import { toast } from '../../../../shared/toast.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { askReason } from './coding-assign.js';

/** Reopen the chart. The reason rides on the new version and in the trail. */
export async function askRecode(no) {
  const rec = coding.get(no);
  const why = coding.recodeBlocked(rec);
  if (why) {
    toast(why, 'warning');
    return false;
  }
  const standing = coding.lastCoded(rec);
  const open = coding.openRecodeRequests(rec);
  const reason = await askReason({
    title: `Recode ${no}`,
    sub: `v${standing.version} coded ${dateTime(standing.codedAt)} by ${coding.coderName(standing.codedBy)}`,
    icon: 'history_edu',
    tone: 'warning',
    lede: open.length
      ? `Opens version ${standing.version + 1} as a copy of version ${standing.version} for you to correct. ${open.length === 1 ? 'The request' : 'The requests'} on this chart ${open.length === 1 ? 'is' : 'are'} accepted and any claim built on version ${standing.version} is marked stale.`
      : `Opens version ${standing.version + 1} as a copy of version ${standing.version} for you to correct. Version ${standing.version} is kept as it was, and any claim built on it is marked stale.`,
    placeholder: open[0]?.reason || 'What was wrong with the coded version',
    confirmLabel: `Open version ${standing.version + 1}`,
  });
  if (typeof reason !== 'string') return false;
  const after = coding.recode(no, reason);
  if (after) toast(`${no} reopened as v${coding.currentVersion(after).version}`, 'success');
  return Boolean(after);
}

/** Ask for a recode without doing it — a reviewer, a physician, a desk. */
export async function askRequestRecode(no) {
  const rec = coding.get(no);
  if (!coding.lastCoded(rec)) {
    toast('Nothing has been coded yet on this chart', 'warning');
    return false;
  }
  const reason = await askReason({
    title: `Request a recode — ${no}`,
    sub: 'Manual request',
    icon: 'flag',
    tone: 'warning',
    lede: 'The chart is flagged Recode Requested on the worklist and the coder sees your reason when they open it. Nothing on the coded version changes until a coder reopens it.',
    placeholder: 'What the coded version got wrong, and where the chart says so',
    confirmLabel: 'Send the request',
  });
  if (typeof reason !== 'string') return false;
  const req = coding.requestRecode(no, { source: 'Manual', ref: currentRole().title, reason });
  if (req) toast(`${req.id} raised on ${no}`, 'success');
  return Boolean(req);
}

/** Dismiss an open request with a reason — the chart stays as coded. */
export async function askDismissRequest(no, id) {
  const reason = await askReason({
    title: `Dismiss ${id}`,
    sub: no,
    icon: 'block',
    tone: 'critical',
    lede: 'The coded version stands. The request stays on the chart with the reason it was not acted on.',
    placeholder: 'The summary was read again and the principal is right as coded…',
    confirmLabel: 'Dismiss',
  });
  if (typeof reason !== 'string') return false;
  const req = coding.dismissRecodeRequest(no, id, reason);
  if (req) toast(`${id} dismissed`, 'success');
  return Boolean(req);
}

const sourceLabel = (source) => (source === 'LateCharge' ? 'Late charge' : source);

const requestTone = (status) => (status === 'Open' ? 'critical' : status === 'Accepted' ? 'warning' : status === 'Done' ? 'success' : '');

/** The requests a chart carries, newest first, with Dismiss on the open ones. */
export function requestsHtml(rec, role = currentRole()) {
  const requests = [...(rec?.recodeRequests || [])].reverse();
  if (!requests.length) return '';
  return `
    <div class="toolbar"><span class="t-title-sm">Recode requests</span></div>
    <table class="tbl">
      <thead><tr>
        <th scope="col">Request</th><th scope="col">Source</th><th scope="col">Reason</th>
        <th scope="col">Raised</th><th scope="col">Status</th><th scope="col"></th>
      </tr></thead>
      <tbody>
        ${requests.map((r) => `
          <tr>
            <td class="t-mono-sm">${esc(r.id)}</td>
            <td>${esc(sourceLabel(r.source))}${r.ref ? `<br><span class="t-body-sm">${esc(r.ref)}</span>` : ''}</td>
            <td>${esc(r.reason)}${r.dismissReason ? `<br><span class="t-body-sm">Dismissed — ${esc(r.dismissReason)}</span>` : ''}</td>
            <td class="t-mono-sm">${dateTime(r.at)}<br><span class="t-body-sm">${esc(r.by || '')}</span></td>
            <td><span class="badge${requestTone(r.status) ? ` badge--${requestTone(r.status)}` : ''}"><span class="dot"></span>${esc(r.status)}</span></td>
            <td>${r.status === 'Open'
              ? (role.canRecode
                ? `<button class="btn btn--ghost btn--sm" data-act="dismiss-request" data-request="${esc(r.id)}">Dismiss</button>`
                : `<button class="btn btn--ghost btn--sm" disabled title="${esc(role.title)} cannot dismiss a recode request">Dismiss</button>`)
              : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/** The versions a chart has carried, newest first — what a recode preserved. */
export function versionsHtml(rec) {
  const versions = [...(rec?.versions || [])].reverse();
  if (versions.length < 2) return '';
  return `
    <div class="toolbar"><span class="t-title-sm">Versions</span></div>
    <table class="tbl">
      <thead><tr>
        <th scope="col">Version</th><th scope="col">Principal</th><th scope="col">Codes</th>
        <th scope="col">Coded</th><th scope="col">Reason</th>
      </tr></thead>
      <tbody>
        ${versions.map((v) => `
          <tr>
            <td class="t-mono-sm">v${v.version}${v.codedAt ? '' : ' <span class="badge badge--accent">draft</span>'}</td>
            <td class="t-mono-sm">${esc(v.diagnoses.find((d) => d.principal)?.code || '—')}</td>
            <td>${v.diagnoses.length} dx · ${v.procedures.length} px</td>
            <td class="t-mono-sm">${v.codedAt ? `${dateTime(v.codedAt)}<br><span class="t-body-sm">${esc(coding.coderName(v.codedBy))}</span>` : '—'}</td>
            <td>${esc(v.reason || '—')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}
