import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  VerificationTokenCapture,
  verifyBearer,
  verifyNotionSignature,
  verifyOauthState,
} from "../src/security.js";

test("verifies Notion HMAC against the exact raw body", () => {
  const token = ["secret", "webhook-verification-token-123"].join("_");
  const body = Buffer.from('{"type":"comment.created","value":"é"}');
  const signature = `sha256=${createHmac("sha256", token).update(body).digest("hex")}`;
  assert.equal(verifyNotionSignature(body, signature, token), true);
  assert.equal(verifyNotionSignature(Buffer.from(`${body.toString()} `), signature, token), false);
  assert.equal(verifyNotionSignature(body, undefined, token), false);
});

test("admin bearer and OAuth state comparisons fail closed", () => {
  assert.equal(verifyBearer("Bearer admin-secret", "admin-secret"), true);
  assert.equal(verifyBearer("Bearer wrong", "admin-secret"), false);
  assert.equal(verifyOauthState("state", "state"), true);
  assert.equal(verifyOauthState("state", "other"), false);
});

test("verification-token capture is one-time and never logs", () => {
  const capture = new VerificationTokenCapture();
  const token = ["secret", "abcdefghijklmnopqrstuvwxyz"].join("_");
  capture.capture(token);
  assert.throws(() => capture.capture(["secret", "another-valid-verification-token"].join("_")));
  assert.equal(capture.take(), token);
  assert.equal(capture.take(), undefined);
  assert.throws(() => capture.capture("short"));
});
