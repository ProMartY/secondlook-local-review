import { parse } from 'csv-parse/sync';
import { z } from 'zod';

export const MAX_ROWS = 150;
export const MAX_CSV_BYTES = 256 * 1024;
export const HEADERS = ['id', 'vendor', 'date', 'currency', 'amount', 'description'];
const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'));

export class InputError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'InputError';
    this.issues = issues;
  }
}

export const invoiceSchema = z.object({
  id: z.string(), vendor: z.string(), date: z.string(), currency: z.string(),
  amount: z.number().positive(), description: z.string(), sourceRow: z.number().int(),
  cents: z.number().int(), vendorKey: z.string(), idKey: z.string(), day: z.number().int(),
});
export const publicInvoiceSchema = invoiceSchema.omit({ cents: true, vendorKey: true, idKey: true, day: true });
export const parsedSchema = z.object({ records: z.array(z.array(z.string())) });
export const validatedSchema = z.object({ rows: z.array(invoiceSchema) });

export function parseInvoiceCSV(csv) {
  if (typeof csv !== 'string' || !csv.trim()) throw new InputError('Paste or choose a non-empty CSV file.');
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) throw new InputError('CSV is larger than the 256 KB limit.');
  let records;
  try {
    records = parse(csv, { bom: true, skip_empty_lines: true, max_record_size: MAX_CSV_BYTES });
  } catch (error) {
    throw new InputError('CSV could not be parsed. Check quoting and the number of fields.', [
      { row: error.records !== undefined ? error.records + 1 : null, field: 'csv', message: 'Malformed CSV record.' },
    ]);
  }
  if (records.length < 1) throw new InputError('The CSV header is missing.');
  const headers = records[0].map((cell) => cell.trim().toLowerCase());
  if (headers.length !== HEADERS.length || new Set(headers).size !== HEADERS.length || HEADERS.some((h) => !headers.includes(h))) {
    throw new InputError(`Use exactly these CSV headers: ${HEADERS.join(',')}.`);
  }
  const order = HEADERS.map((header) => headers.indexOf(header));
  return { records: records.slice(1).map((record) => order.map((index) => record[index])) };
}

export function canonicalVendor(value) {
  // Conservative normalization only. Legal suffixes and words remain significant.
  return value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  const year = date.getUTCFullYear();
  return year >= 1900 && year <= 2100 ? Math.trunc(date.getTime() / 86400000) : null;
}

function parseCents(value) {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cents > 0 && Number.isSafeInteger(cents) ? cents : null;
}

export function validateInvoices({ records }) {
  if (records.length < 2 || records.length > MAX_ROWS) throw new InputError(`Use 2–${MAX_ROWS} invoice records.`);
  const issues = [];
  const rows = [];
  const limits = { id: 128, vendor: 160, date: 10, currency: 3, amount: 16, description: 1000 };
  records.forEach((record, index) => {
    const sourceRow = index + 2;
    const values = Object.fromEntries(HEADERS.map((header, cell) => [header, (record[cell] ?? '').trim()]));
    let invalid = false;
    const issue = (field, message) => { invalid = true; issues.push({ row: sourceRow, field, message }); };
    for (const header of HEADERS) {
      if (!values[header]) issue(header, 'A value is required.');
      else if (values[header].length > limits[header]) issue(header, `Maximum length is ${limits[header]} characters.`);
      else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(values[header])) issue(header, 'Unsupported control character.');
    }
    const currency = values.currency.toUpperCase();
    if (!supportedCurrencies.has(currency)) issue('currency', 'Use a recognized three-letter ISO currency code.');
    else if (new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits !== 2) {
      issue('currency', 'This prototype supports currencies with exactly two decimal places.');
    }
    const cents = parseCents(values.amount);
    if (cents === null) issue('amount', 'Use a positive decimal amount with at most two decimal places; no symbols, separators or exponent notation.');
    const day = parseDate(values.date);
    if (day === null) issue('date', 'Use a real date in YYYY-MM-DD format between 1900 and 2100.');
    const vendorKey = canonicalVendor(values.vendor);
    if (!vendorKey) issue('vendor', 'Vendor must contain a letter or digit.');
    if (!invalid) rows.push({
      ...values, currency, sourceRow, amount: cents / 100, cents, vendorKey,
      idKey: values.id.normalize('NFKC').toUpperCase().replace(/\s+/g, ''), day,
    });
  });
  // One bad row rejects the entire request. No invoice silently disappears.
  if (issues.length) throw new InputError('Fix the listed CSV fields and try again. No rows were analyzed.', issues);
  return { rows };
}

export function publicInvoice(row) {
  const { cents, vendorKey, idKey, day, ...publicRow } = row;
  return publicRow;
}
