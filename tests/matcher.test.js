import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceCSV, validateInvoices } from '../src/invoices.js';
import { createCandidates, cosineSimilarity } from '../src/matcher.js';

const header = 'id,vendor,date,currency,amount,description';
const base = ['A1', 'Northstar Studio', '2026-10-02', 'USD', '480', 'Website maintenance'];
function pair(overrides = {}, vectors = [[1, 0], [1, 0]]) {
  const other = { ...Object.fromEntries(['id', 'vendor', 'date', 'currency', 'amount', 'description'].map((key, index) => [key, base[index]])), id: 'A2', date: '2026-10-04', ...overrides };
  const records = validateInvoices(parseInvoiceCSV(`${header}\n${base.join(',')}\n${Object.values(other).join(',')}`)).rows;
  return createCandidates(records, vectors);
}

test('semantic wording alone cannot cross vendor, currency, amount or date gates', () => {
  for (const overrides of [{ vendor: 'Different Studio' }, { currency: 'EUR' }, { amount: '480.02' }, { date: '2026-10-17' }]) {
    assert.equal(pair(overrides).length, 0, JSON.stringify(overrides));
  }
});

test('one-cent and fourteen-day boundaries are included', () => {
  assert.equal(pair({ amount: '480.01', date: '2026-10-16' }).length, 1);
  assert.equal(pair({ amount: '479.99' })[0].amountDelta, 0.01);
});

test('unrelated descriptions with identical metadata do not create a semantic candidate', () => {
  assert.equal(pair({ description: 'Video editing' }, [[1, 0], [0, 1]]).length, 0);
});

test('same identifier survives a changed description and long date gap', () => {
  const candidates = pair({ id: ' a1 ', date: '2026-12-02', description: 'Changed administrative reference' }, [[1, 0], [0, 1]]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'exact');
  assert.equal(candidates[0].similarity, 0);
  assert.match(candidates[0].reason, /repeated numbering may be legitimate/);
});

test('same identifier still requires matching currency and amount', () => {
  assert.equal(pair({ id: 'A1', currency: 'EUR' }).length, 0);
  assert.equal(pair({ id: 'A1', amount: '481' }).length, 0);
});

test('regular monthly charges outside the date window stay out of the queue', () => {
  assert.equal(pair({ date: '2026-11-02', description: 'Website maintenance' }).length, 0);
});

test('three rows produce each unordered pair once, never self matches', () => {
  const rows = validateInvoices(parseInvoiceCSV(`${header}\n${base.join(',')}\nA2,Northstar Studio,2026-10-04,USD,480,Site care\nA3,Northstar Studio,2026-10-05,USD,480,Web care`)).rows;
  const candidates = createCandidates(rows, [[1, 0], [1, 0], [1, 0]]);
  assert.equal(candidates.length, 3);
  assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, 3);
  assert(candidates.every((candidate) => candidate.left.sourceRow !== candidate.right.sourceRow));
  assert(candidates.every((candidate) => !('cents' in candidate.left)));
});

test('invalid embeddings fail instead of inventing a similarity', () => {
  assert.throws(() => cosineSimilarity([0, 0], [1, 0]));
  assert.throws(() => cosineSimilarity([1], [1, 0]));
  assert.throws(() => cosineSimilarity([NaN, 1], [1, 0]));
  assert.equal(cosineSimilarity([10, 0], [1, 0]), 1);
});
