import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/run.mjs';

const job = (company, id, title = 'Software Engineer', location = 'London') => ({
  source: 'greenhouse', company, id, title, location,
});
const input = { companies: [{ source: 'greenhouse', company: 'example' }] };

test('filters use case-insensitive OR within each list and AND between lists', async () => {
  const adapters = { greenhouse: async company => [
    job(company, '1', 'Software Engineer', 'London'),
    job(company, '2', 'Product Designer', 'Paris'),
    job(company, '3', 'Software Engineer', 'Berlin'),
    job(company, '4', 'Accountant', 'London'),
  ] };
  const result = await run({ ...input, keywords: [' ENGINEER ', 'designer'],
    locations: ['LONDON', 'paris'] }, undefined, { adapters });
  assert.deepEqual(result.newJobs.map(item => item.id), ['1', '2']);
  assert.equal(Object.keys(result.state).length, 4);
  assert.equal(result.report[0].totalJobs, 4);
  assert.equal(result.report[0].newJobs, 2);
  const second = await run(input, result.state, { adapters });
  assert.deepEqual(second.newJobs, []);
});

test('firstRun=none establishes the baseline for every company', async () => {
  const companies = ['alpha', 'beta'].map(company => ({ source: 'greenhouse', company }));
  let added = false;
  const adapters = { greenhouse: async company =>
    added ? [job(company, '1'), job(company, '2')] : [job(company, '1')] };
  const first = await run({ companies, firstRun: 'none' }, undefined, { adapters });
  assert.deepEqual(first.newJobs, []);
  assert.equal(Object.keys(first.state).length, 2);
  added = true;
  const second = await run({ companies, firstRun: 'none' }, first.state, { adapters });
  assert.deepEqual(second.newJobs.map(item => `${item.company}:${item.id}`), ['alpha:2', 'beta:2']);
});

test('one failed company does not interrupt another or erase history', async () => {
  const previous = { 'greenhouse:broken:old': true };
  const companies = ['broken', 'working'].map(company => ({ source: 'greenhouse', company }));
  const adapters = { greenhouse: async company => {
    if (company === 'broken') throw new Error('HTTP 503');
    return [job(company, '1')];
  } };
  const result = await run({ companies }, previous, { adapters });
  assert.equal(result.newJobs.length, 1);
  assert.equal(result.report[0].error, 'HTTP 503');
  assert.equal(result.report[0].totalJobs, null);
  assert.equal(result.report[1].error, null);
  assert.equal(result.state['greenhouse:broken:old'], true);
  assert.deepEqual(previous, { 'greenhouse:broken:old': true });
});

test('duplicate companies and duplicate job IDs are processed once', async () => {
  let calls = 0;
  const adapters = { greenhouse: async company => {
    calls += 1;
    return [job(company, '1'), job(company, '1')];
  } };
  const result = await run({ companies: [...input.companies, ...input.companies] }, undefined, { adapters });
  assert.equal(calls, 1);
  assert.equal(result.newJobs.length, 1);
  assert.equal(result.report[0].totalJobs, 1);
});

test('malformed source results are isolated by company', async () => {
  const adapters = { greenhouse: async () => [job('unexpected', '1')] };
  const result = await run(input, undefined, { adapters });
  assert.deepEqual(result.newJobs, []);
  assert.match(result.report[0].error, /mismatched/);
});

test('invalid filters fail before invoking any adapter', async () => {
  const adapters = { greenhouse: async () => assert.fail('Unexpected source call') };
  await assert.rejects(run({ ...input, keywords: 'engineer' }, undefined, { adapters }), /keywords/);
  await assert.rejects(run({ ...input, firstRun: 'invalid' }, undefined, { adapters }), /firstRun/);
});
