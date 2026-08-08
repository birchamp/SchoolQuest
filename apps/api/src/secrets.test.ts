import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, keyHint } from "./secrets.js";

/**
 * The only field in this database with a student's money behind it.
 *
 * These are the properties that matter for a credential rather than a preference: it survives a
 * round trip, it does not appear in the stored form, a tampered row fails closed, and a row
 * sealed under a different secret reads as "no key" instead of taking the app down.
 */

const SECRET = "test-auth-secret-0000000000000000000000";
const KEY = "sk-or-v1-6f2b9c4d8e1a7f3b5c9d2e6a4f8b1c3d5e7a9f2b4c6d8e0a";

describe("a stored OpenRouter key", () => {
  it("comes back exactly as it went in", async () => {
    const sealed = await encryptSecret(KEY, SECRET);
    expect(await decryptSecret(sealed, SECRET)).toBe(KEY);
  });

  it("is not present in what gets written to the row", async () => {
    // The whole point. A backup, a D1 export or a stray log line must not carry the key.
    const sealed = await encryptSecret(KEY, SECRET);
    expect(sealed).not.toContain(KEY);
    expect(sealed).not.toContain(KEY.slice(0, 20));
  });

  it("seals differently every time, so identical keys do not look identical", async () => {
    // A fresh IV per encryption. Without it, two students on the same key would have byte-equal
    // rows, which leaks that fact to anyone reading the table.
    const a = await encryptSecret(KEY, SECRET);
    const b = await encryptSecret(KEY, SECRET);
    expect(a).not.toBe(b);
    expect(await decryptSecret(b, SECRET)).toBe(KEY);
  });

  it("refuses a row that has been tampered with", async () => {
    /**
     * AES-GCM is authenticated, which is the reason for choosing it: a mangled row must fail
     * rather than decrypt to plausible rubbish, because the plaintext here is sent straight out
     * as a bearer token.
     */
    const sealed = await encryptSecret(KEY, SECRET);
    const [iv, data] = sealed.split(".");
    const flipped = `${iv}.${data!.slice(0, -2)}${data!.slice(-2) === "AA" ? "BB" : "AA"}`;
    expect(await decryptSecret(flipped, SECRET)).toBeNull();
  });

  it("reads as no-key-stored when the deployment secret has changed", async () => {
    // Rotating AUTH_SECRET makes every stored key permanently unreadable. Returning null lets
    // the student paste theirs again; throwing would break every route that merely checks
    // whether a key exists.
    const sealed = await encryptSecret(KEY, SECRET);
    expect(await decryptSecret(sealed, "a-completely-different-secret")).toBeNull();
  });

  it("survives nonsense in the column without throwing", async () => {
    for (const junk of ["", ".", "not-base64", "aaa.bbb", "onlyonepart"]) {
      expect(await decryptSecret(junk, SECRET), junk).toBeNull();
    }
  });
});

describe("the hint shown back to the student", () => {
  it("identifies the key without being usable as one", () => {
    const hint = keyHint(KEY);
    expect(hint).toBe("sk-or-v1…8e0a");
    expect(hint.length).toBeLessThan(20);
    expect(KEY).not.toContain(hint);
  });

  it("does not leak a short string by showing most of it", () => {
    expect(keyHint("sk-or-12")).toBe("…");
  });
});
