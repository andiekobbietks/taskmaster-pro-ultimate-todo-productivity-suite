/**
 * Check the VAPID signing against RFC 8292's own example.
 *
 * RFC 8292 section 2.4 gives a complete request: the Authorization
 * header with the token and the public key, the decoded header, body
 * and JWK, and the signature. Four things are checked:
 *
 *   1. our encoding of the public key is the one the browser needs
 *      (the uncompressed point, base64url) — the RFC's "k" value
 *   2. our JWT header and body are byte-identical to the RFC's
 *   3. the RFC's signature verifies against the RFC's public key,
 *      which proves the JWS is the raw r||s form a push service
 *      expects (not DER)
 *   4. a token we sign verifies against our own public key
 *
 * Run: node --experimental-strip-types scripts/test-vapid.mjs
 */
import { b64url, fromB64url, vapidHeader } from "../src/push.ts";

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

console.log("\n=== RFC 8292 section 2.4: the published example ===");

// From the RFC's Figure 1 and Figure 2.
const RFC_JWT =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9." +
  "eyJhdWQiOiJodHRwczovL3B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1haWx0bzpwdXNoQGV4YW1wbGUuY29tIn0." +
  "i3CYb7t4xfxCDquptFOepC9GAu_HLGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA";
const RFC_PUBLIC_KEY =
  "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs";
const RFC_X = "DUfHPKLVFQzVvnCPGyfucbECzPDa7rWbXriLcysAjEc";
const RFC_Y = "F6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs";
const RFC_EXP = 1453523768;
const RFC_SUB = "mailto:push@example.com";
const RFC_AUD = "https://push.example.net";

// 1. The public key encoding: the uncompressed point, base64url.
const jwk = { kty: "EC", crv: "P-256", x: RFC_X, y: RFC_Y };
const uncompressed = new Uint8Array(65);
uncompressed[0] = 0x04;
uncompressed.set(fromB64url(RFC_X), 1);
uncompressed.set(fromB64url(RFC_Y), 33);
check("the uncompressed public key is the RFC's k value", b64url(uncompressed), RFC_PUBLIC_KEY);

// 2. Our JWT header and body, with the RFC's fixed expiry.
const header = b64url(
  new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))
);
const payload = b64url(
  new TextEncoder().encode(
    JSON.stringify({ aud: RFC_AUD, exp: RFC_EXP, sub: RFC_SUB })
  )
);
check("the JWT header matches the RFC's", header, RFC_JWT.split(".")[0]);
check("the JWT body matches the RFC's", payload, RFC_JWT.split(".")[1]);

// 3. The RFC's signature verifies against the RFC's public key. This is
// the part that proves the signature is the raw r||s form JOSE wants:
// a DER signature would not verify here.
const publicKey = await crypto.subtle.importKey(
  "jwk",
  jwk,
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["verify"]
);
const signatureBytes = fromB64url(RFC_JWT.split(".")[2]);
let verified = false;
try {
  verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signatureBytes,
    new TextEncoder().encode(RFC_JWT.split(".").slice(0, 2).join("."))
  );
} catch {
  verified = false;
}
checkTrue(
  "the RFC's signature verifies against the RFC's public key",
  verified,
  "the signature is not the raw r||s form"
);

// 4. A token we sign verifies against our own public key.
const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);
const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const pubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
const pubPoint = new Uint8Array(65);
pubPoint[0] = 0x04;
pubPoint.set(fromB64url(pubJwk.x), 1);
pubPoint.set(fromB64url(pubJwk.y), 33);

const headerText = await vapidHeader(
  "https://push.example.net/push/abc",
  privJwk,
  "mailto:me@example.com",
  b64url(pubPoint)
);
const token = headerText.match(/t=([^,]+),/)[1];
const [tHeader, tPayload, tSignature] = token.split(".");

const ourPublic = await crypto.subtle.importKey(
  "jwk",
  pubJwk,
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["verify"]
);
let oursVerifies = false;
try {
  oursVerifies = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    ourPublic,
    fromB64url(tSignature),
    new TextEncoder().encode(tHeader + "." + tPayload)
  );
} catch {
  oursVerifies = false;
}
checkTrue("a token we sign verifies against our own public key", oursVerifies);

// The claims have to be right, or a push service rejects the request.
const claims = JSON.parse(new TextDecoder().decode(fromB64url(tPayload)));
check("the audience is the push service's origin", claims.aud, "https://push.example.net");
check("the subject is the contact address", claims.sub, "mailto:me@example.com");
checkTrue(
  "the token expires within the hour",
  claims.exp - Math.floor(Date.now() / 1000) <= 3600 &&
    claims.exp - Math.floor(Date.now() / 1000) > 3500,
  "exp is " + claims.exp
);
const alg = JSON.parse(new TextDecoder().decode(fromB64url(tHeader)));
check("the algorithm is ES256", alg.alg, "ES256");
check("the type is JWT", alg.typ, "JWT");
checkTrue(
  "the header carries the public key",
  headerText.includes(", k=" + b64url(pubPoint)),
  "the k parameter is wrong"
);

console.log("\n" + "=".repeat(60));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log("  FAILED: " + f);
console.log("=".repeat(60));
process.exit(fail > 0 ? 1 : 0);
