const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server;
let baseUrl;
const previousFrontendOrigin = process.env.FRONTEND_ORIGIN;

before(async () => {
  process.env.FRONTEND_ORIGIN = 'https://cafeteria.example/';
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  if (previousFrontendOrigin === undefined) delete process.env.FRONTEND_ORIGIN;
  else process.env.FRONTEND_ORIGIN = previousFrontendOrigin;
});

test('health reports when the database is not connected', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'degraded', database: 'unavailable' });
});

test('registration validates required fields before using the database', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Enter your name and register number.' });
});

test('protected routes reject requests without a token', async () => {
  const response = await fetch(`${baseUrl}/api/auth/profile`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required.' });
});

test('contact rejects incomplete input', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Student' }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Please complete all fields with a valid email address.',
  });
});

test('invalid JSON receives a JSON error response', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Request body must be valid JSON.' });
});

test('unknown routes return a JSON 404', async () => {
  const response = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Route not found.' });
});

test('CORS accepts the configured frontend origin with or without a trailing slash', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://cafeteria.example' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://cafeteria.example');
});
