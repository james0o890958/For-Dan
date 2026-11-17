import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { getEnvConfig } from './server/config';
import { testDatabaseConnection } from './server/db';
import { requireAuth, requireRole } from './server/middleware/auth';
import { listSqlMigrationFiles } from './server/migrate';
import authRoutes from './server/routes/auth';
import marketsRoutes from './server/routes/markets';
import securityRoutes from './server/routes/security';
import { testSupabaseAuthHealth } from './server/supabase';
import {
  INITIAL_PROVIDER_HEALTH,
  unconfiguredCustodyProvider,
  unconfiguredLiquidityProvider,
} from './src/services/providerAdapters';

const PORT =
  Number(process.env.DEFAULT_APP_PORT) ||
  (process.env.PORT && process.env.PORT !== process.env.NGINX_PORT
    ? Number(process.env.PORT)
    : 3000);
const HOST = '0.0.0.0';

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.set('trust proxy', getEnvConfig().trustedProxyHops);
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_req, res) => {
    const { status } = getEnvConfig();
    const [dbHealth, authHealth, migrationsPrepared] = await Promise.all([
      testDatabaseConnection(),
      testSupabaseAuthHealth(),
      listSqlMigrationFiles().catch(() => []),
    ]);

    res.json({
      ok: true,
      stage: 'step_1_supabase_integration',
      database: dbHealth,
      supabaseAuth: authHealth,
      secretsConfigured: {
        supabaseUrl: status.supabaseUrlConfigured,
        supabaseUrlHadRestSuffix: status.supabaseUrlHadRestSuffix,
        normalizedSupabaseUrl: status.normalizedSupabaseUrl,
        supabaseAnonKey: status.supabaseAnonKeyConfigured,
        supabaseAnonKeyFormat: status.supabaseAnonKeyFormat,
        supabaseServiceRoleKey: status.supabaseServiceRoleKeyConfigured,
        supabaseServiceRoleKeyFormat: status.supabaseServiceRoleKeyFormat,
        databaseUrl: status.databaseUrlConfigured && !status.databasePasswordIsPlaceholder,
        databaseUrlParseValid: status.databaseUrlParseValid,
        databaseUrlParseError: status.databaseUrlParseError,
        databaseHost: status.databaseHost,
        databasePort: status.databasePort,
        databaseUser: status.databaseUser,
        databasePasswordPlaceholderDetected: status.databasePasswordIsPlaceholder,
        ipGeolocationConfigured: status.ipGeolocationConfigured,
      },
      migrationsPrepared,
      providersConfigured: false,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/markets', marketsRoutes);
  app.use('/api/admin/security', securityRoutes);

  app.get('/api/providers/health', (_req, res) => {
    res.json({
      ok: true,
      stage: 'step_1_supabase_integration',
      providers: INITIAL_PROVIDER_HEALTH,
    });
  });

  app.post('/api/deposits/address', requireAuth, async (req, res) => {
    const { assetSymbol, networkCode } = req.body ?? {};
    if (
      typeof assetSymbol !== 'string' ||
      !assetSymbol.trim() ||
      typeof networkCode !== 'string' ||
      !networkCode.trim()
    ) {
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'assetSymbol and networkCode are required.',
      });
      return;
    }

    const result = await unconfiguredCustodyProvider.getOrCreateDepositAddress({
      userId: req.auth!.userId,
      assetSymbol: assetSymbol.trim().toUpperCase(),
      networkCode: networkCode.trim().toUpperCase(),
    });

    res.status(503).json(result);
  });

  app.post('/api/withdrawals/request', requireAuth, async (req, res) => {
    const { assetSymbol, networkCode, amount, destinationAddress, twoFactorCode } =
      req.body ?? {};
    const numericAmount = Number(amount);

    if (
      typeof assetSymbol !== 'string' ||
      !assetSymbol.trim() ||
      typeof networkCode !== 'string' ||
      !networkCode.trim() ||
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0 ||
      typeof destinationAddress !== 'string' ||
      !destinationAddress.trim() ||
      typeof twoFactorCode !== 'string' ||
      twoFactorCode.trim().length < 6
    ) {
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message:
          'Valid assetSymbol, networkCode, positive amount, destinationAddress, and 6-digit 2FA code are required.',
      });
      return;
    }

    res.status(503).json({
      ok: false,
      code: 'PROVIDER_NOT_CONFIGURED',
      message:
        'Live withdrawal execution is gated until database migrations and custody policy integrations are activated.',
    });
  });

  app.post(
    '/api/withdrawals/:id/approve',
    requireAuth,
    requireRole('super_admin', 'finance_admin'),
    async (req, res) => {
      const { decision } = req.body ?? {};
      if (!req.params.id || (decision !== 'approve' && decision !== 'reject')) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Withdrawal id and decision (approve|reject) are required.',
        });
        return;
      }

      res.status(503).json({
        ok: false,
        code: 'PROVIDER_NOT_CONFIGURED',
        message:
          'Withdrawal approval execution is gated until migrations and custody approvals are enabled in the next stage.',
      });
    }
  );

  app.post('/api/orders/market', requireAuth, async (req, res) => {
    const { pairSymbol, side, amount } = req.body ?? {};
    const numericAmount = Number(amount);

    if (
      typeof pairSymbol !== 'string' ||
      !pairSymbol.trim() ||
      (side !== 'buy' && side !== 'sell') ||
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Valid pairSymbol, side (buy|sell), and positive amount are required.',
      });
      return;
    }

    const result = await unconfiguredLiquidityProvider.submitMarketOrder({
      clientOrderId: `ord_${req.auth!.publicUserId}_${Date.now()}`,
      venueSymbol: pairSymbol.trim().toUpperCase(),
      side,
      requestedAmount: numericAmount,
    });

    res.status(503).json(result);
  });

  app.post(
    '/api/admin/reconcile',
    requireAuth,
    requireRole('super_admin', 'finance_admin', 'operations_admin', 'compliance_admin'),
    (_req, res) => {
      res.status(503).json({
        ok: false,
        code: 'PROVIDER_NOT_CONFIGURED',
        message:
          'Balance and inventory reconciliation requires migrations to be applied in the next stage.',
      });
    }
  );

  app.all('/api/*', (_req, res) => {
    res.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      message: 'API endpoint not found.',
    });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: { server: httpServer },
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
