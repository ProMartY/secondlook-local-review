import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.js';
import { InputError } from '../src/invoices.js';

async function withServer(options, operation) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await operation(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('status exposes local model state without raw input', async () => {
  await withServer({ getModelStatus: () => ({ state: 'cold', id: 'local-test' }) }, async (base) => {
    const response = await fetch(`${base}/api/status`);
    const value = await response.json();
    assert.equal(value.model.state, 'cold');
    assert.equal(value.privacy.cloudInference, false);
    assert.equal(value.limits.maximumRows, 150);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
  });
});

test('cross-origin requests and DNS-rebinding hosts are blocked', async () => {
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/api/status`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const status = await new Promise((resolve, reject) => {
      http.get(`${base}/api/status`, { headers: { Host: 'untrusted.example' } }, (response) => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(status, 403);
  });
});

test('validation returns useful issues and never calls a cloud endpoint', async () => {
  await withServer({ analyze: async () => { throw new InputError('Invalid invoice.', [{ row: 3, field: 'date', message: 'Invalid date.' }]); } }, async (base) => {
    const response = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: 'synthetic' }) });
    assert.equal(response.status, 422);
    const value = await response.json();
    assert.equal(value.issues[0].row, 3);
  });
});

test('analysis rejects invalid JSON and unexpected content types', async () => {
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/api/analyze`, { method: 'POST', body: 'csv' })).status, 415);
    assert.equal((await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 422);
  });
});
