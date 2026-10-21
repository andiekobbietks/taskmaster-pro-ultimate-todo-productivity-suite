// Extract RFC 8291's test vector from the RFC text itself, so nothing
// is transcribed by hand. Writes scripts/rfc8291-vector.json.
//
// The RFC wraps base64url values across lines, indented by six spaces.
// A continuation line is six spaces and nothing but base64url; prose is
// three spaces and has spaces in it. That is how the two are told apart.
import { writeFileSync } from "node:fs";

const text = await (await fetch("https://www.rfc-editor.org/rfc/rfc8291.txt")).text();
const appendix = text.slice(text.indexOf("Appendix A.  Intermediate Values"));
const section5 = text.slice(text.indexOf("5.  Push Message Encryption Example"));

const lines = (from) => from.split("\n");

/** The value after a label: the rest of its line, then wrapped parts. */
function valueAfter(label, from) {
  const ls = lines(from);
  const at = ls.findIndex((l) => l.includes(label));
  if (at < 0) throw new Error("not found: " + label);
  let value = ls[at].slice(ls[at].indexOf(label) + label.length).trim();
  let i = at + 1;
  // The RFC puts a blank line between the label and the value here.
  while (i < ls.length && ls[i].trim() === "") i++;
  for (; i < ls.length; i++) {
    // A continuation is indented and holds base64url. The RFC wraps some
    // chunks with a space in the middle, so a continuation may have a
    // couple of spaces; prose has many, and is not accepted.
    const plain = ls[i].match(/^\s{3,}([A-Za-z0-9_\-]{8,})\s*$/);
    const spaced = ls[i].match(/^\s{3,}([A-Za-z0-9_\- ]{20,})\s*$/);
    if (plain) {
      value += plain[1];
      continue;
    }
    if (spaced && (spaced[1].match(/ /g) || []).length <= 2) {
      value += spaced[1].replace(/\s+/g, "");
      continue;
    }
    break;
  }
  return value.replace(/\s+/g, "");
}

const vector = {
  plaintext: valueAfter("Plaintext:", appendix),
  asPublic: valueAfter("Application server public key (as_public):", appendix),
  asPrivate: valueAfter("Application server private key (as_private):", appendix),
  uaPublic: valueAfter("User agent public key (ua_public):", appendix),
  uaPrivate: valueAfter("User agent private key (ua_private):", appendix),
  salt: valueAfter("Salt:", appendix),
  auth: valueAfter("Authentication secret (auth_secret):", appendix),
  ecdhSecret: valueAfter("Shared ECDH secret (ecdh_secret):", appendix),
  prkKey: valueAfter("Pseudorandom key (PRK) for key combining (PRK_key):", appendix),
  ikm: valueAfter("Input keying material for content encryption key derivation (IKM):", appendix),
  prk: valueAfter("PRK for content encryption (PRK):", appendix),
  cek: valueAfter("Content encryption key (CEK):", appendix),
  nonce: valueAfter("Nonce (NONCE):", appendix),
  header: valueAfter("produce an 86-octet header of:", appendix),
  ciphertext: valueAfter(
    "of:",
    appendix.slice(appendix.indexOf("The plaintext is then encrypted"))
  ),
};

// Section 5's body: the whole message, one encoding, wrapped at 72.
const bodyLines = lines(section5);
const bodyAt = bodyLines.findIndex((l) => /^\s{3}DGv6ra1nlYgDCS1FRnbzlw/.test(l));
if (bodyAt < 0) throw new Error("the body was not found in section 5");
let body = "";
for (let i = bodyAt; i < bodyLines.length; i++) {
  const m = bodyLines[i].match(/^\s{3,}([A-Za-z0-9_\-]{8,})\s*$/);
  if (!m) break;
  body += m[1];
}
vector.body = body;

writeFileSync("scripts/rfc8291-vector.json", JSON.stringify(vector, null, 2) + "\n");

for (const [k, v] of Object.entries(vector)) {
  const bytes = Math.floor((v.length * 3) / 4);
  console.log(`  ${k.padEnd(12)} ${String(v.length).padStart(4)} chars  ~${bytes} bytes`);
}
