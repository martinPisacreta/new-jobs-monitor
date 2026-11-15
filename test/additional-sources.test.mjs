import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseInput } from '../src/input.mjs';
import { run } from '../src/run.mjs';
import { workday, rippling } from '../src/sources.mjs';

globalThis.fetch = async () => { throw new Error('Real network disabled'); };
const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/additional-${name}.json`, import.meta.url), 'utf8'));
const company = 'nvidia/wd5/NVIDIAExternalCareerSite';
const boardUrl = 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite';
const keys = ['source', 'company', 'id', 'title', 'location', 'remote', 'department', 'url', 'publishedAt', 'updatedAt', 'salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod'].sort();

test('Workday URL, locale URL and short form share company identity', () => {
  const input = parseInput({ companies: [
    { source: 'workday', company: boardUrl },
    { source: 'workday', company: 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite' },
    { source: 'workday', company },
    { source: 'rippling', company: 'rippling' },
  ] });
  assert.deepEqual(input.companies, [
    { source: 'workday', company },
    { source: 'rippling', company: 'rippling' },
  ]);
});

test('invalid Workday identifiers fail before any board is requested', async () => {
  for (const value of [
    'https://example.com/site',
    'https://nvidia.wd5.myworkdayjobs.com.evil.example/site',
    'https://evilmyworkdayjobs.com/site',
    'https://user@nvidia.wd5.myworkdayjobs.com/site',
    'https://nvidia.wd5.myworkdayjobs.com:443/site',
    'http://nvidia.wd5.myworkdayjobs.com/site',
    `${boardUrl}?query=1`, `${boardUrl}#fragment`,
    'nvidia/wd5/../site', 'nvidia/wd5/%2e%2e',
  ]) {
    const companies = [{ source: 'greenhouse', company: 'fixture' }, { source: 'workday', company: value }];
    assert.throws(() => parseInput({ companies }), TypeError);
    await assert.rejects(run({ companies }, undefined, {
      fetchImpl: async () => assert.fail('Invalid board reached transport'),
    }), TypeError);
  }
  for (const workdayMaxPages of [0, 101, 1.5, '10']) {
    assert.throws(() => parseInput({ companies: [{ source: 'workday', company }], workdayMaxPages }), TypeError);
  }
});

test('Workday maps real pages and retains the initial total at the cap', async () => {
  const pages = [await fixture('workday-page-1'), await fixture('workday-page-2')];
  const offsets = [];
  let pagination;
  const rows = await workday(company, {
    maxPages: 2,
    getJson: async (_url, init) => {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['Content-Type'], 'application/json');
      const body = JSON.parse(init.body);
      assert.equal(body.limit, 20);
      offsets.push(body.offset);
      return pages[offsets.length - 1];
    },
    onPagination: value => { pagination = value; },
  });
  assert.equal(pages[1].total, 0);
  assert.deepEqual(offsets, [0, 20]);
  assert.equal(pagination.totalReported, pages[0].total);
  assert.equal(pagination.pagesFetched, 2);
  assert.equal(pagination.truncated, true);
  assert.equal(pagination.stopReason, 'max-pages');
  assert.equal(rows.length, new Set(pages.flatMap(page => page.jobPostings.map(job => job.externalPath))).size);
  assert.deepEqual(Object.keys(rows[0]).sort(), keys);
  assert.equal(rows[0].id, pages[0].jobPostings[0].externalPath);
  assert.equal(rows[0].company, company);
  assert.equal(rows[0].publishedAt, null);
  assert.equal(rows[0].salaryMin, null);
});

test('Workday defaults to ten pages and at most 200 jobs', async () => {
  const page = await fixture('workday-page-1');
  let calls = 0;
  let pagination;
  const rows = await workday(company, {
    getJson: async () => {
      const suffix = calls++;
      return { ...page, total: suffix === 0 ? 1000 : 0, jobPostings: page.jobPostings.map(job => ({
        ...job, externalPath: `${job.externalPath}-page-${suffix}`,
      })) };
    },
    onPagination: value => { pagination = value; },
  });
  assert.equal(calls, 10);
  assert.equal(rows.length, 200);
  assert.equal(pagination.truncated, true);
});

test('short pages and reached totals report completion; repeated pages report truncation', async () => {
  const page = await fixture('workday-page-1');
  for (const [body, expectedCalls, truncated, reason] of [
    [{ ...page, total: 1, jobPostings: page.jobPostings.slice(0, 1) }, 1, false, 'short-page'],
    [{ ...page, total: 20 }, 1, false, 'reported-total'],
    [{ ...page, total: 1000 }, 2, true, 'repeated-page'],
  ]) {
    let calls = 0;
    let pagination;
    await workday(company, {
      getJson: async () => { calls++; return body; },
      onPagination: value => { pagination = value; },
    });
    assert.equal(calls, expectedCalls);
    assert.equal(pagination.truncated, truncated);
    assert.equal(pagination.stopReason, reason);
  }
});

test('Rippling maps its saved fixture to the existing output contract', async () => {
  const body = await fixture('rippling');
  const rows = await rippling('rippling', { getJson: async () => body });
  assert.equal(rows.length, body.length);
  assert.deepEqual(Object.keys(rows[0]).sort(), keys);
  assert.equal(rows[0].id, body[0].uuid);
  assert.equal(rows[0].title, body[0].name.trim());
  assert.equal(rows[0].department, body[0].department.label.trim());
  assert.equal(rows[0].publishedAt, null);
  assert.equal(rows[0].salaryMin, null);
});

test('run avoids cross-host pauses and preserves ID history', async () => {
  const page = await fixture('workday-page-1');
  const ripplingBody = await fixture('rippling');
  const input = { companies: [
    { source: 'workday', company: boardUrl },
    { source: 'rippling', company: 'rippling' },
    { source: 'greenhouse', company: 'fixture' },
  ], workdayMaxPages: 1 };
  const execute = async previous => {
    let time = 0;
    const waits = [];
    let calls = 0;
    const result = await run(input, previous, {
      now: () => time,
      sleep: async ms => { waits.push(ms); time += ms; },
      fetchImpl: async (url, init) => {
        calls++;
        let body;
        if (url.includes('myworkdayjobs.com')) {
          assert.equal(init.method, 'POST');
          assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
          assert.equal(JSON.parse(init.body).offset, 0);
          body = page;
        } else if (url.includes('rippling.com')) {
          body = ripplingBody;
        } else {
          assert.ok(url.includes('greenhouse.io'));
          body = { jobs: [] };
        }
        return { ok: true, json: async () => { time += 100; return body; } };
      },
    });
    assert.equal(calls, 3);
    assert.deepEqual(waits, []);
    assert.ok(result.report.every(item => item.error === null));
    const report = result.report.find(item => item.source === 'workday');
    assert.equal(report.company, company);
    assert.equal(report.truncated, true);
    assert.equal(report.maxPages, 1);
    return result;
  };
  const first = await execute();
  assert.ok(first.newJobs.some(job => job.source === 'workday'));
  assert.ok(first.newJobs.some(job => job.source === 'rippling'));
  input.companies[0].company = company;
  const second = await execute(first.state);
  assert.equal(second.newJobs.length, 0);
  assert.deepEqual(second.state, first.state);
});
