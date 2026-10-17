import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { analyzeCSV } from '../src/workflow.js';
import { modelStatus } from '../src/model.js';

// Entirely synthetic fixtures. This is an integration smoke test, not evidence
// of precision/recall on actual accounting records.
const csv = `id,vendor,date,currency,amount,description
NS-100,Northstar Studio,2026-10-02,USD,480,Website hosting and maintenance for October
NS-101,Northstar Studio,2026-10-04,USD,480,October website maintenance and hosting
NS-102,Northstar Studio,2026-10-04,USD,480,Promotional video editing and color grading
TC-80,TwinCloud,2026-10-05,EUR,80,Cloud storage subscription
TC-80,TwinCloud,2026-10-06,EUR,80,Changed reference document
BK-09,Books and Co,2026-09-01,USD,120,Monthly bookkeeping service
BK-10,Books and Co,2026-10-01,USD,120,Monthly bookkeeping service
EU-100,Northstar Studio,2026-10-04,EUR,480,Website hosting and maintenance for October`;

try {
  const result = await analyzeCSV(csv);
  const pairIds = result.candidates.map((candidate) => [candidate.left.id, candidate.right.id].join('|'));
  assert(pairIds.includes('NS-100|NS-101'), 'Expected same-vendor close-date paraphrase candidate.');
  assert(pairIds.includes('TC-80|TC-80'), 'Expected repeated invoice identifier even with changed wording.');
  assert(!pairIds.some((pair) => pair.includes('NS-102')), 'Unrelated video service must not be flagged.');
  assert(!pairIds.includes('BK-09|BK-10'), 'Recurring monthly charges must stay outside the time gate.');
  assert(!pairIds.some((pair) => pair.includes('EU-100')), 'Different currency must not be matched.');
  assert.equal(result.stages.length, 4);
  assert.equal(modelStatus().state, 'ready');
  const report = { test: 'real-open-model-mastra-integration', testedAt: new Date().toISOString(), passed: true, syntheticOnly: true, node: process.version, platform: process.platform, architecture: process.arch, modelState: modelStatus(), runId: result.runId, model: result.model, summary: result.summary, stages: result.stages, candidates: result.candidates.map(({ id, kind, similarity }) => ({ id, kind, similarity })), timing: result.timing };
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex !== -1 && process.argv[reportIndex + 1]) await writeFile(process.argv[reportIndex + 1], `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ test: 'real-open-model-mastra-integration', passed: false, error: error.message }));
  process.exitCode = 1;
}
