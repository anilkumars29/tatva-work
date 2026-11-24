import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wordsToSegments, type FinchWord } from '../src/pipeline/finch-segments.js';
import { buildKeywords } from '../src/pipeline/keywords.js';

const w = (text: string, start: number, end: number): FinchWord => ({ text, start, end, type: 'word' });
const sp = (at: number): FinchWord => ({ text: ' ', start: at, end: at, type: 'spacing' });

test('formatted text keeps its punctuation, times come from the raw words', () => {
  // Real Finch shape: raw lowercase words ("quarter", "s"), formatted text.
  const words = [w('budget', 0.1, 0.5), sp(0.5), w('is', 0.5, 0.6), sp(0.6), w('two', 0.6, 0.8), sp(0.8), w('lakh', 0.8, 1.0), sp(1.0), w('rahul', 1.2, 1.5), sp(1.5), w('owns', 1.5, 1.8), sp(1.8), w('last', 1.8, 2.0), sp(2.0), w('quarter', 2.0, 2.4), sp(2.4), w('s', 2.4, 2.5), sp(2.5), w('plan', 2.5, 2.9)];
  assert.deepEqual(wordsToSegments(words, "Budget is two lakh. Rahul owns last quarter's plan."), [
    { start: 0.1, end: 1.0, text: 'Budget is two lakh.' },
    { start: 1.2, end: 2.9, text: "Rahul owns last quarter's plan." },
  ]);
});

test('a long pause starts a new segment even without punctuation', () => {
  const segs = wordsToSegments([w('hello', 0, 0.4), w('there', 0.4, 0.8), w('next', 5, 5.3), w('topic', 5.3, 5.7)], 'Hello there next topic');
  assert.deepEqual(segs.map((s) => s.text), ['Hello there', 'next topic']);
  assert.equal(segs[1].start, 5);
});

test('small spelling differences between text and words still align', () => {
  const segs = wordsToSegments([w('pria', 0, 0.4), w('sent', 0.4, 0.7), w('it', 0.7, 0.9), w('monday', 10, 10.5)], 'Priya sent it. Monday');
  assert.deepEqual(segs, [
    { start: 0, end: 0.9, text: 'Priya sent it.' },
    { start: 10, end: 10.5, text: 'Monday' },
  ]);
});

test('segments stay under ~20 seconds without punctuation', () => {
  const words = Array.from({ length: 60 }, (_, i) => w(`w${i}`, i * 0.5, i * 0.5 + 0.4));
  const segs = wordsToSegments(words, words.map((x) => x.text).join(' '));
  assert.ok(segs.length >= 2);
  assert.ok(segs.every((s) => s.end - s.start <= 20));
  assert.equal(segs.map((s) => s.text).join(' ').split(' ').length, 60);
});

test('no words falls back to the plain text; no text uses the raw words', () => {
  assert.deepEqual(wordsToSegments([], 'Just text'), [{ start: 0, end: 0, text: 'Just text' }]);
  assert.deepEqual(wordsToSegments([]), []);
  assert.deepEqual(wordsToSegments([w('hi', 0, 0.3), w('all', 0.3, 0.6)]), [{ start: 0, end: 0.6, text: 'hi all' }]);
});

test('keywords: base words, names deduped, pronouns and junk dropped', () => {
  assert.deepEqual(buildKeywords(['lakh', 'crore', 'Tatva'], ['Anil K', 'Anil'], ['Meera', 'meera', 'Me', 'I', 'team', 'Priya Sharma', 'x', null, 'a@b.com']), [
    'lakh',
    'crore',
    'Tatva',
    'Anil K',
    'Anil',
    'Meera',
    'Priya Sharma',
  ]);
});
