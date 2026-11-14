import test from 'node:test';
import assert from 'node:assert/strict';
import { smartrecruiters } from '../src/sources.mjs';
import { run } from '../src/run.mjs';

// Synthetic cases; the real two-job fixture remains pending.
test('SmartRecruiters follows pagination and normalizes fourteen fields', async () => {
  const urls = [];
  const pages = [
    { totalFound: 2, content: [{ id: 'a', name: 'Engineer', location: { city: 'London', country: 'GB', remote: false }, department: { label: 'Engineering' }, releasedDate: '2026-11-01T12:00:00Z' }] },
    { totalFound: 2, content: [{ id: 'b', name: 'Designer' }] },
  ];
  const jobs = await smartrecruiters('Visa', { getJson: async url => { urls.push(url); return pages.shift(); } });
  assert.deepEqual(urls, [
    'https://api.smartrecruiters.com/v1/companies/Visa/postings?limit=100&offset=0',
    'https://api.smartrecruiters.com/v1/companies/Visa/postings?limit=100&offset=1',
  ]);
  assert.equal(jobs.length, 2);
  assert.deepEqual(Object.keys(jobs[0]).sort(), [
    'source', 'company', 'id', 'title', 'location', 'remote', 'department',
    'url', 'publishedAt', 'updatedAt', 'salaryMin', 'salaryMax',
    'salaryCurrency', 'salaryPeriod',
  ].sort());
  assert.equal(jobs[0].source, 'smartrecruiters');
  assert.equal(jobs[0].company, 'Visa');
  assert.equal(jobs[0].id, 'a');
  assert.equal(jobs[0].title, 'Engineer');
  assert.equal(jobs[0].location, 'London; GB');
  assert.equal(jobs[0].remote, false);
  assert.equal(jobs[0].department, 'Engineering');
  assert.equal(jobs[0].publishedAt, '2026-11-01T12:00:00.000Z');
  assert.equal(jobs[1].remote, null);
  assert.equal(jobs[1].salaryMin, null);
});

test('SmartRecruiters returns an empty complete board', async () => {
  assert.deepEqual(await smartrecruiters('Visa', { getJson: async () => ({ totalFound: 0, content: [] }) }), []);
});

test('SmartRecruiters rejects an incomplete empty page', async () => {
  await assert.rejects(smartrecruiters('Visa', { getJson: async () => ({ totalFound: 1, content: [] }) }), /empty page/);
});

test('SmartRecruiters rejects malformed pagination metadata', async () => {
  for (const totalFound of [undefined, -1, '2', 1.5]) {
    await assert.rejects(smartrecruiters('Visa', { getJson: async () => ({ totalFound, content: [] }) }), /totalFound/);
  }
});

test('SmartRecruiters returns partial jobs and warns after sixty pages', async () => {
  let calls = 0;
  const warnings = [];
  const jobs = await smartrecruiters('LinkedIn3', {
    getJson: async () => ({ totalFound: 61, content: [{ id: String(++calls) }] }),
    onWarning: message => warnings.push(message),
  });
  assert.equal(calls, 60);
  assert.equal(jobs.length, 60);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /60-page limit/);
  assert.match(warnings[0], /incomplete/i);
  assert.equal(Object.keys(jobs[0]).length, 14);
});

test('SmartRecruiters completes sixty pages without a truncation warning', async () => {
  let calls = 0;
  const warnings = [];
  const jobs = await smartrecruiters('LinkedIn3', {
    getJson: async () => ({ totalFound: 60, content: [{ id: String(++calls) }] }),
    onWarning: message => warnings.push(message),
  });
  assert.equal(calls, 60);
  assert.equal(jobs.length, 60);
  assert.deepEqual(warnings, []);
});

test('Partial coverage warning reaches the company report and preserves history', async () => {
  let calls = 0;
  const input = { companies: [{ source: 'smartrecruiters', company: 'LinkedIn3' }] };
  const options = { fetchImpl: async url => {
    calls += 1;
    const offset = Number(new URL(url).searchParams.get('offset'));
    return new Response(JSON.stringify({ totalFound: 61, content: [{ id: String(offset), name: 'Engineer' }] }), { headers: { 'Content-Type': 'application/json' } });
  } };
  const first = await run(input, undefined, options);
  assert.equal(first.report[0].error, null);
  assert.equal(first.report[0].totalJobs, 60);
  assert.match(first.report[0].warnings[0], /60-page limit/);
  assert.equal(first.newJobs.length, 60);
  const saved = JSON.parse(JSON.stringify(first.state));
  const second = await run(input, saved, options);
  assert.equal(second.report[0].error, null);
  assert.match(second.report[0].warnings[0], /incomplete/i);
  assert.equal(second.newJobs.length, 0);
  assert.deepEqual(second.state, saved);
  assert.equal(calls, 120);
});

test('SmartRecruiters propagates request failures', async () => {
  const failure = new Error('HTTP failure');
  await assert.rejects(smartrecruiters('Visa', { getJson: async () => { throw failure; } }), error => error === failure);
});

test('SmartRecruiters rejects company paths before requesting', async () => {
  await assert.rejects(smartrecruiters('../Visa', { getJson: async () => assert.fail('Unexpected request') }), /identifier/);
});
