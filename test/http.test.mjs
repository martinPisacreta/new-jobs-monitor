import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createJsonClient } from '../src/http.mjs';

const url = 'https://example.invalid/jobs';
const ok = () => Response.json({ jobs: [] });

for (const status of [429, 500, 503]) {
  test(`HTTP ${status} receives exactly one delayed retry`, async () => {
    let calls = 0;
    const waits = [];
    const get = createJsonClient({
      fetchImpl: async () => ++calls === 1
        ? new Response('', { status, headers: { 'Retry-After': '2' } })
        : ok(),
      sleep: async ms => waits.push(ms),
    });
    assert.deepEqual(await get(url), { jobs: [] });
    assert.equal(calls, 2);
    assert.deepEqual(waits, [2000]);
  });
}

test('a second retryable failure stops after two requests', async () => {
  let calls = 0;
  const get = createJsonClient({
    fetchImpl: async () => { calls += 1; return new Response('', { status: 503 }); },
    sleep: async () => {},
  });
  await assert.rejects(get(url), { status: 503 });
  assert.equal(calls, 2);
});

test('HTTP 404, transport errors and invalid JSON are not retried', async () => {
  for (const response of [
    () => new Response('', { status: 404 }),
    () => { throw new Error('Transport failure'); },
    () => new Response('not JSON'),
  ]) {
    let calls = 0;
    const get = createJsonClient({
      fetchImpl: async () => { calls += 1; return response(); },
      sleep: async () => assert.fail('Unexpected retry'),
    });
    await assert.rejects(get(url));
    assert.equal(calls, 1);
  }
});

test('Retry-After dates are respected and excessive waits do not retry early', async () => {
  const timestamp = Date.parse('2026-11-13T13:00:00Z');
  const waits = [];
  let calls = 0;
  const get = createJsonClient({
    now: () => timestamp,
    fetchImpl: async () => ++calls === 1
      ? new Response('', { status: 429, headers: {
          'Retry-After': new Date(timestamp + 3000).toUTCString(),
        } })
      : ok(),
    sleep: async ms => waits.push(ms),
  });
  await get(url);
  assert.deepEqual(waits, [3000]);

  calls = 0;
  const limited = createJsonClient({
    fetchImpl: async () => {
      calls += 1;
      return new Response('', { status: 429, headers: { 'Retry-After': '3600' } });
    },
    sleep: async () => assert.fail('Excessive wait'),
  });
  await assert.rejects(limited(url), /no early retry/);
  assert.equal(calls, 1);
});

test('concurrency stays at four through response consumption', async () => {
  let active = 0;
  let peak = 0;
  const get = createJsonClient({
    fetchImpl: async () => {
      active += 1;
      peak = Math.max(peak, active);
      return {
        ok: true,
        async json() {
          await nextTurn();
          active -= 1;
          return [];
        },
      };
    },
  });
  const results = await Promise.all(Array.from({ length: 12 }, () => get(url)));
  assert.equal(results.length, 12);
  assert.equal(peak, 4);
  assert.equal(active, 0);
});

test('a failed request releases its slot for the next company', async () => {
  let calls = 0;
  const get = createJsonClient({
    concurrency: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error('First company failed');
      return ok();
    },
  });
  const results = await Promise.allSettled([get(url), get(url)]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
});
