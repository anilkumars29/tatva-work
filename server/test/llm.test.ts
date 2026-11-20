// Groq 429 parsing: which limit was hit and how long to wait.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRetryAfter, rateLimitKind } from '../src/llm-limits.js';
import { cleanOwner } from '../src/pipeline/owners.js';

const TPD =
  '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197243, Requested 3031. Please try again in 1m58.368s. Need more tokens?","type":"tokens","code":"rate_limit_exceeded"}}';
const TPM =
  '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-20b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 900. Please try again in 6.75s.","type":"tokens","code":"rate_limit_exceeded"}}';
const RPD = 'Rate limit reached for model `qwen/qwen3.8-27b` on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 1h2m3s.';

test('daily limits switch models, per-minute limits wait', () => {
  assert.equal(rateLimitKind(TPD), 'day');
  assert.equal(rateLimitKind(RPD), 'day');
  assert.equal(rateLimitKind(TPM), 'minute');
  assert.equal(rateLimitKind('Rate limit reached on requests per minute (RPM)'), 'minute');
});

test('retry time from the header or the message', () => {
  assert.equal(parseRetryAfter('7', ''), 7000);
  assert.equal(Math.round(parseRetryAfter(null, TPD)!), 118_368);
  assert.equal(parseRetryAfter(null, TPM), 6750);
  assert.equal(parseRetryAfter(null, RPD), 3_723_000);
  assert.equal(parseRetryAfter(null, 'Please try again in 250ms.'), 250);
  assert.equal(parseRetryAfter(null, 'no time given'), null);
});

test('pronouns are not owners (speakers are unlabelled)', () => {
  for (const o of ['I', 'me', 'We', 'Speaker 2', 'someone', '', null]) assert.equal(cleanOwner(o), null, String(o));
  assert.equal(cleanOwner('Priya'), 'Priya');
  assert.equal(cleanOwner('Rahul Das'), 'Rahul Das');
});
