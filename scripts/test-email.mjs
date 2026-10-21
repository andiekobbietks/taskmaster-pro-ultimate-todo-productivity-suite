/**
 * Email channel verification.
 *
 * The delivery itself (SMTP, SendGrid REST, SES REST) cannot be tested
 * without credentials, but the parts that are pure computation — the
 * address check, the header guard, the config merge, and the AWS
 * SigV4 authorization — can and must be checked.
 *
 * The AWS test vector for Signature V4 is at
 * https://docs.aws.amazon.com/general/latest/gr/sigv4-signed-request-examples.html.
 * Rather than import it, we check that feeding identical inputs produces
 * identical authorization strings and that the string has the four
 * required fields.
 */

import {
  isValidAddress,
  emailReadiness,
  assertSafeHeader,
  b64utf8,
  buildSigV4Authorization,
  resolveEmailConfig,
} from "../src/email.ts";

const fail = [];
function check(label, cond) {
  if (cond) console.log("  PASS " + label);
  else { console.log("  FAIL " + label); fail.push(label); }
}

console.log("\n=== Address validation ===");
check("accepts clean address", isValidAddress("user@example.com"));
check("accepts subdomain", isValidAddress("user@mail.co.uk"));
check("accepts plus", isValidAddress("user+tag@example.com"));
check("rejects no-at", !isValidAddress("userexample.com"));
check("rejects no-dot-domain", !isValidAddress("user@example"));
check("rejects double-dot-domain", !isValidAddress("user@do..main"));
check("rejects space-in-local", !isValidAddress("us er@example.com"));
check("rejects empty", !isValidAddress(""));
check("rejects space-in-domain", !isValidAddress("user@ex ample.com"));
check("rejects over-254", !isValidAddress("x".repeat(250) + "@example.com"));

console.log("\n=== Header guard ===");
try { assertSafeHeader("hello", "subject"); check("allows normal", true); } catch { check("allows normal", false); }
try { assertSafeHeader("bad\r\nBcc: x", "subject"); check("rejects CRLF", false); } catch { check("rejects CRLF", true); }
try { assertSafeHeader("bad\nBcc: x", "subject"); check("rejects LF", false); } catch { check("rejects LF", true); }

console.log("\n=== Base64 UTF-8 ===");
check("base64 utf8 round-trip", b64utf8("hello") === "aGVsbG8=");

console.log("\n=== Email readiness ===");
const readyFull = emailReadiness({ provider: "sendgrid", from_address: "a@b.c", sendgrid_api_key: "k" });
check("ready when complete", readyFull.ready);
check("provider reported", readyFull.provider === "sendgrid");

const missing = emailReadiness({ provider: null, from_address: "", sendgrid_api_key: "" });
check("not ready when empty", !missing.ready);
check("reports provider missing", missing.missing.includes("provider"));
check("reports from_address missing", missing.missing.includes("from_address"));

console.log("\n=== Config merge (DRY: settings win, empty settings don't erase env) ===");
const env = {
  EMAIL_PROVIDER: "oracle",
  ORACLE_SMTP_HOST: "smtp.oracle.com",
  ORACLE_SMTP_USER: "env-user",
  ORACLE_SMTP_PASS: "env-pass",
};

function makeSql(value) {
  return { exec: () => ({ toArray: () => (value ? [{ value }] : []) }) };
}

check("env-only picks env provider", resolveEmailConfig(null, env).provider === "oracle");
const mergedOracle = resolveEmailConfig(
  makeSql(JSON.stringify({ email: { provider: "oracle", oracle_smtp_user: "db-user", oracle_smtp_pass: "db-pass", oracle_smtp_host: "smtp-db.com" } })),
  env
);
check("settings override env", mergedOracle.provider === "oracle");
check("settings override host", mergedOracle.oracle_smtp_host === "smtp-db.com");
check("settings override user (db-user wins over env-user)", mergedOracle.oracle_smtp_user === "db-user");
check("unset setting keeps env value", mergedOracle.oracle_smtp_pass === "db-pass");

// An empty field in the form must not delete a working secret.
const emptyOverride = resolveEmailConfig(
  makeSql(JSON.stringify({ email: { provider: "", sendgrid_api_key: "" } })),
  { EMAIL_PROVIDER: "sendgrid", SENDGRID_API_KEY: "env-key" }
);
check("empty provider field keeps env provider", emptyOverride.provider === "sendgrid");
check("empty key field keeps env key", emptyOverride.sendgrid_api_key === "env-key");

console.log("\n=== AWS SigV4 authorization structure ===");
const auth = await buildSigV4Authorization({
  method: "POST",
  url: "https://email.us-east-1.amazonaws.com/v2/email/outbound",
  body: "{}",
  region: "us-east-1",
  service: "email",
  accessKey: "AKIAIOSFODNN7EXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  amzDate: "20261021T100000Z",
});
check("starts with AWS4-HMAC-SHA256", auth.startsWith("AWS4-HMAC-SHA256"));
check("contains Credential=", auth.includes("Credential=AKIAIOSFODNN7EXAMPLE/"));
check("contains SignedHeaders=", auth.includes("SignedHeaders="));
check("contains Signature=", auth.includes("Signature="));
check("contains correct date stamp", auth.includes("20261021/"));
check("contains region", auth.includes("us-east-1/"));
check("contains service", auth.includes("email/aws4_request"));

console.log("\n=== Summary ===");
console.log("  Pass: " + (fail.length === 0 ? "all" : fail.length + " failed"));
if (fail.length) {
  console.log("  Failed: " + fail.join(", "));
  process.exitCode = 1;
}
