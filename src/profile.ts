/**
 * The eligibility profile, in one place.
 *
 * The profile answers one question: which hackathons may this person enter?
 * The eligibility engine (src/hackathons.ts) and the Settings screen
 * (src/settings.ts) both read it, so it needs one type and one default.
 *
 * It used to have two. src/hackathons.ts had an empty profile and
 * src/settings.ts had one with values in it, so with nothing stored the
 * Settings screen showed a profile while the engine saw an empty one —
 * every eligibility verdict was computed against someone who did not exist.
 */
export interface UserProfile {
  citizenships: string[];      // ISO 3166-1 alpha-2
  residencies: string[];       // ISO 3166-1 alpha-2
  residency_status: string;    // "settled", "pre-settled", "visa", "citizen", "none"
  age: number;
  is_student: boolean;
  team_size: number;
  employed_by_sponsor: boolean;
}

/**
 * The profile used when nothing has been stored yet.
 *
 * The values are the seed profile for this deployment. Change them here and
 * both the Settings screen and the eligibility engine change together.
 */
export const DEFAULT_PROFILE: UserProfile = {
  citizenships: ["IT"],
  residencies: ["GB"],
  residency_status: "settled",
  age: 25,
  is_student: false,
  team_size: 1,
  employed_by_sponsor: false,
};

/**
 * Fill in any field a stored profile is missing.
 *
 * A profile written by an older version, or edited one field at a time,
 * may not carry every key. Merging against the default keeps the shape
 * whole rather than leaving an undefined where the engine expects a number.
 */
export function withProfileDefaults(profile: Partial<UserProfile> | null | undefined): UserProfile {
  return {
    ...DEFAULT_PROFILE,
    ...(profile || {}),
  };
}

/**
 * Read the stored profile from its canonical table.
 *
 * The table is `hackathon_profile`. A profile written by an older version,
 * or edited one field at a time, may be missing keys, so the result is
 * merged against the default rather than trusted as-is.
 */
export function readProfile(sql: any): UserProfile {
  try {
    const rows = sql
      .exec("SELECT profile_json FROM hackathon_profile WHERE id = 'default'")
      .toArray();
    if (rows.length > 0 && rows[0].profile_json) {
      return withProfileDefaults(JSON.parse(rows[0].profile_json));
    }
  } catch {
    // fall through to the defaults
  }
  return { ...DEFAULT_PROFILE };
}

/**
 * Write the profile to its canonical table.
 */
export function writeProfile(sql: any, profile: UserProfile): void {
  const json = JSON.stringify(profile);
  const ts = Date.now();
  sql.exec(
    `INSERT INTO hackathon_profile (id, profile_json, updated_at) VALUES ('default', ?, ?)
     ON CONFLICT(id) DO UPDATE SET profile_json = ?, updated_at = ?`,
    json, ts, json, ts
  ).toArray();
}
