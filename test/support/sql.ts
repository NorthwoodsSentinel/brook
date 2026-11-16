// A Durable Object `ctx.storage.sql` backed by node:sqlite, so the tests run every
// query in src/ against a real SQLite engine rather than a hand-written fake.
//
// Matches the parts of the SqlStorage contract src/ relies on: exec(query, ...bindings)
// returns a cursor that is iterable and has toArray(); a script of several statements
// with no bindings runs as a batch (init's CREATE TABLE block); a SQL error throws.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type Row = Record<string, SQLInputValue>;

export interface FakeSql {
  exec(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): Row[]; [Symbol.iterator](): Iterator<Row> };
  db: DatabaseSync;
  // When set, exec throws for any query containing this text (for failure-path tests).
  failOn?: string;
}

function cursor(rows: Row[]) {
  return {
    toArray: () => rows,
    [Symbol.iterator]: () => rows[Symbol.iterator](),
  };
}

export function createSql(): FakeSql {
  const db = new DatabaseSync(":memory:");
  const sql: FakeSql = {
    db,
    exec(query: string, ...bindings: unknown[]) {
      if (sql.failOn && query.includes(sql.failOn))
        throw new Error(`forced failure on ${sql.failOn}`);
      const statements = query
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (statements.length > 1) {
        if (bindings.length > 0)
          throw new Error(
            "bindings are not allowed in a multi-statement script",
          );
        db.exec(query);
        return cursor([]);
      }
      const rows = db
        .prepare(query)
        .all(...(bindings as SQLInputValue[])) as Row[];
      return cursor(rows.map((r) => ({ ...r })));
    },
  };
  return sql;
}

export function createState(sql: FakeSql): DurableObjectState {
  // Double cast: src/ touches only ctx.storage.sql, which FakeSql implements; the
  // rest of DurableObjectState (alarms, KV storage, blockConcurrencyWhile) is unused.
  return { storage: { sql } } as unknown as DurableObjectState;
}
