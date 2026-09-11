// Seed — appeal letter templates (amendment 38). Static, like reference.js:
// two English templates (a contract-terms appeal and a medical-necessity
// appeal) and an Arabic placeholder, each a body of HTML with merge fields
// written as {{field}}. `merge()` is the whole merge engine — a scalar field
// is escaped, an HTML field (the denied lines, the citations, the bundle
// index) is inserted as it is — so the letter tab, the package and the seed
// all render one way. Imports nothing but the grounds list, so the
// repository can read it.

import { GROUNDS } from './appeal-grounds.js';

/** Every field a template may name; `html` fields arrive rendered and are not escaped. */
export const MERGE_FIELDS = [
  { key: 'hospital.name', label: 'Hospital name' },
  { key: 'hospital.line', label: 'Hospital address line' },
  { key: 'hospital.signatory', label: 'Signatory' },
  { key: 'today', label: 'Date of the letter' },
  { key: 'payer.name', label: 'Payer' },
  { key: 'case.id', label: 'Appeal case number' },
  { key: 'case.level', label: 'Appeal level' },
  { key: 'claim.no', label: 'Claim number' },
  { key: 'claim.dos', label: 'Date of service' },
  { key: 'claim.contract', label: 'Contract and version' },
  { key: 'patient.name', label: 'Patient' },
  { key: 'patient.mrn', label: 'MRN' },
  { key: 'member.id', label: 'Member ID' },
  { key: 'policy.no', label: 'Policy number' },
  { key: 'denial.id', label: 'Denial reference' },
  { key: 'denial.code', label: 'Payer reason code' },
  { key: 'denial.reason', label: 'Payer reason' },
  { key: 'denial.date', label: 'Date the denial landed' },
  { key: 'amount.disputed', label: 'Disputed amount' },
  { key: 'amount.billed', label: 'Amount billed' },
  { key: 'grounds.primary', label: 'Primary ground' },
  { key: 'grounds.secondary', label: 'Secondary grounds' },
  { key: 'lines', label: 'Denied lines (table)', html: true },
  { key: 'citations', label: 'Contract citations (list)', html: true },
  { key: 'bundle.index', label: 'Enclosures (list)', html: true },
  { key: 'deadline', label: 'Filing deadline' },
  { key: 'preparer', label: 'Prepared by' },
];

export const TEMPLATES = [
  {
    id: 'T-EN-CONTRACT',
    name: 'Contract terms appeal (EN)',
    language: 'en',
    dir: 'ltr',
    grounds: GROUNDS.filter((g) => g.kind !== 'clinical').map((g) => g.id),
    body: `
<p><strong>{{hospital.name}}</strong><br>{{hospital.line}}</p>
<p>{{today}}</p>
<p>{{payer.name}}<br>Claims appeals desk</p>
<p><strong>Re: Appeal {{case.id}} (level {{case.level}}) — claim {{claim.no}}, patient {{patient.name}} ({{patient.mrn}}), member {{member.id}}, date of service {{claim.dos}}</strong></p>
<p>Dear Sir or Madam,</p>
<p>We write to appeal your adjudication of the claim above, notified on {{denial.date}} under reason {{denial.code}} — {{denial.reason}} — and disputed for {{amount.disputed}} of the {{amount.billed}} billed. The services were rendered under {{claim.contract}}, the agreement in force on the date of service, and the adjudication departs from its terms as follows.</p>
<p><strong>Grounds.</strong> {{grounds.primary}}{{grounds.secondary}}</p>
<p><strong>Contract terms relied on.</strong></p>
{{citations}}
<p><strong>Lines in dispute.</strong></p>
{{lines}}
<p>We ask that the claim be re-adjudicated under the terms cited and the disputed amount paid within the period the agreement provides. The enclosures listed below are attached; this appeal is filed inside the window closing {{deadline}}.</p>
<p><strong>Enclosures.</strong></p>
{{bundle.index}}
<p>Yours faithfully,</p>
<p>{{preparer}}<br>{{hospital.signatory}}<br>{{hospital.name}}</p>`,
  },
  {
    id: 'T-EN-MEDNEC',
    name: 'Medical necessity appeal (EN)',
    language: 'en',
    dir: 'ltr',
    grounds: ['medical_necessity', 'coding_supported', 'authorization_on_file'],
    body: `
<p><strong>{{hospital.name}}</strong><br>{{hospital.line}}</p>
<p>{{today}}</p>
<p>{{payer.name}}<br>Medical review — appeals</p>
<p><strong>Re: Appeal {{case.id}} (level {{case.level}}) — claim {{claim.no}}, patient {{patient.name}} ({{patient.mrn}}), member {{member.id}}, date of service {{claim.dos}}</strong></p>
<p>Dear Medical Director,</p>
<p>We appeal the refusal of the services below, notified on {{denial.date}} under reason {{denial.code}} — {{denial.reason}} — for {{amount.disputed}}. The treating physician's record, enclosed, sets out the presentation, the findings and the decision to treat; the services were clinically indicated at the time they were ordered and are consistent with accepted practice for the diagnosis coded.</p>
<p><strong>Grounds.</strong> {{grounds.primary}}{{grounds.secondary}}</p>
<p><strong>Clinical summary.</strong> Please see the enclosed clinical documentation and coding summary, which together establish the diagnosis, the indication and the procedure performed.</p>
{{citations}}
<p><strong>Services in dispute.</strong></p>
{{lines}}
<p>We request a review by a physician of the same specialty and re-adjudication of the claim. This appeal is filed inside the window closing {{deadline}}; the enclosures are listed below.</p>
<p><strong>Enclosures.</strong></p>
{{bundle.index}}
<p>Yours faithfully,</p>
<p>{{preparer}}<br>{{hospital.signatory}}<br>{{hospital.name}}</p>`,
  },
  {
    id: 'T-AR-PLACEHOLDER',
    name: 'استئناف (AR — placeholder)',
    language: 'ar',
    dir: 'rtl',
    grounds: GROUNDS.map((g) => g.id),
    body: `
<p><strong>{{hospital.name}}</strong><br>{{hospital.line}}</p>
<p>{{today}}</p>
<p>{{payer.name}}<br>قسم الاعتراضات</p>
<p><strong>الموضوع: استئناف رقم {{case.id}} — المطالبة {{claim.no}}، المريض {{patient.name}} ({{patient.mrn}})، تاريخ الخدمة {{claim.dos}}</strong></p>
<p>تحية طيبة وبعد،</p>
<p>نتقدّم باستئناف قرار رفض المطالبة المذكورة أعلاه، المبلّغ بتاريخ {{denial.date}} بموجب السبب {{denial.code}}، والبالغ قيمته المتنازع عليها {{amount.disputed}}. (نصّ عربي مبدئي — يُستكمل لاحقاً.)</p>
<p><strong>الأسباب.</strong> {{grounds.primary}}</p>
{{citations}}
{{lines}}
<p><strong>المرفقات.</strong></p>
{{bundle.index}}
<p>مع فائق الاحترام،</p>
<p>{{preparer}}<br>{{hospital.signatory}}<br>{{hospital.name}}</p>`,
  },
];

export const template = (id) => TEMPLATES.find((t) => t.id === id) || null;

/** The template that argues a ground best: the medical one for clinical grounds, the contract one for the rest. */
export const templateFor = (groundId) => TEMPLATES.find((t) => t.language === 'en' && t.grounds.includes(groundId)) || TEMPLATES[0];

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * merge(template | id, fields) → the letter's HTML. Every {{key}} is
 * replaced by fields[key]; a field the template names and the fields do not
 * carry reads as an empty string. An `html` field is inserted as it is; the
 * rest are escaped. Unknown keys are left in place so a typo shows on the
 * page rather than vanishing.
 */
export function merge(tpl, fields = {}) {
  const t = typeof tpl === 'string' ? template(tpl) : tpl;
  if (!t) return '';
  const html = new Set(MERGE_FIELDS.filter((f) => f.html).map((f) => f.key));
  const known = new Set(MERGE_FIELDS.map((f) => f.key));
  const body = t.body.replace(/\{\{([a-z.]+)\}\}/gi, (m, key) => {
    if (!known.has(key)) return m;
    const v = fields[key];
    if (v == null) return '';
    return html.has(key) ? String(v) : escapeHtml(v);
  });
  return `<div dir="${t.dir}" lang="${t.language}">${body.trim()}</div>`;
}
