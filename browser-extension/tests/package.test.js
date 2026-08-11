const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

for (const variant of ["chromium", "firefox"]) {
  test(`${variant} manifest has only the minimum explicit-audit permissions`, () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, `manifest.${variant}.json`), "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions.sort(), ["contextMenus", "storage"]);
    assert.deepEqual(manifest.host_permissions, ["https://glassbox-platform-gateway.onrender.com/*"]);
    assert.equal("content_scripts" in manifest, false);
    assert.equal("tabs" in manifest.permissions, false);
    assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
    assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-eval|unsafe-inline/);
  });
}

test("Firefox truthfully declares explicit website-content transmission", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.firefox.json"), "utf8"));
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "142.0");
  assert.deepEqual(
    manifest.browser_specific_settings.gecko.data_collection_permissions.required,
    ["websiteContent"],
  );
});

test("the audit UI uses inert DOM rendering and no remote scripts", () => {
  const html = fs.readFileSync(path.join(root, "audit.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "audit.js"), "utf8");
  assert.doesNotMatch(html, /<script[^>]+https?:/i);
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(script, /textContent/);
  assert.match(html, /Nothing is read or sent until you press/);
});

test("the extension contains complete icon sizes and privacy documentation", () => {
  for (const size of [16, 32, 48, 128]) {
    assert.ok(fs.statSync(path.join(root, "icons", `icon-${size}.png`)).size > 100);
  }
  const privacy = fs.readFileSync(path.join(root, "privacy.html"), "utf8");
  assert.match(privacy, /does not inject a content script/);
  assert.match(privacy, /Nothing is sent until/);
});
