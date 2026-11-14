import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseInput } from '../src/input.mjs';
import { run } from '../src/run.mjs';

test('SmartRecruiters works through input, default dispatch and persisted history', async () => {
  const input = parseInput({
    companies: [{ source: 'smartrecruiters', company: 'Visa' }],
    stateKey: 'smartrecruiters-integration',
  });
  let requests = 0;
  const options = { fetchImpl: async url => {
    requests += 1;
    assert.equal(url, 'https://api.smartrecruiters.com/v1/companies/Visa/postings?limit=100&offset=0');
    return new Response(JSON.stringify({
      totalFound: 2,
      content: [{ id: 'a', name: 'Engineer' }, { id: 'b', name: 'Designer' }],
    }), { headers: { 'Content-Type': 'application/json' } });
  } };
  const first = await run(input, undefined, options);
  assert.equal(first.report[0].error, null);
  assert.equal(first.newJobs.length, 2);
  const savedState = JSON.parse(JSON.stringify(first.state));
  const second = await run(input, savedState, options);
  assert.equal(second.report[0].error, null);
  assert.equal(second.report[0].totalJobs, 2);
  assert.equal(second.newJobs.length, 0);
  assert.deepEqual(second.state, savedState);
  assert.equal(requests, 2);
});

test('Actor schema accepts SmartRecruiters and includes required nested editors', async () => {
  const schema = JSON.parse(await readFile(new URL('../.actor/input_schema.json', import.meta.url), 'utf8'));
  const properties = schema.properties.companies.items.properties;
  assert.ok(properties.source.enum.includes('smartrecruiters'));
  for (const [field, editor] of [['source', 'select'], ['company', 'textfield']]) {
    assert.equal(properties[field].editor, editor);
    assert.ok(properties[field].title);
    assert.ok(properties[field].description);
  }
});
