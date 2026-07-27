import { useState } from "react";
import { api, setStoredToken } from "../lib/api";

/**
 * Passwordless sign-in.
 *
 * With no mail provider configured the API returns the link directly, so local
 * development needs no email account. In production `devLoginUrl` is simply absent.
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

  async function redeem(rawToken: string) {
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

        {devUrl && (
          <>
            <p className="muted">
              No mail provider is configured, so here is the link directly:
            </p>
            <p className="notice">{devUrl}</p>
            <button
              className="action primary"
              disabled={busy}
              onClick={() => redeem(new URL(devUrl).searchParams.get("token") ?? "")}
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
            Paste your sign-in token
          </label>
          <input
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Or paste the token from the link"
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
