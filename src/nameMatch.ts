/**
 * Folds a display name to a comparable form: accents stripped, case and
 * surrounding whitespace ignored, so "Juanlú" and " juanlu " compare equal.
 * Spanish names are routinely typed without their accents in a hurry.
 */
const fold = (name: string): string =>
  name.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();

/**
 * Finds the people a typed name refers to. A full-name match wins outright;
 * with no exact hit, a name that starts any word of the full name counts, so
 * "Juan" and "Carlos" both find "Juan Carlos".
 *
 * Deliberately not a substring match: "an" must never resolve to "Juan" and
 * withdraw them. Every match is returned so the caller can refuse to act on an
 * ambiguous one rather than guess.
 */
export function findByName<T extends { user_name: string }>(items: readonly T[], query: string): T[] {
  const needle = fold(query);
  if (!needle) return [];

  const exact = items.filter(item => fold(item.user_name) === needle);
  if (exact.length > 0) return exact;

  return items.filter(item => fold(item.user_name).split(/\s+/).some(word => word.startsWith(needle)));
}
