import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { buildTodoQuery } from "../src/todo-query.ts";

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE todos (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    completed INTEGER DEFAULT 0,
    priority TEXT DEFAULT 'medium',
    due_date TEXT DEFAULT NULL,
    list_id TEXT DEFAULT 'inbox',
    tags TEXT DEFAULT '[]',
    is_pinned INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )
`);

const insert = db.prepare(
  "INSERT INTO todos (title, description, completed, priority, list_id, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
insert.run("Urgent report", "prepare for review", 0, "high", "work", JSON.stringify(["urgent", "work"]), 1);
insert.run("Not urgent report", "contains urgent as part of another tag", 0, "high", "work", JSON.stringify(["not_urgent"]), 2);
insert.run("100% complete", "literal percentage", 0, "medium", "personal", "[]", 3);
insert.run("1000 complete", "not a percentage match", 0, "medium", "personal", "[]", 4);
insert.run("under_score", "literal underscore", 0, "medium", "personal", "[]", 5);
insert.run("underXscore", "not an underscore match", 0, "medium", "personal", "[]", 6);
insert.run("path\\\\task", "literal backslash", 0, "medium", "personal", "[]", 7);

function titles(filters) {
  const { query, params } = buildTodoQuery(filters);
  return db.prepare(query).all(...params).map((row) => row.title);
}

assert.deepEqual(titles({ tag: "urgent" }), ["Urgent report"]);
assert.deepEqual(titles({ tag: "urgent", status: "active", priority: "high", listId: "work" }), ["Urgent report"]);
assert.deepEqual(titles({ search: "100%" }), ["100% complete"]);
assert.deepEqual(titles({ search: "_" }), ["under_score"]);
assert.deepEqual(titles({ search: "\\\\" }), ["path\\\\task"]);

console.log("Todo filter regressions: 5 passed");
db.close();
