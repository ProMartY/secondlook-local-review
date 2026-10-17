import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { performance } from 'node:perf_hooks';
import { parseInvoiceCSV, validateInvoices, parsedSchema, validatedSchema, publicInvoice, InputError } from './invoices.js';
import { createCandidates, LIMITATIONS, SEMANTIC_THRESHOLD, MAX_DAY_DISTANCE } from './matcher.js';
import { embedDescriptions, MODEL_ID, MODEL_REVISION } from './model.js';

const inputSchema = z.object({ csv: z.string() });
const embeddedSchema = validatedSchema.extend({ vectors: z.array(z.array(z.number())) });
const outputSchema = z.object({ candidates: z.array(z.any()), rows: z.array(z.any()) });

export function createReviewWorkflow({ embed = embedDescriptions, onStage = () => {}, stages = [] } = {}) {
  const timed = (name, operation) => async (context) => {
    onStage(name);
    const started = performance.now();
    const output = await operation(context.inputData);
    stages.push({ name, durationMs: Math.round(performance.now() - started) });
    return output;
  };
  const parseStep = createStep({
    id: 'parse-csv', inputSchema, outputSchema: parsedSchema,
    execute: timed('Parse CSV', ({ csv }) => parseInvoiceCSV(csv)),
  });
  const validateStep = createStep({
    id: 'validate-invoices', inputSchema: parsedSchema, outputSchema: validatedSchema,
    execute: timed('Validate invoices', (parsed) => validateInvoices(parsed)),
  });
  const embedStep = createStep({
    id: 'embed-descriptions', inputSchema: validatedSchema, outputSchema: embeddedSchema,
    execute: timed('Embed descriptions locally', async ({ rows }) => ({
      rows, vectors: await embed(rows.map((row) => row.description)),
    })),
  });
  const matchStep = createStep({
    id: 'build-review-queue', inputSchema: embeddedSchema, outputSchema,
    execute: timed('Build review queue', ({ rows, vectors }) => ({
      candidates: createCandidates(rows, vectors), rows: rows.map(publicInvoice),
    })),
  });
  return createWorkflow({
    id: 'secondlook-invoice-review', inputSchema, outputSchema,
    options: { validateInputs: true, shouldPersistSnapshot: () => false, emitStepEvents: false, autoRestartActiveRuns: false },
  }).then(parseStep).then(validateStep).then(embedStep).then(matchStep).commit();
}

export async function analyzeCSV(csv, { embed = embedDescriptions, onStage } = {}) {
  // Reject invalid input before Mastra handles it. This keeps validation responses
  // useful and avoids logging raw CSV/field content from framework validation.
  validateInvoices(parseInvoiceCSV(csv));
  const stages = [];
  const started = performance.now();
  const workflow = createReviewWorkflow({ embed, onStage, stages });
  const run = await workflow.createRun();
  const result = await run.start({ inputData: { csv }, tracingOptions: { hideInput: true, hideOutput: true } });
  if (result.status !== 'success') {
    if (result.error instanceof InputError) throw result.error;
    throw new Error('Analysis did not complete. Check the model status and try again.');
  }
  const { candidates, rows } = result.result;
  return {
    runId: run.runId,
    model: { id: MODEL_ID, revision: MODEL_REVISION, engine: 'Transformers.js / ONNX Runtime / CPU', dtype: 'q8', inference: 'local' },
    workflow: { framework: 'Mastra', id: 'secondlook-invoice-review' },
    stages,
    summary: {
      rows: rows.length, candidates: candidates.length,
      semanticCandidates: candidates.filter((candidate) => candidate.kind === 'semantic').length,
      exactCandidates: candidates.filter((candidate) => candidate.kind === 'exact').length,
    },
    candidates, rows, limitations: LIMITATIONS,
    settings: { semanticThreshold: SEMANTIC_THRESHOLD, semanticDateWindowDays: MAX_DAY_DISTANCE, amountTolerance: 0.01 },
    timing: { totalMs: Math.round(performance.now() - started) },
  };
}
