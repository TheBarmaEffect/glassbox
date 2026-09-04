import assert from "node:assert/strict";
import test from "node:test";

import { CLIENT_ID_HEADER, apiRateKey, hashedRateKey, validClientId } from "../src/ratekey.js";
import { mcpRateKey } from "../src/mcp.js";

test("API callers get separate rate buckets instead of one shared bucket", () => {
  const first = apiRateKey(undefined, "203.0.113.10");
  const second = apiRateKey(undefined, "203.0.113.11");
  assert.notEqual(first, second, "two callers shared a rate bucket");
});

test("a rate key is stable for the same caller", () => {
  assert.equal(apiRateKey(undefined, "203.0.113.10"), apiRateKey(undefined, "203.0.113.10"));
  assert.equal(apiRateKey("tenant-a", "203.0.113.10"), apiRateKey("tenant-a", "198.51.100.4"));
});

test("a rate key never retains the network address", () => {
  const key = apiRateKey(undefined, "203.0.113.10");
  assert.doesNotMatch(key, /203\.0\.113/);
  assert.match(key, /^api-addr:[a-f0-9]{32}$/);
});

test("a caller-supplied client id keeps one bucket across addresses", () => {
  const fromOne = apiRateKey("fleet-7", "203.0.113.10");
  const fromAnother = apiRateKey("fleet-7", "203.0.113.99");
  assert.equal(fromOne, fromAnother, "a distributed client was split across buckets by IP");
  assert.match(fromOne, /^api-client:[a-f0-9]{32}$/);
});

test("a client id cannot collide with another caller's address bucket", () => {
  // Namespaces differ, so choosing a client id equal to someone's address is not a way
  // to land in — or exhaust — their bucket.
  assert.notEqual(apiRateKey("203.0.113.10", "198.51.100.1"), apiRateKey(undefined, "203.0.113.10"));
});

test("client ids are bounded and printable, and fall back to the address otherwise", () => {
  assert.equal(validClientId("fleet-7"), "fleet-7");
  assert.equal(validClientId(""), undefined);
  assert.equal(validClientId("   "), undefined);
  assert.equal(validClientId("a".repeat(129)), undefined);
  assert.equal(validClientId("bad\nvalue"), undefined);
  assert.equal(validClientId("naïve"), undefined);
  // An unusable client id must not become its own shared bucket.
  assert.equal(apiRateKey("a".repeat(129), "203.0.113.10"), apiRateKey(undefined, "203.0.113.10"));
});

test("namespaces keep surfaces apart", () => {
  assert.notEqual(hashedRateKey("mcp", "203.0.113.10"), hashedRateKey("api-addr", "203.0.113.10"));
  assert.match(mcpRateKey("203.0.113.10"), /^mcp:[a-f0-9]{32}$/);
});

test("the header name is the documented one", () => {
  assert.equal(CLIENT_ID_HEADER, "x-glassbox-client");
});
