// Applies supabase/migrations/*.sql in name order, each in its own transaction,
// and records them (with a checksum) in app_meta.schema_migrations.
// An already-applied migration whose file has changed stops the run: migrations
// are append-only — write a new file instead of editing an applied one.

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const dir = process.env.MIGRATIONS_DIR || '/migrations';

async function connect(url) {
  const client = new pg.Client({ connectionString: url });
  // The database may still be finishing its first-boot initialisation.
  for (let attempt = 1; ; attempt++) {
    try {
      await client.connect();
      return client;
    } catch (err) {
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function ensureTable(client) {
  await client.query(`
    create schema if not exists app_meta;
    create table if not exists app_meta.schema_migrations (
      version    text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    );`);
}

async function listFiles() {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  return Promise.all(files.map(async (name) => {
    const sql = await readFile(path.join(dir, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

export async function migrate() {
  // Migrations run as "postgres" (owner of the application schema), never as
  // the superuser, so ownership matches a standard Supabase project.
  const client = await connect(process.env.DATABASE_URL);
  try {
    await ensureTable(client);
    const applied = new Map((await client.query('select version, checksum from app_meta.schema_migrations')).rows
      .map((r) => [r.version, r.checksum]));
    const files = await listFiles();
    let count = 0;
    for (const file of files) {
      const previous = applied.get(file.name);
      if (previous) {
        if (previous !== file.checksum) {
          throw new Error(`Migration ${file.name} was changed after it was applied. Add a new migration instead.`);
        }
        continue;
      }
      process.stdout.write(`Applying ${file.name} ... `);
      await client.query('begin');
      try {
        await client.query(file.sql);
        await client.query('insert into app_meta.schema_migrations (version, checksum) values ($1, $2)', [file.name, file.checksum]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        console.log('FAILED');
        throw new Error(`${file.name}: ${err.message}${err.position ? ` (at character ${err.position})` : ''}`);
      }
      console.log('done');
      count++;
    }
    // Ask PostgREST to reload its schema cache so new tables/functions are visible.
    await client.query("notify pgrst, 'reload schema'");
    console.log(count ? `${count} migration(s) applied.` : 'Database is up to date.');
  } finally {
    await client.end();
  }
}

export async function migrationStatus() {
  const client = await connect(process.env.DATABASE_URL);
  try {
    await ensureTable(client);
    const { rows } = await client.query('select version, applied_at from app_meta.schema_migrations order by version');
    const files = await listFiles();
    for (const f of files) {
      const row = rows.find((r) => r.version === f.name);
      console.log(`${row ? 'applied ' + row.applied_at.toISOString() : 'PENDING                 '}  ${f.name}`);
    }
  } finally {
    await client.end();
  }
}
