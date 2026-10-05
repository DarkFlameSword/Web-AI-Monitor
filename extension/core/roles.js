/**
 * Gauge roles are the RPG vocabulary shared by every vendor. A vendor's plan
 * template says which of its limits plays which role; the theme decides how a
 * role looks. Neither side needs to know about the other.
 */
export const ROLES = Object.freeze({
  /** Short, fast-refilling pool, e.g. Claude's 5-hour session. */
  mp: Object.freeze({ abbr: 'MP', nameKey: 'role.mp', readyWhenFull: false }),
  /** The long pool that everything draws from, e.g. the weekly all-models limit. */
  hp: Object.freeze({ abbr: 'HP', nameKey: 'role.hp', readyWhenFull: false }),
  /** A premium pool: full means the ultimate is ready, e.g. the weekly Fable limit. */
  sp: Object.freeze({ abbr: 'SP', nameKey: 'role.sp', readyWhenFull: true }),
  /** Any limit a template does not name (new limits the vendor adds later). */
  ex: Object.freeze({ abbr: 'EX', nameKey: 'role.ex', readyWhenFull: false }),
});

export function roleOf(id) {
  return ROLES[id] ?? ROLES.ex;
}
