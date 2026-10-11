/**
 * The Quest theme's fixed inks, for inline styles that cannot reach a CSS variable.
 *
 * This object was copied into several components (issue #33). Each copy held a subset of the
 * same values; this is their union. Components import it as `Q`. The literals mirror the
 * `--q-*` custom properties in styles.css and are only ever applied when `theme === "quest"`.
 *
 * Gold carries no words: #c9a227 measures 1.6:1 on parchment, so it may only ever fill a
 * shape or mark a decoration.
 */
export const QUEST_PALETTE = {
  ink: "#2a1f14",
  parchment: "#efe3c8",
  parchmentDeep: "#e4d4b0",
  /** Dim text on the leather banner: 9.7:1. */
  parchmentDim: "#cbb98c",
  leather: "#16100b",
  gold: "#c9a227",
  goldBright: "#e8c95a",
  goldDim: "#8a6f1f",
  wax: "#8c2f28",
  /**
   * Dim ink for text sitting on a *tinted* patch of parchment rather than bare parchment.
   * The card's own `--text-dim` (#6b5636) measures 4.77:1 on the darker parchment stop,
   * which is above the floor, but a 6% wax wash under it drops the same ink to 4.37:1, and a
   * 12% gold wash (a selected table row) to 4.45:1. Tinted regions therefore get this darker
   * value instead of `var(--text-dim)`.
   */
  inkDim: "#5b4930",
  /** Cream that clears 4.5:1 on filled wax and forest chips. */
  chipCream: "#f2ead6",
  /** Dark ink for text on gold leaf; the shipped risk-chip pairing. */
  onGold: "#3a2b00",
} as const;
