/** The slice of a Postgres client the app uses; `pg` clients and PGlite both satisfy it. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
