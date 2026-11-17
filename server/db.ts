import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { getEnvConfig } from './config';

let poolInstance: Pool | null = null;
let poolConfigSignature: string | null = null;

export interface DatabaseHealth {
  connected: boolean;
  configured: boolean;
  reason: string;
  host?: string | null;
  port?: number | null;
  user?: string | null;
  databaseName?: string;
  postgresUser?: string;
  schemaTablesCount?: number;
  hasAuthSchema?: boolean;
  repairedUnencodedPassword?: boolean;
  errorCode?: string | null;
  latencyMs?: number;
  serverTime?: string;
}

export function getDbPool(): Pool | null {
  const { parsedDb, status } = getEnvConfig();
  if (!status.databaseUrlConfigured || status.databasePasswordIsPlaceholder || !parsedDb.valid) {
    return null;
  }

  const signature = `${parsedDb.host}:${parsedDb.port}:${parsedDb.user}:${parsedDb.database}`;
  if (poolInstance && poolConfigSignature === signature) {
    return poolInstance;
  }

  const isLocal = parsedDb.host === 'localhost' || parsedDb.host === '127.0.0.1';

  poolInstance = new Pool({
    host: parsedDb.host!,
    port: parsedDb.port,
    database: parsedDb.database,
    user: parsedDb.user!,
    password: parsedDb.password ?? undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  poolConfigSignature = signature;

  poolInstance.on('error', (err) => {
    console.error('PostgreSQL pool background error:', err.message);
  });

  return poolInstance;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const pool = getDbPool();
  if (!pool) {
    throw new Error('DATABASE_NOT_CONFIGURED');
  }
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getDbPool();
  if (!pool) {
    throw new Error('DATABASE_NOT_CONFIGURED');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Transaction rollback error:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function testDatabaseConnection(): Promise<DatabaseHealth> {
  const { parsedDb, status } = getEnvConfig();

  if (!status.databaseUrlConfigured) {
    return {
      connected: false,
      configured: false,
      reason: 'DATABASE_URL environment variable is not present in the runtime process.',
    };
  }

  if (status.databasePasswordIsPlaceholder) {
    return {
      connected: false,
      configured: false,
      host: parsedDb.host,
      port: parsedDb.port,
      user: parsedDb.user,
      reason:
        'DATABASE_URL contains the [YOUR-PASSWORD] placeholder. Replace it with the real Supabase PostgreSQL database password in Secrets.',
    };
  }

  if (!parsedDb.valid) {
    return {
      connected: false,
      configured: false,
      host: parsedDb.host,
      port: parsedDb.port,
      user: parsedDb.user,
      reason: `DATABASE_URL could not be parsed safely: ${parsedDb.parseError ?? 'Invalid URI format.'}`,
    };
  }

  const pool = getDbPool();
  if (!pool) {
    return {
      connected: false,
      configured: false,
      host: parsedDb.host,
      port: parsedDb.port,
      user: parsedDb.user,
      reason: 'PostgreSQL pool could not be initialized.',
    };
  }

  const startedAt = Date.now();
  try {
    const info = await pool.query<{
      now: string;
      db_name: string;
      pg_user: string;
      table_count: string;
      has_auth_schema: boolean;
    }>(`
      SELECT
        NOW()::text AS now,
        current_database() AS db_name,
        current_user AS pg_user,
        (
          SELECT COUNT(*)::text
          FROM information_schema.tables
          WHERE table_schema = 'public'
        ) AS table_count,
        EXISTS (
          SELECT 1
          FROM information_schema.schemata
          WHERE schema_name = 'auth'
        ) AS has_auth_schema
    `);
    const row = info.rows[0];
    return {
      connected: true,
      configured: true,
      reason: 'Connected to Supabase PostgreSQL over TLS.',
      host: parsedDb.host,
      port: parsedDb.port,
      user: parsedDb.user,
      databaseName: row?.db_name,
      postgresUser: row?.pg_user,
      schemaTablesCount: Number(row?.table_count ?? 0),
      hasAuthSchema: Boolean(row?.has_auth_schema),
      repairedUnencodedPassword: parsedDb.repairedUnencodedPassword,
      latencyMs: Date.now() - startedAt,
      serverTime: row?.now,
    };
  } catch (err) {
    const pgErr = err as { message?: string; code?: string };
    const message = pgErr?.message || 'Unknown connection error';
    return {
      connected: false,
      configured: true,
      host: parsedDb.host,
      port: parsedDb.port,
      user: parsedDb.user,
      repairedUnencodedPassword: parsedDb.repairedUnencodedPassword,
      errorCode: pgErr?.code ?? null,
      latencyMs: Date.now() - startedAt,
      reason: `PostgreSQL connection failed: ${message}`,
    };
  }
}
