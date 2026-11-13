import test from 'node:test';
import assert from 'node:assert/strict';
import { main, STATE_STORE } from '../src/actor.mjs';
import { run } from '../src/run.mjs';

const copy = value => value === undefined ? undefined : structuredClone(value);
const job = id => ({ source: 'greenhouse', company: 'stripe', id,
  title: 'Engineer', location: 'London' });
const key = id => `greenhouse:stripe:${id}`;
const input = { companies: [{ source: 'greenhouse', company: 'stripe' }] };

function fixture({ initial, charges = [], fail, pricing, calculate } = {}) {
  let state = copy(initial);
  let output;
  let chargeIndex = 0;
  const trace = [];
  const records = [];
  const actor = {
    async getInput() { return copy(input); },
    async openKeyValueStore(name) {
      assert.equal(name, STATE_STORE);
      return {
        async getValue(stateKey) {
          assert.equal(stateKey, 'default');
          return copy(state);
        },
        async setValue(stateKey, value) {
          assert.equal(stateKey, 'default');
          trace.push('state');
          if (fail === 'state') throw new Error('State unavailable');
          state = copy(value);
        },
      };
    },
    async pushData(record) {
      trace.push(`push:${Array.isArray(record) ? record.map(item => item.id).join(',') : record.id}`);
      if (fail === 'push') throw new Error('Dataset unavailable');
      records.push(...copy(Array.isArray(record) ? record : [record]));
    },
    async charge(request) {
      assert.ok(Number.isInteger(request.count) && request.count >= 1 && request.count <= 200);
      trace.push(`charge:${request.eventName}`);
      if (fail === request.eventName) throw new Error('Charge response unavailable');
      return copy(charges[chargeIndex++] ?? {
        chargedCount: request.count, eventChargeLimitReached: false,
      });
    },
    async setValue(name, value) {
      assert.equal(name, 'OUTPUT');
      trace.push('output');
      if (fail === 'output') throw new Error('Output unavailable');
      output = copy(value);
    },
  };
  if (pricing !== undefined || calculate !== undefined) {
    const manager = {};
    if (pricing !== undefined) manager.getPricingInfo = () => ({ isPayPerEvent: pricing });
    if (calculate !== undefined) manager.calculateMaxEventChargeCountWithinLimit = calculate;
    actor.getChargingManager = () => manager;
  }
  return { actor, trace, records, state: () => copy(state), output: () => copy(output) };
}

function runner(jobs) {
  return async (runInput, previous, options) => {
    assert.equal(options.timeoutMs, 30000);
    return run(runInput, previous, {
      ...options,
      adapters: { greenhouse: async () => copy(jobs) },
      fetchImpl: async () => assert.fail('Network is forbidden in Actor tests'),
    });
  };
}

test('first run saves each job before charging and commits state last', async () => {
  const f = fixture();
  const output = await main(f.actor, { runJobs: runner([job('1'), job('2')]) });
  assert.deepEqual(f.trace, [
    'charge:run-started', 'push:1', 'charge:new-job',
    'push:2', 'charge:new-job', 'output', 'state',
  ]);
  assert.deepEqual(f.state(), { [key('1')]: true, [key('2')]: true });
  assert.equal(output.savedJobs, 2);
  assert.equal(output.processedJobs, 2);
  assert.equal(output.budgetReached, false);
  assert.deepEqual(output.eventsCharged, { 'run-started': 1, 'new-job': 2 });
  assert.deepEqual(f.output(), output);
});

test('second run with unchanged jobs charges only run-started', async () => {
  const f = fixture();
  const runJobs = runner([job('1')]);
  await main(f.actor, { runJobs });
  f.trace.length = 0;
  const second = await main(f.actor, { runJobs });
  assert.equal(second.savedJobs, 0);
  assert.equal(second.report[0].newJobs, 0);
  assert.deepEqual(f.trace, ['charge:run-started', 'output', 'state']);
  assert.equal(f.records.length, 1);
});

test('spending limit midway commits only successfully charged output IDs', async () => {
  const f = fixture({ charges: [
    { chargedCount: 1, eventChargeLimitReached: false },
    { chargedCount: 1, eventChargeLimitReached: true },
  ] });
  const output = await main(f.actor, { runJobs: runner([job('1'), job('2'), job('3')]) });
  assert.equal(output.budgetReached, true);
  assert.equal(output.availableJobs, 3);
  assert.equal(output.savedJobs, 1);
  assert.equal(output.processedJobs, 1);
  assert.deepEqual(f.state(), { [key('1')]: true });
  assert.deepEqual(f.records.map(item => item.id), ['1']);
  const next = fixture({ initial: f.state() });
  await main(next.actor, { runJobs: runner([job('1'), job('2'), job('3')]) });
  assert.deepEqual(next.records.map(item => item.id), ['2', '3']);
});

test('a saved but uncharged job stays pending when the budget is exhausted', async () => {
  const f = fixture({ charges: [
    { chargedCount: 1, eventChargeLimitReached: false },
    { chargedCount: 0, eventChargeLimitReached: true },
  ] });
  const output = await main(f.actor, { runJobs: runner([job('1'), job('2')]) });
  assert.equal(output.savedJobs, 1);
  assert.equal(output.processedJobs, 0);
  assert.equal(output.eventsCharged['new-job'], 0);
  assert.equal(output.budgetReached, true);
  assert.deepEqual(f.state(), {});
  assert.equal(f.records.length, 1);
});

test('a spending limit at run start prevents board requests and state writes', async () => {
  const initial = { [key('old')]: true };
  const f = fixture({ initial, charges: [
    { chargedCount: 0, eventChargeLimitReached: true },
  ] });
  const output = await main(f.actor, {
    runJobs: async () => assert.fail('Boards must not be requested'),
  });
  assert.equal(output.budgetReached, true);
  assert.deepEqual(f.state(), initial);
  assert.deepEqual(f.trace, ['charge:run-started', 'output']);
});

test('dataset failure preserves state and does not charge the failed job', async () => {
  const initial = { [key('old')]: true };
  const f = fixture({ initial, fail: 'push' });
  await assert.rejects(main(f.actor, { runJobs: runner([job('1')]) }), /Dataset unavailable/);
  assert.deepEqual(f.state(), initial);
  assert.deepEqual(f.trace, ['charge:run-started', 'push:1']);
});

for (const fail of ['new-job', 'output', 'state']) {
  test(`${fail} failure preserves the old state without retrying charges`, async () => {
    const initial = { [key('old')]: true };
    const f = fixture({ initial, fail });
    await assert.rejects(main(f.actor, { runJobs: runner([job('1')]) }), /unavailable/);
    assert.deepEqual(f.state(), initial);
    assert.equal(f.trace.filter(item => item === 'charge:new-job').length, 1);
    assert.equal(f.records.length, 1);
  });
}

test('invalid stateKey fails before storage, billing or source calls', async () => {
  for (const stateKey of ['../other', 'a:b', 'a b', 'x'.repeat(61)]) {
    const f = fixture();
    f.actor.getInput = async () => ({ ...input, stateKey });
    f.actor.openKeyValueStore = async () => assert.fail('Unexpected storage access');
    await assert.rejects(main(f.actor, {
      runJobs: async () => assert.fail('Unexpected source call'),
    }), /stateKey/);
    assert.deepEqual(f.trace, []);
  }
});

test('firstRun=none establishes a baseline without saving or charging jobs', async () => {
  const f = fixture();
  f.actor.getInput = async () => ({ ...input, firstRun: 'none' });
  const output = await main(f.actor, { runJobs: runner([job('1')]) });
  assert.deepEqual(f.state(), { [key('1')]: true });
  assert.equal(output.savedJobs, 0);
  assert.deepEqual(f.trace, ['charge:run-started', 'output', 'state']);
});

test('local runs without pay-per-event pricing process jobs without charge calls', async () => {
  const f = fixture({ pricing: false });
  f.actor.charge = async () => assert.fail('Local runs must not charge');
  const output = await main(f.actor, { runJobs: runner([job('1')]) });
  assert.equal(output.processedJobs, 1);
  assert.deepEqual(output.eventsCharged, { 'run-started': 0, 'new-job': 0 });
  assert.deepEqual(f.state(), { [key('1')]: true });
});


test('demo repeats current jobs without opening the state store', async () => {
  const f = fixture();
  f.actor.getInput = async () => ({ ...input, stateKey: 'demo', firstRun: 'none' });
  f.actor.openKeyValueStore = async () => assert.fail('Demo must not access the state store');
  const runJobs = runner([job('1'), job('2')]);
  for (let round = 0; round < 2; round += 1) {
    const output = await main(f.actor, { runJobs });
    assert.equal(output.demo, true);
    assert.equal(output.savedJobs, 2);
    assert.equal(output.pendingJobs, 0);
    assert.match(output.notice, /never reads or saves history/);
  }
  assert.deepEqual(f.records.map(item => item.id), ['1', '2', '1', '2']);
  assert.equal(f.state(), undefined);
});

test('empty stateKey selects persistent default history', async () => {
  for (const stateKey of ['', '   ']) {
    const f = fixture();
    f.actor.getInput = async () => ({ ...input, stateKey });
    const output = await main(f.actor, { runJobs: runner([job('1')]) });
    assert.equal(output.stateKey, 'default');
    assert.equal(output.demo, false);
    assert.deepEqual(f.state(), { [key('1')]: true });
  }
});

test('partial batch charge acknowledges only its charged prefix', async () => {
  const f = fixture({
    calculate: event => { assert.equal(event, 'new-job'); return 3; },
    charges: [
      { chargedCount: 1, eventChargeLimitReached: false },
      { chargedCount: 2, eventChargeLimitReached: false },
    ],
  });
  const jobs = [job('1'), job('2'), job('3'), job('4')];
  const output = await main(f.actor, { runJobs: runner(jobs) });
  assert.equal(output.savedJobs, 3);
  assert.equal(output.processedJobs, 2);
  assert.equal(output.pendingJobs, 2);
  assert.equal(output.budgetReached, true);
  assert.deepEqual(f.state(), { [key('1')]: true, [key('2')]: true });
  assert.deepEqual(f.trace, ['charge:run-started', 'push:1,2,3', 'charge:new-job', 'output', 'state']);
  const next = fixture({ initial: f.state() });
  await main(next.actor, { runJobs: runner(jobs) });
  assert.deepEqual(next.records.map(item => item.id), ['3', '4']);
});

test('absent charging manager uses batches of one', async () => {
  const f = fixture();
  await main(f.actor, { runJobs: runner([job('1'), job('2')]) });
  assert.equal(f.trace.filter(item => item.startsWith('push:')).length, 2);
  assert.equal(f.trace.filter(item => item === 'charge:new-job').length, 2);
});

test('maxNewJobs leaves excess candidates pending for the next run', async () => {
  const f = fixture();
  f.actor.getInput = async () => ({ ...input, maxNewJobs: 2 });
  const runJobs = runner([job('1'), job('2'), job('3')]);
  const first = await main(f.actor, { runJobs });
  assert.equal(first.savedJobs, 2);
  assert.equal(first.pendingJobs, 1);
  assert.equal(first.maxNewJobsReached, true);
  assert.deepEqual(f.state(), { [key('1')]: true, [key('2')]: true });
  const second = await main(f.actor, { runJobs });
  assert.equal(second.savedJobs, 1);
  assert.equal(second.pendingJobs, 0);
  assert.deepEqual(f.records.map(item => item.id), ['1', '2', '3']);
});

test('exactly 200 jobs use one dataset write and one job charge', async () => {
  const f = fixture({ calculate: () => Infinity });
  const pushes = [];
  const charges = [];
  const pushData = f.actor.pushData;
  const charge = f.actor.charge;
  f.actor.pushData = async records => { pushes.push(records.length); return pushData(records); };
  f.actor.charge = async request => { charges.push({ ...request }); return charge(request); };
  const output = await main(f.actor, { runJobs: runner(Array.from({ length: 200 }, (_, i) => job(String(i)))) });
  assert.deepEqual(pushes, [200]);
  assert.deepEqual(charges, [
    { eventName: 'run-started', count: 1 },
    { eventName: 'new-job', count: 200 },
  ]);
  assert.equal(output.processedJobs, 200);
  assert.equal(Object.keys(f.state()).length, 200);
  assert.equal(f.trace.filter(item => item === 'state').length, 1);
});

test('budget is recalculated before each batch and zero stops before saving', async () => {
  let calculations = 0;
  const f = fixture({ calculate: () => ++calculations === 1 ? 2 : 0 });
  const output = await main(f.actor, { runJobs: runner([job('1'), job('2'), job('3')]) });
  assert.equal(calculations, 2);
  assert.equal(output.savedJobs, 2);
  assert.equal(output.pendingJobs, 1);
  assert.equal(output.budgetReached, true);
  assert.deepEqual(f.records.map(item => item.id), ['1', '2']);
});

test('invalid maxNewJobs fails before state access or billing', async () => {
  for (const maxNewJobs of [0, -1, 10001, 1.5, '10', null]) {
    const f = fixture();
    f.actor.getInput = async () => ({ ...input, maxNewJobs });
    f.actor.openKeyValueStore = async () => assert.fail('Unexpected state access');
    await assert.rejects(main(f.actor), /maxNewJobs/);
    assert.deepEqual(f.trace, []);
  }
});
