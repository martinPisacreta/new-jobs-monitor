import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { smartrecruiters } from '../src/sources.mjs';

test('SmartRecruiters normalizes two captured LinkedIn3 postings without network', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/smartrecruiters.json', import.meta.url), 'utf8'));
  const capture = JSON.parse(await readFile(new URL('./fixtures/smartrecruiters-capture.json', import.meta.url), 'utf8'));
  assert.equal(capture.company, 'LinkedIn3');
  assert.equal(fixture.content.length, 2);
  assert.equal(fixture.totalFound, capture.originalTotalFound);
  assert.ok(fixture.totalFound >= 2);
  let requests = 0;
  const jobs = await smartrecruiters('LinkedIn3', { getJson: async url => {
    requests += 1;
    assert.equal(url, 'https://api.smartrecruiters.com/v1/companies/LinkedIn3/postings?limit=100&offset=0');
    // Treat the retained slice as a complete local board for this mapping test.
    // The saved fixture preserves the real API pagination metadata.
    return { ...fixture, totalFound: fixture.content.length };
  } });
  assert.equal(requests, 1);
  assert.equal(jobs.length, 2);
  const fields = ['source', 'company', 'id', 'title', 'location', 'remote', 'department', 'url', 'publishedAt', 'updatedAt', 'salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod'].sort();
  for (const [index, job] of jobs.entries()) {
    const original = fixture.content[index];
    assert.deepEqual(Object.keys(job).sort(), fields);
    assert.equal(job.source, 'smartrecruiters');
    assert.equal(job.company, 'LinkedIn3');
    assert.equal(job.id, String(original.id));
    assert.ok(job.title, 'Captured posting must retain a title');
    assert.equal(job.title, original.name.trim());
    const url = new URL(job.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'jobs.smartrecruiters.com');
    assert.ok(url.pathname.startsWith('/LinkedIn3/'));
    assert.equal(decodeURIComponent(url.pathname.split('/').at(-1)), job.id);
    if (original.releasedDate) assert.equal(job.publishedAt, new Date(original.releasedDate).toISOString());
    if (typeof original.location?.remote === 'boolean') assert.equal(job.remote, original.location.remote);
    for (const field of ['updatedAt', 'salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod']) assert.equal(job[field], null);
  }
});
