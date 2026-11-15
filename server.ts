import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  INITIAL_PROVIDER_HEALTH,
  unconfiguredCustodyProvider,
  unconfiguredLiquidityProvider,
} from './src/services/providerAdapters';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const ADMIN_APPROVAL_ROLES = new Set(['super_admin', 'finance_admin']);
const ADMIN_READ_ROLES = new Set([
  'super_admin',
  'finance_admin',
  'compliance_admin',
  'support_admin',
]);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      phase: 'A',
      persistence: 'postgresql_blueprint_only',
      providersConfigured: false,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/providers/health', (_req, res) => {
    res.json({
      ok: true,
      phase: 'A',
      providers: INITIAL_PROVIDER_HEALTH,
    });
  });

  app.post('/api/deposits/address', async (req, res) => {
    const { userId, assetSymbol, networkCode } = req.body ?? {};
    if (
      typeof userId !== 'string' ||
      !userId.trim() ||
      typeof assetSymbol !== 'string' ||
      !assetSymbol.trim() ||
      typeof networkCode !== 'string' ||
      !networkCode.trim()
    ) {
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'userId, assetSymbol, and networkCode are required.',
      });
      return;
    }

    const result = await unconfiguredCustodyProvider.getOrCreateDepositAddress({
      userId: userId.trim(),
      assetSymbol: assetSymbol.trim().toUpperCase(),
      networkCode: networkCode.trim().toUpperCase(),
    });

    res.status(503).json(result);
  });

  app.post('/api/withdrawals/request', async (req, res) => {
    const { userId, assetSymbol, networkCode, amount, destinationAddress, twoFactorCode } =
      req.body ?? {};
    const numericAmount = Number(amount);

    if (
      typeof userId !== 'string' ||
      !userId.trim() ||
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
          'Valid userId, assetSymbol, networkCode, positive amount, destinationAddress, and 6-digit 2FA code are required.',
      });
      return;
    }

    res.status(503).json({
      ok: false,
      code: 'PROVIDER_NOT_CONFIGURED',
      message:
        'Database ledger persistence (Phase B) and MPC custody signing (Phase D) must be provisioned before broadcasting real withdrawals.',
    });
  });

  app.post('/api/withdrawals/:id/approve', async (req, res) => {
    const actorRole = String(req.header('x-actor-role') ?? '').trim();
    if (!ADMIN_APPROVAL_ROLES.has(actorRole)) {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        message: 'Super Admin or Finance Admin role is required for withdrawal approval.',
      });
      return;
    }

    const { adminUserId, decision } = req.body ?? {};
    if (
      !req.params.id ||
      typeof adminUserId !== 'string' ||
      !adminUserId.trim() ||
      (decision !== 'approve' && decision !== 'reject')
    ) {
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Withdrawal id, adminUserId, and decision (approve|reject) are required.',
      });
      return;
    }

    res.status(503).json({
      ok: false,
      code: 'PROVIDER_NOT_CONFIGURED',
      message:
        'Withdrawal approval transitions are enforced in Phase B database transactions and dispatched via Phase D custody signers.',
    });
  });

  app.post('/api/orders/market', async (req, res) => {
    const { userId, pairSymbol, side, amount } = req.body ?? {};
    const numericAmount = Number(amount);

    if (
      typeof userId !== 'string' ||
      !userId.trim() ||
      typeof pairSymbol !== 'string' ||
      !pairSymbol.trim() ||
      (side !== 'buy' && side !== 'sell') ||
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Valid userId, pairSymbol, side (buy|sell), and positive amount are required.',
      });
      return;
    }

    const result = await unconfiguredLiquidityProvider.submitMarketOrder({
      clientOrderId: `ord_${Date.now()}`,
      venueSymbol: pairSymbol.trim().toUpperCase(),
      side,
      requestedAmount: numericAmount,
    });

    res.status(503).json(result);
  });

  app.post('/api/admin/reconcile', (req, res) => {
    const actorRole = String(req.header('x-actor-role') ?? '').trim();
    if (!ADMIN_READ_ROLES.has(actorRole)) {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        message: 'Administrative operator role is required to trigger balance reconciliation.',
      });
      return;
    }

    res.status(503).json({
      ok: false,
      code: 'PROVIDER_NOT_CONFIGURED',
      message:
        'Database ledger and external custody vault reconciliation requires Phase B database and Phase D custody provisioning.',
    });
  });

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
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
