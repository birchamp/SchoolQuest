import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useBodyTheme } from "../lib/use-body-theme";

/**
 * The student's own OpenRouter key, and which model reads their syllabi.
 *
 * ## Why the student holds the key
 *
 * SchoolQuest is a hobby project someone else installed. The reading is done by a paid API, and
 * the honest arrangement is that the person using the app pays for their own calls — not that
 * whoever put it online quietly funds everyone's semester. That is also the only version that
 * survives more than one user.
 *
 * ## Why the price is on screen
 *
 * "Pick a model" is not a choice without the number beside it. The spread here is tenfold — about
 * a penny per syllabus on the fast tier against eleven on the strongest — and a student deciding
 * whether to re-read a stubborn syllabus a third time deserves to know what that costs before
 * they do it, not after.
 *
 * The default is the cheapest, not the best. Someone who never opens this screen should be
 * spending pennies a term, and the stronger models are here for the document that defeats the
 * cheap one rather than as a general recommendation.
 *
 * ## What is never shown
 *
 * The key itself, once saved. It comes back as `sk-or-v1…4f2a` and nothing more, because a field
 * that renders a live credential is a field that ends up in a screenshot or a screen share. The
 * hint is enough to recognise which key is stored; replacing it means pasting a new one.
 */

interface ModelOption {
  id: string;
  label: string;
  inputPerMillion: number;
  outputPerMillion: number;
  context: number;
  note: string;
  centsPerSyllabus: number;
}

interface MeResponse {
  user: {
    openrouterKeyHint: string | null;
    providerConfigured: boolean;
    extractionModel: string | null;
    coachModel: string | null;
  };
  models: ModelOption[];
}

export function ProviderSettings({ onChanged }: { onChanged: () => void }) {
  const theme = useBodyTheme();
  const quest = theme === "quest";

  const [me, setMe] = useState<MeResponse | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setMe(await api.get<MeResponse>("/api/me"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your settings.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(patch: Record<string, unknown>, note: string) {
    setBusy(true);
    setError(null);
    try {
      await api.patch("/api/me", patch);
      setSaved(note);
      setKeyInput("");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!me) return null;
  const { user, models } = me;
  const chosen = user.extractionModel ?? models[0]?.id;

  return (
    <section className="card" id="provider-settings" aria-labelledby="provider-heading">
      <h2 id="provider-heading">{quest ? "The reading of scrolls" : "AI and model"}</h2>

      <p className="muted" style={{ marginTop: 0 }}>
        Reading a syllabus is done by an AI model, and the calls are billed to an OpenRouter key.
        Use your own so you are paying for your own work — the cheapest model costs roughly a
        penny per syllabus.
      </p>

      {error && <p className="error">{error}</p>}
      {saved && <p className="notice">{saved}</p>}

      <h3>Your OpenRouter key</h3>
      {user.openrouterKeyHint ? (
        <p className="muted">
          Stored: <code>{user.openrouterKeyHint}</code>. Paste a new one to replace it, or clear it
          to fall back to whatever this installation was set up with.
        </p>
      ) : (
        <p className="muted">
          {user.providerConfigured
            ? "You are using the key this installation was set up with. Add your own to pay for your own reading."
            : "No key is set, so nothing can read a syllabus yet."}{" "}
          Get one free at <code>openrouter.ai/keys</code> and add credit to it.
        </p>
      )}

      <div className="button-row" style={{ flexWrap: "wrap" }}>
        <label className="sr-only" htmlFor="openrouter-key">
          OpenRouter API key
        </label>
        <input
          id="openrouter-key"
          type="password"
          value={keyInput}
          placeholder="sk-or-v1-…"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(e) => setKeyInput(e.target.value)}
          style={{ flex: "1 1 22rem", minWidth: "14rem" }}
        />
        <button
          className="action primary"
          disabled={busy || keyInput.trim() === ""}
          onClick={() => void save({ openrouterKey: keyInput }, "Key saved. It is stored encrypted and never shown again.")}
        >
          Save key
        </button>
        {user.openrouterKeyHint && (
          <button
            className="action"
            disabled={busy}
            onClick={() => void save({ openrouterKey: "" }, "Key removed.")}
          >
            Remove
          </button>
        )}
      </div>

      <h3 style={{ marginTop: "1.1rem" }}>Which model reads your syllabi</h3>
      <ul className="model-list">
        {models.map((model) => (
          <li key={model.id}>
            <label>
              <input
                type="radio"
                name="extraction-model"
                checked={chosen === model.id}
                disabled={busy}
                onChange={() =>
                  void save(
                    { extractionModel: model.id },
                    `Syllabi will be read by ${model.label} from now on.`,
                  )
                }
              />
              <span className="model-name">{model.label}</span>
              {/* The cost first, because it is the part that decides the answer. */}
              <span className="model-price">
                ~{model.centsPerSyllabus}¢ per syllabus
                <span className="muted">
                  {" "}
                  · ${model.inputPerMillion}/M in, ${model.outputPerMillion}/M out
                </span>
              </span>
              <span className="muted model-note">{model.note}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
