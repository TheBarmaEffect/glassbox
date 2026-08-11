import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppConfig } from '@devvit/shared-types/schemas/config-file.v1.js';

const config = parseAppConfig(readFileSync('devvit.json', 'utf8'), false);
if (!config.server) throw new Error('devvit.json must configure a server.');
const entry = join(config.server.dir, config.server.entry);
if (!existsSync(entry)) throw new Error(`Built server entry is missing: ${entry}`);
if (!config.permissions.http.domains.includes('glassbox-platform-gateway.onrender.com')) {
  throw new Error('The exact GlassBox gateway hostname is missing from HTTP permissions.');
}
if (!config.permissions.reddit.enable) throw new Error('Reddit read permission is disabled.');

console.log(`Validated Devvit config and server entry: ${entry}`);
