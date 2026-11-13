import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as sources from '../src/sources.mjs';

const fields = ['source', 'company', 'id', 'title', 'location', 'remote', 'department',
  'url', 'publishedAt', 'updatedAt', 'salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod'].sort();
const boards = { greenhouse: 'stripe', lever: 'palantir', ashby: 'ramp', workable: 'huggingface' };
const endpoints = {
  greenhouse: 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true',
  lever: 'https://api.lever.co/v0/postings/palantir?mode=json',
  ashby: 'https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true',
  workable: 'https://apply.workable.com/api/v1/widget/accounts/huggingface',
};

async function fixture(source) {
  return JSON.parse(await readFile(new URL(`./fixtures/${source}.json`, import.meta.url), 'utf8'));
}

for (const [source, company] of Object.entries(boards)) {
  test(`${source}: saved real response produces the common schema without network`, async () => {
    const body = await fixture(source);
    const before = JSON.stringify(body);
    let calls = 0;
    const jobs = await sources[source](company, { getJson: async url => {
      calls += 1;
      assert.equal(url, endpoints[source]);
      return body;
    } });
    assert.equal(calls, 1);
    assert.equal(jobs.length, 2);
    assert.equal(JSON.stringify(body), before);
    for (const job of jobs) {
      assert.deepEqual(Object.keys(job).sort(), fields);
      assert.equal(job.source, source);
      assert.equal(job.company, company);
      assert.equal(typeof job.id, 'string');
      assert.ok(job.id.length > 0);
      assert.equal(typeof job.title, 'string');
      assert.ok(job.url.startsWith('https://'));
      assert.ok(job.remote === null || typeof job.remote === 'boolean');
      for (const field of ['salaryMin', 'salaryMax']) {
        assert.ok(job[field] === null || Number.isFinite(job[field]));
      }
      for (const field of ['publishedAt', 'updatedAt']) {
        assert.ok(job[field] === null || new Date(job[field]).toISOString() === job[field]);
      }
      assert.ok(Object.values(job).every(value => value !== undefined));
    }
  });
}

test('Greenhouse keeps the published date and department; unknown remote stays null', async () => {
  const body = await fixture('greenhouse');
  const [job] = await sources.greenhouse('stripe', { getJson: async () => body });
  assert.equal(job.id, String(body.jobs[0].id));
  assert.equal(job.department, body.jobs[0].departments[0].name);
  assert.equal(job.publishedAt, new Date(body.jobs[0].first_published).toISOString());
  assert.equal(job.remote, null);
  assert.equal(job.salaryMin, null);
});

test('Lever maps epoch milliseconds and explicit hybrid status', async () => {
  const body = await fixture('lever');
  const [job] = await sources.lever('palantir', { getJson: async () => body });
  assert.equal(job.publishedAt, new Date(body[0].createdAt).toISOString());
  assert.equal(job.remote, false);
  assert.equal(job.department, 'Administrative');
  assert.equal(job.updatedAt, null);
});

test('Ashby selects salary rather than equity and includes secondary locations', async () => {
  const body = await fixture('ashby');
  const [job] = await sources.ashby('ramp', { getJson: async () => body });
  assert.equal(job.salaryMin, 211400);
  assert.equal(job.salaryMax, 290600);
  assert.equal(job.salaryCurrency, 'USD');
  assert.equal(job.salaryPeriod, 'year');
  assert.equal(job.remote, true);
  assert.match(job.location, /Remote \(Canada\)/);
});

test('Workable uses shortcode, published date and explicit telecommuting', async () => {
  const body = await fixture('workable');
  const [job] = await sources.workable('huggingface', { getJson: async () => body });
  assert.equal(job.id, '81B46579FE');
  assert.equal(job.remote, true);
  assert.equal(job.publishedAt, '2026-05-29T00:00:00.000Z');
  assert.equal(job.updatedAt, null);
  assert.match(job.location, /Paris/);
  assert.equal(job.salaryCurrency, null);
});

test('missing optional fields become null and numeric zero remains a valid ID', async () => {
  const [job] = await sources.greenhouse('example', { getJson: async () => ({ jobs: [{ id: 0 }] }) });
  assert.equal(job.id, '0');
  for (const field of fields.filter(key => !['source', 'company', 'id'].includes(key))) {
    assert.equal(job[field], null, field);
  }
});

test('ambiguous or hidden Ashby compensation is not represented as a single salary', async () => {
  for (const hidden of [true, false]) {
    const salary = { compensationType: 'Salary', minValue: 10, maxValue: 20, currencyCode: 'USD', interval: '1 YEAR' };
    const body = { jobs: [{ id: '1', shouldDisplayCompensationOnJobPostings: !hidden,
      compensation: { summaryComponents: hidden ? [salary] : [salary, salary] } }] };
    const [job] = await sources.ashby('example', { getJson: async () => body });
    assert.equal(job.salaryMin, null);
    assert.equal(job.salaryCurrency, null);
  }
});

test('invalid company identifiers are rejected before any request', async () => {
  for (const source of Object.keys(boards)) {
    for (const company of ['https://example.com', '../other', 'a?b', '', 'a/b']) {
      await assert.rejects(sources[source](company, { getJson: async () => assert.fail('Unexpected request') }), /identifier/);
    }
  }
});

test('unexpected envelopes and absent IDs fail instead of establishing an empty baseline', async () => {
  for (const source of Object.keys(boards)) {
    await assert.rejects(sources[source]('example', { getJson: async () => ({ error: 'changed schema' }) }), /format/);
    const body = source === 'lever' ? [{}] : { jobs: [{}] };
    await assert.rejects(sources[source]('example', { getJson: async () => body }), /valid ID/);
  }
});
