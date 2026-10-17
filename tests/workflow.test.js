import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCSV } from '../src/workflow.js';
import { InputError } from '../src/invoices.js';

const csv = 'id,vendor,date,currency,amount,description\nA1,Acme,2026-10-02,USD,100,Website maintenance\nA2,Acme,2026-10-04,USD,100,Site upkeep';

test('the actual Mastra workflow parses, validates, embeds and returns evidence', async () => {
  const seen = [];
  const result = await analyzeCSV(csv, {
    embed: async (descriptions) => { assert.deepEqual(descriptions, ['Website maintenance', 'Site upkeep']); return [[1, 0], [1, 0]]; },
    onStage: (stage) => seen.push(stage),
  });
  assert.equal(result.workflow.framework, 'Mastra');
  assert.equal(result.summary.semanticCandidates, 1);
  assert.equal(result.stages.length, 4);
  assert.equal(seen.length, 4);
  assert.equal(result.candidates[0].left.description, 'Website maintenance');
  assert.equal(result.candidates[0].right.sourceRow, 3);
  assert(result.runId);
});

test('invalid input is rejected before model initialization', async () => {
  let called = false;
  await assert.rejects(() => analyzeCSV('id,vendor\n1,Acme', { embed: async () => { called = true; } }), InputError);
  assert.equal(called, false);
});
