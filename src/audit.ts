/**
 * Audit log helper.
 *
 * Writes one row to the audit_log table for every security-relevant change:
 * settings updates, profile updates, credential rotations, imports, exports,
 * and admin actions. Reads are not logged.
 */
export interface AuditEntry {
  actor: string;
  action: string;
  resource: string;
  resource_id?: string;
  details?: Record<string, unknown>;
  ip?: string;
}

export function writeAuditLog(sql: any, entry: AuditEntry): void {
  sql.exec(
    `INSERT INTO audit_log (ts, actor, action, resource, resource_id, details, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    Date.now(),
    entry.actor,
    entry.action,
    entry.resource,
    entry.resource_id || "",
    JSON.stringify(entry.details || {}),
    entry.ip || ""
  );
}

export function readAuditLog(sql: any, limit = 250): any[] {
  return sql.exec(
    `SELECT id, ts, actor, action, resource, resource_id, details, ip
     FROM audit_log ORDER BY ts DESC LIMIT ?`,
    limit
  ).toArray();
}
