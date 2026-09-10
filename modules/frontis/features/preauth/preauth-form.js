// The request form at #/frontis/preauth/new?mrn=&encounterNo=&estimate=&snapshot=
// and at #/frontis/preauth/<no> while the request is still a Draft — one page,
// four panels, one Save.
//
// Nothing is written until Save draft, with the one exception the domain
// forces: a document is filed against a request number, so Upload is out of
// reach until the draft has one. Submit saves first for the same reason — what
// the payer is answering has to exist before it can be locked.

import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc } from '../../../../shared/format.js';
import {
  askingPrice, bannerHtml, clinicalPanel, documentsPanel, footerHtml, patientPanel, servicesPanel, summaryHtml,
} from './preauth-form-panels.js';
import { blank, blankLine, fromRow } from './preauth-prefill.js';
import { askSubmit } from './preauth-actions.js';

export const meta = { title: 'Pre-authorisation request' };

/** The demo keeps a document's name and size, never the bytes. 10 MB, as asked. */
const MAX_DOC = 10 * 1024 * 1024;

export async function render(mount, ctx) {
  const no = ctx.params[0] === 'new' ? '' : ctx.params[0];
  const row = no ? preauth.get(no) : null;
  if (no && !row) throw new Error(`No pre-authorisation request ${no}`);
  // Anything that has been sent is read on its own page, never in the form.
  if (row && !preauth.isDraft(row)) return ctx.navigate(`/frontis/preauth/${no}`);

  const res = await fetch(new URL('./preauth-form.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load preauth-form.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = row ? fromRow(row) : blank(ctx.query);
  ctx.setHeader(row ? `Request ${row.no}` : 'New pre-authorisation request');
  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Pre-auths', path: '/frontis/preauth' },
    { label: row ? row.no : 'New' },
  ]);

  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    $('#pf-no').textContent = state.no || 'Number assigned on save';
    $('#pf-summary').innerHTML = summaryHtml(state);
    $('#pf-footer').innerHTML = footerHtml(state, submitBlockedBy());
    $('#pf-banner').innerHTML = bannerHtml(state);
    $('#pf-patient').innerHTML = patientPanel(state, role);
    $('#pf-services').innerHTML = servicesPanel(state);
    $('#pf-clinical').innerHTML = clinicalPanel(state);
    $('#pf-documents').innerHTML = documentsPanel(state);
    $('#pf-back').href = state.encounterNo
      ? `#/frontis/encounters/${state.encounterNo}/linked`
      : '#/frontis/preauth';
    showError('');
  }

  const showError = (message) => {
    // .alert sets display:flex, which outranks hidden, so the box is a plain
    // wrapper the alert is written into rather than a hidden alert.
    $('#pf-error').innerHTML = message
      ? `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(message)}</div></div>`
      : '';
  };

  // --- writes ---------------------------------------------------------------

  function payload() {
    const policy = state.policyId ? policies.get(state.policyId) : null;
    return {
      patientMrn: state.patientMrn,
      policyId: policy?.id || null,
      payerId: policy?.payerId || null,
      planId: policy?.planId || null,
      encounterNo: state.encounterNo || null,
      estimateNo: state.estimateNo || null,
      snapshotRef: state.snapshotRef || null,
      services: state.services
        .filter((line) => line.itemId)
        .map((line) => ({
          itemId: line.itemId,
          qty: Math.max(1, Number(line.qty) || 1),
          requestedAmount: Math.round((Number(line.requestedAmount) || 0) * 100) / 100,
          approvedQty: null,
          approvedAmount: null,
          lineDecision: null,
          lineReason: null,
        })),
      diagnosis: state.diagnosis.trim(),
      justification: state.justification.trim(),
      doctorId: state.doctorId,
      priority: state.priority,
    };
  }

  /** Save: the first one creates the number, the rest replace what it holds. */
  function save({ quiet = false } = {}) {
    const why = validate();
    if (why) {
      showError(why);
      return null;
    }
    showError('');
    if (!state.no) {
      const created = preauth.create(payload());
      state.no = created.no;
      // The visit that asked for it registers it, the way every record does.
      if (state.encounterNo) encounters.linkRecord(state.encounterNo, 'preAuth', created.no);
      if (!quiet) toast(`${created.no} saved as a draft`, 'success');
      // The draft has a number now, so the page it lives at is its own.
      ctx.navigate(`/frontis/preauth/${created.no}`);
      return created;
    }
    const saved = preauth.updateDraft(state.no, payload());
    if (saved && !quiet) toast(`${saved.no} saved`, 'success');
    return saved;
  }

  function validate() {
    if (!state.patientMrn) return 'Choose the patient this request is about.';
    if (!state.policyId) return 'Choose the cover the payer is being asked under.';
    if (!state.services.filter((line) => line.itemId).length) {
      return 'Add at least one service. A request with nothing on it asks the payer nothing.';
    }
    if (state.services.some((line) => line.itemId && !(Number(line.qty) >= 1))) {
      return 'Every service is requested for at least one unit.';
    }
    if (state.services.some((line) => line.itemId && !(Number(line.requestedAmount) > 0))) {
      return 'Every service carries the amount being asked for.';
    }
    if (!state.diagnosis.trim()) return 'Enter the diagnosis. It is the first thing a payer reads.';
    if (state.justification.trim().length < 20) {
      return 'Enter the justification. It is what the payer answers against, so a line or two is the minimum.';
    }
    if (!state.doctorId) return 'Choose the treating doctor.';
    return '';
  }

  /** Submit is out of reach for exactly the reasons Save is, and says which. */
  const submitBlockedBy = () => validate();

  // --- events ---------------------------------------------------------------

  mount.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'pf-q') {
      state.q = el.value;
      $('#pf-patient').innerHTML = patientPanel(state, currentRole());
      mount.querySelector('#pf-q')?.focus();
      return;
    }
    if (el.name === 'diagnosis' || el.name === 'justification') {
      state[el.name] = el.value;
      return void ($('#pf-footer').innerHTML = footerHtml(state, submitBlockedBy()));
    }
    const line = lineOf(el);
    if (!line) return;
    if (el.dataset.field === 'qty') {
      line.qty = Math.max(1, Number(el.value) || 1);
      line.requestedAmount = askingPrice(state, line.itemId, line.qty);
    }
    if (el.dataset.field === 'requestedAmount') line.requestedAmount = Number(el.value) || 0;
    $('#pf-summary').innerHTML = summaryHtml(state);
    $('#pf-footer').innerHTML = footerHtml(state, submitBlockedBy());
  });

  mount.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'pf-doc') return readDocument(el);
    if (el.name === 'pf-policy') {
      state.policyId = el.value;
      // A different payer prices the same services differently.
      for (const line of state.services) line.requestedAmount = askingPrice(state, line.itemId, line.qty);
      return draw();
    }
    if (el.name === 'doctorId') {
      state.doctorId = el.value;
      return draw();
    }
    const line = lineOf(el);
    if (line && el.dataset.field === 'itemId') {
      line.itemId = el.value;
      line.requestedAmount = askingPrice(state, line.itemId, line.qty);
      return draw();
    }
    if (line && (el.dataset.field === 'qty' || el.dataset.field === 'requestedAmount')) return draw();
  });

  /** A supporting document, written straight onto the saved draft. */
  function readDocument(input) {
    const file = input.files?.[0];
    if (!file || !state.no) return;
    if (file.size > MAX_DOC) {
      input.value = '';
      return showError('That document is over 10 MB. Scan it again at a lower resolution.');
    }
    const doc = preauth.addDocument(state.no, { kind: 'Supporting', fileName: file.name, size: file.size });
    if (!doc) return;
    state.documents = [...state.documents, doc];
    toast(`${file.name} attached to ${state.no}`, 'success');
    draw();
  }

  mount.addEventListener('click', async (e) => {
    const priority = e.target.closest('[data-priority]');
    if (priority) {
      state.priority = priority.dataset.priority;
      return draw();
    }

    const tr = e.target.closest('tr[data-mrn]');
    if (tr) {
      pick(tr.dataset.mrn);
      return draw();
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'unpick') {
      state.patientMrn = '';
      state.policyId = '';
      state.encounterNo = '';
      state.q = '';
      return draw();
    }
    if (act === 'add-line') {
      state.services.push(blankLine());
      return draw();
    }
    if (act === 'remove-line') {
      state.services.splice(Number(e.target.closest('[data-index]').dataset.index), 1);
      return draw();
    }
    if (act === 'save') return void save();
    if (act === 'submit') {
      const saved = save({ quiet: true });
      if (saved && (await askSubmit(saved.no, ctx))) ctx.navigate(`/frontis/preauth/${saved.no}`);
    }
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-mrn]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      pick(tr.dataset.mrn);
      draw();
    }
  });

  /** Choosing a patient takes the highest cover on their chain without asking. */
  function pick(mrn) {
    state.patientMrn = mrn;
    state.q = '';
    state.policyId = policies.chain(mrn)[0]?.id || '';
    for (const line of state.services) line.requestedAmount = askingPrice(state, line.itemId, line.qty);
  }

  function lineOf(el) {
    const box = el.closest?.('[data-index]');
    return box ? state.services[Number(box.dataset.index)] : null;
  }

  draw();

  // A record merged, the request sent from somewhere else or the expiry sweep
  // running all change what this form is holding.
  ctx.onData(() => {
    const stored = state.no ? preauth.get(state.no) : null;
    if (state.no && !stored) return ctx.navigate('/frontis/preauth');
    if (stored && !preauth.isDraft(stored)) return ctx.navigate(`/frontis/preauth/${state.no}`);
    draw();
  });
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
}
