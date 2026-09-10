// The statement of account as a document: what the generator previews and
// what the statement page prints, from the same frozen snapshot, so a reprint
// a month later is the page that went out. Markup only — no listeners.
//
// Two languages, one layout. The Arabic statement is the same document with
// its labels read from a small dictionary and the direction flipped on the
// document alone; the numbers stay Latin, which is how a Lebanese statement is
// printed. Nothing here is recomputed: every figure is read off the snapshot.

import { date, dateTime, esc, usd } from '../../../../shared/format.js';

const EN = {
  title: 'Statement of account', hospital: 'HARP Medical Centre', address: 'Hamra, Beirut · +961 1 350 000',
  patient: 'Patient', mrn: 'MRN', statementNo: 'Statement no.', generated: 'Generated', scope: 'Scope', by: 'Prepared by',
  encounter: 'Encounter', type: 'Type', dates: 'Dates', charges: 'Charges', payerShare: 'Payer share', patientShare: 'Patient share',
  payments: 'Payments', deposits: 'Deposits applied', adjustments: 'Adjustments', refunds: 'Refunds', unpaid: 'Unpaid', settlement: 'Settlement',
  lines: 'Charge lines', item: 'Item', qty: 'Qty', allowed: 'Allowed', payer: 'Payer', patientCol: 'Patient', movements: 'Money movements',
  account: 'On the account (no visit)', totals: 'Totals', totalCharges: 'Total charges', depositsHeld: 'Deposits held', balanceDue: 'Balance due',
  wholeAccount: 'Whole account', period: 'Period', encounters: 'Encounters', summary: 'Summary', detailed: 'Detailed',
  reversed: 'reversed', overage: 'overage', foot: 'This statement is a record of the account on the date it was generated. Charges are priced under the agreement in force on the date of service; what a payer has yet to adjudicate may still change what the patient owes.',
  Settled: 'Settled', Unsettled: 'Unsettled', Excess: 'Excess', Pending: 'Pending',
};

const AR = {
  title: 'كشف حساب', hospital: 'مركز هارب الطبي', address: 'الحمرا، بيروت · +961 1 350 000',
  patient: 'المريض', mrn: 'رقم الملف', statementNo: 'رقم الكشف', generated: 'تاريخ الإصدار', scope: 'النطاق', by: 'أعدّه',
  encounter: 'الزيارة', type: 'النوع', dates: 'التواريخ', charges: 'الرسوم', payerShare: 'حصة الجهة الضامنة', patientShare: 'حصة المريض',
  payments: 'المدفوعات', deposits: 'التأمينات المطبقة', adjustments: 'التسويات', refunds: 'المبالغ المستردة', unpaid: 'غير المدفوع', settlement: 'التسوية',
  lines: 'بنود الرسوم', item: 'البند', qty: 'الكمية', allowed: 'المعتمد', payer: 'الضامن', patientCol: 'المريض', movements: 'حركات الأموال',
  account: 'على الحساب (بدون زيارة)', totals: 'المجاميع', totalCharges: 'إجمالي الرسوم', depositsHeld: 'التأمينات المحتجزة', balanceDue: 'الرصيد المستحق',
  wholeAccount: 'الحساب كاملاً', period: 'الفترة', encounters: 'زيارات', summary: 'موجز', detailed: 'مفصّل',
  reversed: 'ملغى', overage: 'تجاوز', foot: 'هذا الكشف سجل للحساب بتاريخ إصداره. تُسعَّر الرسوم وفق الاتفاقية السارية بتاريخ الخدمة، وقد يتغير ما يترتب على المريض بحسب ما لم تبتّ فيه الجهة الضامنة بعد.',
  Settled: 'مسوّاة', Unsettled: 'غير مسوّاة', Excess: 'فائض', Pending: 'قيد الانتظار',
};

export const dictionary = (language) => (language === 'AR' ? AR : EN);

const money = (n) => usd(n);

/** The scope in the statement's own language. */
function scopeWords(params, t) {
  if (params.scope === 'Encounters') return `${t.encounters}: ${(params.encounterNos || []).join('، ')}`;
  if (params.scope === 'Period') return `${t.period}: ${params.from ? date(params.from) : '…'} – ${params.to ? date(params.to) : '…'}`;
  return t.wholeAccount;
}

/** statementHtml(row) — `row` is the stored statement (or a preview: the same shape without a number). */
export function statementHtml(row) {
  const t = dictionary(row.params.language);
  const s = row.snapshot;
  const rtl = row.params.language === 'AR';
  return `
    <div class="panel" dir="${rtl ? 'rtl' : 'ltr'}" lang="${rtl ? 'ar' : 'en'}" data-statement="${esc(row.no || 'preview')}">
      <div class="panel-header">
        <span>${esc(t.hospital)}</span>
        <span class="spacer"></span>
        <span class="t-mono-sm">${esc(row.no || '—')}</span>
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <span class="t-title">${esc(t.title)}</span>
          <span class="spacer"></span>
          <span class="t-body-sm">${esc(t.address)}</span>
        </div>
        <dl class="dl dl--narrow">
          <dt>${esc(t.patient)}</dt><dd>${esc(rtl && s.header.nameAr ? s.header.nameAr : s.header.name)} <span class="t-mono-sm">${esc(s.header.mrn)}</span></dd>
          <dt>${esc(t.statementNo)}</dt><dd class="t-mono-sm">${esc(row.no || '—')}</dd>
          <dt>${esc(t.generated)}</dt><dd>${esc(dateTime(row.generatedAt))}</dd>
          <dt>${esc(t.scope)}</dt><dd>${esc(scopeWords(row.params, t))} · ${esc(row.params.detail === 'Detailed' ? t.detailed : t.summary)}</dd>
          <dt>${esc(t.by)}</dt><dd>${esc(row.by || '—')}</dd>
        </dl>

        ${s.encounters.map((b) => blockHtml(b, t, row.params.detail === 'Detailed')).join('')}
        ${s.account ? accountBlockHtml(s.account, t, row.params.detail === 'Detailed') : ''}

        <div class="toolbar"><span class="t-title-sm">${esc(t.totals)}</span></div>
        <table class="tbl">
          <tbody>
            <tr><td>${esc(t.totalCharges)}</td><td class="num t-mono-sm">${money(s.totals.totalCharges)}</td></tr>
            <tr><td>${esc(t.payerShare)}</td><td class="num t-mono-sm">${money(s.totals.payerShare)}</td></tr>
            <tr><td>${esc(t.patientShare)}</td><td class="num t-mono-sm">${money(s.totals.patientShare)}</td></tr>
            <tr><td>${esc(t.payments)}</td><td class="num t-mono-sm">${money(s.totals.paid)}</td></tr>
            <tr><td>${esc(t.deposits)}</td><td class="num t-mono-sm">${money(s.totals.depositsApplied)}</td></tr>
            <tr><td>${esc(t.adjustments)}</td><td class="num t-mono-sm">${money(s.totals.adjustments)}</td></tr>
            ${s.totals.refunds ? `<tr><td>${esc(t.refunds)}</td><td class="num t-mono-sm">${money(s.totals.refunds)}</td></tr>` : ''}
            ${s.totals.depositsHeld ? `<tr><td>${esc(t.depositsHeld)}</td><td class="num t-mono-sm">${money(s.totals.depositsHeld)}</td></tr>` : ''}
            <tr><td><b>${esc(t.balanceDue)}</b></td><td class="num t-mono"><b>${money(s.balanceDue)}</b></td></tr>
          </tbody>
        </table>
        <p class="t-body-sm">${esc(t.foot)}</p>
      </div>
    </div>`;
}

function blockHtml(b, t, detailed) {
  return `
    <div class="toolbar">
      <span class="t-title-sm">${esc(t.encounter)} <span class="t-mono-sm">${esc(b.no)}</span></span>
      <span class="badge">${esc(b.typeLabel)}</span>
      <span class="t-body-sm">${esc(b.department)}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${esc(t.dates)}: ${b.startAt ? esc(date(b.startAt)) : '—'}${b.endAt ? ` – ${esc(date(b.endAt))}` : ''}</span>
    </div>
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col" class="num">${esc(t.charges)}</th>
          <th scope="col" class="num">${esc(t.payerShare)}</th>
          <th scope="col" class="num">${esc(t.patientShare)}</th>
          <th scope="col" class="num">${esc(t.payments)}</th>
          <th scope="col" class="num">${esc(t.deposits)}</th>
          <th scope="col" class="num">${esc(t.adjustments)}</th>
          <th scope="col" class="num">${esc(t.unpaid)}</th>
          <th scope="col">${esc(t.settlement)}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="num t-mono-sm">${money(b.charges)}</td>
          <td class="num t-mono-sm">${money(b.payerShare)}</td>
          <td class="num t-mono-sm">${money(b.patientShare)}</td>
          <td class="num t-mono-sm">${money(b.payments)}</td>
          <td class="num t-mono-sm">${money(b.deposits)}</td>
          <td class="num t-mono-sm">${money(b.adjustments)}</td>
          <td class="num t-mono-sm"><b>${money(b.unpaid)}</b></td>
          <td><span class="badge">${esc(t[b.settlementStatus] || b.settlementStatus)}</span></td>
        </tr>
      </tbody>
    </table>
    ${detailed && b.lines?.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">${esc(t.item)}</th><th scope="col" class="num">${esc(t.qty)}</th><th scope="col" class="num">${esc(t.allowed)}</th><th scope="col" class="num">${esc(t.payer)}</th><th scope="col" class="num">${esc(t.patientCol)}</th></tr></thead>
        <tbody>${b.lines.map((l) => `
          <tr>
            <td>${l.reversed ? '<s>' : ''}<span class="t-mono-sm">${esc(l.code)}</span> ${esc(l.description)}${l.reversed ? '</s>' : ''}
              ${l.isOverage ? `<span class="badge badge--warning">${esc(t.overage)}</span>` : ''}${l.reversed ? `<span class="badge">${esc(t.reversed)}</span>` : ''}</td>
            <td class="num t-mono-sm">${esc(l.qty)}</td>
            <td class="num t-mono-sm">${money(l.allowed)}</td>
            <td class="num t-mono-sm">${money(l.payer)}</td>
            <td class="num t-mono-sm">${money(l.patient)}</td>
          </tr>`).join('')}</tbody>
      </table>` : ''}
    ${detailed && b.movements?.length ? movementsHtml(b.movements, t) : ''}`;
}

function accountBlockHtml(a, t, detailed) {
  return `
    <div class="toolbar"><span class="t-title-sm">${esc(t.account)}</span></div>
    <table class="tbl">
      <thead><tr><th scope="col" class="num">${esc(t.payments)}</th><th scope="col" class="num">${esc(t.deposits)}</th><th scope="col" class="num">${esc(t.adjustments)}</th><th scope="col" class="num">${esc(t.unpaid)}</th></tr></thead>
      <tbody><tr>
        <td class="num t-mono-sm">${money(a.paid)}</td>
        <td class="num t-mono-sm">${money(a.depositsApplied)}</td>
        <td class="num t-mono-sm">${money(a.adjustments)}</td>
        <td class="num t-mono-sm"><b>${money(a.outstanding)}</b></td>
      </tr></tbody>
    </table>
    ${detailed && a.movements?.length ? movementsHtml(a.movements, t) : ''}`;
}

const movementsHtml = (rows, t) => `
  <table class="tbl">
    <thead><tr><th scope="col">${esc(t.movements)}</th><th scope="col" class="num"></th></tr></thead>
    <tbody>${rows.map((m) => `
      <tr>
        <td>${m.reversed ? '<s>' : ''}<span class="t-mono-sm">${esc(date(m.at))}</span> ${esc(m.description)}${m.reversed ? '</s>' : ''}</td>
        <td class="num t-mono-sm">${money(m.amount)}</td>
      </tr>`).join('')}</tbody>
  </table>`;
