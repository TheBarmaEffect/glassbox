import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { Hono } from 'hono';
import { consentFieldName } from '../core/selection.ts';

export const menu = new Hono();

menu.post('/audit', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  let consentName: string;
  try {
    consentName = consentFieldName(request.targetId);
  } catch {
    return c.json<UiResponse>({ showToast: 'Only Reddit posts and comments can be audited.' });
  }
  return c.json<UiResponse>({
    showForm: {
      name: 'confirmAudit',
      form: {
        acceptLabel: 'Send and audit',
        cancelLabel: 'Cancel',
        fields: [
          {
            defaultValue: false,
            helpText:
              'The selected post or comment will be sent over HTTPS to the zero-cost GlassBox Lite gateway. It is processed in memory, is not stored by GlassBox, and no result is posted publicly.',
            label: 'I have authority to submit this content and consent to this one audit.',
            name: consentName,
            type: 'boolean',
          },
        ],
        title: 'Audit selected Reddit content?',
      },
    },
  });
});
