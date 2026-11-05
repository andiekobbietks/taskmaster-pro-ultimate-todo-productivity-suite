# Checkpoint and recovery scope

TaskMaster Pro checkpoints are versioned snapshots of the application's SQLite data. They are intended to recover application records after an unsafe change or migration, not to clone the whole Cloudflare deployment.

## Included tables

A version 2 checkpoint captures every row in these 13 application tables:

- `lists`, `todos`, `hackathons`, `hackathon_profile`
- `attachments` (including the original binary BLOB bytes)
- `archive_sources`, `settings`, `capacity`, `inbox`
- `capture_jobs`, `push_subscriptions`, `email_subscriptions`, `email_deliveries`

Binary SQLite values are encoded as base64-tagged values in the checkpoint payload and restored to byte arrays. Checkpoint payloads are encrypted with the configured `SETTINGS_ENCRYPTION_KEY` using the existing AES-256-GCM settings-crypto implementation. Production already fails closed when that key is absent. In local development without the key, checkpoint payloads remain plaintext and should be treated as sensitive local data.

## Deliberately excluded

- `checkpoints`: a checkpoint does not recursively contain prior checkpoint payloads.
- `rate_limits`: transient abuse-control counters should not be rewound.
- `diagnostics` and `audit_log`: operational and audit history must not be erased or rolled back with application data.

A checkpoint is not a full infrastructure backup. It does not contain Worker code/configuration, environment secrets, Durable Object alarms, or external service state. WACZ uploads are parsed during ingestion; the capture table retains job metadata and extracted information, not the original WACZ archive. Keep separate off-platform backups for any original source archives or deployment configuration that must be retained.

## Restore behaviour

Restore validates the format, version, table allowlist, row structure, and column identifier syntax before writing. It then uses a SQLite savepoint so any failed delete/insert sequence is rolled back as one unit. Version 1 unversioned checkpoints remain readable for the tables they actually contain; they cannot restore tables they never captured.

The checkpoint endpoint is protected by the normal API authentication middleware. Store and protect the encryption key independently of the database: without the same key, encrypted checkpoint payloads cannot be recovered.
