import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachmentCitation } from '../src/pipeline/citation.js';

test('images are cited by what they show', () => {
  assert.equal(attachmentCitation({ name: 'Pricing.png', kind: 'image', label: 'slide' }, 'Q4 Vendor Review'), 'the slide "Pricing.png" shared in Q4 Vendor Review');
});

test('pdfs and unlabelled images', () => {
  assert.equal(attachmentCitation({ name: 'Plan.pdf', kind: 'pdf', label: null }, 'Hiring Plan Sync'), 'the PDF "Plan.pdf" shared in Hiring Plan Sync');
  assert.equal(attachmentCitation({ name: 'x.webp', kind: 'image' }, 'M'), 'the image "x.webp" shared in M');
});
