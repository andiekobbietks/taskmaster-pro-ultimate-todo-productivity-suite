/**
 * Check the push encryption against RFC 8291's own test vector.
 *
 * RFC 8291 Appendix A publishes every value in the derivation chain for
 * one example message, and Section 5 publishes the whole encrypted
 * body. If our implementation is right, feeding it the RFC's inputs has
 * to produce the RFC's outputs, step by step — a wrong step cannot hide
 * behind a right one further down.
 *
 * The vector in scripts/rfc8291-vector.json is extracted from the RFC
 * itself by scripts/extract-rfc-vector.mjs, so nothing here is
 * transcribed by hand.
 *
 * Run: node --experimental-strip-types scripts/test-push.mjs
 */
import { readFileSync } from "node:fs";
import {
  b64url,
  fromB64url,
  deriveContentKeys,
  encryptPayload,
} from "../src/push.ts";

const V = JSON.parse(readFileSync("scripts/rfc8291-vector.json", "utf8"));

let pass = 0;
let fail = 0;
const failures = [];

function check(label, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    failures.push(label);
    console.log("  FAIL " + label);
    console.log("       expected " + expected);
    console.log("       actual   " + actual);
  }
}

function checkTrue(label, condition, detail = "") {
  if (condition) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    failures.push(label);
    console.log("  FAIL " + label + (detail ? " — " + detail : ""));
  }
}

console.log("\n=== RFC 8291: the published example, step by step ===");

// The sender's fixed key pair. The RFC's as_private is the raw scalar,
// which is the "d" of a JWK.
const asPrivateJwk = {
  kty: "EC",
  crv: "P-256",
  d: V.asPrivate,
  x: b64url(fromB64url(V.asPublic).subarray(1, 33)),
  y: b64url(fromB64url(V.asPublic).subarray(33, 65)),
};

const derived = await deriveContentKeys({
  p256dh: V.uaPublic,
  auth: V.auth,
  salt: fromB64url(V.salt),
  asPrivateJwk,
  asPublic: fromB64url(V.asPublic),
});

check("the shared ECDH secret", b64url(derived.ecdhSecret), V.ecdhSecret);
check("the key-combining PRK", b64url(derived.prkKey), V.prkKey);
check("the input keying material", b64url(derived.ikm), V.ikm);
check("the content-encryption PRK", b64url(derived.prk), V.prk);
check("the content encryption key", b64url(derived.cek), V.cek);
check("the nonce", b64url(derived.nonce), V.nonce);
check("the 86-octet header", b64url(derived.header), V.header);

console.log("\n=== RFC 8291 Section 5: the whole encrypted body ===");

const plaintext = new TextDecoder().decode(fromB64url(V.plaintext));
check("the plaintext is the RFC's sentence", plaintext,
  "When I grow up, I want to be a watermelon");

const body = await encryptPayload(plaintext, V.uaPublic, V.auth, {
  salt: fromB64url(V.salt),
  asPrivateJwk,
  asPublic: fromB64url(V.asPublic),
});

// Compare the bytes: base64 of a concatenation is not the concatenation
// of two base64 strings.
const expectedBody = fromB64url(V.body);
checkTrue(
  "the encrypted body is the RFC's body, byte for byte",
  b64url(body) === b64url(expectedBody),
  "our body is " + b64url(body)
);
check("the body is the header plus the ciphertext", body.length, expectedBody.length);
check("the body length matches the RFC's", body.length, 144);

console.log("\n=== the paths that are not the RFC's example ===");

// A different salt must give a different body, or the salt is not used.
const body2 = await encryptPayload(plaintext, V.uaPublic, V.auth, {
  salt: fromB64url("DGv6ra1nlYgDCS1FRnbzlq"),
  asPrivateJwk,
  asPublic: fromB64url(V.asPublic),
});
checkTrue(
  "a different salt gives a different body",
  b64url(body2) !== b64url(body),
  "the salt was not used"
);

// The default path: a random salt and a fresh ephemeral key.
const body3 = await encryptPayload("hello", V.uaPublic, V.auth);
check(
  "the default path gives a header, the plaintext and a tag",
  body3.length,
  86 + "hello".length + 1 + 16
);
checkTrue(
  "the default path carries a fresh salt",
  b64url(body3.slice(0, 16)) !== V.salt,
  "the salt was reused"
);
checkTrue(
  "the default path uses a fresh ephemeral key",
  b64url(body3.slice(23, 88)) !== V.asPublic,
  "the sender key was reused"
);

console.log("\n" + "=".repeat(60));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log("  FAILED: " + f);
console.log("=".repeat(60));
process.exit(fail > 0 ? 1 : 0);
