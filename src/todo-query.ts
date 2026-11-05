/**
 * Build the SQL and bound parameters for the todo-list endpoint.
 *
 * Keeping filter construction separate makes it possible to exercise the
 * exact production query against SQLite in the regression suite.
 */
export interface TodoFilters {
  status?: string;
  priority?: string;
  search?: string;
  tag?: string;
  listId?: string;
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function buildTodoQuery(filters: TodoFilters = {}): { query: string; params: unknown[] } {
  let query = "SELECT * FROM todos WHERE 1=1";
  const params: unknown[] = [];

  if (filters.status === "active") {
    query += " AND completed = 0";
  } else if (filters.status === "completed") {
    query += " AND completed = 1";
  }

  if (filters.priority && filters.priority !== "all") {
    query += " AND priority = ?";
    params.push(filters.priority);
  }

  if (filters.listId && filters.listId !== "all") {
    query += " AND list_id = ?";
    params.push(filters.listId);
  }

  if (filters.tag) {
    query += " AND EXISTS (SELECT 1 FROM json_each(todos.tags) WHERE json_each.value = ?)";
    params.push(filters.tag);
  }

  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    query += " AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')";
    params.push(pattern, pattern);
  }

  query += " ORDER BY is_pinned DESC, due_date ASC, created_at DESC";
  return { query, params };
}
