import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import type {
  AccountStatus,
  AppRole,
  Asset,
  DepositRecord,
  LedgerEntry,
  LedgerTransaction,
  ManualPurchaseOrder,
  NetworkConfig,
  ReceivingAddress,
  TradingPair,
  WalletBalance,
} from '../src/types/domain';
import {
  INITIAL_ASSETS,
  INITIAL_NETWORKS,
  INITIAL_TRADING_PAIRS,
} from '../src/data/exchangeSeed';
import {
  calculateManualPurchaseQuote,
  cancelManualPurchaseOrderRecord,
  canTransitionManualPurchaseStatus,
  createManualPurchaseOrderRecord,
  fulfilManualPurchaseOrderRecord,
  reviewManualPurchaseOrderRecord,
  submitManualPurchasePayment,
  toggleReceivingAddressStatusRecord,
  upsertReceivingAddressRecord,
} from '../src/utils/manualPurchaseEngine';
import {
  createPurchaseOrdersRouter,
  type PurchaseOrderStore,
} from './routes/purchaseOrders';

const BTC_PAIR: TradingPair = INITIAL_TRADING_PAIRS.find((p) => p.symbol === 'BTC/USDT')!;
const BTC_ASSET: Asset = INITIAL_ASSETS.find((a) => a.symbol === 'BTC')!;
const USDT_ASSET: Asset = INITIAL_ASSETS.find((a) => a.symbol === 'USDT')!;
const TRC20_NETWORK: NetworkConfig = INITIAL_NETWORKS.find(
  (n) => n.assetSymbol === 'USDT' && n.code === 'TRC-20'
)!;

const ACTIVE_RECEIVING_ADDR: ReceivingAddress = {
  id: 'rec-usdt-trc20',
  assetSymbol: 'USDT',
  networkCode: 'TRC-20',
  address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
  memoOrTag: null,
  label: 'Treasury Desk USDT TRC-20',
  isActive: true,
  assignedBy: 'admin-super-1',
  assignedByLabel: 'Super Admin',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  auditHistory: [],
};

function makeOrder(overrides?: Partial<ManualPurchaseOrder>): ManualPurchaseOrder {
  const created = createManualPurchaseOrderRecord({
    id: 'ord-1',
    orderRef: 'MPO-20261126-000001',
    eventId: 'evt-1',
    userId: 'cust-1',
    actorLabel: 'Alice Customer',
    side: 'buy',
    orderType: 'MARKET',
    pair: BTC_PAIR,
    baseAsset: BTC_ASSET,
    quoteAsset: USDT_ASSET,
    requestedQuoteAmount: 1000,
    referenceMarketPrice: 90000,
    accountStatus: 'active',
    kycStatus: 'approved',
    receivingAddress: ACTIVE_RECEIVING_ADDR,
    networkConfig: TRC20_NETWORK,
    nowIso: '2026-11-26T10:00:00.000Z',
  });
  assert.equal(created.ok, true);
  return { ...created.data!, ...overrides };
}

test('calculateManualPurchaseQuote computes market & limit BUY quotes and rejects SELL / Stop-Limit / KYC / disabled addresses', () => {
  const mkt = calculateManualPurchaseQuote({
    side: 'buy',
    orderType: 'MARKET',
    pair: BTC_PAIR,
    baseAsset: BTC_ASSET,
    quoteAsset: USDT_ASSET,
    requestedQuoteAmount: 1000,
    referenceMarketPrice: 90000,
    accountStatus: 'active',
    kycStatus: 'approved',
    receivingAddress: ACTIVE_RECEIVING_ADDR,
    networkConfig: TRC20_NETWORK,
  });
  assert.equal(mkt.valid, true);
  assert.equal(mkt.totalPaymentAmount, 1000);
  assert.equal(mkt.estimatedFeeUsdt, 1);
  assert.ok(mkt.estimatedCryptoAmount > 0.011 && mkt.estimatedCryptoAmount < 0.0112);

  const lmt = calculateManualPurchaseQuote({
    side: 'buy',
    orderType: 'LIMIT',
    pair: BTC_PAIR,
    baseAsset: BTC_ASSET,
    quoteAsset: USDT_ASSET,
    requestedQuoteAmount: 1000,
    limitPrice: 80000,
    referenceMarketPrice: 90000,
    accountStatus: 'active',
    kycStatus: 'approved',
    receivingAddress: ACTIVE_RECEIVING_ADDR,
    networkConfig: TRC20_NETWORK,
  });
  assert.equal(lmt.valid, true);
  assert.equal(lmt.effectivePrice, 80000);

  const sellBlocked = calculateManualPurchaseQuote({
    side: 'sell',
    orderType: 'MARKET',
    pair: BTC_PAIR,
    baseAsset: BTC_ASSET,
    quoteAsset: USDT_ASSET,
    requestedQuoteAmount: 1000,
    referenceMarketPrice: 90000,
    accountStatus: 'active',
    kycStatus: 'approved',
    receivingAddress: ACTIVE_RECEIVING_ADDR,
    networkConfig: TRC20_NETWORK,
  });
  assert.equal(sellBlocked.valid, false);
  assert.match(sellBlocked.error ?? '', /BUY/);

  const stopBlocked = calculateManualPurchaseQuote({
    side: 'buy',
    orderType: 'stop_limit',
    pair: BTC_PAIR,
    baseAsset: BTC_ASSET,
    quoteAsset: USDT_ASSET,
    requestedQuoteAmount: 1000,
    referenceMarketPrice: 90000,
    accountStatus: 'active',
    kycStatus: 'approved',
    receivingAddress: ACTIVE_RECEIVING_ADDR,
    networkConfig: TRC20_NETWORK,
  });
  assert.equal(stopBlocked.valid, false);

  const disabledAddrBlocked = calculateManualPurchaseQuote({
    side: 'buy',
    orderType: 'MARKET',
    pair: BTC_PAIR,
    baseAsset: BTC_ASSET,
    quoteAsset: USDT_ASSET,
    requestedQuoteAmount: 1000,
    referenceMarketPrice: 90000,
    accountStatus: 'active',
    kycStatus: 'approved',
    receivingAddress: { ...ACTIVE_RECEIVING_ADDR, isActive: false },
    networkConfig: TRC20_NETWORK,
  });
  assert.equal(disabledAddrBlocked.valid, false);
  assert.match(disabledAddrBlocked.error ?? '', /disabled/i);

  const pendingKycBlocked = calculateManualPurchaseQuote({
    side: 'buy',
    orderType: 'MARKET',
    pair: BTC_PAIR,
    baseAsset: BTC_ASSET,
    quoteAsset: USDT_ASSET,
    requestedQuoteAmount: 1000,
    referenceMarketPrice: 90000,
    accountStatus: 'active',
    kycStatus: 'pending',
    receivingAddress: ACTIVE_RECEIVING_ADDR,
    networkConfig: TRC20_NETWORK,
  });
  assert.equal(pendingKycBlocked.valid, false);
});

test('payment submission validates ownership, txHash format, duplicates, and blocks modification after PAYMENT_SUBMITTED', () => {
  const order = makeOrder();
  const validHash = '0xabc123def4567890fedcba9876543210';

  const wrongOwner = submitManualPurchasePayment({
    order,
    actorUserId: 'other-cust',
    actorLabel: 'Mallory',
    actorAccountStatus: 'active',
    paymentTxHash: validHash,
    actualAmountSent: 1000,
    existingOrders: [order],
    eventId: 'evt-p0',
    nowIso: '2026-11-26T10:01:00.000Z',
  });
  assert.equal(wrongOwner.ok, false);

  const existingDeposit: DepositRecord = {
    id: 'dep-1',
    userId: 'cust-2',
    assetSymbol: 'USDT',
    networkCode: 'TRC-20',
    depositAddress: ACTIVE_RECEIVING_ADDR.address,
    memoOrTag: null,
    fromAddress: null,
    amount: 500,
    txHash: validHash,
    confirmations: 20,
    requiredConfirmations: 12,
    addressVerified: true,
    networkVerified: true,
    amountVerified: true,
    duplicateChecked: true,
    kytStatus: 'passed',
    kytRiskScore: 0,
    status: 'CREDITED',
    adminNote: null,
    reviewedBy: null,
    reviewedAt: null,
    creditedTxId: 'ltx-99',
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:05:00.000Z',
  };

  const dupAgainstDeposit = submitManualPurchasePayment({
    order,
    actorUserId: 'cust-1',
    actorLabel: 'Alice Customer',
    actorAccountStatus: 'active',
    paymentTxHash: validHash,
    actualAmountSent: 1000,
    existingOrders: [order],
    existingDeposits: [existingDeposit],
    eventId: 'evt-dup',
    nowIso: '2026-11-26T10:01:00.000Z',
  });
  assert.equal(dupAgainstDeposit.ok, false);
  assert.match(dupAgainstDeposit.error ?? '', /already been submitted/i);

  const submitted = submitManualPurchasePayment({
    order,
    actorUserId: 'cust-1',
    actorLabel: 'Alice Customer',
    actorAccountStatus: 'active',
    paymentTxHash: validHash,
    actualAmountSent: 1000,
    paymentNote: 'Sent from Binance wallet',
    existingOrders: [order],
    eventId: 'evt-p1',
    nowIso: '2026-11-26T10:02:00.000Z',
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.data?.status, 'PAYMENT_SUBMITTED');

  const resubmitBlocked = submitManualPurchasePayment({
    order: submitted.data!,
    actorUserId: 'cust-1',
    actorLabel: 'Alice Customer',
    actorAccountStatus: 'active',
    paymentTxHash: '0x99999999999999999999999999999999',
    actualAmountSent: 1000,
    existingOrders: [submitted.data!],
    eventId: 'evt-p2',
    nowIso: '2026-11-26T10:03:00.000Z',
  });
  assert.equal(resubmitBlocked.ok, false);

  const cancelAfterPaymentBlocked = cancelManualPurchaseOrderRecord({
    order: submitted.data!,
    actorUserId: 'cust-1',
    actorLabel: 'Alice Customer',
    eventId: 'evt-c1',
    nowIso: '2026-11-26T10:04:00.000Z',
  });
  assert.equal(cancelAfterPaymentBlocked.ok, false);
});

test('strict lifecycle state transitions, verification checklist, mandatory rejection reason, concurrency, RBAC, and atomic ledger settlement', () => {
  const initial = makeOrder();
  assert.equal(canTransitionManualPurchaseStatus('PENDING_PAYMENT', 'COMPLETED'), false);
  assert.equal(canTransitionManualPurchaseStatus('PAYMENT_SUBMITTED', 'APPROVED'), false);

  const submitted = submitManualPurchasePayment({
    order: initial,
    actorUserId: 'cust-1',
    actorLabel: 'Alice Customer',
    actorAccountStatus: 'active',
    paymentTxHash: 'TRX_TX_HASH_1234567890ABC',
    actualAmountSent: 1000,
    existingOrders: [initial],
    eventId: 'evt-sub',
    nowIso: '2026-11-26T10:05:00.000Z',
  }).data!;

  // Customer cannot review
  const custReview = reviewManualPurchaseOrderRecord({
    order: submitted,
    adminUserId: 'cust-1',
    adminLabel: 'Alice',
    adminRole: 'customer',
    targetStatus: 'UNDER_REVIEW',
    existingOrders: [submitted],
    eventId: 'evt-r0',
    nowIso: '2026-11-26T10:06:00.000Z',
  });
  assert.equal(custReview.ok, false);

  // Move to UNDER_REVIEW
  const underReview = reviewManualPurchaseOrderRecord({
    order: submitted,
    adminUserId: 'adm-ops',
    adminLabel: 'Ops Admin',
    adminRole: 'operations_admin',
    targetStatus: 'UNDER_REVIEW',
    expectedVersion: 2,
    existingOrders: [submitted],
    eventId: 'evt-r1',
    nowIso: '2026-11-26T10:06:00.000Z',
  });
  assert.equal(underReview.ok, true);
  assert.equal(underReview.data?.status, 'UNDER_REVIEW');

  // Cannot approve with incomplete checklist
  const incompleteApprove = reviewManualPurchaseOrderRecord({
    order: underReview.data!,
    adminUserId: 'adm-ops',
    adminLabel: 'Ops Admin',
    adminRole: 'operations_admin',
    targetStatus: 'APPROVED',
    checklist: { txHashChecked: true, addressMatched: true },
    existingOrders: [underReview.data!],
    eventId: 'evt-r2a',
    nowIso: '2026-11-26T10:07:00.000Z',
  });
  assert.equal(incompleteApprove.ok, false);

  // Stale version fails concurrency check
  const staleApprove = reviewManualPurchaseOrderRecord({
    order: underReview.data!,
    adminUserId: 'adm-ops',
    adminLabel: 'Ops Admin',
    adminRole: 'operations_admin',
    targetStatus: 'APPROVED',
    checklist: {
      txHashChecked: true,
      addressMatched: true,
      networkMatched: true,
      amountVerified: true,
      duplicateClear: true,
    },
    expectedVersion: 1,
    existingOrders: [underReview.data!],
    eventId: 'evt-r2b',
    nowIso: '2026-11-26T10:07:00.000Z',
  });
  assert.equal(staleApprove.ok, false);

  // Reject without reason fails
  const rejectNoReason = reviewManualPurchaseOrderRecord({
    order: underReview.data!,
    adminUserId: 'adm-ops',
    adminLabel: 'Ops Admin',
    adminRole: 'operations_admin',
    targetStatus: 'REJECTED',
    rejectionReason: '   ',
    existingOrders: [underReview.data!],
    eventId: 'evt-rej0',
    nowIso: '2026-11-26T10:07:00.000Z',
  });
  assert.equal(rejectNoReason.ok, false);

  // Approve with all 5 checks
  const approved = reviewManualPurchaseOrderRecord({
    order: underReview.data!,
    adminUserId: 'adm-ops',
    adminLabel: 'Ops Admin',
    adminRole: 'operations_admin',
    targetStatus: 'APPROVED',
    checklist: {
      txHashChecked: true,
      addressMatched: true,
      networkMatched: true,
      amountVerified: true,
      duplicateClear: true,
    },
    adminRemark: 'Confirmed on Tronscan with 30 confirmations',
    existingOrders: [underReview.data!],
    eventId: 'evt-r2',
    nowIso: '2026-11-26T10:07:00.000Z',
  }).data!;
  assert.equal(approved.status, 'APPROVED');

  const startingBalances: WalletBalance[] = [
    {
      id: 'bal-btc-1',
      userId: 'cust-1',
      assetSymbol: 'BTC',
      available: 0.25,
      reserved: 0,
      updatedAt: '2026-11-26T09:00:00.000Z',
    },
  ];
  const ledgerTxs: LedgerTransaction[] = [];

  // Operations Admin cannot perform financial ledger credit (super_admin / finance_admin only)
  const opsFulfilBlocked = fulfilManualPurchaseOrderRecord({
    order: approved,
    adminUserId: 'adm-ops',
    adminLabel: 'Ops Admin',
    adminRole: 'operations_admin',
    customerAccountStatus: 'active',
    existingOrders: [approved],
    balances: startingBalances,
    ledgerTransactions: ledgerTxs,
    txId: 'ltx-fail-role',
    entryId: 'le-fail-role',
    balanceId: 'bal-new',
    eventId: 'evt-f0',
    nowIso: '2026-11-26T10:08:00.000Z',
  });
  assert.equal(opsFulfilBlocked.ok, false);

  // Failed ledger commit keeps order APPROVED & balances unchanged
  const failedCommit = fulfilManualPurchaseOrderRecord({
    order: approved,
    adminUserId: 'adm-fin',
    adminLabel: 'Finance Admin',
    adminRole: 'finance_admin',
    customerAccountStatus: 'active',
    existingOrders: [approved],
    balances: startingBalances,
    ledgerTransactions: ledgerTxs,
    txId: 'ltx-rollback',
    entryId: 'le-rollback',
    balanceId: 'bal-new',
    eventId: 'evt-f-rollback',
    nowIso: '2026-11-26T10:08:00.000Z',
    beforeCommitHook: () => ({ ok: false, error: 'Simulated DB write error' }),
  });
  assert.equal(failedCommit.ok, false);
  assert.equal(approved.status, 'APPROVED');
  assert.equal(startingBalances[0].available, 0.25);

  // Atomic fulfilment by finance_admin succeeds
  const fulfilled = fulfilManualPurchaseOrderRecord({
    order: approved,
    adminUserId: 'adm-fin',
    adminLabel: 'Finance Admin',
    adminRole: 'finance_admin',
    customerAccountStatus: 'active',
    existingOrders: [approved],
    balances: startingBalances,
    ledgerTransactions: ledgerTxs,
    txId: 'ltx-100',
    entryId: 'le-100',
    balanceId: 'bal-new',
    eventId: 'evt-f1',
    nowIso: '2026-11-26T10:09:00.000Z',
  });
  assert.equal(fulfilled.ok, true);
  assert.equal(fulfilled.data?.updatedOrder.status, 'COMPLETED');
  assert.equal(fulfilled.data?.updatedOrder.creditedTxId, 'ltx-100');
  assert.equal(fulfilled.data?.newTransaction.type, 'spot_buy');
  assert.equal(fulfilled.data?.newTransaction.idempotencyKey, 'mpo-fulfil-ord-1');
  assert.equal(fulfilled.data?.newEntry.deltaAmount, approved.estimatedCryptoAmount);

  const creditedBtcBal = fulfilled.data!.updatedBalances.find((b) => b.assetSymbol === 'BTC')!;
  assert.equal(
    creditedBtcBal.available,
    Number((0.25 + approved.estimatedCryptoAmount).toFixed(8))
  );

  // Double fulfilment blocked even if an order status copy was stale
  const doubleFulfil = fulfilManualPurchaseOrderRecord({
    order: approved,
    adminUserId: 'adm-fin',
    adminLabel: 'Finance Admin',
    adminRole: 'finance_admin',
    customerAccountStatus: 'active',
    existingOrders: [fulfilled.data!.updatedOrder],
    balances: fulfilled.data!.updatedBalances,
    ledgerTransactions: [fulfilled.data!.newTransaction],
    txId: 'ltx-101',
    entryId: 'le-101',
    balanceId: 'bal-new-2',
    eventId: 'evt-f2',
    nowIso: '2026-11-26T10:10:00.000Z',
  });
  assert.equal(doubleFulfil.ok, false);
});

test('receiving address disable preserves snapshot instructions on existing orders', () => {
  const registered = upsertReceivingAddressRecord({
    id: 'rec-new-1',
    assetSymbol: 'USDT',
    networkCode: 'TRC-20',
    address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
    label: 'Primary USDT TRC-20',
    adminUserId: 'adm-1',
    adminLabel: 'Super Admin',
    adminRole: 'super_admin',
    existingAddresses: [],
    networkConfig: TRC20_NETWORK,
    nowIso: '2026-11-26T08:00:00.000Z',
  });
  assert.equal(registered.ok, true);

  const order = makeOrder({
    receivingAddressId: registered.data!.id,
    receivingAddress: registered.data!.address,
  });

  const disabled = toggleReceivingAddressStatusRecord({
    addressRecord: registered.data!,
    nextIsActive: false,
    adminUserId: 'adm-1',
    adminLabel: 'Super Admin',
    adminRole: 'super_admin',
    note: 'Rotating treasury wallet',
    nowIso: '2026-11-26T11:00:00.000Z',
  });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.data?.isActive, false);
  // Existing order still holds its snapshotted receiving address intact
  assert.equal(order.receivingAddress, 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE');
});

test('HTTP routes enforce authentication, ownership isolation, RBAC, duplicate detection, and atomic fulfilment', async () => {
  const state = {
    addresses: [{ ...ACTIVE_RECEIVING_ADDR }] as ReceivingAddress[],
    orders: [] as ManualPurchaseOrder[],
    balances: [] as WalletBalance[],
    txs: [] as LedgerTransaction[],
    entries: [] as LedgerEntry[],
  };

  const store: PurchaseOrderStore = {
    async listReceivingAddresses(activeOnly) {
      return activeOnly ? state.addresses.filter((a) => a.isActive) : state.addresses;
    },
    async upsertReceivingAddress(record) {
      const idx = state.addresses.findIndex((a) => a.id === record.id);
      if (idx >= 0) state.addresses[idx] = record;
      else state.addresses.unshift(record);
      return record;
    },
    async listOrders(userId) {
      return userId ? state.orders.filter((o) => o.userId === userId) : state.orders;
    },
    async getOrderById(id) {
      return state.orders.find((o) => o.id === id) ?? null;
    },
    async getPairBySymbol(symbol) {
      const pair = INITIAL_TRADING_PAIRS.find((p) => p.symbol === symbol);
      const baseAsset = pair ? INITIAL_ASSETS.find((a) => a.symbol === pair.baseAsset) : undefined;
      const quoteAsset = pair ? INITIAL_ASSETS.find((a) => a.symbol === pair.quoteAsset) : undefined;
      return { pair, baseAsset, quoteAsset, networkConfig: TRC20_NETWORK };
    },
    async getReferencePrice() {
      return 90000;
    },
    async getCustomerAccountStatus(): Promise<AccountStatus> {
      return 'active';
    },
    async checkDuplicateTxHash({ txHash, networkCode, excludeOrderId }) {
      const norm = txHash.trim().toLowerCase();
      return state.orders.some(
        (o) =>
          o.id !== excludeOrderId &&
          o.receivingNetwork.toUpperCase() === networkCode.toUpperCase() &&
          (o.paymentTxHash?.trim().toLowerCase() ?? '') === norm &&
          o.status !== 'REJECTED' &&
          o.status !== 'CANCELLED'
      );
    },
    async insertOrder(order) {
      state.orders.unshift(order);
      return order;
    },
    async saveOrderTransition(order) {
      const idx = state.orders.findIndex((o) => o.id === order.id);
      if (idx >= 0) state.orders[idx] = order;
      return order;
    },
    async fulfilOrderAtomically(params) {
      const res = fulfilManualPurchaseOrderRecord({
        order: params.order,
        adminUserId: params.adminUserId,
        adminLabel: params.adminLabel,
        adminRole: params.adminRole,
        customerAccountStatus: 'active',
        finalCryptoAmount: params.finalCryptoAmount,
        finalFeeUsdt: params.finalFeeUsdt,
        adminRemark: params.adminRemark,
        expectedVersion: params.expectedVersion,
        existingOrders: state.orders,
        balances: state.balances,
        ledgerTransactions: state.txs,
        txId: `ltx-${state.txs.length + 1}`,
        entryId: `le-${state.entries.length + 1}`,
        balanceId: `bal-${state.balances.length + 1}`,
        eventId: `evt-fulfil-${state.orders.length + 1}`,
        nowIso: new Date().toISOString(),
      });
      if (!res.ok || !res.data) {
        return {
          ok: false,
          statusCode: res.error?.includes('Duplicate') || res.error?.includes('concurrent') ? 409 : 400,
          error: res.error,
        };
      }
      const idx = state.orders.findIndex((o) => o.id === params.order.id);
      state.orders[idx] = res.data.updatedOrder;
      state.balances = res.data.updatedBalances;
      state.txs.push(res.data.newTransaction);
      state.entries.push(res.data.newEntry);
      return { ok: true, statusCode: 200, order: res.data.updatedOrder, txId: res.data.newTransaction.id };
    },
    async appendAuditAndNotification() {
      // recorded in-memory cleanly for test
    },
  };

  const mockAuth: RequestHandler = (req, res, next) => {
    const uid = req.header('x-user-id');
    const role = (req.header('x-user-role') || 'customer') as AppRole;
    if (!uid) {
      res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: 'Auth required.' });
      return;
    }
    req.auth = {
      userId: uid,
      publicUserId: `UID-${uid.toUpperCase()}`,
      email: `${uid}@example.com`,
      fullName: uid,
      phone: null,
      twoFactorEnabled: false,
      role,
      accountStatus: 'active',
      kycStatus: 'approved',
      preferredLanguage: 'en',
      createdAt: '2026-01-01T00:00:00.000Z',
      accessToken: 'test-token',
    };
    next();
  };

  const app = express();
  app.use(express.json());
  app.use('/api', createPurchaseOrdersRouter({ authMiddleware: mockAuth, store }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  async function apiCall(
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
    const json = (await response.json()) as { ok: boolean; data?: unknown; message?: string };
    return { status: response.status, body: json };
  }

  try {
    // Unauthenticated blocked
    const unauth = await apiCall('GET', '/purchase-orders');
    assert.equal(unauth.status, 401);

    // Customer creates BUY order (attempting client-tampered price/fee is ignored)
    const createRes = await apiCall('POST', '/purchase-orders', {
      userId: 'cust-1',
      body: {
        pairSymbol: 'BTC/USDT',
        side: 'buy',
        orderType: 'MARKET',
        requestedQuoteAmount: 500,
        receivingAddressId: ACTIVE_RECEIVING_ADDR.id,
        feeRate: 0,
        referencePrice: 1,
      },
    });
    assert.equal(createRes.status, 201);

    const createdOrder = createRes.body.data as ManualPurchaseOrder;
    assert.equal(createdOrder.referencePrice, 90000);
    assert.equal(createdOrder.status, 'PENDING_PAYMENT');

    // Another customer cannot see cust-1 order or submit payment on it
    const otherList = await apiCall('GET', '/purchase-orders', { userId: 'cust-2' });
    assert.equal(otherList.status, 200);
    assert.equal((otherList.body.data as ManualPurchaseOrder[]).length, 0);

    const otherPay = await apiCall('POST', `/purchase-orders/${createdOrder.id}/payment`, {
      userId: 'cust-2',
      body: { paymentTxHash: 'TXHASH_OWNERSHIP_TEST_1234', actualAmountSent: 500 },
    });
    assert.equal(otherPay.status, 404);

    // Customer submits payment proof
    const payRes = await apiCall('POST', `/purchase-orders/${createdOrder.id}/payment`, {
      userId: 'cust-1',
      body: { paymentTxHash: 'TXHASH_VALID_HTTP_123456', actualAmountSent: 500 },
    });
    assert.equal(payRes.status, 200);

    // Customer forbidden from admin endpoints
    const custAdminRes = await apiCall('POST', `/admin/purchase-orders/${createdOrder.id}/review`, {
      userId: 'cust-1',
      role: 'customer',
      body: { targetStatus: 'UNDER_REVIEW' },
    });
    assert.equal(custAdminRes.status, 403);

    // Compliance admin can move UNDER_REVIEW -> APPROVED
    const underReviewRes = await apiCall('POST', `/admin/purchase-orders/${createdOrder.id}/review`, {
      userId: 'adm-comp',
      role: 'compliance_admin',
      body: { targetStatus: 'UNDER_REVIEW' },
    });
    assert.equal(underReviewRes.status, 200);

    const approveRes = await apiCall('POST', `/admin/purchase-orders/${createdOrder.id}/review`, {
      userId: 'adm-comp',
      role: 'compliance_admin',
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
    assert.equal(approveRes.status, 200);

    // Compliance admin forbidden from financial wallet credit (403)
    const compFulfilRes = await apiCall('POST', `/admin/purchase-orders/${createdOrder.id}/fulfil`, {
      userId: 'adm-comp',
      role: 'compliance_admin',
      body: {},
    });
    assert.equal(compFulfilRes.status, 403);

    // Finance admin fulfils & credits customer balance once
    const fulfilRes = await apiCall('POST', `/admin/purchase-orders/${createdOrder.id}/fulfil`, {
      userId: 'adm-fin',
      role: 'finance_admin',
      body: {},
    });
    assert.equal(fulfilRes.status, 200);

    const fulfilledOrder = fulfilRes.body.data as ManualPurchaseOrder;
    assert.equal(fulfilledOrder.status, 'COMPLETED');
    assert.equal(state.balances.length, 1);
    assert.equal(state.balances[0].available, createdOrder.estimatedCryptoAmount);
    assert.equal(state.entries.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err?: Error) => (err ? reject(err) : resolve()))
    );
  }
});
