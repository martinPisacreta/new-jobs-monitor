import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { createHttpClient } from '../src/http.mjs';
import { run } from '../src/run.mjs';

globalThis.fetch = async () => { throw new Error('Real network disabled'); };
const response = () => new Response(JSON.stringify({ jobs: [] }), { status: 200 });

test('different Workday hosts fetch concurrently without a shared pause', async () => {
  const starts = [];
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  const client = createHttpClient({
    minIntervalMs: 1500, concurrency: 2,
    sleep: async () => assert.fail('Different hosts must not wait'),
    fetchImpl: async url => {
      starts.push(new URL(url).hostname);
      await gate;
      return response();
    },
  });
  const first = client.getJson('https://one.wd5.myworkdayjobs.com/jobs');
  const second = client.getJson('https://two.wd5.myworkdayjobs.com/jobs');
  await flush();
  const observed = [...starts];
  unblock();
  await Promise.all([first, second]);
  assert.deepEqual(observed.sort(), [
    'one.wd5.myworkdayjobs.com', 'two.wd5.myworkdayjobs.com',
  ]);
});

for (const host of ['one.wd5.myworkdayjobs.com', 'api.rippling.com']) {
  test(`${host} waits 1500 ms while another host can proceed`, async () => {
    let clock = 0;
    let resume;
    const waits = [];
    const starts = [];
    const client = createHttpClient({
      minIntervalMs: 1500, concurrency: 1, now: () => clock,
      sleep: ms => {
        waits.push(ms);
        return new Promise(resolve => {
          resume = () => { clock += ms; resolve(); };
        });
      },
      fetchImpl: async url => {
        starts.push({ url, time: clock });
        return response();
      },
    });
    await client.getJson(`https://${host}/first`);
    const second = client.getJson(`https://${host}/second`);
    await flush();
    const observedWaits = [...waits];
    const observedStarts = starts.length;
    const independent = client.getJson('https://boards-api.greenhouse.io/fixture');
    await flush();
    const independentStarted = starts.some(item => item.url.includes('greenhouse.io'));
    if (resume) resume();
    await Promise.all([second, independent]);
    assert.deepEqual(observedWaits, [1500]);
    assert.equal(observedStarts, 1);
    assert.equal(independentStarted, true);
    assert.equal(starts.find(item => item.url.endsWith('/second')).time, 1500);
  });
}

test('50 Greenhouse companies retain concurrency without added pauses', async () => {
  let calls = 0;
  let active = 0;
  let peak = 0;
  const waits = [];
  const result = await run({ companies: Array.from({ length: 50 }, (_, i) => ({
    source: 'greenhouse', company: `fixture${i}`,
  })) }, undefined, {
    concurrency: 4,
    sleep: async ms => { waits.push(ms); },
    fetchImpl: async url => {
      assert.equal(new URL(url).hostname, 'boards-api.greenhouse.io');
      calls++;
      active++;
      peak = Math.max(peak, active);
      await flush();
      active--;
      return response();
    },
  });
  assert.equal(calls, 50);
  assert.equal(peak, 4);
  assert.deepEqual(waits, []);
  assert.deepEqual(result.newJobs, []);
});
