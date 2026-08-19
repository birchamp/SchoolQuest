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
 * "Pick a model" is not a choice without the number beside it. The spread is tenfold, and the
 * figures are measured from the four real syllabi in `tools/e2e/semester4/` rather than assumed —
 * an earlier version of this screen guessed and was ten times too high, which is precisely the
 * kind of number someone talks themselves out of a better reader over.
 *
 * Shown per *semester*, because that is the unit a student decides against and the only one that
 * survives rounding: the cheap model costs under a cent per document and would render as "0¢".
 * The three-pass figure sits beside it, because re-reading a stubborn syllabus is the decision
 * this screen actually has to support.
 *
 * The default is the strongest reader, not the cheapest. A five-course semester read three times
 * on Grok 4.5 is about 33¢, against 3¢ on the fast tier — and section 7 of
 * docs/10-syllabus-gotchas.md is the evidence for why 30¢ a term is worth it. The cheaper tiers
 * are here for someone watching every cent, not as the recommendation.
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
  provider: string;
  inputPerMillion: number;
  outputPerMillion: number;
  context: number;
  centsPerSemester: number;
  centsPerSemesterThreePasses: number;
}

interface MeResponse {
  user: {
    openrouterKeyHint: string | null;
    providerConfigured: boolean;
    extractionModel: string | null;
    coachModel: string | null;
  };
  models: ModelOption[];
  /** What reading uses when the student has not chosen. Named by the server, not guessed here. */
  defaultExtractionModel: string;
  /** The model answering the daily coach chat, chosen automatically. Null if the catalogue is empty. */
  coachModel: string | null;
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
  const chosen = user.extractionModel ?? me.defaultExtractionModel;

  return (
    <section className="card" id="provider-settings" aria-labelledby="provider-heading">
      <h2 id="provider-heading">{quest ? "The reading of scrolls" : "AI and model"}</h2>

      <p className="muted" style={{ marginTop: 0 }}>
        Reading a syllabus is done by an AI model, and the calls are billed to an OpenRouter key.
        Use your own so you are paying for your own work. Reading five courses' syllabi costs
        between one and eleven cents depending on the model — a whole four-year degree comes to a
        few dollars at most, so this is picked for accuracy rather than to save money.
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
      <p className="muted" style={{ margin: "0 0 0.6rem", fontSize: "0.85rem" }}>
        Live from OpenRouter, cheapest first. The strongest is the default, because a misread
        date costs a deadline and reading is pennies a semester at any of these.
      </p>
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
              <span className="model-name">
                {model.label}
                <span className="muted" style={{ fontWeight: 400 }}> · {model.provider}</span>
              </span>
              {/* The cost first, because it is the part that decides the answer. */}
              {/* Per semester, not per syllabus: it is the unit a student decides against, and
                  the only one that survives rounding — the cheap model is under a cent a
                  document, which would render as "0¢" and tell nobody anything. */}
              <span className="model-price">
                ~{model.centsPerSemester}¢ a semester
                <span className="muted">
                  {" "}
                  · {model.centsPerSemesterThreePasses}¢ if each syllabus is read three times ·
                  ${model.inputPerMillion}/M in, ${model.outputPerMillion}/M out
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {me.coachModel && (
        <p className="muted" style={{ marginTop: "0.8rem", fontSize: "0.86rem" }}>
          Your daily coach chat is answered by <strong>{me.coachModel}</strong>, chosen
          automatically as the strongest fast model — around $2 a semester of daily use, and it
          moves with OpenRouter's list so it can never go stale.
        </p>
      )}
    </section>
  );
}
