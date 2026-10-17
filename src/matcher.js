import { publicInvoice } from './invoices.js';

export const SEMANTIC_THRESHOLD = 0.78;
export const MAX_DAY_DISTANCE = 14;
export const MAX_CENT_DIFFERENCE = 1;

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) {
    throw new Error('Embedding dimensions do not match.');
  }
  let dot = 0, leftMagnitude = 0, rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) throw new Error('Embedding is not finite.');
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  if (!leftMagnitude || !rightMagnitude) throw new Error('Embedding has zero magnitude.');
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftMagnitude * rightMagnitude)));
}

export function createCandidates(rows, vectors) {
  if (vectors.length !== rows.length) throw new Error('Every invoice must have one embedding.');
  const candidates = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const left = rows[i], right = rows[j];
      if (left.vendorKey !== right.vendorKey || left.currency !== right.currency) continue;
      const centsDifference = Math.abs(left.cents - right.cents);
      if (centsDifference > MAX_CENT_DIFFERENCE) continue;
      const dayDistance = Math.abs(left.day - right.day);
      const exactId = left.idKey === right.idKey;
      if (!exactId && dayDistance > MAX_DAY_DISTANCE) continue;
      const similarity = cosineSimilarity(vectors[i], vectors[j]);
      if (!exactId && similarity < SEMANTIC_THRESHOLD) continue;
      const reason = exactId
        ? `Same invoice identifier, normalized vendor, currency and amount within one cent.${dayDistance > MAX_DAY_DISTANCE ? ' The dates are more than 14 days apart; repeated numbering may be legitimate.' : ''} Review the source documents even if the descriptions differ.`
        : `Same normalized vendor and currency; amount differs by ${centsDifference} cent${centsDifference === 1 ? '' : 's'}; dates are ${dayDistance} day${dayDistance === 1 ? '' : 's'} apart. Description cosine similarity meets the ${SEMANTIC_THRESHOLD} review threshold. This is not proof of a duplicate.`;
      candidates.push({
        id: `pair-${left.sourceRow}-${right.sourceRow}`,
        left: publicInvoice(left), right: publicInvoice(right),
        similarity: Math.round(similarity * 10000) / 10000,
        kind: exactId ? 'exact' : 'semantic', priority: exactId ? 'high' : 'review',
        reason, dayDistance, amountDelta: centsDifference / 100,
      });
    }
  }
  return candidates.sort((a, b) => (a.kind === b.kind ? b.similarity - a.similarity : a.kind === 'exact' ? -1 : 1));
}

export const LIMITATIONS = [
  'Candidates need a human review of the original invoice and payment history. No payment, deletion or accounting action is performed.',
  'Cosine similarity measures wording proximity, not a probability that a payment is duplicated. The 0.78 threshold is a prototype preset, not a validated production classifier.',
  'Vendor matching only normalizes case, punctuation and spacing. It cannot establish that two vendor names identify the same legal entity.',
  'Semantic candidates require the same normalized vendor and currency, amounts within one cent, and dates within 14 days. Different amounts, spellings or wider date gaps can hide real duplicates.',
  'Matching invoice identifiers bypass the 14-day gate, but still require the vendor, currency and amount checks. Number reuse can be legitimate.',
  'MiniLM is primarily an English sentence-embedding model. Long descriptions may be token-truncated; multilingual accuracy and domain-specific accuracy have not been established.',
  'Positive invoices in two-decimal ISO currencies only. Credit notes, tax reconciliation and currency conversion are outside this prototype.',
];
