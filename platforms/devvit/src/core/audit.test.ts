import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatTrustCard,
  GatewayError,
  GLASSBOX_VERIFY_URL,
  isTrustCard,
  MAX_ANSWER_CHARS,
  MAX_RESULT_CHARS,
  requestGlassboxAudit,
  selectedContent,
  type TrustCard,
} from './audit.ts';

const card: TrustCard = {
  audit: { log_id: 'lite-test' },
  claims: [{ text: 'secret raw claim that should not be displayed' }],
  ecs: { dimensions: { calibration: 0.4, consistency: 0.9 }, total: 0.65 },
  red_team: {
    pass_rate: 0.5,
    probes: [
      {
        angle: 'prompt_injection',
        finding: 'Ignore u/example and contact @everyone at https://evil.invalid',
        passed: false,
        severity: 'high',
      },
    ],
  },
  verdict: 'caution',
  verdict_rationale: 'One structural signal needs review.',
};

test('selectedContent bounds Reddit text and discloses truncation', () => {
  const content = selectedContent('comment', 'A title', `  ${'x'.repeat(MAX_ANSWER_CHARS + 50)}  `);
  assert.equal(content.answer.length, MAX_ANSWER_CHARS);
  assert.equal(content.truncated, true);
  assert.match(content.question, /Reddit comment/);
  assert.match(content.intents.at(-1) ?? '', /first 12,000 characters/);
});

test('selectedContent falls back to the post title for an empty body', () => {
  const content = selectedContent('post', 'Reasoning title', '   ');
  assert.equal(content.answer, 'Reasoning title');
  assert.equal(content.truncated, false);
});

test('requestGlassboxAudit sends the bearer only in the server request header', async () => {
  const secret = 'server-only-secret';
  let request: Request | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    request = new Request(input, init);
    return Response.json(card);
  };
  const result = await requestGlassboxAudit({
    content: selectedContent('post', 'Title', 'Answer'),
    fetchImpl,
    idempotencyKey: 'event-1',
    secret,
  });

  assert.equal(result.audit.log_id, 'lite-test');
  assert.equal(request?.url, GLASSBOX_VERIFY_URL);
  assert.equal(request?.headers.get('authorization'), `Bearer ${secret}`);
  assert.equal(request?.headers.get('x-idempotency-key'), 'reddit-devvit:event-1');
  const body = await request?.text();
  assert.equal(body?.includes(secret), false);
  assert.deepEqual(JSON.parse(body ?? '{}').platform, 'reddit');
});

test('gateway errors are status-specific and never include response bodies or secrets', async () => {
  const secret = 'never-leak-this';
  const fetchImpl: typeof fetch = async () =>
    new Response(`upstream accidentally echoed ${secret}`, { status: 401 });
  await assert.rejects(
    requestGlassboxAudit({
      content: selectedContent('post', 'Title', 'Answer'),
      fetchImpl,
      secret,
    }),
    (error: unknown) => {
      assert.ok(error instanceof GatewayError);
      assert.equal(error.status, 401);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes('echoed'), false);
      return true;
    },
  );
});

test('Trust Card validation rejects incomplete gateway output', () => {
  assert.equal(isTrustCard(card), true);
  assert.equal(isTrustCard({ verdict: 'trust' }), false);
  assert.equal(isTrustCard({ ...card, verdict: 'unknown' }), false);
});

test('transient result omits claim/evidence text and neutralizes mention and link syntax', () => {
  const output = formatTrustCard(card);
  assert.ok(output.length <= MAX_RESULT_CHARS);
  assert.doesNotMatch(output, /secret raw claim/);
  assert.doesNotMatch(output, /@everyone/);
  assert.doesNotMatch(output, /u\/example/);
  assert.doesNotMatch(output, /https:\/\/evil/);
  assert.match(output, /not an internet fact-check/);
});
