import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTurnstileVerificationPath,
  normalizeTurnstileRedirectPath,
  shouldRequireTurnstileVerification,
} from "../../lib/turnstile";

test("normalizeTurnstileRedirectPath keeps safe relative paths", () => {
  assert.equal(
    normalizeTurnstileRedirectPath("/chat/123?foo=1"),
    "/chat/123?foo=1"
  );
});

test("normalizeTurnstileRedirectPath rejects unsafe targets", () => {
  assert.equal(normalizeTurnstileRedirectPath("https://example.com"), "/");
  assert.equal(normalizeTurnstileRedirectPath("//example.com"), "/");
});

test("buildTurnstileVerificationPath encodes the redirect target", () => {
  assert.equal(
    buildTurnstileVerificationPath("/chat/123?foo=1"),
    "/verify?redirect=%2Fchat%2F123%3Ffoo%3D1"
  );
});

test("shouldRequireTurnstileVerification only protects chat entry pages", () => {
  assert.equal(shouldRequireTurnstileVerification("/"), true);
  assert.equal(shouldRequireTurnstileVerification("/chat/new"), true);
  assert.equal(shouldRequireTurnstileVerification("/chat/123"), true);
  assert.equal(shouldRequireTurnstileVerification("/chat/history"), false);
  assert.equal(shouldRequireTurnstileVerification("/login"), false);
  assert.equal(shouldRequireTurnstileVerification("/channels"), false);
  assert.equal(shouldRequireTurnstileVerification("/api/chat"), false);
});
