import { useEffect, useState } from "react";
import type { ThemeName } from "@schoolquest/domain";

/**
 * The active theme, read from the document rather than passed down.
 *
 * App writes `document.body.dataset.theme` on every render, and the Setup tab mounts its cards
 * without a `theme` prop. Threading one through would mean editing App for every new card, so
 * they read it from the body instead.
 *
 * The observer is not optional: the theme switcher lives on the Setup screen itself, so
 * without it these cards keep the previous chrome until some unrelated re-render comes along.
 *
 * Shared because this was copied into four components before a fifth was about to join them,
 * and four copies of a MutationObserver is four places for it to drift.
 *
 * `override` is the seam for wiring a real prop through later; nothing passes it today.
 */
export function useBodyTheme(override?: ThemeName): ThemeName {
  const [theme, setTheme] = useState<ThemeName>(
    () => (document.body.dataset["theme"] as ThemeName | undefined) ?? "plain",
  );

  useEffect(() => {
    const read = () =>
      setTheme((document.body.dataset["theme"] as ThemeName | undefined) ?? "plain");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return override ?? theme;
}

/**
 * Themed wording on screen, plain wording for assistive technology.
 *
 * Screen-reader output must never depend on the visual theme (docs/02-prd.md §5), and inside a
 * control this is also what keeps the accessible name plain: the themed span is hidden from the
 * name computation, the plain one is not.
 */
export function themedParts(visible: string, plain: string): { visible: string; plain: string } {
  return { visible, plain };
}
