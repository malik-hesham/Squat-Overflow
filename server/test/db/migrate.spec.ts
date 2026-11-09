import { PGlite } from '@electric-sql/pglite';

import { migrate } from '../../src/db/migrate';
import { MIGRATIONS } from '../../src/db/migrations';

let db: PGlite;
beforeEach(() => {
  db = new PGlite();
});
afterEach(() => db.close());

test('applies every migration once and records it', async () => {
  expect(await migrate(db)).toEqual(MIGRATIONS.map((m) => m.name));
  expect(await migrate(db)).toEqual([]); // a second instance starting up applies nothing
  const { rows } = await db.query<{ name: string }>('select name from schema_migrations order by name');
  expect(rows.map((r) => r.name)).toEqual(MIGRATIONS.map((m) => m.name));
});

test('a failing migration rolls back entirely and is not recorded', async () => {
  const broken = [{ name: '900_broken', statements: ['create table half_done (id int)', 'select * from no_such_table'] }];
  await expect(migrate(db, broken)).rejects.toThrow('migration 900_broken failed');
  const { rows } = await db.query(`select to_regclass('half_done') as t`);
  expect(rows[0]).toEqual({ t: null });
  expect((await db.query('select * from schema_migrations')).rows).toEqual([]);
});
