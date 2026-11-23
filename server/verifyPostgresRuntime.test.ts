import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeProfileLockExplainPlan,
  scrubPgEnvOverrides,
  validateDisposableTestUrl,
} from './verifyPostgresRuntime';

test('FINDING-03: validateDisposableTestUrl accepts valid IPv4/localhost/IPv6 loopback disposable URLs without logging passwords', () => {
  const ipv4 = validateDisposableTestUrl(
    'postgresql://ci_verify:ci_disposable_password@127.0.0.1:55432/exchange_verify_disposable'
  );
  assert.equal(ipv4.host, '127.0.0.1');
  assert.equal(ipv4.port, 55432);
  assert.equal(ipv4.database, 'exchange_verify_disposable');
  assert.equal(ipv4.user, 'ci_verify');
  assert.equal(ipv4.safeTarget, 'postgresql://ci_verify@127.0.0.1:55432/exchange_verify_disposable');
  assert.doesNotMatch(ipv4.safeTarget, /ci_disposable_password/);

  const localhost = validateDisposableTestUrl(
    'postgres://ci_verify:secret@LOCALHOST:55433/exchange_verify_disposable'
  );
  assert.equal(localhost.host, 'localhost');
  assert.equal(localhost.port, 55433);

  const ipv6 = validateDisposableTestUrl(
    'postgresql://ci_verify:secret@[::1]:55432/exchange_verify_disposable'
  );
  assert.equal(ipv6.host, '::1');
  assert.equal(ipv6.port, 55432);
  assert.equal(ipv6.safeTarget, 'postgresql://ci_verify@[::1]:55432/exchange_verify_disposable');
});

test('FINDING-03: validateDisposableTestUrl rejects missing URLs, hosted hosts, non-loopbacks, query overrides, default/Supabase ports, non-disposable DBs, sockets, and missing credentials', () => {
  const invalidUrls: Array<[string | undefined, RegExp]> = [
    [undefined, /TEST_DATABASE_URL is required/],
    ['', /TEST_DATABASE_URL is required/],
    ['"postgresql://ci_verify:pw@127.0.0.1:55432/exchange_verify_disposable"', /quotes or whitespace/],
    ['postgresql://u:pw@db.abc.supabase.co:5432/postgres', /hosted\/production database URL pattern/],
    ['postgresql://u:pw@ep-test.us-east-2.aws.neon.tech:5432/neondb', /hosted\/production database URL pattern/],
    ['postgresql://u:pw@postgres:55432/exchange_verify_disposable', /Refusing non-loopback host/],
    ['postgresql://u:pw@10.0.0.5:55432/exchange_verify_disposable', /Refusing non-loopback host/],
    ['postgresql://ci_verify:pw@127.0.0.1:55432/exchange_verify_disposable?host=10.0.0.50', /must not include query parameters/],
    ['postgresql://ci_verify:pw@127.0.0.1:55432/exchange_verify_disposable?sslmode=require', /must not include query parameters/],
    ['postgresql://ci_verify:pw@127.0.0.1:55432/exchange_verify_disposable?service=prod', /must not include query parameters/],
    ['postgresql://ci_verify:pw@127.0.0.1:5432/exchange_verify_disposable', /Refusing unapproved PostgreSQL port 5432/],
    ['postgresql://ci_verify:pw@127.0.0.1:54322/exchange_verify_disposable', /Refusing unapproved PostgreSQL port 54322/],
    ['postgresql://ci_verify:pw@127.0.0.1/exchange_verify_disposable', /must explicitly specify an approved disposable port/],
    ['postgresql://ci_verify:pw@127.0.0.1:55432/postgres', /Refusing unapproved database name "postgres"/],
    ['postgresql://ci_verify:pw@127.0.0.1:55432/', /single clean disposable database name/],
    ['postgresql://ci_verify:pw@127.0.0.1:55432/%2Fvar%2Frun%2Fpostgresql', /Unix socket or encoded path overrides/],
    ['postgresql://ci_verify@127.0.0.1:55432/exchange_verify_disposable', /must explicitly include non-empty disposable credentials/],
    ['postgresql://127.0.0.1:55432/exchange_verify_disposable', /must explicitly include non-empty disposable credentials/],
  ];

  for (const [url, pattern] of invalidUrls) {
    assert.throws(() => validateDisposableTestUrl(url), pattern, `Expected URL "${String(url)}" to fail`);
  }
});

test('FINDING-03: scrubPgEnvOverrides removes inherited libpq PG* environment variables', () => {
  const env: NodeJS.ProcessEnv = {
    PGHOST: 'prod.db.internal',
    PGPORT: '5432',
    PGDATABASE: 'postgres',
    PGUSER: 'postgres',
    PGPASSWORD: 'secret',
    PGSERVICE: 'prod_service',
    KEEP_OTHER: 'ok',
  };
  scrubPgEnvOverrides(env);
  assert.equal(env.PGHOST, undefined);
  assert.equal(env.PGPORT, undefined);
  assert.equal(env.PGDATABASE, undefined);
  assert.equal(env.PGUSER, undefined);
  assert.equal(env.PGPASSWORD, undefined);
  assert.equal(env.PGSERVICE, undefined);
  assert.equal(env.KEEP_OTHER, 'ok');
});

test('FINDING-06: analyzeProfileLockExplainPlan inspects LockRows and ordering AST rather than trusting raw JSON', () => {
  const validSortPlan = [
    {
      Plan: {
        'Node Type': 'LockRows',
        Plans: [
          {
            'Node Type': 'Sort',
            'Sort Key': ['p.id'],
            Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'profiles' }],
          },
        ],
      },
    },
  ];
  const sortResult = analyzeProfileLockExplainPlan(validSortPlan);
  assert.equal(sortResult.ok, true);
  assert.equal(sortResult.hasLockRows, true);
  assert.match(sortResult.orderingStrategy, /^Sort\(p\.id\)/);

  const validIndexPlan = [
    {
      Plan: {
        'Node Type': 'LockRows',
        Plans: [
          {
            'Node Type': 'Index Scan',
            'Relation Name': 'profiles',
            'Index Name': 'profiles_pkey',
            'Scan Direction': 'Forward',
          },
        ],
      },
    },
  ];
  assert.equal(analyzeProfileLockExplainPlan(validIndexPlan).ok, true);

  const missingLockRows = [
    {
      Plan: {
        'Node Type': 'Sort',
        'Sort Key': ['p.id'],
        Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'profiles' }],
      },
    },
  ];
  assert.equal(analyzeProfileLockExplainPlan(missingLockRows).ok, false);

  const descSortPlan = [
    {
      Plan: {
        'Node Type': 'LockRows',
        Plans: [
          {
            'Node Type': 'Sort',
            'Sort Key': ['p.id DESC'],
            Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'profiles' }],
          },
        ],
      },
    },
  ];
  assert.equal(analyzeProfileLockExplainPlan(descSortPlan).ok, false);

  const unorderedBitmapPlan = [
    {
      Plan: {
        'Node Type': 'LockRows',
        Plans: [{ 'Node Type': 'Bitmap Heap Scan', 'Relation Name': 'profiles' }],
      },
    },
  ];
  assert.equal(analyzeProfileLockExplainPlan(unorderedBitmapPlan).ok, false);
});
