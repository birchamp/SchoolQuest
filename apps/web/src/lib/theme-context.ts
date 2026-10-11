import { createContext, useContext } from "react";
import type { ThemeName } from "@schoolquest/domain";

/**
 * The active theme, provided once by App and read wherever wording or chrome depends on it.
 *
 * This replaces two older mechanisms that disagreed about where the theme lived: a `theme` prop
 * threaded from App into some twenty components, and a MutationObserver on
 * `document.body.dataset.theme` for the Setup cards that never received the prop. The body
 * attribute is still written by App -- CSS keys off it -- but nothing in React reads it back.
 *
 * The default is "plain", the theme a signed-out student sees, so a component rendered outside
 * the provider (a test, the pre-sign-in screens) still draws exactly as it always did.
 */
export const ThemeContext = createContext<ThemeName>("plain");

export function useTheme(): ThemeName {
  return useContext(ThemeContext);
}
