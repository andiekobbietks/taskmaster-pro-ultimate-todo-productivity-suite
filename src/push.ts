/**
 * Web push: signing the request and encrypting the payload.
 *
 * Two specs, implemented here so the app keeps its dependency tree at
 * four packages:
 *
 *   RFC 8292  VAPID — who the notification is from. A P-256 ECDSA
 *              signature over a JWT, sent in the Authorization header.
 *   RFC 8291  aes128gcm — the payload encryption the push services
 *              accept. ECDH to agree a secret, HKDF to derive the
 *              content key and the nonce, then AES-128-GCM.
 *
 * The `web-push` npm package does this, but it uses node's `https`
 * module, which does not exist in a Worker. Doing it by hand with
 * WebCrypto is about 150 lines and keeps the bundle clean.
 *
 * What is NOT here: the transport. `sendPush` is given an endpoint and
 * does one fetch. Retries, batching and the 410-gone handling live in
 * push-routes.ts.
 */

/** base64url without padding. */
export function b64url(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url into bytes. */
export function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The 65-byte uncompressed point from a public JWK. */
function uncompressedPoint(jwk: JsonWebKey): Uint8Array {
  const x = fromB64url(jwk.x as string);
  const y = fromB64url(jwk.y as string);
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 33);
  return out;
}

/** HMAC-SHA256. */
async function hmac(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, message as unknown as BufferSource)
  );
}

/** HKDF-Extract: HMAC(salt, ikm). */
async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  return hmac(salt, ikm);
}

/** HKDF-Expand: HMAC(prk, info || counter). */
async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  let previous = new Uint8Array(0);
  let written = 0;
  for (let counter = 1; written < length; counter++) {
    const infoBlock = new Uint8Array(previous.length + info.length + 1);
    infoBlock.set(previous, 0);
    infoBlock.set(info, previous.length);
    infoBlock[infoBlock.length - 1] = counter;
    const block = await hmac(prk, infoBlock);
    const take = Math.min(block.length, length - written);
    out.set(block.subarray(0, take), written);
    written += take;
    previous = block;
    if (counter > 255) break;
  }
  return out;
}

/** Concatenate byte arrays. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The VAPID Authorization header for one endpoint.
 *
 * The audience is the push service's origin, and the token lives for an
 * hour (Apple's guidance: do not refresh it more often than that).
 */
export async function vapidHeader(
  endpoint: string,
  privateJwk: JsonWebKey,
  subject: string,
  publicKeyB64: string,
  opts: { expiresAt?: number; now?: number } = {}
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const now = opts.now ?? Date.now();
  const exp = opts.expiresAt ?? Math.floor(now / 1000) + 3600;
  const header = b64url(
    new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))
  );
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        exp,
        sub: subject,
      })
    )
  );
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  // WebCrypto signs ECDSA as the raw r||s pair, which is what JOSE
  // (and therefore the push service) expects.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput) as unknown as BufferSource
  );

  return `vapid t=${signingInput}.${b64url(signature)}, k=${publicKeyB64}`;
}

/**
 * The VAPID token, cached per audience.
 *
 * Apple's documentation says not to refresh the JWT more often than once
 * an hour. A Worker gets a fresh isolate per request, so the cache
 * lives in a module global: it lasts as long as the isolate does, and
 * at worst the token is signed again, which is allowed.
 */
const tokenCache = new Map<string, { header: string; expiresAt: number }>();

async function cachedVapidHeader(
  endpoint: string,
  privateJwk: JsonWebKey,
  subject: string,
  publicKeyB64: string
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const key = audience + "|" + subject + "|" + publicKeyB64;
  const now = Date.now();
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt > now + 60_000) return hit.header;

  const expiresAt = Math.floor(now / 1000) + 3600;
  const header = await vapidHeader(endpoint, privateJwk, subject, publicKeyB64, {
    expiresAt,
  });
  tokenCache.set(key, { header, expiresAt: expiresAt * 1000 });
  return header;
}

/**
 * The key derivation, in the order the RFC does it.
 *
 * Split out from encryptPayload so it can be checked against the test
 * vector in RFC 8291 Appendix A: every value in this chain is published
 * there, so a wrong step shows up as a wrong number.
 */
export async function deriveContentKeys(opts: {
  p256dh: string;
  auth: string;
  salt: Uint8Array;
  /** The sender's ephemeral private key, if one is fixed. */
  asPrivateJwk?: JsonWebKey;
  /** The sender's ephemeral public key (65 bytes), if one is fixed. */
  asPublic?: Uint8Array;
}): Promise<{
  ecdhSecret: Uint8Array;
  prkKey: Uint8Array;
  ikm: Uint8Array;
  prk: Uint8Array;
  cek: Uint8Array;
  nonce: Uint8Array;
  header: Uint8Array;
}> {
  const encoder = new TextEncoder();

  // The receiver's public key, as a JWK.
  const receiverRaw = fromB64url(opts.p256dh);
  const receiverJwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64url(receiverRaw.subarray(1, 33)),
    y: b64url(receiverRaw.subarray(33, 65)),
  };
  const receiverKey = await crypto.subtle.importKey(
    "jwk",
    receiverJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // An ephemeral key pair, so each message uses a fresh secret.
  let ephemeralPrivate = opts.asPrivateJwk
    ? await crypto.subtle.importKey(
        "jwk",
        opts.asPrivateJwk,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveBits"]
      )
    : null;
  let ephemeralPublicJwk: JsonWebKey | null = null;
  if (!ephemeralPrivate) {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    );
    ephemeralPrivate = pair.privateKey;
    ephemeralPublicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  }

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: receiverKey },
      ephemeralPrivate,
      256
    )
  );

  const senderPublic =
    opts.asPublic ??
    (ephemeralPublicJwk
      ? uncompressedPoint(ephemeralPublicJwk)
      : (() => {
          throw new Error("No sender public key");
        })());
  const receiverPublic = receiverRaw;

  const authSecret = fromB64url(opts.auth);

  // RFC 8291: PRK = HMAC(auth_secret, ecdh_secret)
  const prkKey = await hkdfExtract(authSecret, sharedSecret);
  // IKM = HKDF-Expand(PRK, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(
    encoder.encode("WebPush: info"),
    new Uint8Array([0]),
    receiverPublic,
    senderPublic
  );
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // RFC 8188: salt(16) || rs(4) || idlen(1) || keyid, and the header is
  // the additional data of the cipher.
  const recordSize = new Uint8Array([0, 0, 16, 0]); // 4096, big endian
  const keyIdLength = new Uint8Array([senderPublic.length]);
  const header = concat(opts.salt, recordSize, keyIdLength, senderPublic);

  const prk = await hkdfExtract(opts.salt, ikm);
  // RFC 8188: the info is "Content-Encoding: " and the name of the
  // encoding, then a zero byte. For this one that is
  // "Content-Encoding: aes128gcm\0" — not "auth", which is what the
  // RFC 8291 test vector catches.
  const cek = await hkdfExpand(
    prk,
    concat(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])),
    16
  );
  const nonce = await hkdfExpand(
    prk,
    concat(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0])),
    12
  );

  return { ecdhSecret: sharedSecret, prkKey, ikm, prk, cek, nonce, header };
}

/**
 * Encrypt a payload for one subscription (RFC 8291).
 *
 * The result is the "aes128gcm" body: salt, record size, the sender's
 * public key, and the ciphertext with its tag.
 */
export async function encryptPayload(
  payload: string,
  p256dh: string,
  auth: string,
  opts: { salt?: Uint8Array; asPrivateJwk?: JsonWebKey; asPublic?: Uint8Array } = {}
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const { cek, nonce, header } = await deriveContentKeys({
    p256dh,
    auth,
    salt,
    asPrivateJwk: opts.asPrivateJwk,
    asPublic: opts.asPublic,
  });

  // The plaintext carries a padding delimiter: the last record is
  // 0x02, which says "the body ends here".
  const plaintext = concat(encoder.encode(payload), new Uint8Array([0x02]));

  const cekKey = await crypto.subtle.importKey(
    "raw",
    cek as unknown as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  // RFC 8188 section 2.1: "The additional data passed to each invocation
  // of AEAD_AES_128_GCM is a zero-length octet sequence." The header is
  // sent in the body but it is NOT the additional data. Passing the
  // header as the AAD produces a body the push service cannot decrypt;
  // RFC 8291's own test vector is what caught that.
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as unknown as BufferSource, additionalData: new Uint8Array(0) as unknown as BufferSource, tagLength: 128 },
      cekKey,
      plaintext as unknown as BufferSource
    )
  );

  return concat(header, encrypted);
}

/**
 * Send one push.
 *
 * Returns what the push service said. A 404 or 410 means the
 * subscription is gone and should be deleted.
 */
export async function sendPush(opts: {
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: unknown;
  publicKey: string;
  privateKey: JsonWebKey;
  subject: string;
  ttlSeconds?: number;
}): Promise<{ ok: boolean; status: number; body: string; gone: boolean }> {
  const authorization = await cachedVapidHeader(
    opts.endpoint,
    opts.privateKey,
    opts.subject,
    opts.publicKey
  );
  const body = await encryptPayload(
    JSON.stringify(opts.payload),
    opts.p256dh,
    opts.auth
  );

  const response = await fetch(opts.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length),
      TTL: String(opts.ttlSeconds ?? 86400),
    },
    body: body as unknown as BodyInit,
  });

  const text = await response.text().catch(() => "");
  return {
    ok: response.ok,
    status: response.status,
    body: text.slice(0, 400),
    gone: response.status === 404 || response.status === 410,
  };
}
