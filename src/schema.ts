/**
 * The database schema, in one place.
 *
 * It used to be written out three times: in the Durable Object's initDb,
 * in the route test suite and in the API test suite. They drifted - the
 * capture_jobs table existed in the app and in neither test - so the
 * statements live here and everyone runs the same list.
 *
 * The statements are plain SQL, so the same list works against the
 * Durable Object's storage and against a node:sqlite database.
 */
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
    )`,
  `CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    completed INTEGER DEFAULT 0,
    priority TEXT DEFAULT 'medium',
    due_date TEXT DEFAULT NULL,
    list_id TEXT DEFAULT 'inbox',
    tags TEXT DEFAULT '[]',
    is_pinned INTEGER DEFAULT 0,
    estimated_pomodoros INTEGER DEFAULT 1,
    pomodoro_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    completed_at INTEGER DEFAULT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS hackathons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT DEFAULT 'manual',
    url TEXT DEFAULT '',
    description TEXT DEFAULT '',
    prize TEXT DEFAULT '',
    start_date TEXT DEFAULT NULL,
    end_date TEXT DEFAULT NULL,
    registration_deadline TEXT DEFAULT NULL,
    submission_deadline TEXT DEFAULT NULL,
    eligibility_json TEXT DEFAULT '{}',
    status TEXT DEFAULT 'open',
    notes TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS hackathon_profile (
    id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    data BLOB NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS archive_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    api_key TEXT DEFAULT NULL,
    enabled INTEGER DEFAULT 1,
    base_url TEXT DEFAULT '',
    created_at INTEGER NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS capacity (
    day_of_week INTEGER PRIMARY KEY,
    hours_available REAL NOT NULL DEFAULT 0,
    notes TEXT DEFAULT ''
    )`,
  `CREATE TABLE IF NOT EXISTS inbox (
    id TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    subject TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    body_preview TEXT DEFAULT '',
    body_html TEXT DEFAULT '',
    has_attachments INTEGER DEFAULT 0,
    attachment_names TEXT DEFAULT '[]',
    is_platform INTEGER DEFAULT 0,
    platform TEXT DEFAULT NULL,
    ticket_id TEXT DEFAULT NULL,
    read INTEGER DEFAULT 0,
    processed INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    match_confidence REAL DEFAULT 0,
    match_method TEXT DEFAULT 'none'
    )`,
  `CREATE TABLE IF NOT EXISTS capture_jobs (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    name TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    wacz_size INTEGER DEFAULT 0,
    extracted_json TEXT DEFAULT '{}',
    error TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    ip TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0,
    window_start INTEGER NOT NULL
    )`,
];

/**
 * Create every table that is not there yet.
 *
 * @param exec - Something with an exec(sql) method: the Durable Object's
 *   storage.sql, or a node:sqlite database.
 */
export function createSchema(exec: any): void {
  for (const statement of SCHEMA) {
    exec.exec(statement);
  }
}
