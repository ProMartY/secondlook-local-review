import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeCSV } from '../src/workflow.js';
import { modelStatus, MODEL_CACHE_DIR, MODEL_ID, MODEL_REVISION } from '../src/model.js';

const sampleFile = new URL('../public/sample.csv', import.meta.url);
const reportFile = new URL('./verification-public-sample.json', import.meta.url);
const csv = await readFile(sampleFile, 'utf8');
try {
  const result = await analyzeCSV(csv);
  assert.equal(result.summary.rows, 12);
  assert.equal(result.summary.candidates, 2);
  const semantic = result.candidates.find((candidate) => candidate.kind === 'semantic');
  const exact = result.candidates.find((candidate) => candidate.kind === 'exact');
  assert.deepEqual([semantic.left.id, semantic.right.id], ['NS-201', 'NS-218']);
  assert.deepEqual([exact.left.id, exact.right.id], ['TC-007', 'TC-007']);
  assert(result.candidates.every((candidate) => candidate.left.currency === candidate.right.currency));
  const second = await analyzeCSV(csv);
  assert.deepEqual(second.candidates, result.candidates);
  const modelAssets = [];
  for (const relative of ['config.json', 'tokenizer_config.json', 'tokenizer.json', 'onnx/model_quantized.onnx']) {
    const bytes = await readFile(path.join(MODEL_CACHE_DIR, MODEL_ID, MODEL_REVISION, relative));
    modelAssets.push({ file: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const report = {
    test: 'public-sample-real-open-model', testedAt: new Date().toISOString(), passed: true,
    syntheticOnly: true, caveat: 'Twelve synthetic invoices with two predefined positive pairs and several negative controls are a functional fixture, not a production accuracy benchmark.',
    node: process.version, platform: process.platform, modelState: modelStatus(),
    sampleSHA256: createHash('sha256').update(csv).digest('hex'), summary: result.summary,
    candidates: result.candidates.map(({ id, kind, similarity, left, right }) => ({ id, kind, similarity, leftId: left.id, rightId: right.id, leftSourceRow: left.sourceRow, rightSourceRow: right.sourceRow })),
    firstRun: { timing: result.timing, stages: result.stages },
    secondRun: { timing: second.timing, stages: second.stages }, modelAssets,
  };
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ test: 'public-sample-real-open-model', passed: false, error: error.message }));
  process.exitCode = 1;
}
