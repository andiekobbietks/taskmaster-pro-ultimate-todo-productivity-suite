// Faithful mock of the Durable Object's ctx.storage.sql API.
//
// The DO returns a cursor after exec(). For a SELECT the cursor yields rows.
// For a write, the statement has already been applied and the cursor yields
// nothing — so draining it must NOT re-run the statement.
const isSelect = (text) => /^\s*(select|with)/i.test(text);

export function makeSql(db) {
  return {
    exec(text, ...params) {
      const stmt = db.prepare(text);
      if (isSelect(text)) {
        const rows = stmt.all(...params);
        return {
          toArray: () => rows,
          one: () => (rows.length > 0 ? rows[0] : undefined),
        };
      }
      // A write. Apply it once. The cursor yields nothing, and consuming it
      // must not re-apply the statement.
      stmt.run(...params);
      const empty = [];
      return {
        toArray: () => empty,
        one: () => undefined,
      };
    },
  };
}
