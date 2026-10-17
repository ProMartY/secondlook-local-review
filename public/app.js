import { buildReviewCsv } from './review-export.js';

const $ = (id) => document.getElementById(id);
const state = { result: null, selected: null, reviews: new Map(), busy: false, source: '', lastCsv: '', statusTimer: null };
const labels = { pending: 'Unreviewed', duplicate: 'Marked duplicate', distinct: 'Keep both', needs_context: 'Needs context' };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}
function currency(row) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: row.currency }).format(Number(row.amount)); }
  catch { return `${row.currency} ${Number(row.amount).toFixed(2)}`; }
}
function getReview(id) { return state.reviews.get(id) || { decision: 'pending', note: '' }; }
function showError(text) { $('input-error').textContent = text; $('input-error').hidden = !text; }
function syncInput() { $('analyze').disabled = state.busy || !$('csv-input').value.trim(); }
function sourceChanged(label) {
  state.source = label;
  $('source-label').textContent = label || 'Pasted CSV';
  syncInput();
}
function clearReport() {
  state.result = null; state.selected = null; state.reviews.clear(); state.lastCsv = '';
  ['metric-rows', 'metric-candidates', 'metric-reviewed'].forEach((id) => { $(id).textContent = '—'; });
  $('overview-empty').hidden = false; $('overview-result').hidden = true; $('review-section').hidden = true;
  $('candidate-list').replaceChildren(); $('pair-detail').replaceChildren();
}
async function useSample() {
  if (state.busy) return;
  try {
    const response = await fetch('/sample.csv');
    if (!response.ok) throw new Error('The sample could not be loaded. You can paste your own CSV.');
    $('csv-input').value = await response.text();
    clearReport(); sourceChanged('Fictional sample · 12 invoices'); showError('');
    $('run-status').textContent = 'Sample data is fictional. Ready for comparison.';
  } catch (error) { showError(error.message); }
}
async function loadFile(file) {
  if (!file || state.busy) return;
  if (file.size > 256 * 1024) { showError('This file is larger than 256 KB. Use a smaller CSV with up to 150 invoices.'); return; }
  if (!file.name.toLowerCase().endsWith('.csv')) { showError('Choose a .csv file. PDF and spreadsheet files are not supported in this version.'); return; }
  try { $('csv-input').value = await file.text(); clearReport(); sourceChanged(file.name); showError(''); $('run-status').textContent = 'File loaded locally. Ready for comparison.'; }
  catch { showError('This file could not be read. Try exporting it as UTF-8 CSV.'); }
}
async function pollStatus() {
  if (!state.busy) return;
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    if (!state.busy) return;
    const modelState = status.model?.state || status.state;
    if (modelState === 'loading' || modelState === 'downloading') $('run-status').textContent = 'Preparing the local model. First use downloads model files; your CSV stays here.';
    else if (modelState === 'ready') $('run-status').textContent = 'Comparing invoice descriptions on this computer…';
  } catch { /* The analysis request supplies a useful error if the local server is unavailable. */ }
}
async function analyze() {
  if (state.busy || !$('csv-input').value.trim()) return;
  const submittedCsv = $('csv-input').value;
  const previousReviews = state.lastCsv === submittedCsv ? new Map(state.reviews) : new Map();
  state.busy = true; document.body.classList.add('busy'); syncInput(); showError('');
  $('use-sample').disabled = true; $('clear-session').disabled = true; $('csv-file').disabled = true; $('csv-input').disabled = true;
  $('analyze-label').textContent = 'Comparing invoices…';
  $('run-status').textContent = 'Starting the local comparison. First use may take a minute.';
  state.statusTimer = setInterval(pollStatus, 1200); pollStatus();
  try {
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: submittedCsv }) });
    const result = await response.json();
    if (!response.ok) {
      const issues = Array.isArray(result.issues) ? result.issues.slice(0, 7).map((issue) => `Row ${issue.row ?? '?'}${issue.field ? ` · ${issue.field}` : ''}: ${issue.message}`).join('\n') : '';
      throw new Error([result.error || 'The comparison could not be completed.', issues].filter(Boolean).join('\n'));
    }
    if (!Array.isArray(result.candidates) || !Array.isArray(result.rows)) throw new Error('The local server returned an incomplete report. No review decisions were changed.');
    state.result = result;
    state.lastCsv = submittedCsv;
    state.reviews = new Map(result.candidates.filter((pair) => previousReviews.has(pair.id)).map((pair) => [pair.id, previousReviews.get(pair.id)]));
    state.selected = result.candidates.some((pair) => pair.id === state.selected) ? state.selected : result.candidates[0]?.id ?? null;
    $('review-filter').value = 'all'; renderResults();
    const seconds = Number(result.timing?.totalMs || 0) / 1000;
    $('run-status').textContent = `Comparison complete${seconds ? ` in ${seconds.toFixed(2)}s` : ''}. Review any flagged pairs below.`;
  } catch (error) { showError(error.message || 'The local server could not be reached.'); $('run-status').textContent = 'Comparison did not complete. Your source text is unchanged.'; }
  finally {
    state.busy = false; clearInterval(state.statusTimer); state.statusTimer = null; document.body.classList.remove('busy');
    $('analyze-label').textContent = 'Find possible duplicates'; $('use-sample').disabled = false; $('clear-session').disabled = false; $('csv-file').disabled = false; $('csv-input').disabled = false; syncInput();
  }
}
function renderResults() {
  const result = state.result;
  if (!result) return;
  $('metric-rows').textContent = result.rows.length;
  $('metric-candidates').textContent = result.candidates.length;
  updateReviewedCount();
  $('overview-empty').hidden = true; $('overview-result').hidden = false;
  const exact = result.summary?.exactCandidates ?? result.candidates.filter((pair) => pair.kind === 'exact').length;
  const semantic = result.summary?.semanticCandidates ?? result.candidates.length - exact;
  $('result-summary').textContent = result.candidates.length
    ? `${exact} repeated-ID pair${exact === 1 ? '' : 's'} and ${semantic} related-description pair${semantic === 1 ? '' : 's'} to review. These are candidates, not confirmed duplicates.`
    : 'No candidate pairs passed the current comparison rules. This does not establish that the invoices are unique or correct.';
  const stageList = $('stage-list'); stageList.replaceChildren();
  for (const stage of result.stages || []) {
    const row = node('div', 'stage-row'); row.append(node('span', 'stage-tick', '✓'), node('span', '', stage.name), node('span', 'stage-time', `${Number(stage.durationMs || 0).toFixed(0)} ms`)); stageList.append(row);
  }
  $('review-section').hidden = !result.candidates.length;
  renderCandidates(); renderDetail();
}
function updateReviewedCount() { $('metric-reviewed').textContent = state.result ? state.result.candidates.filter((pair) => getReview(pair.id).decision !== 'pending').length : '—'; }
function filteredPairs() {
  if (!state.result) return [];
  const filter = $('review-filter').value;
  return state.result.candidates.filter((pair) => filter === 'all' || getReview(pair.id).decision === filter);
}
function renderCandidates() {
  const list = $('candidate-list'); list.replaceChildren();
  const pairs = filteredPairs();
  if (!pairs.some((pair) => pair.id === state.selected)) state.selected = pairs[0]?.id ?? null;
  if (!pairs.length) { list.append(node('p', 'empty-filter', 'No pairs match this filter.')); return; }
  for (const pair of pairs) {
    const review = getReview(pair.id);
    const item = node('button', `candidate-item${pair.id === state.selected ? ' selected' : ''}`); item.type = 'button'; item.setAttribute('aria-pressed', String(pair.id === state.selected));
    const head = node('div', 'candidate-head'); head.append(node('span', 'candidate-kind', pair.kind === 'exact' ? 'REPEATED ID' : 'RELATED WORDING'), node('strong', '', currency(pair.left)));
    const foot = node('div', 'candidate-foot'); foot.append(node('span', '', `Rows ${pair.left.sourceRow} ↔ ${pair.right.sourceRow}`), node('span', 'review-state', labels[review.decision]));
    item.append(head, node('div', 'candidate-title', pair.left.vendor), node('div', 'candidate-ids', `${pair.left.id} ↔ ${pair.right.id}`), foot);
    item.addEventListener('click', () => { state.selected = pair.id; renderCandidates(); renderDetail(); }); list.append(item);
  }
}
function evidenceCard(invoice, side) {
  const card = node('section', 'evidence-card');
  card.append(node('div', 'evidence-caption', `INVOICE ${side} · CSV ROW ${invoice.sourceRow}`), node('div', 'evidence-id', invoice.id));
  const fields = node('dl', 'evidence-fields');
  for (const [label, value] of [['Vendor', invoice.vendor], ['Date', invoice.date], ['Amount', `${currency(invoice)} ${invoice.currency}`]]) fields.append(node('dt', '', label), node('dd', '', value));
  card.append(fields, node('p', 'evidence-description', invoice.description)); return card;
}
function renderDetail() {
  const detail = $('pair-detail'); detail.replaceChildren();
  const pair = state.result?.candidates.find((item) => item.id === state.selected);
  if (!pair) { detail.append(node('p', 'empty-filter', 'Select a pair or change the filter.')); return; }
  const review = getReview(pair.id);
  const top = node('div', 'pair-topline'); const heading = node('div'); heading.append(node('h3', '', pair.kind === 'exact' ? 'A repeated invoice identifier' : 'Different words. Related work.'), node('p', '', pair.reason));
  const score = node('div', 'similarity-badge'); score.append(node('strong', '', Number.isFinite(pair.similarity) ? pair.similarity.toFixed(2) : '—'), node('span', '', 'description similarity'));
  top.append(heading, score);
  const evidence = node('div', 'evidence-grid'); evidence.append(evidenceCard(pair.left, 'A'), evidenceCard(pair.right, 'B'));
  const explanation = node('div', 'pair-explanation', 'A similarity score is a comparison signal, not the probability of a duplicate. Check the underlying work, service period and payment records before acting.');
  const actions = node('div', 'pair-actions');
  for (const [value, text] of [['duplicate', 'Mark as duplicate'], ['distinct', 'Keep both'], ['needs_context', 'Needs context']]) {
    const button = node('button', 'decision-button', text); button.type = 'button'; button.setAttribute('aria-pressed', String(review.decision === value));
    button.addEventListener('click', () => {
      const current = getReview(pair.id); state.reviews.set(pair.id, { ...current, decision: current.decision === value ? 'pending' : value });
      updateReviewedCount(); renderCandidates(); renderDetail();
    }); actions.append(button);
  }
  const label = node('label', 'note-label', 'Your review note'); label.htmlFor = 'review-note';
  const note = node('textarea', 'review-note'); note.id = 'review-note'; note.maxLength = 1000; note.placeholder = 'e.g. Confirm that both invoices cover the same work.'; note.value = review.note;
  note.addEventListener('input', () => { state.reviews.set(pair.id, { ...getReview(pair.id), note: note.value }); });
  detail.append(top, evidence, explanation, actions, label, note);
}
function download(name, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function reviewReport() {
  return { ...state.result, sourceLabel: state.source, exportedAt: new Date().toISOString(), reviewWarning: 'Candidate matches are not confirmed duplicates. Review decisions were entered by the user; no payments or source invoices were changed.', reviewedCandidates: state.result.candidates.map((pair) => ({ ...pair, review: getReview(pair.id) })) };
}
function exportCsv() {
  if (!state.result) return;
  download('secondlook-review.csv', buildReviewCsv(state.result.candidates, getReview), 'text/csv;charset=utf-8');
}
$('use-sample').addEventListener('click', useSample);
$('csv-input').addEventListener('input', () => { sourceChanged('Pasted CSV · not yet compared'); clearReport(); });
$('csv-file').addEventListener('change', (event) => loadFile(event.target.files[0]));
$('analyze').addEventListener('click', analyze);
$('review-filter').addEventListener('change', () => { renderCandidates(); renderDetail(); });
$('export-csv').addEventListener('click', exportCsv);
$('export-json').addEventListener('click', () => { if (state.result) download('secondlook-review.json', JSON.stringify(reviewReport(), null, 2), 'application/json'); });
$('clear-session').addEventListener('click', () => { if (state.busy) return; $('csv-input').value = ''; $('csv-file').value = ''; clearReport(); sourceChanged(''); $('source-label').textContent = 'No source loaded'; showError(''); $('run-status').textContent = 'Session cleared. No invoices or review notes are retained.'; });
const dropzone = $('dropzone');
dropzone.addEventListener('dragover', (event) => { event.preventDefault(); if (!state.busy) dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('drag-over'); loadFile(event.dataTransfer.files[0]); });
syncInput();
