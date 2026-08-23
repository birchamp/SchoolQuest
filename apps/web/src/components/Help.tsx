import { HELP_SECTIONS } from "../lib/help-content";

/**
 * The Help page: how the app works, in concepts and plain words.
 *
 * Content lives in `help-content.ts` so there is one source, kept at the concept level to stay
 * true across UI changes. This component only renders it.
 */
export function Help() {
  return (
    <section className="card" aria-labelledby="help-heading">
      <h2 id="help-heading">How SchoolQuest works</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        The short version of what everything means and how the pieces fit. It sticks to concepts,
        so it stays true even as the screens change.
      </p>
      {HELP_SECTIONS.map((section) => (
        <div key={section.heading} style={{ marginTop: "1rem" }}>
          <h3 style={{ margin: "0 0 0.3rem", fontSize: "1rem" }}>{section.heading}</h3>
          {section.body.map((paragraph, i) => (
            <p
              key={i}
              className="muted"
              style={{ margin: i === 0 ? "0" : "0.4rem 0 0", fontSize: "0.9rem", lineHeight: 1.5 }}
            >
              {paragraph}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}
