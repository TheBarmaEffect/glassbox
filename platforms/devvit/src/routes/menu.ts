import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { Hono } from 'hono';

export const menu = new Hono();

menu.post('/audit', async (c) => {
  await c.req.json<MenuItemRequest>();
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
            name: 'consent',
            type: 'boolean',
          },
        ],
        title: 'Audit selected Reddit content?',
      },
    },
  });
});
