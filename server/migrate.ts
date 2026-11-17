import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDbPool, testDatabaseConnection, withTransaction } from './db';

export interface MigrationSummary {
  applied: string[];
  skipped: string[];
}

export async function listSqlMigrationFiles(): Promise<string[]> {
  const dir = path.resolve(process.cwd(), 'db', 'migrations');
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();
}

export async function runPendingMigrations(): Promise<MigrationSummary> {
  const pool = getDbPool();
  if (!pool) {
    throw new Error('DATABASE_URL is missing or contains a placeholder password.');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.schema_migrations FROM anon, authenticated;
  `);

  const appliedRes = await pool.query<{ version: string }>(
    'SELECT version FROM public.schema_migrations ORDER BY version ASC'
  );
  const appliedSet = new Set(appliedRes.rows.map((r) => r.version));
  const files = await listSqlMigrationFiles();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file)) {
      skipped.push(file);
      continue;
    }

    const sqlPath = path.resolve(process.cwd(), 'db', 'migrations', file);
    const sql = await fs.readFile(sqlPath, 'utf8');

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO public.schema_migrations (version) VALUES ($1)',
        [file]
      );
    });
    applied.push(file);
  }

  return { applied, skipped };
}

// Run only when explicitly invoked via CLI with --apply
if (process.argv.includes('--apply')) {
  (async () => {
    const health = await testDatabaseConnection();
    if (!health.connected) {
      console.error('Migration aborted:', health.reason);
      process.exit(1);
    }
    const result = await runPendingMigrations();
    console.log('Migrations complete:', JSON.stringify(result, null, 2));
    process.exit(0);
  })().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
