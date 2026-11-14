import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonioXml } from '../src/personio-xml.mjs';

test('Personio XML reads fields, entities, CDATA and optional empty values', () => {
  const jobs = parsePersonioXml(`<?xml version="1.0" encoding="UTF-8"?>
    <workzag-jobs>
      <!-- Synthetic parser coverage; live fixture tested separately. -->
      <position>
        <id>0</id><name><![CDATA[Research & Development <Engineer>]]></name>
        <office>Berlin &amp; Munich &#38; &#x1F30D;</office>
        <department/>
        <jobDescriptions><jobDescription><name language="en">About us</name>
          <value><![CDATA[<p>Ignored nested description</p>]]></value>
        </jobDescription></jobDescriptions>
      </position>
      <position><id>two</id><name>A &lt; B &quot;C&quot; &apos;D&apos;</name></position>
    </workzag-jobs>`);
  assert.deepEqual(jobs, [
    { id: '0', name: 'Research & Development <Engineer>', office: 'Berlin & Munich & 🌍', department: null, createdAt: null },
    { id: 'two', name: `A < B "C" 'D'`, office: null, department: null, createdAt: null },
  ]);
  assert.equal(parsePersonioXml('<workzag-jobs><position><id>&amp;lt;</id></position></workzag-jobs>')[0].id, '&lt;');
});

test('Personio XML recognizes an empty board', () => {
  assert.deepEqual(parsePersonioXml('<workzag-jobs/>'), []);
  assert.deepEqual(parsePersonioXml('<workzag-jobs> </workzag-jobs>'), []);
});

test('Personio XML rejects malformed feeds instead of creating an empty baseline', () => {
  const malformed = [
    '', '<html/>', '<workzag-jobs>', '<workzag-jobs><position></workzag-jobs>',
    '<workzag-jobs/><workzag-jobs/>', '<workzag-jobs><other/></workzag-jobs>',
    '<workzag-jobs><position><id/></position></workzag-jobs>',
    '<workzag-jobs><position><id>a</id><id>b</id></position></workzag-jobs>',
    '<workzag-jobs><position><id><nested/></id></position></workzag-jobs>',
    '<workzag-jobs><position><id>&unknown;</id></position></workzag-jobs>',
    '<workzag-jobs><position><id>&#0;</id></position></workzag-jobs>',
    '<workzag-jobs><position><id>&#xD800;</id></position></workzag-jobs>',
    '<workzag-jobs><position><id>&#x110000;</id></position></workzag-jobs>',
    '<!DOCTYPE workzag-jobs SYSTEM "file:///etc/passwd"><workzag-jobs/>',
    '<!DOCTYPE workzag-jobs [<!ENTITY x "secret">]><workzag-jobs/>',
    '<workzag-jobs><position><id>a</id><name>unescaped & text</name></position></workzag-jobs>',
  ];
  for (const xml of malformed) assert.throws(() => parsePersonioXml(xml), /personio:/);
  assert.throws(() => parsePersonioXml(null), /personio:/);
});
