// A minimal in-memory fake of the Supabase query builder, covering just the
// operations the game API routes actually use (insert/select/eq/order/
// limit/single/maybeSingle/update/delete, plus bare `await`ing a builder).
// This is not a general-purpose Supabase mock — chains not used by the
// routes under test aren't supported.
import { randomUUID } from "crypto";

type Row = Record<string, unknown>;

function defaultsFor(table: string): Row {
  const now = new Date().toISOString();
  switch (table) {
    case "games":
      return {
        status: "waiting",
        team_a_level: 2,
        team_b_level: 2,
        winning_team: null,
        created_at: now,
        updated_at: now,
      };
    case "game_rounds":
      return {
        game_state: {},
        current_player_turn: null,
        leader_position: null,
        status: "in_progress",
        finishing_positions: null,
        created_at: now,
        updated_at: now,
      };
    case "game_participants":
      return {
        hand: [],
        is_connected: true,
        connected_at: now,
        last_heartbeat: now,
        created_at: now,
      };
    case "game_actions":
      return { action_data: {}, created_at: now };
    default:
      return {};
  }
}

function matches(row: Row, filters: [string, unknown][]): boolean {
  return filters.every(([column, value]) => row[column] === value);
}

interface QueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

// Mirrors the unique constraints in supabase/migrations/001_initial_schema.sql
// closely enough for the routes under test to hit real 23505 conflicts.
const UNIQUE_CONSTRAINTS: Record<string, string[][]> = {
  game_participants: [
    ["game_id", "player_id"],
    ["game_id", "position"],
  ],
};

// Postgres unique constraints treat NULL as distinct from everything,
// including other NULLs — e.g. any number of spectators (position=null)
// can coexist. Only a match where every constrained column is non-null on
// both sides counts as a conflict.
function findUniqueViolation(
  table: string,
  existingRows: Row[],
  candidate: Row,
): string[] | null {
  for (const constraint of UNIQUE_CONSTRAINTS[table] ?? []) {
    if (constraint.some((column) => candidate[column] == null)) continue;
    const conflict = existingRows.some((row) =>
      constraint.every((column) => row[column] === candidate[column]),
    );
    if (conflict) return constraint;
  }
  return null;
}

type Op = "select" | "insert" | "update" | "delete";

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  private op: Op = "select";
  private payload: unknown;
  private filters: [string, unknown][] = [];
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private tables: Record<string, Row[]>,
    private table: string,
    private injectedFailures: Set<string>,
  ) {}

  insert(payload: unknown) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  // Column selection is untyped here — the fake always returns full rows
  // and callers narrow via TypeScript casts, same as elsewhere in this file.
  // The parameter only exists so call sites like `.select("id")` typecheck.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  select(columns?: string) {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  // Ordering/limiting aren't simulated — the only caller (getLatestRound)
  // only ever has one row per game_id in practice, so it doesn't matter.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  order(column?: string, opts?: unknown) {
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  limit(count?: number) {
    return this;
  }

  single(): Promise<QueryResult> {
    this.mode = "single";
    return this.execute();
  }

  maybeSingle(): Promise<QueryResult> {
    this.mode = "maybeSingle";
    return this.execute();
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult> {
    const failureKey = `${this.table}:${this.op}`;
    if (this.injectedFailures.has(failureKey)) {
      this.injectedFailures.delete(failureKey);
      return {
        data: null,
        error: { code: "INJECTED", message: `injected failure for ${failureKey}` },
      };
    }

    const rows = this.tables[this.table] ?? (this.tables[this.table] = []);
    let result: Row[];

    if (this.op === "insert") {
      const payloads = Array.isArray(this.payload) ? this.payload : [this.payload];
      const newRows: Row[] = [];
      for (const p of payloads) {
        const candidate: Row = {
          id: randomUUID(),
          ...defaultsFor(this.table),
          ...(p as Row),
        };
        const violation = findUniqueViolation(this.table, [...rows, ...newRows], candidate);
        if (violation) {
          return {
            data: null,
            error: {
              code: "23505",
              message: `duplicate key value violates unique constraint on (${violation.join(", ")})`,
            },
          };
        }
        newRows.push(candidate);
      }
      rows.push(...newRows);
      result = newRows;
    } else if (this.op === "update") {
      result = rows.filter((r) => matches(r, this.filters));
      for (const r of result) Object.assign(r, this.payload);
    } else if (this.op === "delete") {
      result = rows.filter((r) => matches(r, this.filters));
      for (const r of result) rows.splice(rows.indexOf(r), 1);
    } else {
      result = rows.filter((r) => matches(r, this.filters));
    }

    if (this.mode === "single") {
      if (result.length !== 1) {
        return { data: null, error: { message: "expected exactly one row" } };
      }
      return { data: result[0], error: null };
    }
    if (this.mode === "maybeSingle") {
      return { data: result[0] ?? null, error: null };
    }
    return { data: result, error: null };
  }
}

export interface FakeSupabaseClient {
  from(table: string): FakeQueryBuilder;
  _tables: Record<string, Row[]>;
  _reset(): void;
  // Makes the next `op` against `table` (e.g. "game_participants", "update")
  // resolve with an error instead of executing, so tests can exercise a
  // route's error-handling/rollback paths without a real DB failure.
  // Consumed after one use.
  _failNext(table: string, op: Op): void;
}

export function createFakeSupabase(): FakeSupabaseClient {
  const tables: Record<string, Row[]> = {};
  const failures = new Set<string>();
  return {
    from(table: string) {
      return new FakeQueryBuilder(tables, table, failures);
    },
    _tables: tables,
    _reset() {
      for (const key of Object.keys(tables)) delete tables[key];
      failures.clear();
    },
    _failNext(table: string, op: Op) {
      failures.add(`${table}:${op}`);
    },
  };
}
