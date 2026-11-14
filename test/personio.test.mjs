import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { personio } from '../src/personio.mjs';
import { parseInput } from '../src/input.mjs';
import { run } from '../src/run.mjs';

const fixtureUrl = new URL('./fixtures/personio.xml', import.meta.url);

test('Personio maps two captured positions into fourteen fields without network', async () => {
  const xml = await readFile(fixtureUrl, 'utf8');
  const jobs = await personio('personio', { getText: async url => {
    assert.equal(url, 'https://personio.jobs.personio.de/xml');
    return xml;
  } });
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map(job => job.id), ['2885178', '2884392']);
  assert.deepEqual(jobs.map(job => job.location), ['Berlin', 'Munich']);
  assert.deepEqual(jobs.map(job => job.department), ['Go to Market', 'Product and Tech']);
  assert.deepEqual(jobs.map(job => job.title), ['Business Development Representative (d/f/m)', 'Test Job']);
  assert.deepEqual(jobs.map(job => job.publishedAt), ['2026-11-11T17:43:42.000Z', '2026-11-11T10:53:10.000Z']);
  const fields = ['source', 'company', 'id', 'title', 'location', 'remote', 'department', 'url', 'publishedAt', 'updatedAt', 'salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod'].sort();
  for (const job of jobs) {
    assert.deepEqual(Object.keys(job).sort(), fields);
    assert.equal(job.source, 'personio');
    assert.equal(job.company, 'personio');
    assert.equal(job.url, `https://personio.jobs.personio.de/job/${job.id}`);
    for (const field of ['remote', 'updatedAt', 'salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod']) assert.equal(job[field], null);
  }
});

test('Personio integrates schema, shared HTTP transport and saved history', async () => {
  const xml = await readFile(fixtureUrl, 'utf8');
  const schema = JSON.parse(await readFile(new URL('../.actor/input_schema.json', import.meta.url), 'utf8'));
  assert.ok(schema.properties.companies.items.properties.source.enum.includes('personio'));
  const input = parseInput({ companies: [{ source: 'personio', company: 'personio' }], stateKey: 'personio-test', firstRun: 'all' });
  let requests = 0;
  const options = { fetchImpl: async (url, init) => {
    requests += 1;
    assert.equal(url, 'https://personio.jobs.personio.de/xml');
    assert.match(init.headers.Accept, /xml/);
    return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
  } };
  const first = await run(input, undefined, options);
  assert.equal(first.report[0].error, null);
  assert.equal(first.newJobs.length, 2);
  const previous = JSON.parse(JSON.stringify(first.state));
  const second = await run(input, previous, options);
  assert.equal(second.report[0].error, null);
  assert.equal(second.report[0].totalJobs, 2);
  assert.equal(second.newJobs.length, 0);
  assert.deepEqual(second.state, previous);
  assert.equal(requests, 2);
});

test('Personio rejects identifiers before requests and propagates transport errors', async () => {
  for (const company of ['', '../personio', 'https://personio.jobs.personio.de']) {
    await assert.rejects(personio(company, { getText: async () => assert.fail('Unexpected request') }), /identifier/);
  }
  const failure = new Error('HTTP failure');
  await assert.rejects(personio('personio', { getText: async () => { throw failure; } }), error => error === failure);
});
