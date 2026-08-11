import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppConfig } from '@devvit/shared-types/schemas/config-file.v1.js';

const GATEWAY_DOMAIN = 'glassbox-platform-gateway.onrender.com';
const PRIVACY_URL = `https://${GATEWAY_DOMAIN}/privacy`;
const TERMS_URL = `https://${GATEWAY_DOMAIN}/terms`;

const config = parseAppConfig(readFileSync('devvit.json', 'utf8'), false);
if (!config.server) throw new Error('devvit.json must configure a server.');
const entry = join(config.server.dir, config.server.entry);
if (!existsSync(entry)) throw new Error(`Built server entry is missing: ${entry}`);
if (
  config.permissions.http.domains.length !== 1 ||
  config.permissions.http.domains[0] !== GATEWAY_DOMAIN
) {
  throw new Error(`HTTP permissions must contain only the exact hostname ${GATEWAY_DOMAIN}.`);
}
if (!config.permissions.reddit.enable) throw new Error('Reddit read permission is disabled.');

const readme = readFileSync('README.md', 'utf8');
if (!/^## Fetch Domains$/m.test(readme)) {
  throw new Error('README.md must include Reddit\'s required "## Fetch Domains" section.');
}
for (const requiredText of [GATEWAY_DOMAIN, PRIVACY_URL, TERMS_URL]) {
  if (!readme.includes(requiredText)) {
    throw new Error(`README.md is missing required review documentation: ${requiredText}`);
  }
}

const iconPath = config.marketingAssets?.icon;
if (!iconPath) throw new Error('devvit.json must configure marketingAssets.icon.');
const icon = readFileSync(iconPath);
const maxIconBytes = 500 * 1024;
if (icon.byteLength > maxIconBytes) {
  throw new Error(`${iconPath} must be at most 500KB; received ${icon.byteLength} bytes.`);
}
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!icon.subarray(0, pngSignature.length).equals(pngSignature)) {
  throw new Error(`${iconPath} must be a PNG.`);
}
const iconWidth = icon.readUInt32BE(16);
const iconHeight = icon.readUInt32BE(20);
if (iconWidth !== 1024 || iconHeight !== 1024) {
  throw new Error(`${iconPath} must be 1024x1024; received ${iconWidth}x${iconHeight}.`);
}

console.log(`Validated Devvit config, review documentation, app icon, and server entry: ${entry}`);
