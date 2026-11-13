import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recruitee } from '../src/sources.mjs';

const fixture = async () => JSON.parse(await readFile(
  new URL('./fixtures/recruitee.json', import.meta.url), 'utf8'));

test('Recruitee normalizes the saved bunq response without network', async () => {
  const body = await fixture();
  const before = JSON.stringify(body);
  const jobs = await recruitee('bunq', { getJson: async url => {
    assert.equal(url, 'https://bunq.recruitee.com/api/offers/');
    return body;
  } });
  assert.equal(jobs.length, 2);
  assert.equal(JSON.stringify(body), before);
  const fields = ['source', 'company', 'id', 'title', 'location', 'remote',
    'department', 'url', 'publishedAt', 'updatedAt',
    'salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod'].sort();
  for (const job of jobs) {
    assert.deepEqual(Object.keys(job).sort(), fields);
    assert.equal(job.source, 'recruitee');
    assert.equal(job.company, 'bunq');
    assert.equal(typeof job.id, 'string');
    assert.ok(job.id.length > 0);
    assert.equal(typeof job.title, 'string');
    assert.ok(job.url?.startsWith('https://'));
    assert.ok(job.remote === null || typeof job.remote === 'boolean');
    assert.ok(Object.values(job).every(value => value !== undefined));
  }
  assert.equal(jobs[0].title, 'Security Engineer');
  assert.equal(jobs[0].department, 'Technology');
  assert.equal(jobs[0].publishedAt, '2026-11-11T13:21:40.000Z');
});

test('Recruitee rejects invalid boards before requesting data', async () => {
  await assert.rejects(recruitee('../other', {
    getJson: async () => assert.fail('Unexpected request'),
  }), /identifier/);
});

test('Recruitee rejects changed envelopes and missing identities', async () => {
  await assert.rejects(recruitee('example', { getJson: async () => ({ jobs: [] }) }), /format/);
  await assert.rejects(recruitee('example', { getJson: async () => ({ offers: [{}] }) }), /valid ID/);
});
