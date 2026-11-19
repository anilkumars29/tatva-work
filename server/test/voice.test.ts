import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmationIntent, dropRepeat, speakable } from '../src/voice/speech.js';

test('clear yes confirms', () => {
  for (const t of ['Yes.', 'yeah go ahead', 'Haan, send it', 'Okay, do it', 'Sure!', 'Yes please', 'Try again', "That's right"]) {
    assert.equal(confirmationIntent(t), 'yes', t);
  }
});

test('no cancels', () => {
  for (const t of ['No.', 'Nope', 'cancel that', "Don't send it", 'never mind']) assert.equal(confirmationIntent(t), 'no', t);
});

test('yes with changes, or other speech, is not a confirmation', () => {
  for (const t of [
    'Yes but send it to Rahul instead',
    'Actually wait',
    'What did we decide in the performance review?',
    'Change the time to 3 pm',
    'yes and also can you tell me what else is pending from the last meeting with the whole team',
    '',
  ]) {
    assert.equal(confirmationIntent(t), null, t);
  }
});

test('speakable strips markdown and urls', () => {
  assert.equal(speakable('**Done**, see https://x.y/z'), 'Done, see ');
  assert.equal(speakable('- one\n2. two'), 'one\ntwo');
});

test('dropRepeat keeps the first copy of a doubled answer', () => {
  const once = 'Your next meeting is the design review on Friday. Nothing else is pending.';
  assert.equal(dropRepeat(`${once}${once}`), once);
  assert.equal(dropRepeat(`${once} Your next meeting is the design review on Friday, remember.`), once);
  assert.equal(dropRepeat(once), once);
});
