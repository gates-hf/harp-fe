// Seed — appeal cases (amendment 38). Four cases on the denials amendment 36
// seeded as appealable, written as intents and driven through the
// repository's own writes with the dates the events happened on, so a seeded
// citation was rendered off the stamped contract version the way a live one
// is, a seeded review round was signed by somebody who was not the preparer,
// and a seeded submission wrote the denial's trail and the claim's timeline
// the way the button does. Denials are found by rule — payer, code and state
// — never by number: a reset fired from a Claima screen deals the Bupa
// denial last and shifts every id by one.
//
// The four states the workbench opens on: a Draft with its citations started
// and five days to file (the ministry's CO-96 — the one denial in the seed
// inside the warning window, so the deadline-critical row is a real one), a
// case In review at the senior tier (the ministry's protocol appeal, AC-0001,
// which the denials seed already opened — upgraded in place, never renamed),
// one Approved to submit with the full bundle and the letter locked (the
// Army fund's documentation refusal), and one Submitted by portal three days
// ago (the Allianz cover-lapsed remainder) for amendment 39 to pick up.
//
// Reads the citation engine to render what it cites and the charge master
// to match a line to a scope; imports no repository that imports the appeal
// register back.

import * as citations from '../engines/citation-renderer.js';
import * as cdm from '../repositories/cdm.js';

const ANALYST = 'Hala Mansour';   // denial analyst — prepares, never signs in, so both demo reviewers have work
const CODER = 'Tarek Solh';
const CMO = 'Georges Khoury';

/**
 * buildAppealCases({ denials, today, get, byDenial, setGrounds, addCitation,
 * addBundleItem, setTemplate, generateLetter, editLetter, submitForReview,
 * review, submit, suggestedBundle, tag }) → the cases it touched.
 */
export function buildAppealCases(api) {
  const { denials } = api;
  const out = [];
  const at = (daysAgo, hhmm) => `${dayMinus(api.today, daysAgo)}T${hhmm}:00.000Z`;
  const rows = denials.all();
  const opts = (n, hhmm, by) => ({ at: at(n, hhmm), by, commit: false });

  // --- 1. Draft, five days to file: the ministry refused a charge as non-covered; the agreement prices its category.
  const dnDraft = rows.find((d) => d.payerId === 'PY-0002' && (d.payerReason?.code || d.code) === 'CO-96' && d.status === 'Untriaged');
  if (dnDraft) {
    denials.assign(dnDraft.id, ANALYST, { at: at(3, '09:50'), by: ANALYST });
    denials.triage(dnDraft.id, {
      class: 'Appealable', rootCauseId: 'RC-15', category: 'Administrative', tier: 'Hard', separation: 'True',
      note: 'The agreement prices the category under its default methodology and names no exclusion — the refusal reads a list that is not in the contract',
    }, { at: at(3, '10:15'), by: ANALYST });
    const r = denials.route(dnDraft.id, 'Appeal', { reason: null }, { at: at(3, '10:40'), by: ANALYST });
    const c = r?.error ? null : api.get(r.route?.ref);
    if (c) {
      api.setGrounds(c.id, { primary: 'contract_violation', secondary: ['coverage_confirmed'] }, opts(3, '10:52', ANALYST));
      cite(api, c, dnDraft, ['methodology:line', 'methodology:default'], 'The charge falls under this rate row; a priced category is a covered one.', opts(3, '11:05', ANALYST));
      attach(api, c, ['Claim', 'Denial notice', 'Contract extract'], opts(3, '11:10', ANALYST));
      api.tag(c);
      out.push(c);
    }
  }

  // --- 2. In review, senior tier: the ministry's protocol names the test — AC-0001, opened by the denials seed.
  const dnReview = rows.find((d) => d.payerId === 'PY-0002' && (d.payerReason?.code || d.code) === 'CO-50' && d.route?.kind === 'Appeal');
  const cReview = dnReview ? api.get(dnReview.route.ref) : null;
  if (cReview && cReview.status === 'Draft') {
    api.setGrounds(cReview.id, { primary: 'medical_necessity', secondary: ['contract_violation'] }, opts(9, '09:20', CODER));
    cite(api, cReview, dnReview, ['term', 'methodology:line', 'methodology:default'], 'The test is priced under the agreement and named by the ministry’s own protocol for the diagnosis coded.', opts(9, '09:35', CODER));
    attach(api, cReview, ['Claim', 'Denial notice', 'Contract extract', 'Coding summary', 'Clinical document'], opts(8, '10:05', CODER));
    api.addBundleItem(cReview.id, { type: 'Clinical document', source: 'upload', file: { name: 'moph-protocol-extract-2025.pdf', size: 412000 }, description: 'MOPH treatment protocol — extract naming the test for the coded diagnosis' }, opts(8, '10:12', CODER));
    api.addBundleItem(cReview.id, { type: 'Clinical document', source: 'upload', file: { name: 'physician-statement-haddad.pdf', size: 186000 }, description: 'Attending physician’s statement of medical necessity — Dr. Rana Haddad' }, opts(8, '10:14', CODER));
    api.setTemplate(cReview.id, 'T-EN-MEDNEC', opts(8, '10:20', CODER));
    const v = api.generateLetter(cReview.id, opts(8, '10:22', CODER));
    if (v?.html) {
      api.editLetter(cReview.id, v.html.replace('<p><strong>Clinical summary.</strong>',
        '<p><strong>Protocol.</strong> The ministry’s own treatment protocol, extract enclosed, names this test as the first-line investigation for the diagnosis coded on the claim; a refusal on medical necessity contradicts the payer’s published standard.</p>\n<p><strong>Clinical summary.</strong>'), opts(7, '15:40', CODER));
    }
    api.submitForReview(cReview.id, opts(6, '09:05', CODER));
    api.tag(cReview);
    out.push(cReview);
  }

  // --- 3. Approved to submit: the Army fund said the documents were missing; they were in the batch's forms.
  const dnApproved = rows.find((d) => d.payerId === 'PY-0003' && (d.payerReason?.code || d.code) === 'CO-16' && d.status === 'Untriaged');
  if (dnApproved) {
    denials.assign(dnApproved.id, ANALYST, { at: at(1, '09:20'), by: ANALYST });
    denials.triage(dnApproved.id, {
      class: 'Appealable', rootCauseId: 'RC-15', category: 'Administrative', tier: 'Hard', separation: 'True',
      note: 'The discharge summary went out with the batch’s forms; the fund’s reader missed it — appeal with the document rather than refile',
    }, { at: at(1, '09:30'), by: ANALYST });
    const r = denials.route(dnApproved.id, 'Appeal', { reason: null }, { at: at(1, '09:45'), by: ANALYST });
    const c = r?.error ? null : api.get(r.route?.ref);
    if (c) {
      api.setGrounds(c.id, { primary: 'documentation_supplied', secondary: ['contract_violation'] }, opts(1, '09:50', ANALYST));
      cite(api, c, dnApproved, ['coverage:default', 'term'], 'The agreement names no document the fund may hold a claim for beyond what was filed; the summary is enclosed again.', opts(1, '10:05', ANALYST));
      attach(api, c, ['Claim', 'Denial notice', 'Contract extract'], opts(1, '10:15', ANALYST));
      api.addBundleItem(c.id, { type: 'Clinical document', source: 'upload', file: { name: `discharge-summary-${claimMrn(denials, dnApproved)}.pdf`, size: 231000 }, description: 'Discharge summary as filed with the claim' }, opts(1, '10:18', ANALYST));
      api.addBundleItem(c.id, { type: 'Claim attachment', source: 'upload', file: { name: 'batch-forms-cover-lahf.pdf', size: 98000 }, description: 'Batch cover sheet listing the summary among the forms sent' }, opts(1, '10:20', ANALYST));
      api.setTemplate(c.id, 'T-EN-CONTRACT', opts(1, '10:55', ANALYST));
      api.generateLetter(c.id, opts(1, '11:00', ANALYST));
      api.submitForReview(c.id, opts(1, '11:20', ANALYST));
      api.review(c.id, { action: 'approve', note: 'Summary is in the cover sheet’s list — file it with the sheet' }, { at: at(0, '08:40'), by: CODER, role: reviewer(CODER), commit: false });
      api.tag(c);
      out.push(c);
    }
  }

  // --- 4. Submitted by portal: the remainder Allianz still refuses after the cover was shown renewed.
  const dnSubmitted = rows.find((d) => d.previousDenialId && d.class === 'Appealable' && d.rootCauseId === 'RC-03' && d.status === 'Triaged' && !d.route);
  if (dnSubmitted) {
    denials.assign(dnSubmitted.id, ANALYST, { at: at(6, '09:05'), by: ANALYST });
    const r = denials.route(dnSubmitted.id, 'Appeal', { reason: null }, { at: at(6, '09:15'), by: ANALYST });
    const c = r?.error ? null : api.get(r.route?.ref);
    if (c) {
      api.setGrounds(c.id, { primary: 'eligibility_confirmed', secondary: ['contract_violation'] }, opts(6, '09:25', ANALYST));
      cite(api, c, dnSubmitted, ['term', 'coverage:default'], 'The policy was renewed mid-month and the covered days were already settled; the remainder falls inside the renewed term.', opts(6, '09:40', ANALYST));
      attach(api, c, ['Claim', 'Denial notice', 'Contract extract'], opts(6, '09:50', ANALYST));
      api.addBundleItem(c.id, { type: 'Eligibility check', source: 'upload', file: { name: 'allianz-renewal-notice.pdf', size: 142000 }, description: 'Allianz renewal notice — cover in force across the date of service' }, opts(6, '09:55', ANALYST));
      api.setTemplate(c.id, 'T-EN-CONTRACT', opts(5, '10:00', ANALYST));
      api.generateLetter(c.id, opts(5, '10:05', ANALYST));
      api.submitForReview(c.id, opts(5, '10:30', ANALYST));
      api.review(c.id, { action: 'approve', note: '' }, { at: at(4, '14:10'), by: CODER, role: reviewer(CODER), commit: false });
      api.submit(c.id, { method: 'Portal', reference: 'ALZ-APL-2026-01187', submittedAt: dayMinus(api.today, 3), lateReason: '' }, { at: at(3, '11:30'), by: ANALYST, role: reviewer(ANALYST), commit: false });
      api.tag(c);
      out.push(c);
    }
  }

  // Everything the seed touched is tagged, and the register commits once — the batch around it announces the reasons.
  return out;
}

// --- internals ------------------------------------------------------------------------------

/** A stand-in role for a seeded signature: the name, and the flags a reviewer at either tier holds. */
const reviewer = (name) => ({ name, canReviewAppeal: true, canApproveSeniorAppeal: name === CMO, canOverrideAppealDeadline: name === CMO });

const dayMinus = (today, n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

const claimMrn = (denials, denial) => denials.claimOf(denial)?.patientMrn || 'patient';

/**
 * Cites the rows `prefs` name on the version stamped on the denial's claim,
 * in order, skipping what is not there: `term`, `methodology:line` (the row
 * scoped to the denied line's category), `methodology:default`,
 * `coverage:default` (on the claim's plan). Every text is rendered by the
 * engine at the date of service, the way the picker renders it.
 */
function cite(api, c, denial, prefs, argument, opts) {
  const claim = api.denials.claimOf(denial);
  if (!claim?.contractId) return;
  let rows;
  try { rows = citations.browse(claim.contractId, { planId: claim.planId, dos: claim.dateOfService }); } catch { return; }
  const line = claim.lines.find((l) => l.id === denial.lineId) || claim.lines[0];
  const category = line ? cdm.get(line.itemId)?.category || null : null;
  const picks = [];
  for (const pref of prefs) {
    const [section, which] = pref.split(':');
    let hit = null;
    if (section === 'term') hit = rows.find((r) => r.section === 'term');
    else if (which === 'line') hit = rows.find((r) => r.section === section && category && r.summary.startsWith(`${scopeWord(r)}${category}`));
    else if (which === 'default') hit = rows.find((r) => r.section === section && /Default/.test(r.summary));
    if (hit && !picks.includes(hit)) picks.push(hit);
  }
  picks.forEach((p, i) => api.addCitation(c.id, { sourceRef: p.sourceRef, renderedText: p.renderedText, argument: i === 0 ? argument : '', href: citations.hrefOf(p.sourceRef) }, opts));
}

const scopeWord = (r) => (r.section === 'coverage' ? '' : 'Category: ');

/** Attaches the suggested system items of the named types, in the order given. */
function attach(api, c, types, opts) {
  for (const type of types) {
    for (const s of api.suggestedBundle(api.get(c.id)).filter((x) => x.type === type && !x.attached)) {
      api.addBundleItem(c.id, { type: s.type, source: 'system', ref: s.ref, description: s.description, href: s.href }, opts);
    }
  }
}
