import assert from 'node:assert/strict';
import test from 'node:test';
import { consentedTargetId, consentFieldName } from './selection.ts';

test('consent field carries a selected post through form submission', () => {
  const name = consentFieldName('t3_abc123');
  assert.equal(name, 'consentFor_t3_abc123');
  assert.equal(consentedTargetId({ [name]: true }), 't3_abc123');
});

test('consent field carries a selected comment through form submission', () => {
  const name = consentFieldName('t1_def456');
  assert.equal(consentedTargetId({ [name]: true }), 't1_def456');
});

test('missing, declined, ambiguous, and unsupported consent values fail closed', () => {
  assert.equal(consentedTargetId({}), undefined);
  assert.equal(consentedTargetId({ consentFor_t3_abc123: false }), undefined);
  assert.equal(
    consentedTargetId({ consentFor_t3_abc123: true, consentFor_t1_def456: true }),
    undefined,
  );
  assert.equal(consentedTargetId({ consentFor_t5_abc123: true }), undefined);
  assert.throws(() => consentFieldName('t5_abc123'));
});
