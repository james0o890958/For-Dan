import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  type Router,
} from 'express';
import type { Pool } from 'pg';
import { getEnvConfig } from './config';
import { testDatabaseConnection } from './db';
import { requireAuth, requireRole } from './middleware/auth';
import { asyncHandler, createCsrfProtectionMiddleware } from './middleware/security';
import { createAuthRouter, type AuthRouterOptions } from './routes/auth';
import depositsRoutes, { createDepositsRouter } from './routes/deposits';
import marketsRoutes from './routes/markets';
import purchaseOrdersRoutes, { createPurchaseOrdersRouter } from './routes/purchaseOrders';
import securityRoutes from './routes/security';
import { testSupabaseAuthHealth } from './supabase';
import {
  INITIAL_PROVIDER_HEALTH,
  unconfiguredCustodyProvider,
  unconfiguredLiquidityProvider,
} from '../src/services/providerAdapters';

export interface CreateApiAppOptions {
  trustedProxyHops?: number | false;
  appUrl?: string | null;
  isProduction?: boolean;
  authRouter?: Router;
  authRouterOptions?: AuthRouterOptions;
  authMiddleware?: RequestHandler;
  pool?: Pool;
  preferDbPrice?: boolean;
  purchaseOrdersRouter?: Router;
  depositsRouter?: Router;
  extraTestRouter?: (app: Express) => void;
  checkHealth?: () => Promise<{ databaseConnected: boolean; authReachable: boolean }>;
}

export function createApiApp(options?: CreateApiAppOptions): Express {
  const app = express();
  const env = getEnvConfig();
  const trustedProxyHops =
    options?.trustedProxyHops !== undefined ? options.trustedProxyHops : env.trustedProxyHops;
  const appUrl = options?.appUrl !== undefined ? options.appUrl : env.appUrl;
  const isProduction =
    options?.isProduction !== undefined ? options.isProduction : env.isProduction;

  app.set('trust proxy', trustedProxyHops);
  app.use(express.json({ limit: '1mb' }));

  app.use(
    '/api',
    createCsrfProtectionMiddleware({
      getConfig: () => ({ trustedProxyHops, appUrl, isProduction }),
    })
  );

  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      let databaseConnected = false;
      let authReachable = false;

      if (options?.checkHealth) {
        const result = await options.checkHealth();
        databaseConnected = result.databaseConnected;
        authReachable = result.authReachable;
      } else {
        const [dbHealth, authHealth] = await Promise.all([
          testDatabaseConnection(),
          testSupabaseAuthHealth(),
        ]);
        databaseConnected = dbHealth.connected;
        authReachable = authHealth.reachable;
      }

      const healthy = databaseConnected && authReachable;

      res.json({
        ok: true,
        status: healthy ? 'healthy' : 'degraded',
        checks: {
          database: databaseConnected ? 'ok' : 'unavailable',
          auth: authReachable ? 'ok' : 'unavailable',
        },
        timestamp: new Date().toISOString(),
      });
    })
  );

  app.use('/api/auth', options?.authRouter ?? createAuthRouter(options?.authRouterOptions));
  app.use('/api/markets', marketsRoutes);
  app.use('/api/admin/security', securityRoutes);

  const mountedPurchaseOrders =
    options?.purchaseOrdersRouter ??
    (options?.pool || options?.authMiddleware
      ? createPurchaseOrdersRouter({
          pool: options.pool,
          authMiddleware: options.authMiddleware,
          preferDbPrice: options.preferDbPrice,
        })
      : purchaseOrdersRoutes);
  const mountedDeposits =
    options?.depositsRouter ??
    (options?.pool || options?.authMiddleware
      ? createDepositsRouter({
          pool: options.pool,
          authMiddleware: options.authMiddleware,
        })
      : depositsRoutes);

  app.use('/api', mountedPurchaseOrders);
  app.use('/api', mountedDeposits);

  app.get('/api/providers/health', (_req, res) => {
    res.json({
      ok: true,
      providers: INITIAL_PROVIDER_HEALTH,
    });
  });

  app.post(
    '/api/deposits/address',
    requireAuth,
    asyncHandler(async (req, res) => {
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
    })
  );

  app.post(
    '/api/withdrawals/request',
    requireAuth,
    asyncHandler(async (req, res) => {
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
    })
  );

  app.post(
    '/api/withdrawals/:id/approve',
    requireAuth,
    requireRole('super_admin', 'finance_admin'),
    asyncHandler(async (req, res) => {
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
    })
  );

  app.post(
    '/api/orders/market',
    requireAuth,
    asyncHandler(async (req, res) => {
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
    })
  );

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

  if (options?.extraTestRouter) {
    options.extraTestRouter(app);
  }

  app.all('/api/*', (_req, res) => {
    res.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      message: 'API endpoint not found.',
    });
  });

  // Centralized API error handler: sanitizes unexpected errors and malformed JSON payloads
  app.use('/api', (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (
      err instanceof SyntaxError &&
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      (err as { status?: number }).status === 400
    ) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_JSON',
        message: 'Malformed JSON request payload.',
      });
      return;
    }

    console.error(`[API Error] ${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return;
    res.status(500).json({
      ok: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred. Please try again later.',
    });
  });

  return app;
}
