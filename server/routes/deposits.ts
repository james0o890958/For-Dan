import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/security';
import type {
  AccountStatus,
  AdminAuditLog,
  AppRole,
  Asset,
  DepositAddress,
  DepositRecord,
  DepositStatus,
  KycStatus,
  KytStatus,
  LedgerEntry,
  LedgerTransaction,
  LedgerTransactionType,
  NetworkConfig,
  NotificationCategory,
  NotificationItem,
  Profile,
  TradingPair,
  UserRoleRecord,
  WalletBalance,
} from '../../src/types/domain';
import { applyDepositApproval } from '../../src/utils/exchangeEngine';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function classifyPgError(err: unknown): { status: number; code: string; message: string } | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: string; message?: string; constraint?: string };
  const msg = e.message ?? 'Database operation failed.';

  if (e.code === '23505') {
    if (e.constraint?.includes('deposit_addresses') || msg.includes('uq_deposit_addresses_network_addr_memo')) {
      return {
        status: 409,
        code: 'CONFLICT',
        message: 'This deposit address and memo combination is already assigned on this network.',
      };
    }
    if (e.constraint?.includes('tx_hash') || e.constraint?.includes('deposits') || msg.includes('deposits_network_code_tx_hash')) {
      return {
        status: 409,
        code: 'CONFLICT',
        message: 'This transaction hash has already been recorded on this network.',
      };
    }
    if (e.constraint?.includes('idempotency_key')) {
      return {
        status: 409,
        code: 'CONFLICT',
        message: 'This operation has already been credited (idempotency guard).',
      };
    }
    return { status: 409, code: 'CONFLICT', message: 'Duplicate record conflict.' };
  }
  if (e.code === '23503') {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Referenced customer, asset, or network does not exist.' };
  }
  if (e.code === '22P02') {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Malformed identifier format.' };
  }
  if (e.code === 'P0001') {
    const isConflict = /closed|suspended|immutable|terminal|cannot create or modify/i.test(msg);
    return {
      status: isConflict ? 409 : 400,
      code: isConflict ? 'CONFLICT' : 'VALIDATION_ERROR',
      message: msg,
    };
  }
  return null;
}

const toIso = (val: unknown): string | null => {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
};

function mapDepositRow(row: Record<string, unknown>): DepositRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    assetSymbol: String(row.asset_symbol),
    networkCode: String(row.network_code),
    depositAddress: String(row.deposit_address),
    memoOrTag: row.memo_or_tag ? String(row.memo_or_tag) : null,
    txHash: String(row.tx_hash),
    fromAddress: row.from_address ? String(row.from_address) : null,
    amount: Number(row.amount),
    confirmations: Number(row.confirmations),
    requiredConfirmations: Number(row.required_confirmations),
    addressVerified: Boolean(row.address_verified),
    networkVerified: Boolean(row.network_verified),
    amountVerified: Boolean(row.amount_verified),
    duplicateChecked: Boolean(row.duplicate_checked),
    kytStatus: String(row.kyt_status) as KytStatus,
    kytRiskScore:
      row.kyt_risk_score !== null && row.kyt_risk_score !== undefined
        ? Number(row.kyt_risk_score)
        : null,
    status: String(row.status) as DepositStatus,
    adminNote: row.admin_note ? String(row.admin_note) : null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: toIso(row.reviewed_at),
    creditedTxId: row.credited_tx_id ? String(row.credited_tx_id) : null,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function mapDepositAddressRow(row: Record<string, unknown>): DepositAddress {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    assetSymbol: String(row.asset_symbol),
    networkCode: String(row.network_code),
    custodyVaultId: String(row.custody_vault_id),
    address: String(row.address),
    memoOrTag: row.memo_or_tag ? String(row.memo_or_tag) : null,
    createdAt: toIso(row.created_at) ?? '',
  };
}

function mapBalanceRow(row: Record<string, unknown>): WalletBalance {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    assetSymbol: String(row.asset_symbol),
    available: Number(row.available),
    reserved: Number(row.reserved),
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function mapProfileRow(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    publicUserId: String(row.public_user_id),
    email: String(row.email),
    fullName: String(row.full_name),
    phone: row.phone ? String(row.phone) : null,
    twoFactorEnabled: Boolean(row.totp_enabled),
    accountStatus: String(row.account_status) as AccountStatus,
    kycStatus: String(row.kyc_status) as KycStatus,
    preferredLanguage: String(row.preferred_language ?? 'English'),
    createdAt: toIso(row.created_at) ?? '',
  };
}

function mapNetworkRow(row: Record<string, unknown>): NetworkConfig {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    assetSymbol: String(row.asset_symbol),
    requiredConfirmations: Number(row.required_confirmations),
    minDeposit: Number(row.min_deposit),
    minWithdrawal: Number(row.min_withdrawal),
    networkFee: Number(row.network_fee),
    platformFee: Number(row.platform_fee),
    addressPattern: String(row.address_regex),
    memoRequired: Boolean(row.memo_required),
    isDepositEnabled: Boolean(row.is_deposit_enabled),
    isWithdrawalEnabled: Boolean(row.is_withdrawal_enabled),
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function mapAssetRow(row: Record<string, unknown>): Asset {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    name: String(row.name),
    decimals: Number(row.decimals),
    isEnabled: Boolean(row.is_enabled),
    sortOrder: Number(row.sort_order),
    badgeColor: String(row.badge_color),
    description: String(row.description),
  };
}

function mapPairRow(row: Record<string, unknown>): TradingPair {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    baseAsset: String(row.base_asset),
    quoteAsset: String(row.quote_asset),
    feeRate: Number(row.fee_rate),
    minOrderUsdt: Number(row.min_order_usdt),
    venueSymbol: row.venue_symbol ? String(row.venue_symbol) : '',
    isEnabled: Boolean(row.is_enabled),
  };
}

function mapLedgerTxRow(row: Record<string, unknown>): LedgerTransaction {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    type: String(row.type) as LedgerTransactionType,
    referenceId: String(row.reference_id),
    idempotencyKey: String(row.idempotency_key),
    sourceAccount: String(row.source_account),
    reasonCode: row.reason_code ? String(row.reason_code) : null,
    reversalOfTxId: row.reversal_of_tx_id ? String(row.reversal_of_tx_id) : null,
    summary: String(row.summary),
    createdAt: toIso(row.created_at) ?? '',
  };
}

function mapLedgerEntryRow(row: Record<string, unknown>): LedgerEntry {
  return {
    id: String(row.id),
    transactionId: String(row.transaction_id),
    userId: String(row.user_id),
    assetSymbol: String(row.asset_symbol),
    bucket: String(row.bucket) as LedgerEntry['bucket'],
    deltaAmount: Number(row.delta_amount),
    balanceAfter: Number(row.balance_after),
    entryRole: String(row.entry_role),
    createdAt: toIso(row.created_at) ?? '',
  };
}

function mapNotificationRow(row: Record<string, unknown>): NotificationItem {
  return {
    id: String(row.id),
    campaignId: row.campaign_id ? String(row.campaign_id) : 'system',
    userId: String(row.user_id),
    title: String(row.title),
    message: String(row.message),
    category: String(row.category) as NotificationCategory,
    isRead: Boolean(row.is_read),
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at) ?? '',
  };
}

function mapAuditLogRow(row: Record<string, unknown>): AdminAuditLog {
  return {
    id: String(row.id),
    adminUserId: String(row.admin_user_id),
    adminLabel: String(row.admin_label),
    action: String(row.action),
    affectedUserId: row.affected_user_id ? String(row.affected_user_id) : null,
    affectedPublicUserId: row.affected_public_user_id ? String(row.affected_public_user_id) : null,
    recordType: String(row.record_type),
    recordId: String(row.record_id),
    details: String(row.details),
    createdAt: toIso(row.created_at) ?? '',
  };
}

export interface DepositsRouterOptions {
  authMiddleware?: RequestHandler;
  pool?: Pool;
}

export function createDepositsRouter(options?: DepositsRouterOptions): Router {
  const router = Router();
  const auth = options?.authMiddleware ?? requireAuth;

  async function runInTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!options?.pool) {
      return withTransaction(fn);
    }
    const client = await options.pool.connect();
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

  // Customer: authoritative wallet summary (profile, balances, deposit addresses, catalog, notifications)
  router.get(
    '/wallet/summary',
    auth,
    asyncHandler(async (req, res) => {
      const userId = req.auth!.userId;
      const data = await runInTx(async (client) => {
        const [profileRes, balRes, addrRes, assetRes, netRes, pairRes, notifRes] = await Promise.all([
          client.query(
            `SELECT id, public_user_id, email, full_name, phone, totp_enabled,
                    account_status, kyc_status, preferred_language, created_at::text AS created_at
             FROM public.profiles
             WHERE id = $1
             LIMIT 1`,
            [userId]
          ),
          client.query(
            `SELECT id, user_id, asset_symbol, available::text AS available, reserved::text AS reserved,
                    updated_at::text AS updated_at
             FROM public.wallet_balances
             WHERE user_id = $1
             ORDER BY asset_symbol ASC`,
            [userId]
          ),
          client.query(
            `SELECT id, user_id, asset_symbol, network_code, custody_vault_id, address, memo_or_tag,
                    created_at::text AS created_at
             FROM public.deposit_addresses
             WHERE user_id = $1 AND is_active = TRUE
             ORDER BY created_at DESC`,
            [userId]
          ),
          client.query(
            `SELECT id, symbol, name, decimals, is_enabled, sort_order, badge_color, description
             FROM public.assets
             ORDER BY sort_order ASC`
          ),
          client.query(
            `SELECT id, code, name, asset_symbol, contract_address, required_confirmations,
                    min_deposit::text AS min_deposit, min_withdrawal::text AS min_withdrawal,
                    network_fee::text AS network_fee, platform_fee::text AS platform_fee,
                    address_regex, memo_required, is_deposit_enabled, is_withdrawal_enabled,
                    updated_at::text AS updated_at
             FROM public.networks
             ORDER BY asset_symbol ASC, code ASC`
          ),
          client.query(
            `SELECT id, symbol, base_asset, quote_asset, fee_rate::text AS fee_rate,
                    min_order_usdt::text AS min_order_usdt, venue_symbol, is_enabled
             FROM public.trading_pairs
             ORDER BY symbol ASC`
          ),
          client.query(
            `SELECT id, campaign_id, user_id, title, message, category, is_read,
                    read_at::text AS read_at, created_at::text AS created_at
             FROM public.notifications
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 100`,
            [userId]
          ),
        ]);

        const profileRow = profileRes.rows[0];
        if (!profileRow) return null;

        return {
          profile: mapProfileRow(profileRow),
          role: req.auth!.role,
          balances: balRes.rows.map(mapBalanceRow),
          depositAddresses: addrRes.rows.map(mapDepositAddressRow),
          assets: assetRes.rows.map(mapAssetRow),
          networks: netRes.rows.map(mapNetworkRow),
          tradingPairs: pairRes.rows.map(mapPairRow),
          notifications: notifRes.rows.map(mapNotificationRow),
        };
      });

      if (!data) {
        res.status(404).json({ ok: false, code: 'PROFILE_NOT_FOUND', message: 'Profile not found.' });
        return;
      }

      res.json({ ok: true, data });
    })
  );

  // Customer: authoritative ledger transactions & entries for own account
  router.get(
    '/transactions',
    auth,
    asyncHandler(async (req, res) => {
      const userId = req.auth!.userId;
      const data = await runInTx(async (client) => {
        const txRes = await client.query(
          `SELECT id, user_id, type, reference_id, idempotency_key, source_account,
                  reason_code, reversal_of_tx_id, summary, created_at::text AS created_at
           FROM public.ledger_transactions
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 200`,
          [userId]
        );
        const transactions = txRes.rows.map(mapLedgerTxRow);
        const txIds = transactions.map((t) => t.id);
        let entries: LedgerEntry[] = [];
        if (txIds.length > 0) {
          const entryRes = await client.query(
            `SELECT id, transaction_id, user_id, asset_symbol, bucket,
                    delta_amount::text AS delta_amount, balance_after::text AS balance_after,
                    entry_role, created_at::text AS created_at
             FROM public.ledger_entries
             WHERE user_id = $1 AND transaction_id = ANY($2::uuid[])
             ORDER BY created_at DESC`,
            [userId, txIds]
          );
          entries = entryRes.rows.map(mapLedgerEntryRow);
        }
        return { transactions, entries };
      });

      res.json({ ok: true, data });
    })
  );

  // Customer: list own deposit submissions
  router.get(
    '/deposits',
    auth,
    asyncHandler(async (req, res) => {
      const userId = req.auth!.userId;
      const rows = await runInTx(async (client) => {
        const result = await client.query(
          `SELECT * FROM public.deposits WHERE user_id = $1 ORDER BY created_at DESC`,
          [userId]
        );
        return result.rows.map(mapDepositRow);
      });
      res.json({ ok: true, data: rows });
    })
  );

  // Customer: submit crypto deposit reference against assigned deposit address
  router.post(
    '/deposits',
    auth,
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      const { assetSymbol, networkCode, amount, txHash } = req.body ?? {};
      const cleanedAsset = typeof assetSymbol === 'string' ? assetSymbol.trim().toUpperCase() : '';
      const cleanedNet = typeof networkCode === 'string' ? networkCode.trim().toUpperCase() : '';
      const cleanedHash = typeof txHash === 'string' ? txHash.trim() : '';
      const parsedAmount = Number(amount);

      if (!cleanedAsset || !cleanedNet) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'assetSymbol and networkCode are required.',
        });
        return;
      }
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Please enter a valid deposit amount greater than zero.',
        });
        return;
      }
      if (!cleanedHash || cleanedHash.length < 10 || /\s/.test(cleanedHash)) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'A valid transaction hash / reference (min 10 chars, no spaces) is required.',
        });
        return;
      }

      try {
        const outcome = await runInTx(async (client) => {
          await client.query('SELECT public.acquire_user_account_lock($1)', [actor.userId]);

          const profileRes = await client.query<{
            account_status: AccountStatus;
            kyc_status: KycStatus;
          }>(
            `SELECT account_status, kyc_status
             FROM public.profiles
             WHERE id = $1
             FOR KEY SHARE`,
            [actor.userId]
          );
          const profile = profileRes.rows[0];
          if (!profile || profile.account_status !== 'active') {
            return {
              status: 403,
              code: 'ACCOUNT_INACTIVE',
              message: `Account is ${profile?.account_status ?? 'inactive'}. Deposits are disabled.`,
            } as const;
          }
          if (profile.kyc_status !== 'approved') {
            return {
              status: 400,
              code: 'KYC_REQUIRED',
              message: 'Approved KYC verification is required before submitting deposits.',
            } as const;
          }

          const netRes = await client.query<{
            asset_symbol: string;
            code: string;
            required_confirmations: number;
            min_deposit: string;
            is_deposit_enabled: boolean;
          }>(
            `SELECT asset_symbol, code, required_confirmations, min_deposit::text AS min_deposit, is_deposit_enabled
             FROM public.networks
             WHERE UPPER(asset_symbol) = $1 AND UPPER(code) = $2
             LIMIT 1`,
            [cleanedAsset, cleanedNet]
          );
          const net = netRes.rows[0];
          if (!net) {
            return {
              status: 400,
              code: 'VALIDATION_ERROR',
              message: `Unsupported deposit asset or network (${cleanedAsset} / ${cleanedNet}).`,
            } as const;
          }
          if (!net.is_deposit_enabled) {
            return {
              status: 400,
              code: 'NETWORK_DISABLED',
              message: `Deposits on ${net.code} are currently disabled.`,
            } as const;
          }

          const minDeposit = Number(net.min_deposit);
          if (parsedAmount < minDeposit) {
            return {
              status: 400,
              code: 'VALIDATION_ERROR',
              message: `Amount is below the minimum deposit requirement of ${minDeposit} ${net.asset_symbol}.`,
            } as const;
          }

          const addrRes = await client.query<{
            address: string;
            memo_or_tag: string | null;
          }>(
            `SELECT address, memo_or_tag
             FROM public.deposit_addresses
             WHERE user_id = $1 AND asset_symbol = $2 AND network_code = $3 AND is_active = TRUE
             LIMIT 1`,
            [actor.userId, net.asset_symbol, net.code]
          );
          const assignedAddr = addrRes.rows[0];
          if (!assignedAddr) {
            return {
              status: 400,
              code: 'ADDRESS_REQUIRED',
              message: 'No deposit address assigned for this asset and network. Contact an administrator first.',
            } as const;
          }

          const dupDep = await client.query(
            `SELECT id
             FROM public.deposits
             WHERE UPPER(network_code) = UPPER($1) AND LOWER(tx_hash) = LOWER($2)
             LIMIT 1`,
            [net.code, cleanedHash]
          );
          if (dupDep.rows.length > 0) {
            return {
              status: 409,
              code: 'CONFLICT',
              message: 'Duplicate transaction hash detected on this network. This transaction has already been recorded.',
            } as const;
          }

          const dupMpo = await client.query(
            `SELECT id
             FROM public.manual_purchase_orders
             WHERE UPPER(receiving_network) = UPPER($1)
               AND LOWER(payment_tx_hash) = LOWER($2)
               AND status NOT IN ('REJECTED', 'CANCELLED')
             LIMIT 1`,
            [net.code, cleanedHash]
          );
          if (dupMpo.rows.length > 0) {
            return {
              status: 409,
              code: 'CONFLICT',
              message: 'Duplicate transaction hash detected on this network. It is already linked to an active purchase order.',
            } as const;
          }

          const depId = crypto.randomUUID();
          const insertRes = await client.query(
            `INSERT INTO public.deposits (
               id, user_id, asset_symbol, network_code, deposit_address, memo_or_tag,
               tx_hash, log_index, from_address, amount, confirmations, required_confirmations,
               address_verified, network_verified, amount_verified, duplicate_checked,
               kyt_status, kyt_risk_score, status
             ) VALUES (
               $1, $2, $3, $4, $5, $6,
               $7, 0, NULL, $8, 1, $9,
               TRUE, TRUE, TRUE, TRUE,
               'passed', 10, 'PENDING_ADMIN_REVIEW'
             )
             RETURNING *`,
            [
              depId,
              actor.userId,
              net.asset_symbol,
              net.code,
              assignedAddr.address,
              assignedAddr.memo_or_tag,
              cleanedHash,
              parsedAmount,
              net.required_confirmations,
            ]
          );
          const created = mapDepositRow(insertRes.rows[0]);

          await client.query(
            `INSERT INTO public.notifications (user_id, title, message, category)
             VALUES ($1, $2, $3, 'Deposit')`,
            [
              actor.userId,
              `Deposit Submitted (${created.assetSymbol} · ${created.networkCode})`,
              `Your deposit reference (${created.amount} ${created.assetSymbol}) has been queued for administrator verification.`,
            ]
          );

          return { status: 201, data: created } as const;
        });

        if ('code' in outcome) {
          res.status(outcome.status).json({
            ok: false,
            code: outcome.code,
            message: outcome.message,
          });
          return;
        }

        res.status(201).json({ ok: true, data: outcome.data });
      } catch (err) {
        const mapped = classifyPgError(err);
        if (mapped) {
          res.status(mapped.status).json({ ok: false, code: mapped.code, message: mapped.message });
          return;
        }
        throw err;
      }
    })
  );

  // Admin: list sanitized profiles and roles
  router.get(
    '/admin/customers',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin', 'compliance_admin'),
    asyncHandler(async (_req, res) => {
      const data = await runInTx(async (client) => {
        const [profilesRes, rolesRes] = await Promise.all([
          client.query(
            `SELECT id, public_user_id, email, full_name, phone, totp_enabled,
                    account_status, kyc_status, preferred_language, created_at::text AS created_at
             FROM public.profiles
             ORDER BY created_at DESC`
          ),
          client.query(
            `SELECT id, user_id, role, assigned_by, created_at::text AS created_at
             FROM public.user_roles
             ORDER BY created_at ASC`
          ),
        ]);
        const profiles = profilesRes.rows.map(mapProfileRow);
        const userRoles: UserRoleRecord[] = rolesRes.rows.map((r) => ({
          id: String(r.id),
          userId: String(r.user_id),
          role: String(r.role) as AppRole,
          assignedBy: r.assigned_by ? String(r.assigned_by) : 'system',
          createdAt: toIso(r.created_at) ?? '',
        }));
        return { profiles, userRoles };
      });
      res.json({ ok: true, data });
    })
  );

  // Admin: authoritative ledger snapshot for admin workspace & KPIs
  router.get(
    '/admin/ledger',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin', 'compliance_admin'),
    asyncHandler(async (_req, res) => {
      const data = await runInTx(async (client) => {
        const [balRes, txRes, entryRes, auditRes] = await Promise.all([
          client.query(
            `SELECT id, user_id, asset_symbol, available::text AS available, reserved::text AS reserved,
                    updated_at::text AS updated_at
             FROM public.wallet_balances
             ORDER BY updated_at DESC`
          ),
          client.query(
            `SELECT id, user_id, type, reference_id, idempotency_key, source_account,
                    reason_code, reversal_of_tx_id, summary, created_at::text AS created_at
             FROM public.ledger_transactions
             ORDER BY created_at DESC
             LIMIT 250`
          ),
          client.query(
            `SELECT id, transaction_id, user_id, asset_symbol, bucket,
                    delta_amount::text AS delta_amount, balance_after::text AS balance_after,
                    entry_role, created_at::text AS created_at
             FROM public.ledger_entries
             ORDER BY created_at DESC
             LIMIT 500`
          ),
          client.query(
            `SELECT id, admin_user_id, admin_label, action, affected_user_id,
                    affected_public_user_id, record_type, record_id, details,
                    created_at::text AS created_at
             FROM public.admin_audit_logs
             ORDER BY created_at DESC
             LIMIT 200`
          ),
        ]);
        return {
          walletBalances: balRes.rows.map(mapBalanceRow),
          ledgerTransactions: txRes.rows.map(mapLedgerTxRow),
          ledgerEntries: entryRes.rows.map(mapLedgerEntryRow),
          auditLogs: auditRes.rows.map(mapAuditLogRow),
        };
      });
      res.json({ ok: true, data });
    })
  );

  // Admin: list all deposits
  router.get(
    '/admin/deposits',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin', 'compliance_admin'),
    asyncHandler(async (_req, res) => {
      const rows = await runInTx(async (client) => {
        const result = await client.query(
          `SELECT * FROM public.deposits ORDER BY created_at DESC`
        );
        return result.rows.map(mapDepositRow);
      });
      res.json({ ok: true, data: rows });
    })
  );

  // Admin: list all customer deposit addresses
  router.get(
    '/admin/deposits/addresses',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin', 'compliance_admin'),
    asyncHandler(async (_req, res) => {
      const rows = await runInTx(async (client) => {
        const result = await client.query(
          `SELECT id, user_id, asset_symbol, network_code, custody_vault_id, address, memo_or_tag,
                  created_at::text AS created_at
           FROM public.deposit_addresses
           WHERE is_active = TRUE
           ORDER BY created_at DESC`
        );
        return result.rows.map(mapDepositAddressRow);
      });
      res.json({ ok: true, data: rows });
    })
  );

  // Admin: assign genuine deposit address to a customer
  router.post(
    '/admin/deposits/addresses',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin'),
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      const { userId, assetSymbol, networkCode, address, memoOrTag } = req.body ?? {};
      const cleanedUserId = typeof userId === 'string' ? userId.trim() : '';
      const cleanedAsset = typeof assetSymbol === 'string' ? assetSymbol.trim().toUpperCase() : '';
      const cleanedNet = typeof networkCode === 'string' ? networkCode.trim().toUpperCase() : '';
      const cleanedAddress = typeof address === 'string' ? address.trim() : '';
      const cleanedMemo = typeof memoOrTag === 'string' && memoOrTag.trim() ? memoOrTag.trim() : null;

      if (!UUID_REGEX.test(cleanedUserId)) {
        res.status(400).json({ ok: false, code: 'VALIDATION_ERROR', message: 'Valid customer userId is required.' });
        return;
      }
      if (!cleanedAsset || !cleanedNet || !cleanedAddress) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'assetSymbol, networkCode, and deposit address are required.',
        });
        return;
      }

      try {
        const outcome = await runInTx(async (client) => {
          await client.query('SELECT public.acquire_user_account_lock($1)', [cleanedUserId]);

          const custRes = await client.query<{
            id: string;
            public_user_id: string;
            account_status: AccountStatus;
          }>(
            `SELECT id, public_user_id, account_status
             FROM public.profiles
             WHERE id = $1
             FOR KEY SHARE`,
            [cleanedUserId]
          );
          const customer = custRes.rows[0];
          if (!customer) {
            return { status: 404, code: 'NOT_FOUND', message: 'Customer profile not found.' } as const;
          }
          if (customer.account_status !== 'active') {
            return {
              status: 409,
              code: 'ACCOUNT_INACTIVE',
              message: `Cannot assign deposit address to ${customer.account_status} customer account.`,
            } as const;
          }

          const netRes = await client.query<{
            asset_symbol: string;
            code: string;
            address_regex: string;
            memo_required: boolean;
          }>(
            `SELECT asset_symbol, code, address_regex, memo_required
             FROM public.networks
             WHERE UPPER(asset_symbol) = $1 AND UPPER(code) = $2
             LIMIT 1`,
            [cleanedAsset, cleanedNet]
          );
          const net = netRes.rows[0];
          if (!net) {
            return {
              status: 400,
              code: 'VALIDATION_ERROR',
              message: `Unsupported asset or network (${cleanedAsset} / ${cleanedNet}).`,
            } as const;
          }

          try {
            const regex = new RegExp(net.address_regex);
            if (!regex.test(cleanedAddress)) {
              return {
                status: 400,
                code: 'VALIDATION_ERROR',
                message: `Address format does not match ${net.code} network validation rules.`,
              } as const;
            }
          } catch {
            // Ignore malformed pattern in DB
          }

          if (net.memo_required && !cleanedMemo) {
            return {
              status: 400,
              code: 'VALIDATION_ERROR',
              message: `Destination tag/memo is required for ${net.code}.`,
            } as const;
          }

          const addrId = crypto.randomUUID();
          const upsertRes = await client.query(
            `INSERT INTO public.deposit_addresses (
               id, user_id, asset_symbol, network_code, custody_vault_id, address, memo_or_tag, is_active
             ) VALUES (
               $1, $2, $3, $4, 'vault-manual-admin', $5, $6, TRUE
             )
             ON CONFLICT (user_id, asset_symbol, network_code) DO UPDATE SET
               address = EXCLUDED.address,
               memo_or_tag = EXCLUDED.memo_or_tag,
               custody_vault_id = EXCLUDED.custody_vault_id,
               is_active = TRUE
             RETURNING id, user_id, asset_symbol, network_code, custody_vault_id, address, memo_or_tag, created_at::text AS created_at`,
            [addrId, cleanedUserId, net.asset_symbol, net.code, cleanedAddress, cleanedMemo]
          );
          const savedAddr = mapDepositAddressRow(upsertRes.rows[0]);

          await client.query(
            `INSERT INTO public.admin_audit_logs (
               admin_user_id, admin_label, action, affected_user_id, affected_public_user_id,
               record_type, record_id, details
             ) VALUES ($1, $2, 'DEPOSIT_ADDRESS_ASSIGNED', $3, $4, 'deposit_addresses', $5, $6)`,
            [
              actor.userId,
              `${actor.fullName} (${actor.role})`,
              cleanedUserId,
              customer.public_user_id,
              savedAddr.id,
              `Assigned ${savedAddr.assetSymbol} (${savedAddr.networkCode}) deposit address ${savedAddr.address}`,
            ]
          );

          await client.query(
            `INSERT INTO public.notifications (user_id, title, message, category)
             VALUES ($1, $2, $3, 'Deposit')`,
            [
              cleanedUserId,
              `Deposit Address Assigned (${savedAddr.assetSymbol} · ${savedAddr.networkCode})`,
              `An administrator assigned your custody deposit address for ${savedAddr.assetSymbol} on ${savedAddr.networkCode}.`,
            ]
          );

          return { status: 201, data: savedAddr } as const;
        });

        if ('code' in outcome) {
          res.status(outcome.status).json({ ok: false, code: outcome.code, message: outcome.message });
          return;
        }
        res.status(201).json({ ok: true, data: outcome.data });
      } catch (err) {
        const mapped = classifyPgError(err);
        if (mapped) {
          res.status(mapped.status).json({ ok: false, code: mapped.code, message: mapped.message });
          return;
        }
        throw err;
      }
    })
  );

  // Admin: verify block confirmation finality for a deposit
  router.post(
    '/admin/deposits/:id/confirm-finality',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin'),
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      const depositId = req.params.id;
      if (!UUID_REGEX.test(depositId)) {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Deposit record not found.' });
        return;
      }

      const rawConf = req.body?.confirmations;
      const requestedConf =
        rawConf !== undefined && rawConf !== null ? Number(rawConf) : undefined;
      if (
        requestedConf !== undefined &&
        (!Number.isInteger(requestedConf) || requestedConf < 0)
      ) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'confirmations must be a non-negative integer.',
        });
        return;
      }

      try {
        const outcome = await runInTx(async (client) => {
          const existingRes = await client.query(
            `SELECT * FROM public.deposits WHERE id = $1 FOR UPDATE`,
            [depositId]
          );
          const row = existingRes.rows[0];
          if (!row) {
            return { status: 404, code: 'NOT_FOUND', message: 'Deposit record not found.' } as const;
          }
          const current = mapDepositRow(row);
          if (current.status === 'CREDITED' || current.status === 'REJECTED') {
            return {
              status: 409,
              code: 'INVALID_TRANSITION',
              message: 'Cannot modify block confirmations for a terminal deposit.',
            } as const;
          }

          await client.query('SELECT public.acquire_user_account_lock($1)', [current.userId]);
          const nextConf = Math.max(
            current.confirmations,
            requestedConf ?? current.requiredConfirmations
          );

          const updatedRes = await client.query(
            `UPDATE public.deposits
             SET confirmations = $2, updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [depositId, nextConf]
          );
          const updated = mapDepositRow(updatedRes.rows[0]);

          await client.query(
            `INSERT INTO public.admin_audit_logs (
               admin_user_id, admin_label, action, affected_user_id,
               record_type, record_id, details
             ) VALUES ($1, $2, 'DEPOSIT_FINALITY_VERIFIED', $3, 'deposits', $4, $5)`,
            [
              actor.userId,
              `${actor.fullName} (${actor.role})`,
              updated.userId,
              updated.id,
              `Verified block finality for deposit ${updated.amount} ${updated.assetSymbol} (${updated.networkCode}): ${updated.confirmations}/${updated.requiredConfirmations} confirmations.`,
            ]
          );

          return { status: 200, data: updated } as const;
        });

        if ('code' in outcome) {
          res.status(outcome.status).json({ ok: false, code: outcome.code, message: outcome.message });
          return;
        }
        res.json({ ok: true, data: outcome.data });
      } catch (err) {
        const mapped = classifyPgError(err);
        if (mapped) {
          res.status(mapped.status).json({ ok: false, code: mapped.code, message: mapped.message });
          return;
        }
        throw err;
      }
    })
  );

  // Admin: reject or atomically approve & credit a deposit once
  router.post(
    '/admin/deposits/:id/review',
    auth,
    requireRole('super_admin', 'finance_admin', 'operations_admin', 'compliance_admin'),
    asyncHandler(async (req, res) => {
      const actor = req.auth!;
      const depositId = req.params.id;
      if (!UUID_REGEX.test(depositId)) {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Deposit record not found.' });
        return;
      }

      const { decision, adminNote } = req.body ?? {};
      if (decision !== 'approved' && decision !== 'rejected') {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'decision must be approved or rejected.',
        });
        return;
      }

      if (decision === 'approved' && actor.role !== 'super_admin' && actor.role !== 'finance_admin') {
        res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          message: 'Only Super Admin or Finance Admin can approve and credit deposits to internal wallet ledger.',
        });
        return;
      }

      const cleanedNote = typeof adminNote === 'string' ? adminNote.trim() : '';

      try {
        const outcome = await runInTx(async (client) => {
          const preRes = await client.query<{ user_id: string }>(
            `SELECT user_id FROM public.deposits WHERE id = $1`,
            [depositId]
          );
          if (preRes.rows.length === 0) {
            return { status: 404, code: 'NOT_FOUND', message: 'Deposit record not found.' } as const;
          }
          const ownerUserId = String(preRes.rows[0].user_id);

          await client.query('SELECT public.acquire_user_account_lock($1)', [ownerUserId]);

          const depRes = await client.query(
            `SELECT * FROM public.deposits WHERE id = $1 FOR UPDATE`,
            [depositId]
          );
          const lockedDeposit = mapDepositRow(depRes.rows[0]);

          const profileRes = await client.query<{
            account_status: AccountStatus;
            public_user_id: string;
          }>(
            `SELECT account_status, public_user_id
             FROM public.profiles
             WHERE id = $1
             FOR KEY SHARE`,
            [ownerUserId]
          );
          const customer = profileRes.rows[0];
          const customerStatus: AccountStatus = customer?.account_status ?? 'closed';

          if (decision === 'rejected') {
            if (lockedDeposit.status === 'CREDITED' || lockedDeposit.status === 'REJECTED') {
              return {
                status: 409,
                code: 'INVALID_TRANSITION',
                message: 'This deposit has already reached a terminal state.',
              } as const;
            }
            const noteToSave = cleanedNote || 'Rejected by administrator';
            const rejRes = await client.query(
              `UPDATE public.deposits
               SET status = 'REJECTED',
                   admin_note = $2,
                   reviewed_by = $3,
                   reviewed_at = NOW(),
                   updated_at = NOW()
               WHERE id = $1 AND status NOT IN ('CREDITED', 'REJECTED')
               RETURNING *`,
              [depositId, noteToSave, actor.userId]
            );
            if (rejRes.rows.length === 0) {
              return {
                status: 409,
                code: 'CONFLICT',
                message: 'Deposit state changed concurrently. Refresh and retry.',
              } as const;
            }
            const rejected = mapDepositRow(rejRes.rows[0]);

            await client.query(
              `INSERT INTO public.admin_audit_logs (
                 admin_user_id, admin_label, action, affected_user_id, affected_public_user_id,
                 record_type, record_id, details
               ) VALUES ($1, $2, 'DEPOSIT_REJECTED', $3, $4, 'deposits', $5, $6)`,
              [
                actor.userId,
                `${actor.fullName} (${actor.role})`,
                ownerUserId,
                customer?.public_user_id ?? null,
                rejected.id,
                `Rejected deposit ${rejected.amount} ${rejected.assetSymbol} (${rejected.networkCode}). ${noteToSave}`,
              ]
            );

            await client.query(
              `INSERT INTO public.notifications (user_id, title, message, category)
               VALUES ($1, $2, $3, 'Deposit')`,
              [
                ownerUserId,
                `Deposit Rejected (${rejected.assetSymbol} · ${rejected.networkCode})`,
                `Your deposit (${rejected.amount} ${rejected.assetSymbol}) was rejected. Reason: ${noteToSave}`,
              ]
            );

            return { status: 200, data: rejected } as const;
          }

          // Approval & Atomic Ledger Credit
          const [balRes, idemRes, dupDepRes, dupMpoRes] = await Promise.all([
            client.query(
              `SELECT id, user_id, asset_symbol, available::text AS available, reserved::text AS reserved, updated_at::text AS updated_at
               FROM public.wallet_balances
               WHERE user_id = $1 AND asset_symbol = $2
               FOR UPDATE`,
              [ownerUserId, lockedDeposit.assetSymbol]
            ),
            client.query(
              `SELECT id, user_id, type, reference_id, idempotency_key, source_account, reason_code, reversal_of_tx_id, summary, created_at::text AS created_at
               FROM public.ledger_transactions
               WHERE idempotency_key = $1`,
              [`dep-approve-${lockedDeposit.id}`]
            ),
            client.query(
              `SELECT id FROM public.deposits
               WHERE id <> $1
                 AND UPPER(network_code) = UPPER($2)
                 AND LOWER(tx_hash) = LOWER($3)
                 AND status IN ('APPROVED', 'CREDITED')
               LIMIT 1`,
              [lockedDeposit.id, lockedDeposit.networkCode, lockedDeposit.txHash]
            ),
            client.query(
              `SELECT id FROM public.manual_purchase_orders
               WHERE UPPER(receiving_network) = UPPER($1)
                 AND LOWER(payment_tx_hash) = LOWER($2)
                 AND status NOT IN ('REJECTED', 'CANCELLED')
               LIMIT 1`,
              [lockedDeposit.networkCode, lockedDeposit.txHash]
            ),
          ]);

          const existingDeposits: DepositRecord[] = [lockedDeposit];
          if (dupDepRes.rows.length > 0) {
            existingDeposits.push({
              ...lockedDeposit,
              id: 'duplicate-deposit-sentinel',
              status: 'CREDITED',
            });
          }

          const existingManualOrders =
            dupMpoRes.rows.length > 0
              ? [
                  {
                    id: 'duplicate-mpo-sentinel',
                    receivingNetwork: lockedDeposit.networkCode,
                    paymentTxHash: lockedDeposit.txHash,
                    status: 'APPROVED' as const,
                  },
                ]
              : [];

          const currentBalances = balRes.rows.map(mapBalanceRow);
          const existingLedgerTxs = idemRes.rows.map(mapLedgerTxRow);

          const applied = applyDepositApproval({
            deposit: lockedDeposit,
            existingDeposits,
            balances: currentBalances,
            ledgerTransactions: existingLedgerTxs,
            customerAccountStatus: customerStatus,
            existingManualPurchaseOrders: existingManualOrders as never,
            adminUserId: actor.userId,
            adminNote: cleanedNote,
            nowIso: new Date().toISOString(),
            txId: crypto.randomUUID(),
            entryId: crypto.randomUUID(),
            balanceId: crypto.randomUUID(),
          });

          if (!applied.ok || !applied.data) {
            const isConflict = /PENDING_ADMIN_REVIEW|Duplicate|collides|idempotency|closed|suspended/i.test(
              applied.error ?? ''
            );
            return {
              status: isConflict ? 409 : 400,
              code: isConflict ? 'CONFLICT' : 'VALIDATION_ERROR',
              message: applied.error ?? 'Deposit verification failed.',
            } as const;
          }

          const { updatedDeposit, newTransaction, newEntry } = applied.data;
          const targetBalance = applied.data.updatedBalances.find(
            (b) => b.userId === ownerUserId && b.assetSymbol === lockedDeposit.assetSymbol
          )!;

          await client.query(
            `INSERT INTO public.wallet_balances (id, user_id, asset_symbol, available, reserved, updated_at)
             VALUES ($1, $2, $3, $4, 0, NOW())
             ON CONFLICT (user_id, asset_symbol) DO UPDATE SET
               available = $4,
               updated_at = NOW()`,
            [targetBalance.id, ownerUserId, lockedDeposit.assetSymbol, targetBalance.available]
          );

          await client.query(
            `INSERT INTO public.ledger_transactions (
               id, user_id, type, reference_id, idempotency_key, source_account, reason_code, summary
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              newTransaction.id,
              newTransaction.userId,
              newTransaction.type,
              newTransaction.referenceId,
              newTransaction.idempotencyKey,
              newTransaction.sourceAccount,
              newTransaction.reasonCode,
              newTransaction.summary,
            ]
          );

          await client.query(
            `INSERT INTO public.ledger_entries (
               id, transaction_id, user_id, asset_symbol, bucket, delta_amount, balance_after, entry_role
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              newEntry.id,
              newEntry.transactionId,
              newEntry.userId,
              newEntry.assetSymbol,
              newEntry.bucket,
              newEntry.deltaAmount,
              newEntry.balanceAfter,
              newEntry.entryRole,
            ]
          );

          const credRes = await client.query(
            `UPDATE public.deposits
             SET status = 'CREDITED',
                 admin_note = $2,
                 reviewed_by = $3,
                 reviewed_at = NOW(),
                 credited_tx_id = $4,
                 updated_at = NOW()
             WHERE id = $1 AND status = 'PENDING_ADMIN_REVIEW'
             RETURNING *`,
            [depositId, updatedDeposit.adminNote, actor.userId, newTransaction.id]
          );

          if (credRes.rows.length === 0) {
            throw new Error('CONCURRENT_DEPOSIT_CONFLICT');
          }

          const credited = mapDepositRow(credRes.rows[0]);

          await client.query(
            `INSERT INTO public.admin_audit_logs (
               admin_user_id, admin_label, action, affected_user_id, affected_public_user_id,
               record_type, record_id, details
             ) VALUES ($1, $2, 'DEPOSIT_VERIFIED_AND_CREDITED', $3, $4, 'deposits', $5, $6)`,
            [
              actor.userId,
              `${actor.fullName} (${actor.role})`,
              ownerUserId,
              customer?.public_user_id ?? null,
              credited.id,
              `Approved & credited verified deposit of ${credited.amount} ${credited.assetSymbol} (${credited.networkCode}, tx ${credited.txHash}) via ledger tx ${newTransaction.id}.`,
            ]
          );

          await client.query(
            `INSERT INTO public.notifications (user_id, title, message, category)
             VALUES ($1, $2, $3, 'Deposit')`,
            [
              ownerUserId,
              `Deposit Credited (${credited.amount} ${credited.assetSymbol})`,
              `Your verified ${credited.networkCode} deposit of ${credited.amount} ${credited.assetSymbol} has been credited to your internal wallet ledger.`,
            ]
          );

          return { status: 200, data: credited } as const;
        });

        if ('code' in outcome) {
          res.status(outcome.status).json({ ok: false, code: outcome.code, message: outcome.message });
          return;
        }

        res.json({ ok: true, data: outcome.data });
      } catch (err) {
        if (err instanceof Error && err.message === 'CONCURRENT_DEPOSIT_CONFLICT') {
          res.status(409).json({
            ok: false,
            code: 'CONFLICT',
            message: 'Deposit was modified concurrently by another operation. Refresh and retry.',
          });
          return;
        }
        const mapped = classifyPgError(err);
        if (mapped) {
          res.status(mapped.status).json({ ok: false, code: mapped.code, message: mapped.message });
          return;
        }
        throw err;
      }
    })
  );

  return router;
}

export default createDepositsRouter();
