import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { Hono } from 'hono';
import { forms } from './routes/forms.ts';
import { menu } from './routes/menu.ts';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/forms', forms);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
