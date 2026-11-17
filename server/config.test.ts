import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {
  detectSupabaseKeyFormat,
  getEnvConfig,
  hasDatabasePasswordPlaceholder,
  normalizeSupabaseProjectUrl,
  parseDatabaseUrl,
  parseTrustedProxyHops,
} from './config';
import { parseCookies } from './middleware/auth';
import { listSqlMigrationFiles } from './migrate';
import { resolveServerRequestIp } from './services/connectionContext';

test('normalizeSupabaseProjectUrl strips /rest/v1/ suffix safely', () => {
  assert.equal(
    normalizeSupabaseProjectUrl('https://oykwfjemmyakowviyisp.supabase.co/rest/v1/'),
    'https://oykwfjemmyakowviyisp.supabase.co'
  );
  assert.equal(
    normalizeSupabaseProjectUrl('  "https://example.supabase.co"  '),
    'https://example.supabase.co'
  );
  assert.equal(normalizeSupabaseProjectUrl('not-a-url'), null);
});

test('hasDatabasePasswordPlaceholder detects unreplaced password placeholders', () => {
  assert.equal(
    hasDatabasePasswordPlaceholder(
      'postgresql://postgres.ref:%5BYOUR-PASSWORD%5D@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'
    ),
    true
  );
  assert.equal(
    hasDatabasePasswordPlaceholder(
      'postgresql://postgres.ref:[YOUR-PASSWORD]@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'
    ),
    true
  );
  assert.equal(
    hasDatabasePasswordPlaceholder(
      'postgresql://postgres.ref:realSecretPass99@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'
    ),
    false
  );
});

test('parseDatabaseUrl handles quotes and unencoded @ or # characters in passwords cleanly', () => {
  const parsed = parseDatabaseUrl(
    '"postgresql://postgres.oykwfjemmyakowviyisp:P@ss#word1!@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"'
  );
  assert.equal(parsed.valid, true);
  assert.equal(parsed.hadQuotes, true);
  assert.equal(parsed.repairedUnencodedPassword, true);
  assert.equal(parsed.user, 'postgres.oykwfjemmyakowviyisp');
  assert.equal(parsed.password, 'P@ss#word1!');
  assert.equal(parsed.host, 'aws-1-eu-west-1.pooler.supabase.com');
  assert.equal(parsed.port, 5432);
  assert.equal(parsed.database, 'postgres');
  assert.equal(parsed.sslMode, 'require');
});

test('detectSupabaseKeyFormat recognizes modern sb_publishable, sb_secret, and legacy JWT keys', () => {
  assert.equal(detectSupabaseKeyFormat('sb_publishable_abc123', 'anon'), 'sb_publishable');
  assert.equal(detectSupabaseKeyFormat('sb_secret_xyz999', 'service'), 'sb_secret');
  assert.equal(detectSupabaseKeyFormat('eyJaaa.bbb.ccc', 'anon'), 'jwt');
});

test('parseDatabaseUrl detects common malformed secret formats without echoing values', () => {
  const withPrefix = parseDatabaseUrl('DATABASE_URL=postgresql://postgres:secret@host:5432/postgres');
  assert.equal(withPrefix.valid, false);
  assert.match(withPrefix.parseError ?? '', /DATABASE_URL=/);

  const bareValue = parseDatabaseUrl('justAPasswordValue');
  assert.equal(bareValue.valid, false);
  assert.match(bareValue.parseError ?? '', /bare string\/password/);
});

test('parseCookies parses access and refresh tokens cleanly', () => {
  const cookies = parseCookies('sb_access_token=abc%2E123; theme=dark; sb_refresh_token=xyz');
  assert.equal(cookies.sb_access_token, 'abc.123');
  assert.equal(cookies.sb_refresh_token, 'xyz');
  assert.equal(cookies.theme, 'dark');
});

test('parseTrustedProxyHops safely constrains trust proxy depth and returns numeric 0 for "0"', () => {
  assert.equal(parseTrustedProxyHops(undefined), 1);
  assert.equal(parseTrustedProxyHops('0'), 0);
  assert.equal(typeof parseTrustedProxyHops('0'), 'number');
  assert.equal(parseTrustedProxyHops(' "0" '), 0);
  assert.equal(parseTrustedProxyHops('2'), 2);
  assert.equal(parseTrustedProxyHops('10'), 10);
  assert.equal(parseTrustedProxyHops('false'), false);
  assert.equal(parseTrustedProxyHops('off'), false);
  assert.equal(parseTrustedProxyHops('true'), 1);
  assert.equal(parseTrustedProxyHops('-1'), 1);
  assert.equal(parseTrustedProxyHops('11'), 1);
  assert.equal(parseTrustedProxyHops('2abc'), 1);
  assert.equal(parseTrustedProxyHops('1.5'), 1);
});

test('Express trust proxy receives numeric 0 and ignores forwarded headers when TRUSTED_PROXY_HOPS="0"', async () => {
  const previous = process.env.TRUSTED_PROXY_HOPS;
  process.env.TRUSTED_PROXY_HOPS = '0';
  try {
    const cfg = getEnvConfig();
    assert.equal(cfg.trustedProxyHops, 0);
    assert.equal(typeof cfg.trustedProxyHops, 'number');

    const app = express();
    app.set('trust proxy', cfg.trustedProxyHops);
    assert.equal(app.get('trust proxy'), 0);
    assert.equal(typeof app.get('trust proxy'), 'number');

    app.get('/probe', (req, res) => {
      const resolved = resolveServerRequestIp(req);
      res.json({
        ok: true,
        reqIp: req.ip,
        reqIps: req.ips,
        socketRemoteAddress: req.socket?.remoteAddress,
        resolvedIp: resolved.ipInfo.ip,
        resolvedSource: resolved.ipSource,
      });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const addr = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${addr.port}/probe`, {
        headers: {
          'X-Forwarded-For': '203.0.113.55, 198.51.100.10',
          'X-Forwarded-Proto': 'https',
          Forwarded: 'for=203.0.113.55;proto=https',
        },
      });
      assert.equal(response.status, 200);
      const observed = (await response.json()) as {
        ok: boolean;
        reqIp?: string;
        reqIps: string[];
        socketRemoteAddress?: string;
        resolvedIp: string | null;
        resolvedSource: string;
      };
      assert.equal(observed.reqIp, '127.0.0.1');
      assert.deepEqual(observed.reqIps, []);
      assert.equal(observed.socketRemoteAddress, '127.0.0.1');
      assert.equal(observed.resolvedIp, '127.0.0.1');
      assert.equal(observed.resolvedSource, 'express_trusted_ip');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    if (previous === undefined) {
      delete process.env.TRUSTED_PROXY_HOPS;
    } else {
      process.env.TRUSTED_PROXY_HOPS = previous;
    }
  }
});

test('listSqlMigrationFiles discovers all ordered versioned SQL migrations', async () => {
  const files = await listSqlMigrationFiles();
  assert.deepEqual(files, [
    '001_core_exchange_schema.sql',
    '002_company_inventory_treasury_pricing.sql',
    '003_rls_and_permissions.sql',
    '004_auth_bootstrap_and_catalog.sql',
    '005_security_events_and_ip_intelligence.sql',
  ]);
});
