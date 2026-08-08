import { useState } from "react";
import { api, isDesktop, setStoredToken } from "../lib/api";
import { loginTokenFrom } from "../lib/sign-in-link";

/**
 * Passwordless sign-in.
 *
 * With no mail provider configured the API returns the link directly, so local
 * development needs no email account. In production `devLoginUrl` is simply absent.
 *
 * The desktop app cannot follow the emailed link itself. Its window loads from
 * `tauri://localhost`, and Windows hands the link in the student's mail client to their default
 * browser — which signs them in *there*, in a browser that is not this app. Nothing bridges that
 * except the clipboard, so the desktop screen asks for the link to be pasted and says so plainly.
 * The alternative, registering a `schoolquest://` protocol handler, would be nicer and is a
 * bigger change than a per-user installer should make to a machine the university administers.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ emailed: boolean; devLoginUrl?: string }>(
        "/api/auth/login",
        { email },
      );
      setSent(true);
      setDevUrl(result.devLoginUrl ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the link.");
    } finally {
      setBusy(false);
    }
  }

  async function redeem(pasted: string) {
    const rawToken = loginTokenFrom(pasted);
    if (!rawToken) {
      setError("That does not look like a sign-in link. Copy the whole link from the email.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ sessionToken: string }>("/api/auth/callback", {
        token: rawToken,
      });
      // The desktop shell authenticates by bearer token; the browser also has the cookie.
      setStoredToken(result.sessionToken);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That link did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="centered">
        <h1>Check your email</h1>
        <p className="muted">
          A sign-in link is on its way to {email}. It expires in 15 minutes.
        </p>

        {isDesktop && (
          <p className="muted">
            Open the email, right-click the link and choose <strong>Copy link</strong>, then paste
            it below. Clicking it opens your web browser instead of this window, which signs you in
            there rather than here.
          </p>
        )}

        {devUrl && (
          <>
            <p className="muted">
              No mail provider is configured, so here is the link directly:
            </p>
            <p className="notice">{devUrl}</p>
            <button
              className="action primary"
              disabled={busy}
              onClick={() => redeem(devUrl)}
            >
              Sign in now
            </button>
          </>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void redeem(token);
          }}
          style={{ marginTop: "1.5rem" }}
        >
          <label className="sr-only" htmlFor="token">
            Paste your sign-in link
          </label>
          <input
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your sign-in link here"
          />
          <button className="action" type="submit" disabled={busy || !token.trim()}>
            Sign in
          </button>
        </form>

        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="centered">
      <h1>SchoolQuest</h1>
      <p className="muted">
        Know what to work on now, and trust that the rest is protected.
      </p>

      <form onSubmit={requestLink}>
        <label className="sr-only" htmlFor="email">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@school.edu"
          autoComplete="email"
        />
        <button className="action primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
