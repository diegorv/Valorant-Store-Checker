/**
 * Collection grid layout.
 *
 * The collection is virtualized by row, so the code that slices skins into
 * rows has to agree with the number of columns the CSS grid actually shows.
 * Both read from here instead of one guessing the other.
 */

/** Narrowest a card gets before the grid drops a column (px) */
export const MIN_CARD_WIDTH = 260;
/** Horizontal gap between cards, the same as Tailwind's `gap-6` (px) */
export const GRID_GAP = 24;
/** Never wider than the desktop layout */
export const MAX_COLUMNS = 4;

/**
 * How many cards fit side by side in a container of the given width.
 * Always at least one, so a phone gets a single column instead of four
 * cards crammed into a row sized for one.
 */
export function columnsForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  const fit = Math.floor((width + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP));
  return Math.max(1, Math.min(MAX_COLUMNS, fit));
}
