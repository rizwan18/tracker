import type { Account, Bill, CapitalGainDisposal, Category, Dividend, Document, Investment, InvestmentTransaction, Property, PropertyPhoto, PropertyScheduleLine, PropertyYearDetail, Reminder, Transaction } from "@prisma/client";
import { escapeFormula, toCsv } from "../../lib/csv";
import { EXPORT_FORMAT_TITLE, EXPORT_FORMAT_VERSION, SECTION_COLUMNS, SECTION_ORDER, type SectionName } from "./sections";

export interface ExportData {
  profile: { fullName: string; email: string; timezone: string; easyViewEnabled: boolean; householdName: string };
  accounts: Account[];
  categories: Category[];
  properties: Property[];
  owners: Array<{ propertyId: string; email: string; percentage: number }>;
  scheduleLines: PropertyScheduleLine[];
  yearDetails: PropertyYearDetail[];
  photos: PropertyPhoto[];
  investments: Investment[];
  investmentTransactions: InvestmentTransaction[];
  dividends: Dividend[];
  disposals: CapitalGainDisposal[];
  transactions: Transaction[];
  bills: Bill[];
  reminders: Reminder[];
  documents: Document[];
}

// Cell formatters. Text is protected against spreadsheet formulas; numbers, dates
// and booleans are written in a fixed machine-readable form.
const t = (v: string | null | undefined): string => (v == null ? "" : escapeFormula(v));
const n = (v: number | null | undefined): string => (v == null ? "" : String(v));
const d = (v: Date | null | undefined): string => (v == null ? "" : v.toISOString());
const b = (v: boolean): string => (v ? "true" : "false");
const id = (v: string | null | undefined): string => v ?? "";

/** Turns already-loaded data into the export file text. Pure — no database access. */
export function renderExportCsv(data: ExportData, now: Date = new Date()): string {
  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));
  const propertyName = new Map(data.properties.map((p) => [p.id, p.name]));
  const investmentName = new Map(data.investments.map((i) => [i.id, i.name]));
  const nameOf = (map: Map<string, string>, key: string | null | undefined) => (key ? t(map.get(key)) : "");

  const sections: Record<SectionName, string[][]> = {
    profile: [[t(data.profile.fullName), t(data.profile.email), data.profile.timezone, b(data.profile.easyViewEnabled), t(data.profile.householdName)]],
    accounts: data.accounts.map((a) => [a.id, t(a.name), a.type]),
    categories: data.categories.map((c) => [c.id, t(c.name), c.direction, b(c.isCustom)]),
    properties: data.properties.map((p) => [
      p.id, t(p.name), t(p.address), p.propertyType, d(p.purchaseDate), n(p.purchasePrice), n(p.currentEstimatedValue), n(p.loanBalance),
      n(p.loanInterestRate), t(p.rentalAgent), t(p.tenantName), n(p.rentAmount), id(p.rentFrequency), d(p.rentalStartDate),
      d(p.availableForRentDate), b(p.scheduleInitialised), t(p.notes), t(p.managerName), t(p.managerCompany), t(p.managerEmail), t(p.managerPhone),
      t(p.managerMobile), t(p.managerWebsite), t(p.managerAbn), t(p.managerAddress), t(p.managerNotes),
    ]),
    property_owners: data.owners.map((o) => [o.propertyId, nameOf(propertyName, o.propertyId), t(o.email), n(o.percentage)]),
    property_schedule_lines: data.scheduleLines.map((l) => [
      l.id, l.propertyId, nameOf(propertyName, l.propertyId), l.categoryId, nameOf(categoryName, l.categoryId), t(l.label), b(l.isManual), String(l.sortOrder),
    ]),
    property_year_details: data.yearDetails.map((y) => [y.id, y.propertyId, nameOf(propertyName, y.propertyId), y.financialYear, n(y.weeksRented)]),
    property_photos: data.photos.map((x) => [x.id, x.propertyId, nameOf(propertyName, x.propertyId), t(x.fileName), x.contentType, x.filePath, id(x.thumbPath), b(x.isPrimary)]),
    investments: data.investments.map((i) => [i.id, t(i.name), t(i.ticker), i.type, t(i.notes), n(i.currentValueOverride)]),
    investment_transactions: data.investmentTransactions.map((x) => [
      x.id, x.investmentId, nameOf(investmentName, x.investmentId), x.type, d(x.date), n(x.quantity), n(x.pricePerUnit), n(x.brokerage), t(x.notes),
    ]),
    dividends: data.dividends.map((x) => [
      x.id, x.investmentId, nameOf(investmentName, x.investmentId), d(x.exDividendDate), d(x.paymentDate), n(x.grossAmount), n(x.frankingCredit),
      n(x.frankedAmount), n(x.unfrankedAmount), n(x.taxWithheld), n(x.netAmount), x.status, t(x.notes), x.financialYear,
    ]),
    capital_gain_disposals: data.disposals.map((x) => [
      x.id, x.investmentId, nameOf(investmentName, x.investmentId), d(x.purchaseDate), n(x.purchasePrice), n(x.purchaseCosts), d(x.saleDate),
      n(x.salePrice), n(x.saleCosts), n(x.quantity), n(x.ownershipPercentage), n(x.costBase), n(x.proceeds), n(x.grossGainLoss),
      String(x.holdingPeriodDays), x.financialYear, t(x.notes),
    ]),
    transactions: data.transactions.map((x) => [
      x.id, d(x.date), t(x.description), n(x.amount), x.direction, id(x.categoryId), nameOf(categoryName, x.categoryId), id(x.accountId),
      nameOf(accountName, x.accountId), id(x.propertyId), nameOf(propertyName, x.propertyId), id(x.investmentId), nameOf(investmentName, x.investmentId),
      t(x.notes), b(x.isRecurring), id(x.recurrenceFrequency), t(x.potentialTaxCategory), x.financialYear,
    ]),
    bills: data.bills.map((x) => [
      x.id, t(x.name), t(x.provider), n(x.amount), x.frequency, d(x.nextDueDate), id(x.accountId), nameOf(accountName, x.accountId), id(x.categoryId),
      nameOf(categoryName, x.categoryId), id(x.propertyId), nameOf(propertyName, x.propertyId), b(x.autoRenew), String(x.reminderDaysBefore), x.status, t(x.notes),
    ]),
    reminders: data.reminders.map((x) => [x.id, id(x.billId), id(x.transactionId), id(x.dividendId), t(x.title), d(x.dueDate), String(x.daysBefore), x.status, t(x.notes)]),
    documents: data.documents.map((x) => [
      x.id, t(x.fileName), x.fileType, x.filePath, id(x.transactionId), id(x.propertyId), id(x.investmentId), id(x.dividendId), id(x.capitalGainDisposalId),
    ]),
  };

  const rows: string[][] = [
    [EXPORT_FORMAT_TITLE, String(EXPORT_FORMAT_VERSION)],
    ["Exported at", now.toISOString()],
    ["Note", "This file contains all of your financial information — keep it somewhere safe. Import it from the dashboard to bring your data back."],
    [],
  ];
  for (const name of SECTION_ORDER) {
    rows.push([`[${name}]`], [...SECTION_COLUMNS[name]], ...sections[name], []);
  }
  return toCsv(rows);
}

