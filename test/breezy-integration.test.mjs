import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseInput } from '../src/input.mjs';
import { run } from '../src/run.mjs';

test('Breezy integrates input, schema, default dispatch and saved history', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/breezy.json', import.meta.url), 'utf8'));
  const schema = JSON.parse(await readFile(new URL('../.actor/input_schema.json', import.meta.url), 'utf8'));
  assert.ok(schema.properties.companies.items.properties.source.enum.includes('breezy'));
  const input = parseInput({ companies: [{ source: 'breezy', company: 'breezy' }], stateKey: 'breezy-integration' });
  let requests = 0;
  const options = { fetchImpl: async url => {
    requests += 1;
    assert.equal(url, 'https://breezy.breezy.hr/json');
    return new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } });
  } };
  const first = await run(input, undefined, options);
  assert.equal(first.report[0].error, null);
  assert.equal(first.report[0].totalJobs, 2);
  assert.equal(first.newJobs.length, 2);
  const saved = JSON.parse(JSON.stringify(first.state));
  const second = await run(input, saved, options);
  assert.equal(second.report[0].error, null);
  assert.equal(second.report[0].totalJobs, 2);
  assert.equal(second.newJobs.length, 0);
  assert.deepEqual(second.state, saved);
  assert.equal(requests, 2);
});
