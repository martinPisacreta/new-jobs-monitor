import test from 'node:test';
import assert from 'node:assert/strict';
import { diffJobs, jobKey } from '../src/diff.mjs';

function job(id, company = 'example', source = 'greenhouse') {
  return Object.freeze({ source, company, id, title: `Role ${id}` });
}

test('firstRun=all returns the initial jobs and serializable state', () => {
  const jobs = Object.freeze([job('1'), job('2')]);
  const result = diffJobs(jobs);
  assert.deepEqual(result.newJobs, jobs);
  assert.deepEqual(result.state, {
    'greenhouse:example:1': true,
    'greenhouse:example:2': true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.state)), result.state);
});

test('firstRun=none records the baseline without returning jobs', () => {
  const result = diffJobs([job('1'), job('2')], undefined, { firstRun: 'none' });
  assert.deepEqual(result.newJobs, []);
  assert.equal(Object.keys(result.state).length, 2);
  const next = diffJobs([job('1'), job('2'), job('3')], result.state, { firstRun: 'none' });
  assert.deepEqual(next.newJobs.map(item => item.id), ['3']);
});

test('unchanged second run returns no new jobs', () => {
  const first = diffJobs([job('1'), job('2')]);
  const previous = Object.freeze(JSON.parse(JSON.stringify(first.state)));
  const second = diffJobs([job('2'), job('1')], previous);
  assert.deepEqual(second.newJobs, []);
  assert.deepEqual(second.state, previous);
  assert.notEqual(second.state, previous);
});

test('addition and removal return only the addition and preserve history', () => {
  const first = diffJobs([job('1'), job('2')]);
  const second = diffJobs([job('2'), job('3')], first.state);
  assert.deepEqual(second.newJobs.map(item => item.id), ['3']);
  assert.equal(second.state['greenhouse:example:1'], true);
  const third = diffJobs([job('1'), job('2'), job('3')], second.state);
  assert.deepEqual(third.newJobs, []);
});

test('an empty completed baseline still detects subsequent arrivals', () => {
  const first = diffJobs([], undefined, { firstRun: 'none' });
  const second = diffJobs([job('1')], first.state, { firstRun: 'none' });
  assert.deepEqual(second.newJobs.map(item => item.id), ['1']);
});

test('duplicate records are emitted once', () => {
  const result = diffJobs([job('1'), job('1'), job('2')]);
  assert.deepEqual(result.newJobs.map(item => item.id), ['1', '2']);
});

test('identical IDs from different companies or sources remain distinct', () => {
  const result = diffJobs([
    job('1', 'alpha'),
    job('1', 'beta'),
    job('1', 'alpha', 'lever'),
  ]);
  assert.equal(result.newJobs.length, 3);
  assert.equal(Object.keys(result.state).length, 3);
});

test('empty input preserves previously seen jobs', () => {
  const previous = Object.freeze({ 'lever:example:42': true });
  assert.deepEqual(diffJobs([], previous), { newJobs: [], state: previous });
});

test('inherited properties do not count as persisted state', () => {
  const previous = Object.create({ 'greenhouse:example:1': true });
  assert.equal(diffJobs([job('1')], previous).newJobs.length, 1);
});

test('numeric IDs, including zero, have stable keys', () => {
  assert.equal(jobKey(job(0)), 'greenhouse:example:0');
  const first = diffJobs([job(42)]);
  assert.deepEqual(diffJobs([job('42')], first.state).newJobs, []);
});

test('invalid options, state, and identities fail without changing input', () => {
  const previous = { 'greenhouse:example:1': true };
  const snapshot = JSON.stringify(previous);
  assert.throws(() => diffJobs([], previous, { firstRun: 'invalid' }), /firstRun/);
  assert.throws(() => diffJobs({}, previous), /array/);
  for (const invalid of [[], 1, 'state', false]) {
    assert.throws(() => diffJobs([], invalid), /previousState/);
  }
  for (const invalid of [null, {}, job(''), job(NaN), job(Infinity), job('1', 'a:b')]) {
    assert.throws(() => diffJobs([job('2'), invalid], previous), TypeError);
  }
  assert.equal(JSON.stringify(previous), snapshot);
});
