import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceCSV, validateInvoices, canonicalVendor, InputError } from '../src/invoices.js';

const header = 'id,vendor,date,currency,amount,description';
const row = 'A1,Northstar Studio,2026-10-02,USD,480.00,Website maintenance';
const other = 'A2,Northstar Studio,2026-10-04,USD,480,Website care';
const read = (csv) => validateInvoices(parseInvoiceCSV(csv)).rows;

test('quoted commas, escaped quotes and quoted newlines remain one invoice record', () => {
  const rows = read(`${header}\r\nA1,"Northstar, Studio",2026-10-02,USD,480.00,"Website \"\"care\"\"\nOctober"\r\n${other}\r\n`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].vendor, 'Northstar, Studio');
  assert.equal(rows[0].description, 'Website "care"\nOctober');
  assert.equal(rows[1].sourceRow, 3);
});

test('BOM and reordered headers are accepted without corrupting fields', () => {
  const rows = read('\ufeffdescription,amount,currency,date,vendor,id\nSite care,480,USD,2026-10-02,Acme,A1\nSEO care,480,USD,2026-10-04,Acme,A2');
  assert.equal(rows[0].amount, 480); assert.equal(rows[0].id, 'A1');
});

test('duplicate, missing or unexpected CSV headers are rejected', () => {
  assert.throws(() => parseInvoiceCSV(`id,id,date,currency,amount,description\n${row}\n${other}`), InputError);
  assert.throws(() => parseInvoiceCSV(`id,vendor,date,currency,amount,description,secret\n${row},x\n${other},y`), InputError);
});

test('malformed CSV never silently drops an invoice', () => {
  assert.throws(() => read(`${header}\n${row}\nA2,Missing,Columns`), InputError);
  assert.throws(() => read(`${header}\n${row}\n"unclosed`), InputError);
});

test('invalid and ambiguous monetary input is rejected before analysis', () => {
  for (const amount of ['1e3', '-2', '0', '3.001', '$20', '01.00', 'NaN']) {
    assert.throws(() => read(`${header}\n${row}\nA2,Acme,2026-10-02,USD,${amount},Care`), InputError, amount);
  }
  assert.equal(read(`${header}\n${row}\n${other}`)[0].cents, 48000);
});

test('calendar rollover, non-ISO dates and non-two-decimal currencies are rejected', () => {
  for (const date of ['2026-02-29', '2026-04-31', '02/03/2026', '2101-01-01']) {
    assert.throws(() => read(`${header}\n${row}\nA2,Acme,${date},USD,20,Care`), InputError, date);
  }
  for (const currency of ['ABC', 'JPY', 'KWD']) {
    assert.throws(() => read(`${header}\n${row}\nA2,Acme,2026-10-02,${currency},20,Care`), InputError, currency);
  }
});

test('a bad record rejects the complete request and identifies the logical row', () => {
  assert.throws(() => read(`${header}\n${row}\nA2,Acme,2026-02-30,USD,20,Care`), (error) => {
    assert(error instanceof InputError);
    assert(error.issues.some((issue) => issue.row === 3 && issue.field === 'date'));
    return true;
  });
});

test('row and byte limits constrain untrusted input', () => {
  assert.throws(() => read(`${header}\n${row}`), InputError);
  assert.throws(() => read(`${header}\n${Array(151).fill(row).join('\n')}`), InputError);
  assert.throws(() => parseInvoiceCSV('a'.repeat(262145)), InputError);
});

test('vendor normalization does not collapse legally meaningful words', () => {
  assert.equal(canonicalVendor('  NORTHSTAR,  Studio! '), canonicalVendor('Northstar Studio'));
  assert.notEqual(canonicalVendor('Acme LLC'), canonicalVendor('Acme Inc'));
});

test('duplicate invoice identifiers retain distinct source records', () => {
  const rows = read(`${header}\n${row}\n${row}`);
  assert.equal(rows[0].id, rows[1].id);
  assert.notEqual(rows[0].sourceRow, rows[1].sourceRow);
});
