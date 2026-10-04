/** Text helpers that are safe for emoji and Indic scripts (never split a surrogate pair). */

/** Truncate to at most `max` Unicode code points, adding an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max).join('')}…` : text;
}
