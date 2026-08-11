import { context, reddit, settings } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { Hono } from 'hono';
import {
  formatTrustCard,
  GatewayError,
  requestGlassboxAudit,
  selectedContent,
} from '../core/audit.ts';
import { consentedTargetId } from '../core/selection.ts';

type ConfirmAuditValues = Record<string, unknown>;

export const forms = new Hono();

forms.post('/confirm-audit', async (c) => {
  const values = await c.req.json<ConfirmAuditValues>();
  const targetId = consentedTargetId(values);
  if (!targetId) {
    return c.json<UiResponse>({ showToast: 'Audit canceled: consent is required.' });
  }

  let stage = 'content';
  try {
    const content = await loadSelectedContent(targetId);
    stage = 'settings';
    const secret = await settings.get('glassboxGatewaySecret');
    if (typeof secret !== 'string' || !secret.trim()) {
      throw new GatewayError('GlassBox gateway secret is not configured.');
    }
    stage = 'gateway';
    const card = await requestGlassboxAudit({ content, secret });
    stage = 'format';
    const result = formatTrustCard(card);
    return c.json<UiResponse>({
      showForm: {
        name: 'closeResult',
        form: {
          acceptLabel: 'Close',
          cancelLabel: 'Close',
          fields: [
            {
              defaultValue: result,
              helpText: 'This transient result is not posted to Reddit or stored by this app.',
              label: 'Trust Card',
              name: 'result',
              required: false,
              type: 'paragraph',
            },
          ],
          title: 'GlassBox Trust Card',
        },
      },
    });
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message
        : 'GlassBox could not audit the selected content. Retry shortly.';
    console.error(
      `GlassBox Devvit audit failed: ${
        error instanceof GatewayError
          ? `gateway-${error.status ?? 'network'}`
          : `internal-${stage}`
      }`,
    );
    return c.json<UiResponse>({ showToast: message });
  }
});

forms.post('/close-result', async (c) => {
  await c.req.json<Record<string, unknown>>().catch(() => ({}));
  return c.json<UiResponse>({ showToast: 'GlassBox audit closed.' });
});

async function loadSelectedContent(targetId: string) {
  if (targetId.startsWith('t1_')) {
    const comment = await reddit.getCommentById(targetId as `t1_${string}`);
    assertInstallationScope(comment.subredditName);
    const post = await reddit.getPostById(comment.postId);
    return selectedContent('comment', post.title, comment.body);
  }
  if (targetId.startsWith('t3_')) {
    const post = await reddit.getPostById(targetId as `t3_${string}`);
    assertInstallationScope(post.subredditName);
    return selectedContent('post', post.title, post.body ?? post.title);
  }
  throw new Error('No selected Reddit post or comment is available.');
}

function assertInstallationScope(subredditName: string): void {
  if (
    context.subredditName &&
    subredditName.toLowerCase() !== context.subredditName.toLowerCase()
  ) {
    throw new Error('Selected content is outside the installed subreddit.');
  }
}
