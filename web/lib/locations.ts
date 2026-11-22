// The plant page's Location field, pure: which of the locations in use its
// list shows for what the field holds (#129). The component
// (components/plant-editor.tsx) draws the rows; this decides them.

export type LocationChoices = {
  rows: string[]; // the known locations to show, in the order given
  fresh: string | null; // the typed text, trimmed, when it matches no known location and so would be a new one
};

/**
 * The list under the Location field. `known` is every location in use, in
 * the order to show them. `text` is what the field holds, and `resting` what
 * it held before the person typed: the plant's saved location, or the row
 * just chosen.
 *
 * While the text is still the resting text, or the field is empty, every
 * known location is shown: a field that already names a location must still
 * offer the others, which a datalist does not (it filters by the field's own
 * value). Once the person types, the list narrows to the locations that
 * contain the text, ignoring case. Text that matches none is kept, since a
 * location is free text, and is reported as a new one.
 */
export function locationChoices(known: string[], text: string, resting: string): LocationChoices {
  const typed = text.trim();
  if (typed === "" || typed === resting.trim()) return { rows: known, fresh: null };
  const needle = typed.toLowerCase();
  const rows = known.filter((l) => l.toLowerCase().includes(needle));
  return { rows, fresh: rows.length === 0 ? typed : null };
}

/** Whether two locations are the same one: ignoring case and surrounding spaces. */
export function sameLocation(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
