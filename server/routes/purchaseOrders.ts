import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db';
import { requireAuth, requireRole, type AuthenticatedContext } from '../middleware/auth';
import { asyncHandler } from '../middleware/security';
import type {
  AccountStatus,
  Asset,
  ManualPurchaseOrder,
  ManualPurchaseOrderReviewEvent,
  ManualPurchaseOrderStatus,
  ManualPurchaseVerificationChecklist,
  NetworkConfig,
  ReceivingAddress,
  TradingPair,
  WalletBalance,
} from '../../src/types/domain';
import {
  createManualPurchaseOrderRecord,
  fulfilManualPurchaseOrderRecord,
  reviewManualPurchaseOrderRecord,
  submitManualPurchasePayment,
  toggleReceivingAddressStatusRecord,
  upsertReceivingAddressRecord,
  cancelManualPurchaseOrderRecord,
} from '../../src/utils/manualPurchaseEngine';
import { SANDBOX_REFERENCE_MARKETS } from '../../src/utils/overviewModel';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function classifyPgError(err: unknown): { status: number; code: string; message: string } | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: string; message?: string; constraint?: string };
  const msg = e.message ?? 'Database operation failed.';

  if (msg === 'CONCURRENT_ORDER_CONFLICT') {
    return {
      status: 409,
      code: 'CONFLICT',
      message: 'Order was modified concurrently by another operation. Refresh and retry.',
    };
  }
  if (e.code === '23505') {
    if (e.constraint?.includes('tx_hash') || msg.includes('uq_manual_purchase_orders_network_tx_hash')) {
      return {
        status: 409,
        code: 'CONFLICT',
        message: 'This transaction hash has already been submitted on this network and cannot be reused.',
      };
    }
    if (e.constraint?.includes('receiving_addresses') || msg.includes('uq_receiving_addresses_network_addr_memo')) {
      return {
        status: 409,
        code: 'CONFLICT',
        message: 'This receiving address and memo combination is already registered on this network.',
      };
    }
    return { status: 409, code: 'CONFLICT', message: 'Duplicate record conflict.' };
  }
  if (e.code === '23503') {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Referenced asset, network, or record does not exist.' };
  }
  if (e.code === '22P02') {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Malformed identifier format.' };
  }
  if (e.code === 'P0001') {
    const isConflict =
      /transition|immutable|terminal|closed|suspended/i.test(msg);
    return {
      status: isConflict ? 409 : 400,
      code: isConflict ? 'CONFLICT' : 'VALIDATION_ERROR',
      message: msg,
    };
  }
  return null;
}

export interface PurchaseOrderStore {
  listReceivingAddresses: (activeOnly: boolean) => Promise<ReceivingAddress[]>;
  upsertReceivingAddress: (
    record: ReceivingAddress,
    auditNote: string
  ) => Promise<ReceivingAddress>;
  getNetworkConfig?: (assetSymbol: string, networkCode: string) => Promise<NetworkConfig | undefined>;
  listOrders: (userId?: string) => Promise<ManualPurchaseOrder[]>;
  getOrderById: (id: string) => Promise<ManualPurchaseOrder | null>;
  getPairBySymbol: (symbol: string) => Promise<{
    pair: TradingPair | undefined;
    baseAsset: Asset | undefined;
    quoteAsset: Asset | undefined;
    networkConfig: NetworkConfig | undefined;
  }>;
  getReferencePrice: (symbol: string) => Promise<number>;
  getCustomerAccountStatus: (userId: string) => Promise<AccountStatus>;
  checkDuplicateTxHash: (params: {
    txHash: string;
    networkCode: string;
    excludeOrderId: string;
  }) => Promise<boolean>;
  insertOrder: (order: ManualPurchaseOrder) => Promise<ManualPurchaseOrder>;
  saveOrderTransition: (order: ManualPurchaseOrder, event: ManualPurchaseOrderReviewEvent) => Promise<ManualPurchaseOrder>;
  fulfilOrderAtomically: (params: {
    order: ManualPurchaseOrder;
    adminUserId: string;
    adminLabel: string;
    adminRole: AuthenticatedContext['role'];
    finalCryptoAmount?: number;
    finalFeeUsdt?: number;
    adminRemark?: string;
    expectedVersion?: number;
  }) => Promise<{
    ok: boolean;
    statusCode: number;
    error?: string;
    order?: ManualPurchaseOrder;
    txId?: string;
  }>;
  appendAuditAndNotification: (params: {
    adminUserId?: string;
    adminLabel?: string;
    action?: string;
    recordId: string;
    details: string;
    notifyUserId: string;
    notifyTitle: string;
    notifyMessage: string;
  }) => Promise<void>;
}

function createPgPurchaseOrderStore(storeOptions?: {
  pool?: Pool;
  preferDbPrice?: boolean;
}): PurchaseOrderStore {
  async function runInTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!storeOptions?.pool) {
      return withTransaction(fn);
    }
    const client = await storeOptions.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const toIsoString = (val: unknown): string | null => {
    if (val === null || val === undefined) return null;
    if (val instanceof Date) return val.toISOString();
    return String(val);
  };

  const mapAddressRow = (row: Record<string, unknown>): ReceivingAddress => ({
    id: String(row.id),
    assetSymbol: String(row.asset_symbol),
    networkCode: String(row.network_code),
    address: String(row.address),
    memoOrTag: row.memo_or_tag ? String(row.memo_or_tag) : null,
    label: String(row.label),
    isActive: Boolean(row.is_active),
    assignedBy: String(row.assigned_by),
    assignedByLabel: String(row.assigned_by_label ?? 'Administrator'),
    createdAt: toIsoString(row.created_at) ?? '',
    updatedAt: toIsoString(row.updated_at) ?? '',
    auditHistory: Array.isArray(row.audit_history)
      ? (row.audit_history as ReceivingAddress['auditHistory'])
      : [],
  });

  const mapOrderRow = (
    row: Record<string, unknown>,
    events: ManualPurchaseOrderReviewEvent[]
  ): ManualPurchaseOrder => ({
    id: String(row.id),
    orderRef: String(row.order_ref),
    userId: String(row.user_id),
    pairSymbol: String(row.pair_symbol),
    baseAsset: String(row.base_asset),
    quoteAsset: String(row.quote_asset),
    side: 'buy',
    orderType: row.order_type === 'LIMIT' ? 'LIMIT' : 'MARKET',
    requestedQuoteAmount: Number(row.requested_quote_amount),
    limitPrice: row.limit_price !== null && row.limit_price !== undefined ? Number(row.limit_price) : null,
    referencePrice: Number(row.reference_price),
    feeRate: Number(row.fee_rate),
    estimatedFeeUsdt: Number(row.estimated_fee_usdt),
    estimatedCryptoAmount: Number(row.estimated_crypto_amount),
    totalPaymentAmount: Number(row.total_payment_amount),
    paymentAsset: String(row.payment_asset),
    receivingNetwork: String(row.receiving_network),
    receivingAddressId: String(row.receiving_address_id),
    receivingAddress: String(row.receiving_address),
    receivingMemoOrTag: row.receiving_memo_or_tag ? String(row.receiving_memo_or_tag) : null,
    paymentTxHash: row.payment_tx_hash ? String(row.payment_tx_hash) : null,
    actualAmountSent:
      row.actual_amount_sent !== null && row.actual_amount_sent !== undefined
        ? Number(row.actual_amount_sent)
        : null,
    paymentNote: row.payment_note ? String(row.payment_note) : null,
    paymentSubmittedAt: toIsoString(row.payment_submitted_at),
    status: String(row.status) as ManualPurchaseOrderStatus,
    verificationChecklist: {
      txHashChecked: Boolean(row.tx_hash_checked),
      addressMatched: Boolean(row.address_matched),
      networkMatched: Boolean(row.network_matched),
      amountVerified: Boolean(row.amount_verified),
      duplicateClear: Boolean(row.duplicate_clear),
    },
    finalCryptoAmount:
      row.final_crypto_amount !== null && row.final_crypto_amount !== undefined
        ? Number(row.final_crypto_amount)
        : null,
    finalFeeUsdt:
      row.final_fee_usdt !== null && row.final_fee_usdt !== undefined
        ? Number(row.final_fee_usdt)
        : null,
    adminRemark: row.admin_remark ? String(row.admin_remark) : null,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: toIsoString(row.reviewed_at),
    fulfilledBy: row.fulfilled_by ? String(row.fulfilled_by) : null,
    fulfilledAt: toIsoString(row.fulfilled_at),
    creditedTxId: row.credited_tx_id ? String(row.credited_tx_id) : null,
    idempotencyKey: String(row.idempotency_key),
    version: Number(row.version),
    reviewHistory: events,
    createdAt: toIsoString(row.created_at) ?? '',
    updatedAt: toIsoString(row.updated_at) ?? '',
  });

  async function loadEventsForOrders(client: PoolClient, orderIds: string[]) {
    if (orderIds.length === 0) return new Map<string, ManualPurchaseOrderReviewEvent[]>();
    const res = await client.query(
      `SELECT id, order_id, from_status, to_status, actor_user_id, actor_label, actor_role, remark, created_at::text
       FROM public.manual_purchase_order_events
       WHERE order_id = ANY($1::uuid[])
       ORDER BY created_at ASC`,
      [orderIds]
    );
    const map = new Map<string, ManualPurchaseOrderReviewEvent[]>();
    for (const r of res.rows) {
      const list = map.get(String(r.order_id)) ?? [];
      list.push({
        id: String(r.id),
        fromStatus: r.from_status ? (String(r.from_status) as ManualPurchaseOrderStatus) : null,
        toStatus: String(r.to_status) as ManualPurchaseOrderStatus,
        actorUserId: String(r.actor_user_id),
        actorLabel: String(r.actor_label),
        actorRole: String(r.actor_role) as AuthenticatedContext['role'],
        remark: String(r.remark),
        createdAt: String(r.created_at),
      });
      map.set(String(r.order_id), list);
    }
    return map;
  }

  async function loadAuditHistoryForAddresses(client: PoolClient, addressIds: string[]) {
    if (addressIds.length === 0) return new Map<string, ReceivingAddress['auditHistory']>();
    const res = await client.query(
      `SELECT receiving_address_id, action, actor_user_id, actor_label, note, created_at::text
       FROM public.receiving_address_audit_logs
       WHERE receiving_address_id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [addressIds]
    );
    const map = new Map<string, ReceivingAddress['auditHistory']>();
    for (const r of res.rows) {
      const id = String(r.receiving_address_id);
      const list = map.get(id) ?? [];
      list.push({
        action: String(r.action) as ReceivingAddress['auditHistory'][number]['action'],
        actorUserId: String(r.actor_user_id),
        actorLabel: String(r.actor_label),
        note: String(r.note),
        createdAt: String(r.created_at),
      });
      map.set(id, list);
    }
    return map;
  }

  return {
    async listReceivingAddresses(activeOnly: boolean) {
      return runInTx(async (client) => {
        const res = await client.query(
          `SELECT ra.id, ra.asset_symbol, ra.network_code, ra.address, ra.memo_or_tag,
                  ra.label, ra.is_active, ra.assigned_by,
                  COALESCE(p.full_name, 'Administrator') AS assigned_by_label,
                  ra.created_at::text, ra.updated_at::text
           FROM public.receiving_addresses ra
           LEFT JOIN public.profiles p ON p.id = ra.assigned_by
           ${activeOnly ? 'WHERE ra.is_active = TRUE' : ''}
           ORDER BY ra.created_at DESC`
        );
        const ids = res.rows.map((r) => String(r.id));
        const auditMap = await loadAuditHistoryForAddresses(client, ids);
        return res.rows.map((r) => ({
          ...mapAddressRow(r),
          auditHistory: auditMap.get(String(r.id)) ?? [],
        }));
      });
    },

    async upsertReceivingAddress(record: ReceivingAddress, auditNote: string) {
      return runInTx(async (client) => {
        await client.query(
          `INSERT INTO public.receiving_addresses (
             id, asset_symbol, network_code, address, memo_or_tag, label, is_active, assigned_by, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             address = EXCLUDED.address,
             memo_or_tag = EXCLUDED.memo_or_tag,
             label = EXCLUDED.label,
             is_active = EXCLUDED.is_active,
             updated_at = EXCLUDED.updated_at`,
          [
            record.id,
            record.assetSymbol,
            record.networkCode,
            record.address,
            record.memoOrTag,
            record.label,
            record.isActive,
            record.assignedBy,
            record.createdAt,
            record.updatedAt,
          ]
        );
        const latestAudit = record.auditHistory[record.auditHistory.length - 1];
        if (latestAudit) {
          await client.query(
            `INSERT INTO public.receiving_address_audit_logs (
               receiving_address_id, action, actor_user_id, actor_label, note, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              record.id,
              latestAudit.action,
              latestAudit.actorUserId,
              latestAudit.actorLabel,
              auditNote || latestAudit.note,
              latestAudit.createdAt,
            ]
          );
        }
        const auditMap = await loadAuditHistoryForAddresses(client, [record.id]);
        return {
          ...record,
          auditHistory: auditMap.get(record.id) ?? record.auditHistory,
        };
      });
    },

    async getNetworkConfig(assetSymbol: string, networkCode: string) {
      return runInTx(async (client) => {
        const res = await client.query(
          `SELECT id, code, name, asset_symbol, required_confirmations, min_deposit, min_withdrawal,
                  network_fee, platform_fee, address_regex, memo_required,
                  is_deposit_enabled, is_withdrawal_enabled, updated_at::text
           FROM public.networks
           WHERE UPPER(asset_symbol) = UPPER($1) AND LOWER(code) = LOWER($2)
           LIMIT 1`,
          [assetSymbol, networkCode]
        );
        const r = res.rows[0];
        if (!r) return undefined;
        return {
          id: String(r.id),
          code: String(r.code),
          name: String(r.name),
          assetSymbol: String(r.asset_symbol),
          requiredConfirmations: Number(r.required_confirmations),
          minDeposit: Number(r.min_deposit),
          minWithdrawal: Number(r.min_withdrawal),
          networkFee: Number(r.network_fee),
          platformFee: Number(r.platform_fee),
          addressPattern: String(r.address_regex),
          memoRequired: Boolean(r.memo_required),
          isDepositEnabled: Boolean(r.is_deposit_enabled),
          isWithdrawalEnabled: Boolean(r.is_withdrawal_enabled),
          updatedAt: String(r.updated_at),
        };
      });
    },

    async listOrders(userId?: string) {
      return runInTx(async (client) => {
        const res = userId
          ? await client.query(
              `SELECT * FROM public.manual_purchase_orders WHERE user_id = $1 ORDER BY created_at DESC`,
              [userId]
            )
          : await client.query(`SELECT * FROM public.manual_purchase_orders ORDER BY created_at DESC`);
        const ids = res.rows.map((r) => String(r.id));
        const eventMap = await loadEventsForOrders(client, ids);
        return res.rows.map((r) => mapOrderRow(r, eventMap.get(String(r.id)) ?? []));
      });
    },

    async getOrderById(id: string) {
      if (!UUID_REGEX.test(id)) return null;
      return runInTx(async (client) => {
        const res = await client.query(
          `SELECT * FROM public.manual_purchase_orders WHERE id = $1 LIMIT 1`,
          [id]
        );
        if (res.rows.length === 0) return null;
        const eventMap = await loadEventsForOrders(client, [id]);
        return mapOrderRow(res.rows[0], eventMap.get(id) ?? []);
      });
    },

    async getPairBySymbol(symbol: string) {
      return runInTx(async (client) => {
        const pairRes = await client.query(
          `SELECT id, symbol, base_asset, quote_asset, fee_rate, min_order_usdt, venue_symbol, is_enabled
           FROM public.trading_pairs WHERE symbol = $1 LIMIT 1`,
          [symbol]
        );
        const pairRow = pairRes.rows[0];
        const pair: TradingPair | undefined = pairRow
          ? {
              id: String(pairRow.id),
              symbol: String(pairRow.symbol),
              baseAsset: String(pairRow.base_asset),
              quoteAsset: String(pairRow.quote_asset),
              feeRate: Number(pairRow.fee_rate),
              minOrderUsdt: Number(pairRow.min_order_usdt),
              venueSymbol: String(pairRow.venue_symbol ?? ''),
              isEnabled: Boolean(pairRow.is_enabled),
            }
          : undefined;
        if (!pair) return { pair: undefined, baseAsset: undefined, quoteAsset: undefined, networkConfig: undefined };
        const assetsRes = await client.query(
          `SELECT id, symbol, name, decimals, is_enabled, sort_order, badge_color, description
           FROM public.assets WHERE symbol IN ($1, $2)`,
          [pair.baseAsset, pair.quoteAsset]
        );
        const toAsset = (r: Record<string, unknown> | undefined): Asset | undefined =>
          r
            ? {
                id: String(r.id),
                symbol: String(r.symbol),
                name: String(r.name),
                decimals: Number(r.decimals),
                isEnabled: Boolean(r.is_enabled),
                sortOrder: Number(r.sort_order),
                badgeColor: String(r.badge_color),
                description: String(r.description),
              }
            : undefined;
        const baseAsset = toAsset(assetsRes.rows.find((r) => r.symbol === pair.baseAsset));
        const quoteAsset = toAsset(assetsRes.rows.find((r) => r.symbol === pair.quoteAsset));
        return { pair, baseAsset, quoteAsset, networkConfig: undefined };
      });
    },

    async getReferencePrice(symbol: string) {
      const readDbPrice = async () => {
        try {
          const dbPrice = await runInTx(async (client) => {
            const r = await client.query(
              `SELECT price FROM public.market_prices WHERE pair_symbol = $1 LIMIT 1`,
              [symbol]
            );
            return Number(r.rows[0]?.price ?? 0);
          });
          if (Number.isFinite(dbPrice) && dbPrice > 0) return dbPrice;
        } catch {
          // fallback below
        }
        return 0;
      };

      if (storeOptions?.preferDbPrice) {
        const dbPrice = await readDbPrice();
        if (dbPrice > 0) return dbPrice;
      }

      const venueSymbol = symbol.replace('/', '').toUpperCase();
      try {
        const res = await fetch(
          `https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(venueSymbol)}`,
          { signal: AbortSignal.timeout(4000) }
        );
        if (res.ok) {
          const payload = (await res.json()) as { price?: string };
          const price = Number(payload.price);
          if (Number.isFinite(price) && price > 0) return price;
        }
      } catch {
        // fallback to DB / reference quote below
      }

      const dbPrice = await readDbPrice();
      if (dbPrice > 0) return dbPrice;

      return SANDBOX_REFERENCE_MARKETS[symbol]?.price ?? 0;
    },

    async getCustomerAccountStatus(userId: string) {
      if (!UUID_REGEX.test(userId)) return 'closed';
      return runInTx(async (client) => {
        const res = await client.query(
          `SELECT account_status FROM public.profiles WHERE id = $1 LIMIT 1`,
          [userId]
        );
        return (res.rows[0]?.account_status as AccountStatus) ?? 'closed';
      });
    },

    async checkDuplicateTxHash({ txHash, networkCode, excludeOrderId }) {
      return runInTx(async (client) => {
        const res = await client.query(
          `SELECT EXISTS(
             SELECT 1 FROM public.manual_purchase_orders
             WHERE id <> $1
               AND receiving_network = $2
               AND LOWER(payment_tx_hash) = LOWER($3)
               AND status NOT IN ('REJECTED', 'CANCELLED')
           ) OR EXISTS(
             SELECT 1 FROM public.deposits
             WHERE network_code = $2
               AND LOWER(tx_hash) = LOWER($3)
               AND status IN ('APPROVED', 'CREDITED')
           ) AS dup`,
          [excludeOrderId, networkCode, txHash]
        );
        return Boolean(res.rows[0]?.dup);
      });
    },

    async insertOrder(order: ManualPurchaseOrder) {
      return runInTx(async (client) => {
        await client.query(
          `INSERT INTO public.manual_purchase_orders (
             id, order_ref, user_id, pair_symbol, base_asset, quote_asset, side, order_type,
             requested_quote_amount, limit_price, reference_price, fee_rate, estimated_fee_usdt,
             estimated_crypto_amount, total_payment_amount, payment_asset, receiving_network,
             receiving_address_id, receiving_address, receiving_memo_or_tag, status,
             idempotency_key, version, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, 'buy', $7,
             $8, $9, $10, $11, $12,
             $13, $14, $15, $16,
             $17, $18, $19, $20,
             $21, $22, $23, $24
           )`,
          [
            order.id,
            order.orderRef,
            order.userId,
            order.pairSymbol,
            order.baseAsset,
            order.quoteAsset,
            order.orderType,
            order.requestedQuoteAmount,
            order.limitPrice,
            order.referencePrice,
            order.feeRate,
            order.estimatedFeeUsdt,
            order.estimatedCryptoAmount,
            order.totalPaymentAmount,
            order.paymentAsset,
            order.receivingNetwork,
            order.receivingAddressId,
            order.receivingAddress,
            order.receivingMemoOrTag,
            order.status,
            order.idempotencyKey,
            order.version,
            order.createdAt,
            order.updatedAt,
          ]
        );
        for (const evt of order.reviewHistory) {
          await client.query(
            `INSERT INTO public.manual_purchase_order_events (
               id, order_id, from_status, to_status, actor_user_id, actor_label, actor_role, remark, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              evt.id,
              order.id,
              evt.fromStatus,
              evt.toStatus,
              evt.actorUserId,
              evt.actorLabel,
              evt.actorRole,
              evt.remark,
              evt.createdAt,
            ]
          );
        }
        return order;
      });
    },

    async saveOrderTransition(order: ManualPurchaseOrder, event: ManualPurchaseOrderReviewEvent) {
      return runInTx(async (client) => {
        const res = await client.query(
          `UPDATE public.manual_purchase_orders
           SET payment_tx_hash = $2,
               actual_amount_sent = $3,
               payment_note = $4,
               payment_submitted_at = $5,
               status = $6,
               tx_hash_checked = $7,
               address_matched = $8,
               network_matched = $9,
               amount_verified = $10,
               duplicate_clear = $11,
               admin_remark = $12,
               rejection_reason = $13,
               reviewed_by = $14,
               reviewed_at = $15,
               version = $16,
               updated_at = $17
           WHERE id = $1 AND version = $18
           RETURNING id`,
          [
            order.id,
            order.paymentTxHash,
            order.actualAmountSent,
            order.paymentNote,
            order.paymentSubmittedAt,
            order.status,
            order.verificationChecklist.txHashChecked,
            order.verificationChecklist.addressMatched,
            order.verificationChecklist.networkMatched,
            order.verificationChecklist.amountVerified,
            order.verificationChecklist.duplicateClear,
            order.adminRemark,
            order.rejectionReason,
            order.reviewedBy,
            order.reviewedAt,
            order.version,
            order.updatedAt,
            order.version - 1,
          ]
        );
        if (res.rowCount === 0) {
          throw new Error('CONCURRENT_ORDER_CONFLICT');
        }
        await client.query(
          `INSERT INTO public.manual_purchase_order_events (
             id, order_id, from_status, to_status, actor_user_id, actor_label, actor_role, remark, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            event.id,
            order.id,
            event.fromStatus,
            event.toStatus,
            event.actorUserId,
            event.actorLabel,
            event.actorRole,
            event.remark,
            event.createdAt,
          ]
        );
        return order;
      });
    },

    async fulfilOrderAtomically(params) {
      if (!UUID_REGEX.test(params.order.id)) {
        return { ok: false, statusCode: 404, error: 'Manual purchase order not found.' };
      }

      try {
        return await runInTx(async (client) => {
          const ownerRes = await client.query<{ user_id: string }>(
            `SELECT user_id FROM public.manual_purchase_orders WHERE id = $1`,
            [params.order.id]
          );
          if (ownerRes.rows.length === 0) {
            return { ok: false, statusCode: 404, error: 'Manual purchase order not found.' };
          }
          // Lock order customer via shared per-user advisory lock before row locks (007/009 contract)
          await client.query(`SELECT public.acquire_user_account_lock($1)`, [ownerRes.rows[0].user_id]);

          const lockRes = await client.query(
            `SELECT * FROM public.manual_purchase_orders WHERE id = $1 FOR UPDATE`,
            [params.order.id]
          );
          if (lockRes.rows.length === 0) {
            return { ok: false, statusCode: 404, error: 'Manual purchase order not found.' };
          }
          const eventMap = await loadEventsForOrders(client, [params.order.id]);
          const lockedOrder = mapOrderRow(lockRes.rows[0], eventMap.get(params.order.id) ?? []);

          const acctRes = await client.query(
            `SELECT account_status FROM public.profiles WHERE id = $1 FOR KEY SHARE`,
            [lockedOrder.userId]
          );
          const customerStatus = (acctRes.rows[0]?.account_status as AccountStatus) ?? 'closed';

          const balRes = await client.query(
            `SELECT id, user_id, asset_symbol, available, reserved, updated_at::text
             FROM public.wallet_balances
             WHERE user_id = $1 AND asset_symbol = $2
             FOR UPDATE`,
            [lockedOrder.userId, lockedOrder.baseAsset]
          );
          const balances: WalletBalance[] = balRes.rows.map((b) => ({
            id: String(b.id),
            userId: String(b.user_id),
            assetSymbol: String(b.asset_symbol),
            available: Number(b.available),
            reserved: Number(b.reserved),
            updatedAt: String(b.updated_at),
          }));

          const idempotencyKey = `mpo-fulfil-${lockedOrder.id}`;
          const existingTxRes = await client.query(
            `SELECT id FROM public.ledger_transactions WHERE idempotency_key = $1 LIMIT 1`,
            [idempotencyKey]
          );
          const existingLedgerTxs = existingTxRes.rows.map((r) => ({
            id: String(r.id),
            userId: lockedOrder.userId,
            type: 'spot_buy' as const,
            referenceId: lockedOrder.id,
            idempotencyKey,
            sourceAccount: '',
            reasonCode: null,
            reversalOfTxId: null,
            summary: '',
            createdAt: new Date().toISOString(),
          }));

          const dupRes = await client.query(
            `SELECT EXISTS(
               SELECT 1 FROM public.manual_purchase_orders
               WHERE id <> $1 AND receiving_network = $2 AND LOWER(payment_tx_hash) = LOWER($3)
                 AND status NOT IN ('REJECTED', 'CANCELLED')
             ) OR EXISTS(
               SELECT 1 FROM public.deposits
               WHERE network_code = $2
                 AND LOWER(tx_hash) = LOWER($3)
                 AND status IN ('APPROVED', 'CREDITED')
             ) AS dup`,
            [lockedOrder.id, lockedOrder.receivingNetwork, lockedOrder.paymentTxHash ?? '']
          );
          const dupOrders: ManualPurchaseOrder[] = dupRes.rows[0]?.dup
            ? [{ ...lockedOrder, id: 'other-order' }]
            : [];

          const txId = crypto.randomUUID();
          const entryId = crypto.randomUUID();
          const balanceId = crypto.randomUUID();
          const eventId = crypto.randomUUID();
          const nowIso = new Date().toISOString();

          const result = fulfilManualPurchaseOrderRecord({
            order: lockedOrder,
            adminUserId: params.adminUserId,
            adminLabel: params.adminLabel,
            adminRole: params.adminRole,
            customerAccountStatus: customerStatus,
            finalCryptoAmount: params.finalCryptoAmount,
            finalFeeUsdt: params.finalFeeUsdt,
            adminRemark: params.adminRemark,
            expectedVersion: params.expectedVersion,
            existingOrders: dupOrders,
            balances,
            ledgerTransactions: existingLedgerTxs,
            txId,
            entryId,
            balanceId,
            eventId,
            nowIso,
          });

          if (!result.ok || !result.data) {
            return {
              ok: false,
              statusCode:
                result.error?.includes('concurrent') ||
                result.error?.includes('Duplicate') ||
                result.error?.includes('must be APPROVED') ||
                result.error?.includes('already been credited')
                  ? 409
                  : 400,
              error: result.error ?? 'Order fulfilment validation failed.',
            };
          }

          const { updatedOrder, updatedBalances, newTransaction, newEntry } = result.data;
          const targetBal = updatedBalances.find(
            (b) => b.userId === updatedOrder.userId && b.assetSymbol === updatedOrder.baseAsset
          )!;

          await client.query(
            `INSERT INTO public.wallet_balances (id, user_id, asset_symbol, available, reserved, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id, asset_symbol) DO UPDATE SET
               available = EXCLUDED.available,
               updated_at = EXCLUDED.updated_at`,
            [
              targetBal.id,
              targetBal.userId,
              targetBal.assetSymbol,
              targetBal.available,
              targetBal.reserved,
              targetBal.updatedAt,
            ]
          );

          await client.query(
            `INSERT INTO public.ledger_transactions (
               id, user_id, type, reference_id, idempotency_key, source_account, reason_code, reversal_of_tx_id, summary, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9)`,
            [
              newTransaction.id,
              newTransaction.userId,
              newTransaction.type,
              newTransaction.referenceId,
              newTransaction.idempotencyKey,
              newTransaction.sourceAccount,
              newTransaction.reasonCode,
              newTransaction.summary,
              newTransaction.createdAt,
            ]
          );

          await client.query(
            `INSERT INTO public.ledger_entries (
               id, transaction_id, user_id, asset_symbol, bucket, delta_amount, balance_after, entry_role, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              newEntry.id,
              newEntry.transactionId,
              newEntry.userId,
              newEntry.assetSymbol,
              newEntry.bucket,
              newEntry.deltaAmount,
              newEntry.balanceAfter,
              newEntry.entryRole,
              newEntry.createdAt,
            ]
          );

          const updRes = await client.query(
            `UPDATE public.manual_purchase_orders
             SET status = 'COMPLETED',
                 final_crypto_amount = $2,
                 final_fee_usdt = $3,
                 admin_remark = $4,
                 fulfilled_by = $5,
                 fulfilled_at = $6,
                 credited_tx_id = $7,
                 version = $8,
                 updated_at = $9
             WHERE id = $1 AND status = 'APPROVED' AND version = $10`,
            [
              updatedOrder.id,
              updatedOrder.finalCryptoAmount,
              updatedOrder.finalFeeUsdt,
              updatedOrder.adminRemark,
              updatedOrder.fulfilledBy,
              updatedOrder.fulfilledAt,
              updatedOrder.creditedTxId,
              updatedOrder.version,
              updatedOrder.updatedAt,
              lockedOrder.version,
            ]
          );
          if (updRes.rowCount !== 1) {
            throw new Error('CONCURRENT_ORDER_CONFLICT');
          }

          const latestEvt = updatedOrder.reviewHistory[updatedOrder.reviewHistory.length - 1];
          if (latestEvt) {
            await client.query(
              `INSERT INTO public.manual_purchase_order_events (
                 id, order_id, from_status, to_status, actor_user_id, actor_label, actor_role, remark, created_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                latestEvt.id,
                updatedOrder.id,
                latestEvt.fromStatus,
                latestEvt.toStatus,
                latestEvt.actorUserId,
                latestEvt.actorLabel,
                latestEvt.actorRole,
                latestEvt.remark,
                latestEvt.createdAt,
              ]
            );
          }

          return { ok: true, statusCode: 200, order: updatedOrder, txId: newTransaction.id };
        });
      } catch (err) {
        const mapped = classifyPgError(err);
        if (mapped) {
          return { ok: false, statusCode: mapped.status, error: mapped.message };
        }
        throw err;
      }
    },

    async appendAuditAndNotification(params) {
      await runInTx(async (client) => {
        if (params.adminUserId && params.action) {
          await client.query(
            `INSERT INTO public.admin_audit_logs (
               admin_user_id, admin_label, action, affected_user_id, record_type, record_id, details
             ) VALUES ($1, $2, $3, $4, 'manual_purchase_orders', $5, $6)`,
            [
              params.adminUserId,
              params.adminLabel ?? 'Administrator',
              params.action,
              params.notifyUserId,
              params.recordId,
              params.details,
            ]
          );
        }
        await client.query(
          `INSERT INTO public.notifications (user_id, title, message, category)
           VALUES ($1, $2, $3, 'Trade')`,
          [params.notifyUserId, params.notifyTitle, params.notifyMessage]
        );
      });
    },
  };
}

export interface PurchaseOrdersRouterOptions {
  authMiddleware?: RequestHandler;
  store?: PurchaseOrderStore;
  pool?: Pool;
  preferDbPrice?: boolean;
}

export function createPurchaseOrdersRouter(options?: PurchaseOrdersRouterOptions): Router {
  const router = Router();
  const auth = options?.authMiddleware ?? requireAuth;
  const store =
    options?.store ??
    createPgPurchaseOrderStore({
      pool: options?.pool,
      preferDbPrice: options?.preferDbPrice,
    });

  // Customer: list active receiving addresses
  router.get(
    '/purchase-orders/receiving-addresses',
    auth,
    asyncHandler(async (_req, res) => {
      const addresses = await store.listReceivingAddresses(true);
      res.json({ ok: true, data: addresses });
    })
  );

  // Customer: list ONLY own manual purchase orders
  router.get(
    '/purchase-orders',
    auth,
    asyncHandler(async (req, res) => {
      const orders = await store.listOrders(req.auth!.userId);
      res.json({ ok: true, data: orders });
    })
  );

  // Customer: create manual BUY purchase order
  router.post(
    '/purchase-orders',
    auth,
    asyncHandler(async (req, res) => {
      const { pairSymbol, side, orderType, requestedQuoteAmount, limitPrice, receivingAddressId } =
        req.body ?? {};
      const actor = req.auth!;

      if (typeof pairSymbol !== 'string' || !pairSymbol.trim()) {
        res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'pairSymbol is required.' });
        return;
      }

      const normalizedPair = pairSymbol.trim().toUpperCase();
      const { pair, baseAsset, quoteAsset, networkConfig } =
        await store.getPairBySymbol(normalizedPair);
      const addresses = await store.listReceivingAddresses(false);
      const selectedAddr = addresses.find((a) => a.id === receivingAddressId);
      const addrNetworkConfig =
        selectedAddr && store.getNetworkConfig
          ? await store.getNetworkConfig(selectedAddr.assetSymbol, selectedAddr.networkCode)
          : undefined;
      const referencePrice = await store.getReferencePrice(normalizedPair);

      const nowIso = new Date().toISOString();
      const orderId = crypto.randomUUID();
      const orderRef = `MPO-${nowIso.slice(0, 10).replace(/-/g, '')}-${orderId.slice(0, 6).toUpperCase()}`;

      const result = createManualPurchaseOrderRecord({
        id: orderId,
        orderRef,
        eventId: crypto.randomUUID(),
        userId: actor.userId,
        actorLabel: actor.fullName,
        side: typeof side === 'string' ? side.toLowerCase() : 'buy',
        orderType: typeof orderType === 'string' ? orderType.toUpperCase() : 'MARKET',
        pair,
        baseAsset,
        quoteAsset,
        requestedQuoteAmount: Number(requestedQuoteAmount),
        limitPrice: limitPrice !== undefined && limitPrice !== null ? Number(limitPrice) : null,
        referenceMarketPrice: referencePrice,
        accountStatus: actor.accountStatus,
        kycStatus: actor.kycStatus,
        receivingAddress: selectedAddr,
        networkConfig: addrNetworkConfig ?? networkConfig,
        nowIso,
      });

      if (!result.ok || !result.data) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: result.error ?? 'Invalid manual purchase request.',
        });
        return;
      }

      let saved: ManualPurchaseOrder;
      try {
        saved = await store.insertOrder(result.data);
      } catch (err) {
        const mapped = classifyPgError(err);
        if (mapped) {
          res.status(mapped.status).json({ ok: false, code: mapped.code, message: mapped.message });
          return;
        }
        throw err;
      }

      await store.appendAuditAndNotification({
        recordId: saved.id,
        details: `Created purchase order ${saved.orderRef}`,
        notifyUserId: actor.userId,
        notifyTitle: `Purchase Order Created (${saved.orderRef})`,
        notifyMessage: `Send ${saved.totalPaymentAmount} ${saved.paymentAsset} via ${saved.receivingNetwork} to complete your ${saved.pairSymbol} purchase request.`,
      });

      res.status(201).json({ ok: true, data: saved });
    })
  );

  // Customer: submit payment reference for own PENDING_PAYMENT order
  router.post(
    '/purchase-orders/:id/payment',
    auth,
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      const existing = await store.getOrderById(req.params.id);
      if (!existing || existing.userId !== actor.userId) {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Purchase order not found.' });
        return;
      }

      const { paymentTxHash, actualAmountSent, paymentNote } = req.body ?? {};
      const cleanedHash = typeof paymentTxHash === 'string' ? paymentTxHash.trim() : '';
      const hasDup = cleanedHash
        ? await store.checkDuplicateTxHash({
            txHash: cleanedHash,
            networkCode: existing.receivingNetwork,
            excludeOrderId: existing.id,
          })
        : false;

      const existingOrders = hasDup
        ? [
            {
              ...existing,
              id: 'duplicate-sentinel',
              paymentTxHash: cleanedHash,
              status: 'PAYMENT_SUBMITTED' as const,
            },
          ]
        : [existing];

      const nowIso = new Date().toISOString();
      const result = submitManualPurchasePayment({
        order: existing,
        actorUserId: actor.userId,
        actorLabel: actor.fullName,
        actorAccountStatus: actor.accountStatus,
        paymentTxHash: cleanedHash,
        actualAmountSent: Number(actualAmountSent),
        paymentNote: typeof paymentNote === 'string' ? paymentNote : undefined,
        existingOrders,
        eventId: crypto.randomUUID(),
        nowIso,
      });

      if (!result.ok || !result.data) {
        const isConflict =
          result.error?.includes('already been submitted') ||
          result.error?.includes('cannot be modified');
        res.status(isConflict ? 409 : 400).json({
          ok: false,
          code: isConflict ? 'CONFLICT' : 'VALIDATION_ERROR',
          message: result.error ?? 'Unable to submit payment details.',
        });
        return;
      }

      const evt = result.data.reviewHistory[result.data.reviewHistory.length - 1]!;
      let saved: ManualPurchaseOrder;
      try {
        saved = await store.saveOrderTransition(result.data, evt);
      } catch (err) {
        const mapped = classifyPgError(err);
        if (mapped) {
          res.status(mapped.status).json({ ok: false, code: mapped.code, message: mapped.message });
          return;
        }
        throw err;
      }

      await store.appendAuditAndNotification({
        recordId: saved.id,
        details: `Customer submitted payment reference for ${saved.orderRef}`,
        notifyUserId: actor.userId,
        notifyTitle: `Payment Reference Submitted (${saved.orderRef})`,
        notifyMessage: `Your transaction reference for ${saved.pairSymbol} has been queued for independent administrator verification.`,
      });

      res.json({ ok: true, data: saved });
    })
  );

  // Customer: cancel own PENDING_PAYMENT order
  router.post(
    '/purchase-orders/:id/cancel',
    auth,
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      const existing = await store.getOrderById(req.params.id);
      if (!existing || existing.userId !== actor.userId) {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Purchase order not found.' });
        return;
      }
      const result = cancelManualPurchaseOrderRecord({
        order: existing,
        actorUserId: actor.userId,
        actorLabel: actor.fullName,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        eventId: crypto.randomUUID(),
        nowIso: new Date().toISOString(),
      });
      if (!result.ok || !result.data) {
        res.status(409).json({
          ok: false,
          code: 'INVALID_TRANSITION',
          message: result.error ?? 'Order cannot be cancelled.',
        });
        return;
      }
      const evt = result.data.reviewHistory[result.data.reviewHistory.length - 1]!;
      let saved: ManualPurchaseOrder;
      try {
        saved = await store.saveOrderTransition(result.data, evt);
      } catch (err) {
        const mapped = classifyPgError(err);
        if (mapped) {
          res.status(mapped.status).json({ ok: false, code: mapped.code, message: mapped.message });
          return;
        }
        throw err;
      }
      res.json({ ok: true, data: saved });
    })
  );

  // Admin: list all receiving addresses
  router.get(
    '/admin/purchase-orders/receiving-addresses',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin', 'compliance_admin'),
    asyncHandler(async (_req, res) => {
      const addresses = await store.listReceivingAddresses(false);
      res.json({ ok: true, data: addresses });
    })
  );

  // Admin: add or update receiving address
  router.post(
    '/admin/purchase-orders/receiving-addresses',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin'),
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      const { id, assetSymbol, networkCode, address, memoOrTag, label, isActive } = req.body ?? {};
      const existingAddresses = await store.listReceivingAddresses(false);
      const nowIso = new Date().toISOString();
      const cleanedAsset = typeof assetSymbol === 'string' ? assetSymbol.trim().toUpperCase() : '';
      const cleanedNet = typeof networkCode === 'string' ? networkCode.trim().toUpperCase() : '';
      const networkConfig =
        cleanedAsset && cleanedNet && store.getNetworkConfig
          ? await store.getNetworkConfig(cleanedAsset, cleanedNet)
          : undefined;

      const result = upsertReceivingAddressRecord({
        id: typeof id === 'string' && id.trim() ? id.trim() : crypto.randomUUID(),
        assetSymbol: cleanedAsset,
        networkCode: cleanedNet,
        address: typeof address === 'string' ? address : '',
        memoOrTag: typeof memoOrTag === 'string' ? memoOrTag : null,
        label: typeof label === 'string' ? label : undefined,
        isActive: typeof isActive === 'boolean' ? isActive : true,
        adminUserId: actor.userId,
        adminLabel: actor.fullName,
        adminRole: actor.role,
        existingAddresses,
        networkConfig,
        nowIso,
      });

      if (!result.ok || !result.data) {
        const isConflict = result.error?.includes('already registered');
        res.status(isConflict ? 409 : 400).json({
          ok: false,
          code: isConflict ? 'CONFLICT' : 'VALIDATION_ERROR',
          message: result.error ?? 'Invalid receiving address configuration.',
        });
        return;
      }

      let saved: ReceivingAddress;
      try {
        saved = await store.upsertReceivingAddress(result.data, 'Configured receiving address');
      } catch (err) {
        const mapped = classifyPgError(err);
        if (mapped) {
          res.status(mapped.status).json({ ok: false, code: mapped.code, message: mapped.message });
          return;
        }
        throw err;
      }
      res.status(201).json({ ok: true, data: saved });
    })
  );

  // Admin: toggle receiving address active/disabled status
  router.patch(
    '/admin/purchase-orders/receiving-addresses/:id/status',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin'),
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      const existingAddresses = await store.listReceivingAddresses(false);
      const target = existingAddresses.find((a) => a.id === req.params.id);
      if (!target) {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Receiving address not found.' });
        return;
      }

      const { isActive, note } = req.body ?? {};
      if (typeof isActive !== 'boolean') {
        res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'isActive boolean is required.' });
        return;
      }

      const result = toggleReceivingAddressStatusRecord({
        addressRecord: target,
        nextIsActive: isActive,
        adminUserId: actor.userId,
        adminLabel: actor.fullName,
        adminRole: actor.role,
        note: typeof note === 'string' ? note : undefined,
        nowIso: new Date().toISOString(),
      });

      if (!result.ok || !result.data) {
        res.status(403).json({ ok: false, code: 'FORBIDDEN', message: result.error });
        return;
      }

      const saved = await store.upsertReceivingAddress(
        result.data,
        typeof note === 'string' ? note : `Toggled status to ${isActive ? 'active' : 'disabled'}`
      );
      res.json({ ok: true, data: saved });
    })
  );

  // Admin: list manual purchase orders with filtering
  router.get(
    '/admin/purchase-orders',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin', 'compliance_admin'),
    asyncHandler(async (req, res) => {
      const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const networkFilter = typeof req.query.network === 'string' ? req.query.network.trim() : '';
      const orders = await store.listOrders();
      const filtered = orders.filter((o) => {
        if (statusFilter && o.status !== statusFilter) return false;
        if (networkFilter && o.receivingNetwork !== networkFilter) return false;
        return true;
      });
      res.json({ ok: true, data: filtered });
    })
  );

  // Admin: review transition (UNDER_REVIEW / APPROVED / REJECTED)
  router.post(
    '/admin/purchase-orders/:id/review',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin', 'compliance_admin'),
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      const existing = await store.getOrderById(req.params.id);
      if (!existing) {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Purchase order not found.' });
        return;
      }

      const { targetStatus, checklist, adminRemark, rejectionReason, expectedVersion } =
        req.body ?? {};
      if (
        targetStatus !== 'UNDER_REVIEW' &&
        targetStatus !== 'APPROVED' &&
        targetStatus !== 'REJECTED'
      ) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'targetStatus must be UNDER_REVIEW, APPROVED, or REJECTED.',
        });
        return;
      }

      const hasDup =
        targetStatus === 'APPROVED' && existing.paymentTxHash
          ? await store.checkDuplicateTxHash({
              txHash: existing.paymentTxHash,
              networkCode: existing.receivingNetwork,
              excludeOrderId: existing.id,
            })
          : false;

      const existingOrders = hasDup
        ? [
            {
              ...existing,
              id: 'duplicate-sentinel',
              status: 'COMPLETED' as const,
            },
          ]
        : [existing];

      const result = reviewManualPurchaseOrderRecord({
        order: existing,
        adminUserId: actor.userId,
        adminLabel: actor.fullName,
        adminRole: actor.role,
        targetStatus,
        checklist: checklist as Partial<ManualPurchaseVerificationChecklist> | undefined,
        adminRemark: typeof adminRemark === 'string' ? adminRemark : undefined,
        rejectionReason: typeof rejectionReason === 'string' ? rejectionReason : undefined,
        expectedVersion: typeof expectedVersion === 'number' ? expectedVersion : undefined,
        existingOrders,
        eventId: crypto.randomUUID(),
        nowIso: new Date().toISOString(),
      });

      if (!result.ok || !result.data) {
        const isConflict =
          result.error?.includes('concurrent') ||
          result.error?.includes('Invalid') ||
          result.error?.includes('Duplicate') ||
          result.error?.includes('terminal');
        res.status(isConflict ? 409 : 400).json({
          ok: false,
          code: isConflict ? 'INVALID_TRANSITION' : 'VALIDATION_ERROR',
          message: result.error ?? 'Order review failed.',
        });
        return;
      }

      const typedStatus: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' = targetStatus;
      const evt = result.data.reviewHistory[result.data.reviewHistory.length - 1]!;
      let saved: ManualPurchaseOrder;
      try {
        saved = await store.saveOrderTransition(result.data, evt);
      } catch (err) {
        const mapped = classifyPgError(err);
        if (mapped) {
          res.status(mapped.status).json({ ok: false, code: mapped.code, message: mapped.message });
          return;
        }
        throw err;
      }

      const titleMap: Record<'UNDER_REVIEW' | 'APPROVED' | 'REJECTED', string> = {
        UNDER_REVIEW: `Order Under Review (${saved.orderRef})`,
        APPROVED: `Payment Approved for Fulfilment (${saved.orderRef})`,
        REJECTED: `Purchase Order Rejected (${saved.orderRef})`,
      };
      const msgMap: Record<'UNDER_REVIEW' | 'APPROVED' | 'REJECTED', string> = {
        UNDER_REVIEW: `An administrator is reviewing your payment reference for ${saved.pairSymbol}.`,
        APPROVED: `Your payment for ${saved.orderRef} passed verification and is approved for wallet ledger fulfilment.`,
        REJECTED: `Your purchase order ${saved.orderRef} was rejected. Reason: ${saved.rejectionReason}`,
      };

      await store.appendAuditAndNotification({
        adminUserId: actor.userId,
        adminLabel: actor.fullName,
        action: `MANUAL_PURCHASE_${typedStatus}`,
        recordId: saved.id,
        details: `${typedStatus} order ${saved.orderRef} (${saved.pairSymbol}). ${saved.rejectionReason || saved.adminRemark || ''}`,
        notifyUserId: saved.userId,
        notifyTitle: titleMap[typedStatus],
        notifyMessage: msgMap[typedStatus],
      });

      res.json({ ok: true, data: saved });
    })
  );

  // Admin: atomic fulfilment (APPROVED -> COMPLETED) + ledger credit
  router.post(
    '/admin/purchase-orders/:id/fulfil',
    auth,
    requireRole('super_admin', 'finance_admin'),
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      const existing = await store.getOrderById(req.params.id);
      if (!existing) {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Purchase order not found.' });
        return;
      }

      const { finalCryptoAmount, finalFeeUsdt, adminRemark, expectedVersion } = req.body ?? {};
      const resFulfil = await store.fulfilOrderAtomically({
        order: existing,
        adminUserId: actor.userId,
        adminLabel: actor.fullName,
        adminRole: actor.role,
        finalCryptoAmount:
          finalCryptoAmount !== undefined && finalCryptoAmount !== null
            ? Number(finalCryptoAmount)
            : undefined,
        finalFeeUsdt:
          finalFeeUsdt !== undefined && finalFeeUsdt !== null ? Number(finalFeeUsdt) : undefined,
        adminRemark: typeof adminRemark === 'string' ? adminRemark : undefined,
        expectedVersion: typeof expectedVersion === 'number' ? expectedVersion : undefined,
      });

      if (!resFulfil.ok || !resFulfil.order) {
        res.status(resFulfil.statusCode).json({
          ok: false,
          code: resFulfil.statusCode === 409 ? 'CONFLICT' : 'FULFILMENT_ERROR',
          message: resFulfil.error ?? 'Unable to fulfil purchase order.',
        });
        return;
      }

      const saved = resFulfil.order;
      await store.appendAuditAndNotification({
        adminUserId: actor.userId,
        adminLabel: actor.fullName,
        action: 'MANUAL_PURCHASE_FULFILLED',
        recordId: saved.id,
        details: `Fulfilled ${saved.orderRef}: credited ${saved.finalCryptoAmount} ${saved.baseAsset} via ledger tx ${saved.creditedTxId}.`,
        notifyUserId: saved.userId,
        notifyTitle: `Order Completed & Credited (${saved.orderRef})`,
        notifyMessage: `${saved.finalCryptoAmount} ${saved.baseAsset} has been credited to your internal wallet balance.`,
      });

      res.json({ ok: true, data: saved });
    })
  );

  return router;
}

export default createPurchaseOrdersRouter();
