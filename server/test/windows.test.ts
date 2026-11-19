import assert from 'node:assert/strict';
import { test } from 'node:test';
import { windows } from '../src/pipeline/windows.js';

test('short text is one window', () => {
  assert.deepEqual(windows('  Hello   world. '), ['Hello world.']);
  assert.deepEqual(windows(''), []);
});

test('long text splits into overlapping windows that cover everything', () => {
  const sentences = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} talks about vendor escalation.`);
  const text = sentences.join(' ');
  const parts = windows(text, 300, 60);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= 300);
  assert.ok(parts[0].endsWith('.'), 'breaks at a sentence end');
  for (const s of sentences) assert.ok(parts.some((p) => p.includes(s)), `"${s}" is in some window`);
});
