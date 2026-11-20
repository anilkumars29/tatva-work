// Conversation scope and "what's next" (calendar events + planned follow-ups).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outOfScopeMessage, parseScopeHeader, refersToThisMeeting } from '../src/voice/scope.js';
import { mergeUpcoming, sameEvent } from '../src/voice/upcoming.js';

const ID = '694a6844-1234-4abc-9def-0123456789ab';

test('scope header: meeting:<uuid> is meeting mode, anything else is general', () => {
  assert.equal(parseScopeHeader(`meeting:${ID}`), ID);
  assert.equal(parseScopeHeader(`MEETING:${ID.toUpperCase()}`), ID);
  for (const v of [undefined, null, '', 'all', 'meeting:', 'meeting:not-a-uuid', `${ID}`, `meeting:${ID}; drop table`]) assert.equal(parseScopeHeader(v), null, String(v));
});

test('"this meeting" style references stay on the focused meeting', () => {
  for (const r of [undefined, '', 'this meeting', 'the meeting', 'latest', 'current call', 'this', 'it']) assert.ok(refersToThisMeeting(r), String(r));
  for (const r of ['hiring plan sync', 'Q4 vendor review']) assert.equal(refersToThisMeeting(r), false, r);
});

test('out-of-scope reply names the meeting and points to the dashboard', () => {
  const m = outOfScopeMessage({ kind: 'meeting', meetingId: ID, title: 'Pilot Review and Q1 Rollout', date: 'Sat 21 Nov' });
  assert.match(m, /focused on Pilot Review and Q1 Rollout/);
  assert.match(m, /Talk to Tatva from the dashboard/);
});

const NOW = Date.parse('2026-11-21T06:00:00Z');
const storeTraining = { id: 'f1', topic: 'store training', people: ['Rahul'], suggested_at: '2026-11-26T09:30:00Z', meeting: 'Pilot Review and Q1 Rollout' };
const walkthrough = { id: 'f2', topic: 'Technical walkthrough preparation', people: [], suggested_at: '2026-11-27T09:30:00Z', meeting: 'Document Validation Workflow Sync' };
const regression = { id: 'f3', topic: 'Regression testing plan', people: [], suggested_at: '2026-11-23T05:30:00Z', meeting: 'Document Validation Workflow Sync' };
const oldOne = { id: 'f4', topic: 'Old topic', people: [], suggested_at: '2026-11-10T05:30:00Z', meeting: 'Q4 Vendor Review' };
const calStore = { title: 'Store training', start: '2026-11-26T09:30:00.000Z', attendees: ['Rahul Das'], link: 'https://calendar/1' };
const calBudget = { title: 'Budget Review', start: '2026-11-23T05:30:00.000Z', attendees: [], link: null };

test('a follow-up matches its calendar event by words or by time slot', () => {
  assert.ok(sameEvent('store training', storeTraining.suggested_at, calStore));
  assert.ok(sameEvent('Store training session with Rahul', null, { title: 'Store training', start: '2026-12-01T00:00:00Z' }));
  assert.equal(sameEvent('Technical walkthrough preparation', walkthrough.suggested_at, calStore), false);
  assert.equal(sameEvent('Regression testing plan', regression.suggested_at, calBudget), false, 'same slot but no shared word');
});

test('general mode: calendar events and follow-ups merged by date, past ones dropped', () => {
  const items = mergeUpcoming([calStore, calBudget], [walkthrough, storeTraining, regression, oldOne], { onlyFollowUps: false, now: NOW });
  assert.deepEqual(
    items.map((i) => [i.title, i.kind, i.on_calendar]),
    [
      ['Regression testing plan', 'follow_up', false],
      ['Budget Review', 'calendar_event', true],
      ['Store training', 'follow_up', true],
      ['Technical walkthrough preparation', 'follow_up', false],
    ],
  );
});

test('meeting mode: only that meeting\'s follow-ups, the earlier one first, marked on or off the calendar', () => {
  // Without the calendar event the store training follow-up is "not on the calendar yet".
  const off = mergeUpcoming([calBudget], [storeTraining], { onlyFollowUps: true, now: NOW });
  assert.equal(off.length, 1);
  assert.equal(off[0].title, 'store training');
  assert.equal(off[0].on_calendar, false);
  assert.equal(off[0].follow_up_id, 'f1');
  assert.deepEqual(off[0].people, ['Rahul']);
  // With it, the same follow-up is on the calendar, and unrelated events never appear.
  const on = mergeUpcoming([calBudget, calStore], [storeTraining], { onlyFollowUps: true, now: NOW });
  assert.deepEqual(on.map((i) => [i.title, i.on_calendar]), [['Store training', true]]);
});

test('the bug: a later calendar event must not hide an earlier follow-up', () => {
  const later = { title: 'Technical walkthrough preparation', start: '2026-11-27T09:30:00.000Z', attendees: [], link: null };
  const items = mergeUpcoming([later], [storeTraining], { onlyFollowUps: false, now: NOW });
  assert.equal(items[0].title, 'store training');
  assert.equal(items[0].on_calendar, false);
});
