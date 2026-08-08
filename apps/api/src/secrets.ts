/**
 * Encrypting a student's OpenRouter key at rest.
 *
 * ## Why not just store it
 *
 * Because it is a live credential with the student's money behind it, held by an app they
 * installed from a stranger on the internet. A plain column means anyone who reads a backup, a
 * misconfigured D1 export, or a stray log line can spend their balance. That is a different
 * class of harm from leaking a due date, and it is the only field in this database with that
 * property.
 *
 * ## The key
 *
 * Derived from `AUTH_SECRET` with HKDF and a fixed info string, so it is a *different* key from
 * the one signing sessions even though it comes from the same secret. Reusing one secret for two
 * purposes is the mistake that turns a session-token leak into a credential leak; a separate
 * derivation costs nothing and stops that.
 *
 * AES-GCM with a fresh 12-byte IV per encryption, stored alongside the ciphertext. GCM is
 * authenticated, so a tampered row fails to decrypt rather than returning plausible rubbish that
 * gets sent to OpenRouter as a bearer token.
 *
 * ## What this is not
 *
 * It is not protection from whoever runs the Worker — they hold `AUTH_SECRET` and can decrypt
 * anything. There is no arrangement where a server that must *use* a key cannot read it. What it
 * buys is that the key is not sitting in plaintext in every copy of the database, and that is
 * worth having on its own.
 */

const IV_BYTES = 12;

async function derive(authSecret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authSecret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      // Fixed rather than random: the same key has to come back on every request, and HKDF's
      // salt is not required to be secret. The info string is what separates this from any
      // other use of AUTH_SECRET.
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("schoolquest:provider-key:v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Returns `iv.ciphertext`, both base64url, which is what goes in the column. */
export async function encryptSecret(plaintext: string, authSecret: string): Promise<string> {
  const key = await derive(authSecret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${b64url(iv)}.${b64url(new Uint8Array(sealed))}`;
}

/**
 * Returns null rather than throwing on anything that does not decrypt.
 *
 * A row encrypted under a previous `AUTH_SECRET` is unreadable and always will be, so the honest
 * behaviour is to treat it as "no key stored" and let the student paste theirs again. Throwing
 * would take down every route that merely *checks* whether a key exists.
 */
export async function decryptSecret(stored: string, authSecret: string): Promise<string | null> {
  const [ivPart, dataPart] = stored.split(".");
  if (!ivPart || !dataPart) return null;
  try {
    const key = await derive(authSecret);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(ivPart) },
      key,
      fromB64url(dataPart),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/**
 * "sk-or-v1-…4f2a" — enough for a student to recognise which key is stored, and useless to
 * anyone else. Shown instead of the key itself, which never leaves the server once written.
 */
export function keyHint(plaintext: string): string {
  return plaintext.length <= 8 ? "…" : `${plaintext.slice(0, 8)}…${plaintext.slice(-4)}`;
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}
