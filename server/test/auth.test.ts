import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedOrigin, mintUploadToken, verifyUploadToken } from '../src/auth.js';

test('upload tokens verify with the same key until they expire', () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const token = mintUploadToken('k1', 600, now);
  assert.equal(verifyUploadToken(token, 'k1', now + 1000), true);
  assert.equal(verifyUploadToken(token, 'k2', now + 1000), false, 'other key');
  assert.equal(verifyUploadToken(token, 'k1', now + 601_000), false, 'expired');
  const [exp, sig] = token.split('.');
  assert.equal(verifyUploadToken(`${Number(exp) + 3600}.${sig}`, 'k1', now), false, 'extended expiry');
  assert.equal(verifyUploadToken('garbage', 'k1', now), false);
  assert.equal(verifyUploadToken(token, '', now), false, 'no key configured');
});

test('cors allows localhost, the extension and configured web origins only', () => {
  process.env.WEB_ORIGINS = 'https://tatva-work.vercel.app/, https://tatva.example.com';
  assert.equal(allowedOrigin(undefined), true);
  assert.equal(allowedOrigin('http://localhost:3000'), true);
  assert.equal(allowedOrigin('chrome-extension://abcdef'), true);
  assert.equal(allowedOrigin('https://tatva-work.vercel.app'), true);
  assert.equal(allowedOrigin('https://tatva.example.com'), true);
  assert.equal(allowedOrigin('https://evil.vercel.app'), false);
  assert.equal(allowedOrigin('https://tatva-work.vercel.app.evil.com'), false);
});
