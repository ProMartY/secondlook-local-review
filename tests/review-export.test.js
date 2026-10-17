import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';
import { buildReviewCsv } from '../public/review-export.js';

const pair = {
  id: 'pair-2-3', kind: 'semantic', similarity: 0.9307, reason: 'Candidate only',
  left: {id:'NS-201',sourceRow:2,vendor:'Northline Studio',currency:'USD',amount:'480.00',date:'2026-10-02',description:'Mobile layout, including "small screens"'},
  right: {id:'NS-218',sourceRow:3,vendor:'NORTHLINE STUDIO',currency:'USD',amount:'480.00',date:'2026-10-04',description:'Responsive CSS\nfor the landing page'},
};
const read = (text) => parse(text, {columns:true,bom:true});
test('CSV retains both original vendors, multiline evidence and human review', () => {
  const [row] = read(buildReviewCsv([pair], () => ({decision:'needs_context',note:'Check the actual service period.'})));
  assert.equal(row.left_vendor, 'Northline Studio');
  assert.equal(row.right_vendor, 'NORTHLINE STUDIO');
  assert.equal(row.left_description, pair.left.description);
  assert.equal(row.right_description, pair.right.description);
  assert.equal(row.review_decision, 'needs_context');
  assert.equal(row.review_note, 'Check the actual service period.');
});
test('CSV neutralizes formula-like notes and source fields', () => {
  const unsafe = {...pair,left:{...pair.left,vendor:' =HYPERLINK("https://example.invalid")'}};
  const [row] = read(buildReviewCsv([unsafe], () => ({decision:'pending',note:'\t+SUM(1,2)'})));
  assert.ok(row.left_vendor.startsWith("'"));
  assert.ok(row.review_note.startsWith("'"));
  assert.equal(row.right_vendor, 'NORTHLINE STUDIO');
});
test('no candidates produces a valid header-only review export', () => {
  const text = buildReviewCsv([], () => { throw new Error('No review should be requested'); });
  assert.deepEqual(read(text), []);
  assert.ok(text.includes('left_vendor'));
  assert.ok(text.includes('right_vendor'));
});
