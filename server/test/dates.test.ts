// pnpm test: deterministic checks for spoken-date resolution (no secrets needed).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedDate, fixDateTime, fixDueDate } from '../src/pipeline/dates.js';

const thursday = new Date('2026-11-19T16:00:00+05:30');
const friday = new Date('2026-11-20T10:00:00+05:30');
const followUp = { nextWeekMeansMonday: true };
const deadline = { nextWeekMeansMonday: false };

test('weekdays resolve to the first such day after the meeting', () => {
  assert.equal(expectedDate('by Friday', thursday, deadline), '2026-11-20');
  assert.equal(expectedDate('Monday', thursday, deadline), '2026-11-23');
  assert.equal(expectedDate('next Tuesday at 3 PM', thursday, followUp), '2026-11-24');
  assert.equal(expectedDate('Tuesday afternoon', thursday, followUp), '2026-11-24');
  assert.equal(expectedDate('on Thursday', thursday, followUp), '2026-11-26'); // same weekday -> next week
  assert.equal(expectedDate('Friday', friday, followUp), '2026-11-27');
});

test('"<day> next week" lands in next week', () => {
  assert.equal(expectedDate('Friday next week', thursday, followUp), '2026-11-27');
});

test('"next week" means Monday only for follow-ups, never for "end of next week"', () => {
  assert.equal(expectedDate('next week', thursday, followUp), '2026-11-23');
  assert.equal(expectedDate('next week', friday, followUp), '2026-11-23');
  assert.equal(expectedDate('next week', thursday, deadline), null);
  assert.equal(expectedDate('by the end of next week', thursday, followUp), null);
});

test('phrases without a checkable cue are left to the LLM', () => {
  assert.equal(expectedDate('after the launch on December 1st', thursday, followUp), null);
  assert.equal(expectedDate('next month', thursday, followUp), null);
  assert.equal(expectedDate(null, thursday, followUp), null);
});

test('fixDateTime corrects the date but keeps the time of day', () => {
  assert.equal(fixDateTime('2026-12-02T15:00:00+05:30', 'next week', thursday), '2026-11-23T15:00:00+05:30');
  assert.equal(fixDateTime(null, 'Tuesday', thursday), '2026-11-24T11:00:00+05:30');
  assert.equal(fixDateTime('2026-12-02T11:00:00+05:30', 'after the launch', thursday), '2026-12-02T11:00:00+05:30');
});

test('fixDueDate corrects a wrong weekday', () => {
  assert.equal(fixDueDate('2026-11-22', 'Monday', thursday), '2026-11-23');
  assert.equal(fixDueDate('2026-11-30', 'before the launch', thursday), '2026-11-30');
});
