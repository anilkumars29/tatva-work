import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionMinutes, estimateTimeSaved } from '../src/pipeline/timesaved.js';

test('a short meeting with two tasks and one follow-up', () => {
  const r = estimateTimeSaved({ durationSeconds: 46, actionItems: 2, followUpTopics: 1 });
  assert.deepEqual(r.breakdown, [
    { task: 'Meeting notes & summary doc', minutes: 3 },
    { task: 'Capturing 2 action items', minutes: 2 },
    { task: 'Noting 1 follow-up topic', minutes: 1 },
  ]);
  assert.equal(r.minutes, 6);
});

test('notes scale with meeting length', () => {
  assert.equal(estimateTimeSaved({ durationSeconds: 30 * 60, actionItems: 0, followUpTopics: 0 }).minutes, 9);
});

test('executed actions add their minutes, grouped', () => {
  const r = estimateTimeSaved({
    durationSeconds: 60,
    actionItems: 0,
    followUpTopics: 0,
    actions: [
      { tool: 'send_email' },
      { tool: 'send_email' },
      { tool: 'post_to_slack' },
      { tool: 'add_tracker_row', args: { rows: [{}, {}, {}] } },
      { tool: 'search_knowledge' },
    ],
  });
  assert.deepEqual(r.breakdown.slice(1), [
    { task: 'Sending 2 emails', minutes: 8 },
    { task: 'Posting 1 Slack update', minutes: 2 },
    { task: 'Adding 3 tracker rows', minutes: 3 },
  ]);
  assert.equal(r.minutes, 3 + 8 + 2 + 3);
  assert.equal(actionMinutes('get_open_items', {}), 0);
});
