// Optional verification only: npm install --prefix .tmp/sql-check --no-save @electric-sql/pglite
// Executes an in-memory PostgreSQL instance; never connects to a Supabase project.
const { PGlite } = require('../.tmp/sql-check/node_modules/@electric-sql/pglite');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const migration = await fs.readFile('supabase/migrations/20261011140000_demo_dataset.sql', 'utf8');
  const seed = await fs.readFile('supabase/seed.sql', 'utf8');
  await db.exec(migration);
  await db.exec(seed);
  await db.query("update feedsure_demo_generators set name = 'Preserved local edit' where generator_id = 'demo-kitchen-01'");
  await db.exec(migration);
  await db.exec(seed);
  const counts = (await db.query(`select
    (select count(*) from feedsure_demo_generators) as generators,
    (select count(*) from feedsure_demo_readiness) as readiness,
    (select count(*) from feedsure_demo_history) as history`)).rows[0];
  assert.deepEqual(counts, { generators: 10, readiness: 10, history: 140 });
  const row = (await db.query("select name, lat, lng from feedsure_demo_generators where generator_id = 'demo-kitchen-01'")).rows[0];
  assert.equal(row.name, 'Preserved local edit');
  assert.equal(row.lat, 12.6778162);
  assert.equal(row.lng, 77.4746671);
  await assert.rejects(db.query("insert into feedsure_demo_readiness values ('demo-kitchen-01','2026-10-13','READY',null,'ESTIMATE','06:00','09:00',null,true,'SIMULATED')"), /check constraint/);
  await assert.rejects(db.query("insert into feedsure_demo_history values ('demo-kitchen-99','2026-10-11',100,true,'SIMULATED')"), /foreign key/);
  await db.exec('set role anon;');
  await assert.rejects(db.query('select * from feedsure_demo_readiness'), /permission denied/);
  await db.exec('reset role; set role service_role;');
  await db.exec(seed);
  assert.equal((await db.query('select count(*) as count from feedsure_demo_generators')).rows[0].count, 10);
  await db.exec('reset role;');
  const tables = (await db.query("select count(*) as count from pg_class where relname like 'feedsure_demo_%' and relkind = 'r' and relrowsecurity")).rows[0].count;
  assert.equal(tables, 3);
  console.log(JSON.stringify({ counts, rerunPreservedEdit: true, coordinatePrecision: true, checksAndForeignKeys: true, anonymousAccessBlocked: true, serviceRoleRead: true, rlsTables: tables }));
  await db.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
