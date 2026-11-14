import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { breezy } from '../src/breezy.mjs';

const fields = ['source', 'company', 'id', 'title', 'location', 'remote', 'department', 'url', 'publishedAt', 'updatedAt', 'salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod'].sort();

test('Breezy normalizes two captured postings without network', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/breezy.json', import.meta.url), 'utf8'));
  assert.equal(fixture.length, 2);
  let requests = 0;
  const jobs = await breezy('breezy', { getJson: async url => {
    requests += 1;
    assert.equal(url, 'https://breezy.breezy.hr/json');
    return fixture;
  } });
  assert.equal(requests, 1);
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map(job => job.id), ['98323abf2296', '088ac6d52139']);
  assert.deepEqual(jobs.map(job => job.title), ['Employee #12', 'Open Position']);
  assert.deepEqual(jobs.map(job => job.location), ['Chaos, FL', 'New York, NY']);
  assert.deepEqual(jobs.map(job => job.remote), [false, null]);
  for (const [index, job] of jobs.entries()) {
    assert.deepEqual(Object.keys(job).sort(), fields);
    assert.equal(job.source, 'breezy');
    assert.equal(job.company, 'breezy');
    assert.equal(job.department, fixture[index].department);
    assert.equal(job.url, fixture[index].url);
    assert.equal(job.publishedAt, new Date(fixture[index].published_date).toISOString());
    for (const field of ['updatedAt', 'salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod']) assert.equal(job[field], null);
  }
});

test('Breezy preserves zero IDs, explicit remote status and unknown fields', async () => {
  const jobs = await breezy('example', { getJson: async () => [
    { id: 0, name: ' Engineer ', location: { is_remote: true }, published_date: 'invalid' },
    { id: 'other' },
  ] });
  assert.equal(jobs[0].id, '0');
  assert.equal(jobs[0].title, 'Engineer');
  assert.equal(jobs[0].remote, true);
  assert.equal(jobs[0].publishedAt, null);
  assert.equal(jobs[1].remote, null);
  assert.equal(jobs[1].location, null);
  assert.equal(jobs[1].url, null);
});

test('Breezy accepts empty boards and rejects malformed responses', async () => {
  assert.deepEqual(await breezy('example', { getJson: async () => [] }), []);
  for (const body of [{ jobs: [] }, null, [null], [{}], [{ id: '' }], [{ id: 'a', locations: {} }]]) {
    await assert.rejects(breezy('example', { getJson: async () => body }), /breezy:/);
  }
});

test('Breezy validates identifiers before requests and propagates failures', async () => {
  for (const company of ['../example', 'https://example.com', 'a.b', '']) {
    await assert.rejects(breezy(company, { getJson: async () => assert.fail('Unexpected request') }), /identifier/);
  }
  const failure = new Error('HTTP failure');
  await assert.rejects(breezy('example', { getJson: async () => { throw failure; } }), error => error === failure);
});
