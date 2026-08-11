import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const reproducibleTime = new Date("2026-08-11T00:00:00.000Z");
const common = [
  "audit.html",
  "audit.css",
  "audit.js",
  "background.js",
  "privacy.html",
  "lib/mcp-client.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
];

fs.mkdirSync(dist, { recursive: true });
const checksums = [];
for (const variant of ["chromium", "firefox"]) {
  const destination = path.join(dist, variant);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const relative of common) {
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, relative), target);
    fs.utimesSync(target, reproducibleTime, reproducibleTime);
  }
  const packagedManifest = path.join(destination, "manifest.json");
  fs.copyFileSync(path.join(root, `manifest.${variant}.json`), packagedManifest);
  fs.utimesSync(packagedManifest, reproducibleTime, reproducibleTime);
  validatePackage(destination, variant);

  const extension = variant === "firefox" ? "xpi" : "zip";
  const archive = path.join(dist, `glassbox-lite-${variant}-${version}.${extension}`);
  fs.rmSync(archive, { force: true });
  execFileSync("zip", ["-X", "-D", "-q", "-r", archive, "."], { cwd: destination });
  checksums.push(`${sha256(archive)}  ${path.basename(archive)}`);
}
fs.writeFileSync(path.join(dist, "SHA256SUMS"), `${checksums.join("\n")}\n`);
console.log(`Built GlassBox Lite ${version}: Chromium ZIP and Firefox XPI.`);

function validatePackage(directory, variant) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.manifest_version !== 3) throw new Error(`${variant}: Manifest V3 is required.`);
  if (manifest.content_scripts) throw new Error(`${variant}: Content scripts are forbidden.`);
  const permissions = new Set(manifest.permissions ?? []);
  for (const forbidden of ["tabs", "history", "cookies", "webRequest", "scripting", "activeTab", "clipboardRead"]) {
    if (permissions.has(forbidden)) throw new Error(`${variant}: forbidden permission ${forbidden}.`);
  }
  if (JSON.stringify(manifest).includes("unsafe-eval") || JSON.stringify(manifest).includes("unsafe-inline")) {
    throw new Error(`${variant}: unsafe CSP token.`);
  }
  if (variant === "firefox" && !manifest.browser_specific_settings?.gecko?.id) {
    throw new Error("Firefox package requires a stable Gecko ID for AMO signing.");
  }
  if (
    variant === "firefox" &&
    manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required?.[0] !== "websiteContent"
  ) {
    throw new Error("Firefox package must disclose explicit website-content transmission.");
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
