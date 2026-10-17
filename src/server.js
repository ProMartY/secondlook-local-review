import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCSV } from './workflow.js';
import { modelStatus } from './model.js';
import { InputError, MAX_CSV_BYTES, MAX_ROWS } from './invoices.js';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.woff2': 'font/woff2',
};

function setHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
}

function json(response, status, value) {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readJSON(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
    const error = new InputError('Send application/json with a csv string.'); error.status = 415; throw error;
  }
  // JSON escaping can enlarge the encoded CSV, so the transport cap is larger
  // than the separate 256 KB decoded-CSV cap checked by parseInvoiceCSV.
  const limit = MAX_CSV_BYTES * 3 + 1024;
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new InputError('Request exceeds the transport limit.'); error.status = 413; throw error;
    }
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InputError('Request must contain valid JSON.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.csv !== 'string') {
    throw new InputError('Send an object with a csv string.');
  }
  return input;
}

export function createServer({ analyze = analyzeCSV, getModelStatus = modelStatus } = {}) {
  let busy = false;
  let stage = null;
  return http.createServer(async (request, response) => {
    setHeaders(response);
    const expectedPort = request.socket.localPort;
    const allowedHosts = new Set([`127.0.0.1:${expectedPort}`, `localhost:${expectedPort}`]);
    if (!allowedHosts.has(request.headers.host || '')) return json(response, 403, { error: 'Local host only.' });
    const origin = request.headers.origin;
    if (origin && !new Set([`http://127.0.0.1:${expectedPort}`, `http://localhost:${expectedPort}`]).has(origin)) {
      return json(response, 403, { error: 'Cross-origin access is disabled.' });
    }
    let url;
    try { url = new URL(request.url, `http://127.0.0.1:${expectedPort}`); }
    catch { return json(response, 400, { error: 'Invalid URL.' }); }
    if (url.pathname === '/api/status' && request.method === 'GET') {
      return json(response, 200, {
        app: 'SecondLook', model: getModelStatus(), analysis: { busy, stage },
        limits: { minimumRows: 2, maximumRows: MAX_ROWS, maximumCsvBytes: MAX_CSV_BYTES },
        privacy: { inference: 'local', invoiceStorage: 'memory only', cloudInference: false, telemetry: false },
      });
    }
    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      if (busy) return json(response, 409, { error: 'An analysis is already running. Please wait for it to finish.' });
      busy = true; stage = 'Read request';
      try {
        const { csv } = await readJSON(request);
        const result = await analyze(csv, { onStage: (name) => { stage = name; } });
        return json(response, 200, result);
      } catch (error) {
        if (error instanceof InputError) return json(response, error.status || 422, { error: error.message, issues: error.issues });
        return json(response, 503, { error: 'Analysis could not finish. Check the model status; the first run may need the model download. No review actions were applied.' });
      } finally { busy = false; stage = null; }
    }
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'API route not found.' });
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed.' });
    let relative;
    try { relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }
    catch { return json(response, 400, { error: 'Invalid file path.' }); }
    const target = path.resolve(publicRoot, `.${relative}`);
    if (!target.startsWith(`${path.resolve(publicRoot)}${path.sep}`)) return json(response, 403, { error: 'File access denied.' });
    try {
      if (!(await stat(target)).isFile()) return json(response, 404, { error: 'File not found.' });
      const content = await readFile(target);
      response.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { json(response, 404, { error: 'File not found.' }); }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
  const server = createServer();
  server.listen(port, '127.0.0.1', () => console.log(`SecondLook is ready at http://127.0.0.1:${port} — invoice data stays in this process.`));
  server.on('error', (error) => { console.error(`SecondLook server could not start: ${error.code || 'unknown error'}.`); process.exitCode = 1; });
}
