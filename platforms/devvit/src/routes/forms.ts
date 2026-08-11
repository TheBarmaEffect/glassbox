import { context, reddit, settings } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { Hono } from 'hono';
import {
  formatTrustCard,
  GatewayError,
  requestGlassboxAudit,
  selectedContent,
} from '../core/audit.ts';

type ConfirmAuditValues = { consent?: boolean };

export const forms = new Hono();

forms.post('/confirm-audit', async (c) => {
  const values = await c.req.json<ConfirmAuditValues>();
  if (values.consent !== true) {
    return c.json<UiResponse>({ showToast: 'Audit canceled: consent is required.' });
  }

  try {
    const [content, secret] = await Promise.all([
      loadSelectedContent(),
      settings.get('glassboxGatewaySecret'),
    ]);
    if (typeof secret !== 'string' || !secret.trim()) {
      throw new GatewayError('GlassBox gateway secret is not configured.');
    }
    const card = await requestGlassboxAudit({ content, secret });
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
      `GlassBox Devvit audit failed: ${error instanceof GatewayError ? 'gateway' : 'internal'}`,
    );
    return c.json<UiResponse>({ showToast: message });
  }
});

forms.post('/close-result', async (c) => {
  await c.req.json<Record<string, unknown>>().catch(() => ({}));
  return c.json<UiResponse>({ showToast: 'GlassBox audit closed.' });
});

async function loadSelectedContent() {
  if (context.commentId) {
    const comment = await reddit.getCommentById(context.commentId);
    assertInstallationScope(comment.subredditName);
    const post = await reddit.getPostById(comment.postId);
    return selectedContent('comment', post.title, comment.body);
  }
  if (context.postId) {
    const post = await reddit.getPostById(context.postId);
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
