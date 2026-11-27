import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import { createPurchaseOrdersRouter } from './routes/purchaseOrders';
import {
  createDisposablePool,
  resetDisposableDatabase,
  seedTestExchangeFixtures,
  TEST_FIXTURE_IDS,
} from './testDbHarness';
import { validateDisposableTestUrl } from './verifyPostgresRuntime';
import type { AccountStatus, AppRole, KycStatus, ManualPurchaseOrder, ReceivingAddress } from '../src/types/domain';

test('Test DB safety guard strictly rejects production, Supabase, default port 5432, and query overrides', () => {
  assert.throws(() => validateDisposableTestUrl(undefined), /TEST_DATABASE_URL is required/);
  assert.throws(
    () => validateDisposableTestUrl('postgresql://postgres:secret@db.proj.supabase.co:5432/postgres'),
    /hosted\/production/
  );
  assert.throws(
    () => validateDisposableTestUrl('postgresql://user:pass@127.0.0.1:5432/exchange_verify_disposable'),
    /unapproved PostgreSQL port 5432/
  );
  assert.throws(
    () => validateDisposableTestUrl('postgresql://user:pass@127.0.0.1:55432/production_db'),
    /unapproved database name/
  );
  assert.throws(
    () => validateDisposableTestUrl('postgresql://user:pass@127.0.0.1:55432/exchange_verify_disposable?sslmode=require'),
    /query parameters/
  );
});

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL?.trim());

test(
  'Live PostgreSQL 16 Phase 2.4 & 2.5 financial workflow integrity, concurrency, RBAC, and atomicity',
  { skip: hasTestDb ? false : 'TEST_DATABASE_URL not set; skipping live PostgreSQL integration test' },
  async (t) => {
    const { pool } = createDisposablePool();
    await resetDisposableDatabase(pool);
    await seedTestExchangeFixtures(pool);

    // Express auth middleware backed directly by disposable PG profiles + user_roles
    const pgAuthMiddleware: RequestHandler = async (req, res, next) => {
      const uid = req.header('x-user-id');
      if (!uid) {
        res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: 'Missing x-user-id header.' });
        return;
      }
      const pRes = await pool.query<{
        id: string;
        public_user_id: string;
        email: string;
        full_name: string;
        account_status: AccountStatus;
        kyc_status: KycStatus;
        preferred_language: string;
        created_at: string;
      }>(
        `SELECT id, public_user_id, email, full_name, account_status, kyc_status, preferred_language, created_at::text
         FROM public.profiles WHERE id = $1 LIMIT 1`,
        [uid]
      );
      if (pRes.rows.length === 0) {
        res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: 'Unknown test user.' });
        return;
      }
      const rolesRes = await pool.query<{ role: AppRole }>(
        `SELECT role FROM public.user_roles WHERE user_id = $1`,
        [uid]
      );
      const roleOrder: AppRole[] = ['super_admin', 'finance_admin', 'operations_admin', 'compliance_admin', 'customer'];
      const assigned = new Set(rolesRes.rows.map((r) => r.role));
      const requestedRole = req.header('x-user-role') as AppRole | undefined;
      const effectiveRole =
        requestedRole && assigned.has(requestedRole)
          ? requestedRole
          : roleOrder.find((r) => assigned.has(r)) ?? 'customer';

      const p = pRes.rows[0];
      req.auth = {
        userId: p.id,
        publicUserId: p.public_user_id,
        email: p.email,
        fullName: p.full_name,
        phone: null,
        twoFactorEnabled: false,
        role: effectiveRole,
        accountStatus: p.account_status,
        kycStatus: p.kyc_status,
        preferredLanguage: p.preferred_language,
        createdAt: p.created_at,
        accessToken: 'pg-test-token',
      };
      next();
    };

    const app = express();
    app.use(express.json());
    app.use('/api', createPurchaseOrdersRouter({ authMiddleware: pgAuthMiddleware, pool, preferDbPrice: true }));
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('Unhandled test router error:', err);
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: (err as Error).message });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}/api`;

    async function api<T = unknown>(
      method: string,
      path: string,
      opts?: { userId?: string; role?: AppRole; body?: unknown }
    ) {
      const headers: Record<string, string> = {};
      if (opts?.userId) headers['x-user-id'] = opts.userId;
      if (opts?.role) headers['x-user-role'] = opts.role;
      if (opts?.body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const json = (await response.json()) as { ok: boolean; code?: string; data?: T; message?: string };
      return { status: response.status, body: json };
    }

    const DEPOSIT_TX_HASH = '0xPGDepositCreditedHash1111111111111111';

    try {
      await t.test('Phase 2.4 deposits: atomic ledger credit, idempotency, duplicate tx_hash, closed-account rejection', async () => {
        const depId = crypto.randomUUID();
        const txId = crypto.randomUUID();

        // Insert pending verified deposit for customerApproved
        await pool.query(
          `INSERT INTO public.deposits (
             id, user_id, asset_symbol, network_code, deposit_address, tx_hash, amount,
             confirmations, required_confirmations, address_verified, network_verified,
             amount_verified, duplicate_checked, kyt_status, status
           ) VALUES (
             $1, $2, 'USDT', 'TRC-20', 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL', $3, 500,
             20, 20, TRUE, TRUE, TRUE, TRUE, 'passed', 'PENDING_ADMIN_REVIEW'
           )`,
          [depId, TEST_FIXTURE_IDS.customerApproved, DEPOSIT_TX_HASH]
        );

        // Execute atomic deposit approval & ledger credit
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT public.acquire_user_account_lock($1)', [TEST_FIXTURE_IDS.customerApproved]);
          const balRes = await client.query<{ available: string }>(
            `UPDATE public.wallet_balances
             SET available = available + 500, updated_at = NOW()
             WHERE user_id = $1 AND asset_symbol = 'USDT'
             RETURNING available::text`,
            [TEST_FIXTURE_IDS.customerApproved]
          );
          const nextBal = Number(balRes.rows[0].available);
          await client.query(
            `INSERT INTO public.ledger_transactions (id, user_id, type, reference_id, idempotency_key, source_account, reason_code, summary)
             VALUES ($1, $2, 'deposit_credit', $3, $4, 'custody_deposit_TRC-20', 'ONCHAIN_DEPOSIT_VERIFIED', 'PG integration deposit credit')`,
            [txId, TEST_FIXTURE_IDS.customerApproved, depId, `dep-approve-${depId}`]
          );
          await client.query(
            `INSERT INTO public.ledger_entries (transaction_id, user_id, asset_symbol, bucket, delta_amount, balance_after, entry_role)
             VALUES ($1, $2, 'USDT', 'available', 500, $3, 'credit_verified_deposit')`,
            [txId, TEST_FIXTURE_IDS.customerApproved, nextBal]
          );
          await client.query(
            `UPDATE public.deposits
             SET status = 'CREDITED', credited_tx_id = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [depId, txId, TEST_FIXTURE_IDS.financeAdmin]
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }

        // Duplicate idempotency key fails (23505)
        await assert.rejects(
          () =>
            pool.query(
              `INSERT INTO public.ledger_transactions (user_id, type, reference_id, idempotency_key, summary)
               VALUES ($1, 'deposit_credit', $2, $3, 'Duplicate test')`,
              [TEST_FIXTURE_IDS.customerApproved, depId, `dep-approve-${depId}`]
            ),
          (err: { code?: string }) => err.code === '23505'
        );

        // Duplicate (network_code, tx_hash) blocked on deposits table (23505)
        await assert.rejects(
          () =>
            pool.query(
              `INSERT INTO public.deposits (
                 user_id, asset_symbol, network_code, deposit_address, tx_hash, amount,
                 confirmations, required_confirmations, status
               ) VALUES (
                 $1, 'USDT', 'TRC-20', 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL', $2, 100,
                 20, 20, 'PENDING_ADMIN_REVIEW'
               )`,
              [TEST_FIXTURE_IDS.customerApproved2, DEPOSIT_TX_HASH]
            ),
          (err: { code?: string }) => err.code === '23505'
        );

        // Closed account cannot receive deposit records (P0001)
        await assert.rejects(
          () =>
            pool.query(
              `INSERT INTO public.deposits (
                 user_id, asset_symbol, network_code, deposit_address, tx_hash, amount,
                 confirmations, required_confirmations, status
               ) VALUES (
                 $1, 'USDT', 'TRC-20', 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL', '0xClosedAcctDeposit123456', 100,
                 20, 20, 'PENDING_ADMIN_REVIEW'
               )`,
              [TEST_FIXTURE_IDS.customerClosed]
            ),
          (err: { code?: string; message?: string }) =>
            err.code === 'P0001' && /closed account/i.test(err.message ?? '')
        );
      });

      await t.test('Phase 2.5 receiving addresses: network regex, memo check, audit hydration, disable & duplicate 409', async () => {
        // Invalid TRC-20 address format rejected (400)
        const badAddr = await api('POST', '/admin/purchase-orders/receiving-addresses', {
          userId: TEST_FIXTURE_IDS.superAdmin,
          body: {
            assetSymbol: 'USDT',
            networkCode: 'TRC-20',
            address: 'not-a-tron-address',
            label: 'Bad Address',
          },
        });
        assert.equal(badAddr.status, 400);

        // XRP without required memo/tag rejected (400)
        const xrpNoMemo = await api('POST', '/admin/purchase-orders/receiving-addresses', {
          userId: TEST_FIXTURE_IDS.superAdmin,
          body: {
            assetSymbol: 'XRP',
            networkCode: 'XRP',
            address: 'rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv',
            label: 'XRP Missing Memo',
          },
        });
        assert.equal(xrpNoMemo.status, 400);

        // Duplicate active TRC-20 address rejected (409)
        const dupAddr = await api('POST', '/admin/purchase-orders/receiving-addresses', {
          userId: TEST_FIXTURE_IDS.superAdmin,
          body: {
            assetSymbol: 'USDT',
            networkCode: 'TRC-20',
            address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
            label: 'Duplicate TRC-20',
          },
        });
        assert.equal(dupAddr.status, 409);

        // Hydrated receiving addresses include assignedByLabel and auditHistory
        const listRes = await api<ReceivingAddress[]>('GET', '/admin/purchase-orders/receiving-addresses', {
          userId: TEST_FIXTURE_IDS.operationsAdmin,
        });
        assert.equal(listRes.status, 200);
        const trc = listRes.body.data!.find((a) => a.id === TEST_FIXTURE_IDS.receivingAddressUsdtTrc20);
        assert.equal(trc?.assignedByLabel, 'Test Super Admin');
        assert.ok((trc?.auditHistory.length ?? 0) >= 1);
      });

      await t.test('Phase 2.5 order creation, KYC/closed checks, malformed ID 404, ownership isolation, and cancellation', async () => {
        // Malformed UUID id returns clean 404 instead of 500
        const malformedPay = await api('POST', '/purchase-orders/not-a-uuid/payment', {
          userId: TEST_FIXTURE_IDS.customerApproved,
          body: { paymentTxHash: '0xValidHash123456', actualAmountSent: 100 },
        });
        assert.equal(malformedPay.status, 404);

        // Pending KYC user blocked (400)
        const kycRes = await api('POST', '/purchase-orders', {
          userId: TEST_FIXTURE_IDS.customerKycPending,
          body: {
            pairSymbol: 'BTC/USDT',
            orderType: 'MARKET',
            requestedQuoteAmount: 1000,
            receivingAddressId: TEST_FIXTURE_IDS.receivingAddressUsdtTrc20,
          },
        });
        assert.equal(kycRes.status, 400);
        assert.match(kycRes.body.message ?? '', /KYC/i);

        // Closed customer blocked (400)
        const closedRes = await api('POST', '/purchase-orders', {
          userId: TEST_FIXTURE_IDS.customerClosed,
          body: {
            pairSymbol: 'BTC/USDT',
            orderType: 'MARKET',
            requestedQuoteAmount: 1000,
            receivingAddressId: TEST_FIXTURE_IDS.receivingAddressUsdtTrc20,
          },
        });
        assert.equal(closedRes.status, 400);

        // Create and cancel an order cleanly
        const limitCreate = await api<ManualPurchaseOrder>('POST', '/purchase-orders', {
          userId: TEST_FIXTURE_IDS.customerApproved,
          body: {
            pairSymbol: 'ETH/USDT',
            orderType: 'LIMIT',
            requestedQuoteAmount: 640,
            limitPrice: 3200,
            receivingAddressId: TEST_FIXTURE_IDS.receivingAddressUsdtErc20,
          },
        });
        assert.equal(limitCreate.status, 201);
        const cancelOrderId = limitCreate.body.data!.id;

        // Customer 2 cannot cancel or submit payment for Customer 1's order (404)
        const otherCancel = await api('POST', `/purchase-orders/${cancelOrderId}/cancel`, {
          userId: TEST_FIXTURE_IDS.customerApproved2,
          body: { reason: 'Hijack attempt' },
        });
        assert.equal(otherCancel.status, 404);

        const ownCancel = await api<ManualPurchaseOrder>('POST', `/purchase-orders/${cancelOrderId}/cancel`, {
          userId: TEST_FIXTURE_IDS.customerApproved,
          body: { reason: 'Changed mind' },
        });
        assert.equal(ownCancel.status, 200);
        assert.equal(ownCancel.body.data!.status, 'CANCELLED');

        // Payment submission on cancelled order blocked (409)
        const payCancelled = await api('POST', `/purchase-orders/${cancelOrderId}/payment`, {
          userId: TEST_FIXTURE_IDS.customerApproved,
          body: { paymentTxHash: '0xCancelledPayHash123456', actualAmountSent: 640 },
        });
        assert.equal(payCancelled.status, 409);
      });

      await t.test('Phase 2.5 duplicate payment tx_hash (concurrent + cross-deposit), rejected reuse, and concurrent fulfilment atomicity', async () => {
        // Create 3 orders for testing duplicate txHash races, rejection reuse, and concurrent fulfilment
        const o1Res = await api<ManualPurchaseOrder>('POST', '/purchase-orders', {
          userId: TEST_FIXTURE_IDS.customerApproved,
          body: {
            pairSymbol: 'BTC/USDT',
            orderType: 'MARKET',
            requestedQuoteAmount: 1000,
            receivingAddressId: TEST_FIXTURE_IDS.receivingAddressUsdtTrc20,
          },
        });
        const o2Res = await api<ManualPurchaseOrder>('POST', '/purchase-orders', {
          userId: TEST_FIXTURE_IDS.customerApproved2,
          body: {
            pairSymbol: 'BTC/USDT',
            orderType: 'MARKET',
            requestedQuoteAmount: 1000,
            receivingAddressId: TEST_FIXTURE_IDS.receivingAddressUsdtTrc20,
          },
        });
        assert.equal(o1Res.status, 201);
        assert.equal(o2Res.status, 201);
        const order1 = o1Res.body.data!;
        const order2 = o2Res.body.data!;

        // Server-side seeded market_prices.pair_symbol ('BTC/USDT' = 90000) used cleanly
        assert.equal(order1.referencePrice, 90000);
        assert.equal(order1.estimatedFeeUsdt, 1);
        assert.equal(order1.estimatedCryptoAmount, 0.0111);

        // Reusing an already-credited deposit tx_hash on TRC-20 must fail cleanly with 409 Conflict
        const depCollision = await api('POST', `/purchase-orders/${order1.id}/payment`, {
          userId: TEST_FIXTURE_IDS.customerApproved,
          body: { paymentTxHash: DEPOSIT_TX_HASH, actualAmountSent: 1000 },
        });
        assert.equal(depCollision.status, 409);
        assert.match(depCollision.body.message ?? '', /already been submitted/i);

        // Concurrent Promise.all duplicate payment_tx_hash submission across order1 & order2
        const SHARED_HASH = 'TRX_CONCURRENT_DUP_HASH_99887766';
        const [pay1, pay2] = await Promise.all([
          api<ManualPurchaseOrder>('POST', `/purchase-orders/${order1.id}/payment`, {
            userId: TEST_FIXTURE_IDS.customerApproved,
            body: { paymentTxHash: SHARED_HASH, actualAmountSent: 1000 },
          }),
          api<ManualPurchaseOrder>('POST', `/purchase-orders/${order2.id}/payment`, {
            userId: TEST_FIXTURE_IDS.customerApproved2,
            body: { paymentTxHash: SHARED_HASH.toLowerCase(), actualAmountSent: 1000 },
          }),
        ]);
        const payStatuses = [pay1.status, pay2.status].sort((a, b) => a - b);
        assert.deepEqual(payStatuses, [200, 409]);

        const winningOrder = pay1.status === 200 ? order1 : order2;
        const winningOwner =
          winningOrder.id === order1.id
            ? TEST_FIXTURE_IDS.customerApproved
            : TEST_FIXTURE_IDS.customerApproved2;
        const otherOrder = winningOrder.id === order1.id ? order2 : order1;
        const otherOwner =
          otherOrder.id === order1.id
            ? TEST_FIXTURE_IDS.customerApproved
            : TEST_FIXTURE_IDS.customerApproved2;

        // Resubmitting or tampering with already-submitted payment details is blocked (409)
        const resubmit = await api('POST', `/purchase-orders/${winningOrder.id}/payment`, {
          userId: winningOwner,
          body: { paymentTxHash: 'TRX_TAMPERED_HASH_0000000', actualAmountSent: 1000 },
        });
        assert.equal(resubmit.status, 409);

        // Invalid transition PAYMENT_SUBMITTED -> APPROVED rejected (409)
        const skipReview = await api('POST', `/admin/purchase-orders/${winningOrder.id}/review`, {
          userId: TEST_FIXTURE_IDS.complianceAdmin,
          body: {
            targetStatus: 'APPROVED',
            checklist: {
              txHashChecked: true,
              addressMatched: true,
              networkMatched: true,
              amountVerified: true,
              duplicateClear: true,
            },
          },
        });
        assert.equal(skipReview.status, 409);

        // Move winningOrder to UNDER_REVIEW -> REJECTED without reason fails (400) -> REJECTED with reason succeeds
        const underRev = await api('POST', `/admin/purchase-orders/${winningOrder.id}/review`, {
          userId: TEST_FIXTURE_IDS.operationsAdmin,
          body: { targetStatus: 'UNDER_REVIEW' },
        });
        assert.equal(underRev.status, 200);

        const rejNoReason = await api('POST', `/admin/purchase-orders/${winningOrder.id}/review`, {
          userId: TEST_FIXTURE_IDS.complianceAdmin,
          body: { targetStatus: 'REJECTED', rejectionReason: '  ' },
        });
        assert.equal(rejNoReason.status, 400);

        const rejected = await api<ManualPurchaseOrder>('POST', `/admin/purchase-orders/${winningOrder.id}/review`, {
          userId: TEST_FIXTURE_IDS.complianceAdmin,
          body: { targetStatus: 'REJECTED', rejectionReason: 'Counterparty mismatch during verification' },
        });
        assert.equal(rejected.status, 200);
        assert.equal(rejected.body.data!.status, 'REJECTED');

        // Rejected order leaves BTC balance untouched (0) AND releases tx_hash for legitimate order
        const btcBalBefore = await pool.query<{ available: string }>(
          `SELECT available::text FROM public.wallet_balances WHERE user_id = $1 AND asset_symbol = 'BTC'`,
          [winningOwner]
        );
        assert.equal(Number(btcBalBefore.rows[0].available), 0);

        const reusePay = await api<ManualPurchaseOrder>('POST', `/purchase-orders/${otherOrder.id}/payment`, {
          userId: otherOwner,
          body: { paymentTxHash: SHARED_HASH, actualAmountSent: 1000 },
        });
        assert.equal(reusePay.status, 200);

        // Advance otherOrder: UNDER_REVIEW -> incomplete checklist blocked (400) -> APPROVED (200)
        assert.equal(
          (
            await api('POST', `/admin/purchase-orders/${otherOrder.id}/review`, {
              userId: TEST_FIXTURE_IDS.operationsAdmin,
              body: { targetStatus: 'UNDER_REVIEW' },
            })
          ).status,
          200
        );
        assert.equal(
          (
            await api('POST', `/admin/purchase-orders/${otherOrder.id}/review`, {
              userId: TEST_FIXTURE_IDS.complianceAdmin,
              body: { targetStatus: 'APPROVED', checklist: { txHashChecked: true } },
            })
          ).status,
          400
        );
        const approvedRes = await api<ManualPurchaseOrder>('POST', `/admin/purchase-orders/${otherOrder.id}/review`, {
          userId: TEST_FIXTURE_IDS.complianceAdmin,
          body: {
            targetStatus: 'APPROVED',
            checklist: {
              txHashChecked: true,
              addressMatched: true,
              networkMatched: true,
              amountVerified: true,
              duplicateClear: true,
            },
            adminRemark: 'All 5 checks verified in PG integration test',
          },
        });
        assert.equal(approvedRes.status, 200);

        // RBAC enforcement: operations_admin and compliance_admin get 403 on fulfilment
        assert.equal(
          (
            await api('POST', `/admin/purchase-orders/${otherOrder.id}/fulfil`, {
              userId: TEST_FIXTURE_IDS.operationsAdmin,
              body: {},
            })
          ).status,
          403
        );
        assert.equal(
          (
            await api('POST', `/admin/purchase-orders/${otherOrder.id}/fulfil`, {
              userId: TEST_FIXTURE_IDS.complianceAdmin,
              body: {},
            })
          ).status,
          403
        );

        // Account closure lock: customer cannot be closed while manual purchase order is APPROVED/in-flight
        await assert.rejects(
          () => pool.query(`SELECT public.close_customer_account($1, FALSE)`, [otherOwner]),
          (err: { code?: string; message?: string }) =>
            err.code === 'P0001' && /unresolved manual purchase orders remain/.test(err.message ?? '')
        );

        // CONCURRENT FULFILMENT RACE: fire two simultaneous requests (finance_admin + super_admin)
        const [f1, f2] = await Promise.all([
          api<ManualPurchaseOrder>('POST', `/admin/purchase-orders/${otherOrder.id}/fulfil`, {
            userId: TEST_FIXTURE_IDS.financeAdmin,
            body: {},
          }),
          api<ManualPurchaseOrder>('POST', `/admin/purchase-orders/${otherOrder.id}/fulfil`, {
            userId: TEST_FIXTURE_IDS.superAdmin,
            body: {},
          }),
        ]);
        const fulfilStatuses = [f1.status, f2.status].sort((a, b) => a - b);
        assert.deepEqual(fulfilStatuses, [200, 409]);

        const wonFulfil = f1.status === 200 ? f1.body.data! : f2.body.data!;
        assert.equal(wonFulfil.status, 'COMPLETED');
        assert.ok(wonFulfil.creditedTxId);

        // Verify exact database state: 1 ledger_transaction, 1 ledger_entry, exact BTC balance delta
        const ltxRes = await pool.query<{ id: string }>(
          `SELECT id FROM public.ledger_transactions WHERE idempotency_key = $1`,
          [`mpo-fulfil-${otherOrder.id}`]
        );
        assert.equal(ltxRes.rows.length, 1);

        const leRes = await pool.query<{ delta_amount: string; balance_after: string }>(
          `SELECT delta_amount::text, balance_after::text
           FROM public.ledger_entries
           WHERE transaction_id = $1`,
          [ltxRes.rows[0].id]
        );
        assert.equal(leRes.rows.length, 1);
        assert.equal(Number(leRes.rows[0].delta_amount), 0.0111);
        assert.equal(Number(leRes.rows[0].balance_after), 0.0111);

        const finalBtcBal = await pool.query<{ available: string }>(
          `SELECT available::text FROM public.wallet_balances WHERE user_id = $1 AND asset_symbol = 'BTC'`,
          [otherOwner]
        );
        assert.equal(Number(finalBtcBal.rows[0].available), 0.0111);

        const eventsRes = await pool.query<{ to_status: string }>(
          `SELECT to_status FROM public.manual_purchase_order_events WHERE order_id = $1 ORDER BY created_at ASC`,
          [otherOrder.id]
        );
        assert.deepEqual(
          eventsRes.rows.map((r) => r.to_status),
          ['PENDING_PAYMENT', 'PAYMENT_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'COMPLETED']
        );
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err?: Error) => (err ? reject(err) : resolve()))
      );
      await pool.end();
    }
  }
);
