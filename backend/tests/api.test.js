import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { app } from '../src/server.js';

let server;

describe('API', () => {
  before(() => {
    server = app.listen(0);
  });
  after(() => {
    server.close();
  });

  const base = () => `http://127.0.0.1:${server.address().port}`;

  it('GET /api/ping returns 200', async () => {
    const res = await fetch(`${base()}/api/ping`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.status, 'ok');
  });

  it('GET /api/assignments/1/my-submission without token returns 401', async () => {
    const res = await fetch(`${base()}/api/assignments/1/my-submission`);
    assert.strictEqual(res.status, 401);
  });

  it('GET /api/assignments/1/submissions without token returns 401', async () => {
    const res = await fetch(`${base()}/api/assignments/1/submissions`);
    assert.strictEqual(res.status, 401);
  });

  it('POST /api/assignments/1/submit without token returns 401', async () => {
    const res = await fetch(`${base()}/api/assignments/1/submit`, { method: 'POST' });
    assert.strictEqual(res.status, 401);
  });
});
