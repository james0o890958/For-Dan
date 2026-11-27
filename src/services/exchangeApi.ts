import type {
  AdminAuditLog,
  AppRole,
  Asset,
  DepositAddress,
  DepositRecord,
  LedgerEntry,
  LedgerTransaction,
  ManualPurchaseOrder,
  ManualPurchaseVerificationChecklist,
  NetworkConfig,
  NotificationItem,
  Profile,
  ReceivingAddress,
  TradingPair,
  UserRoleRecord,
  WalletBalance,
} from '../types/domain';

export interface AuthSecurityEventRecord {
  id: string;
  eventType: 'register' | 'login_success' | 'login_failure';
  userId: string | null;
  identifierAttempted: string | null;
  ipAddress: string | null;
  ipVersion: 4 | 6 | null;
  ipSource: string;
  isGeolocationApproximate: boolean;
  locationNotice: string;
  countryCode: string | null;
  countryName: string | null;
  regionState: string | null;
  approximateCity: string | null;
  isp: string | null;
  asn: string | null;
  asnOrganization: string | null;
  deviceType: string;
  operatingSystem: string;
  browser: string;
  userAgentSummary: string;
  ipIntelProvider: string;
  ipIntelStatus: string;
  ipIntelError: string | null;
  vpnDetectionStatus: string;
  proxyDetectionStatus: string;
  torDetectionStatus: string;
  isVpn: boolean | null;
  isProxy: boolean | null;
  isResidentialProxy: boolean | null;
  isDatacenterProxy: boolean | null;
  isTor: boolean | null;
  createdAt: string;
}

export interface SecurityProviderStatusPayload {
  provider: string;
  endpoint: string;
  configured: boolean;
  trustedProxyHops: number;
  cacheEntries: number;
  locationNotice: string;
  capabilities: {
    geolocationApproximate: boolean;
    ispAndAsn: boolean;
    vpnProxyTorDetection: Record<string, unknown>;
  };
}

export interface SecurityEventsPayload {
  source: 'database' | 'runtime';
  locationNotice: string;
  events: AuthSecurityEventRecord[];
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  code?: string;
  message: string;
  data?: T;
}

async function apiRequest<T>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
  }
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(path, {
      method: options?.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      code?: string;
      message?: string;
      data?: T;
    } | null;

    const ok = Boolean(res.ok && json?.ok);
    const fallbackMessage = ok
      ? 'Request succeeded.'
      : `Request failed (HTTP ${res.status}).`;

    return {
      ok,
      status: res.status,
      code: json?.code,
      message: json?.message || fallbackMessage,
      data: json?.data,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Backend API service is unreachable. Please verify connectivity and try again.',
    };
  }
}

export interface WalletSummaryPayload {
  profile: Profile;
  role: AppRole;
  balances: WalletBalance[];
  depositAddresses: DepositAddress[];
  assets: Asset[];
  networks: NetworkConfig[];
  tradingPairs: TradingPair[];
  notifications: NotificationItem[];
}

export interface TransactionsPayload {
  transactions: LedgerTransaction[];
  entries: LedgerEntry[];
}

export interface AdminCustomersPayload {
  profiles: Profile[];
  userRoles: UserRoleRecord[];
}

export interface AdminLedgerPayload {
  walletBalances: WalletBalance[];
  ledgerTransactions: LedgerTransaction[];
  ledgerEntries: LedgerEntry[];
  auditLogs: AdminAuditLog[];
}

export const exchangeApi = {
  // Customer wallet, ledger & deposits
  fetchWalletSummary: () => apiRequest<WalletSummaryPayload>('/api/wallet/summary'),
  fetchTransactions: () => apiRequest<TransactionsPayload>('/api/transactions'),
  fetchCustomerDeposits: () => apiRequest<DepositRecord[]>('/api/deposits'),
  submitDeposit: (payload: {
    assetSymbol: string;
    networkCode: string;
    amount: number;
    txHash: string;
  }) => apiRequest<DepositRecord>('/api/deposits', { method: 'POST', body: payload }),

  // Customer manual crypto purchases
  fetchCustomerReceivingAddresses: () =>
    apiRequest<ReceivingAddress[]>('/api/purchase-orders/receiving-addresses'),
  fetchCustomerPurchaseOrders: () =>
    apiRequest<ManualPurchaseOrder[]>('/api/purchase-orders'),
  createPurchaseOrder: (payload: {
    pairSymbol: string;
    orderType: 'MARKET' | 'LIMIT';
    requestedQuoteAmount: number;
    limitPrice?: number | null;
    receivingAddressId: string;
  }) => apiRequest<ManualPurchaseOrder>('/api/purchase-orders', { method: 'POST', body: payload }),
  submitPurchasePayment: (
    orderId: string,
    payload: {
      paymentTxHash: string;
      actualAmountSent: number;
      paymentNote?: string;
    }
  ) =>
    apiRequest<ManualPurchaseOrder>(
      `/api/purchase-orders/${encodeURIComponent(orderId)}/payment`,
      { method: 'POST', body: payload }
    ),
  cancelPurchaseOrder: (orderId: string, reason?: string) =>
    apiRequest<ManualPurchaseOrder>(
      `/api/purchase-orders/${encodeURIComponent(orderId)}/cancel`,
      { method: 'POST', body: { reason } }
    ),

  // Admin customers, ledger & deposits
  fetchAdminCustomers: () => apiRequest<AdminCustomersPayload>('/api/admin/customers'),
  fetchAdminLedger: () => apiRequest<AdminLedgerPayload>('/api/admin/ledger'),
  fetchAdminDeposits: () => apiRequest<DepositRecord[]>('/api/admin/deposits'),
  fetchAdminDepositAddresses: () => apiRequest<DepositAddress[]>('/api/admin/deposits/addresses'),
  assignDepositAddress: (payload: {
    userId: string;
    assetSymbol: string;
    networkCode: string;
    address: string;
    memoOrTag?: string;
  }) => apiRequest<DepositAddress>('/api/admin/deposits/addresses', { method: 'POST', body: payload }),
  confirmDepositFinality: (depositId: string, confirmations?: number) =>
    apiRequest<DepositRecord>(
      `/api/admin/deposits/${encodeURIComponent(depositId)}/confirm-finality`,
      { method: 'POST', body: confirmations !== undefined ? { confirmations } : {} }
    ),
  reviewDeposit: (depositId: string, decision: 'approved' | 'rejected', adminNote: string) =>
    apiRequest<DepositRecord>(`/api/admin/deposits/${encodeURIComponent(depositId)}/review`, {
      method: 'POST',
      body: { decision, adminNote },
    }),

  // Admin manual crypto purchases & receiving addresses
  fetchAdminReceivingAddresses: () =>
    apiRequest<ReceivingAddress[]>('/api/admin/purchase-orders/receiving-addresses'),
  saveReceivingAddress: (payload: {
    id?: string;
    assetSymbol: string;
    networkCode: string;
    address: string;
    memoOrTag?: string;
    label?: string;
    isActive?: boolean;
  }) =>
    apiRequest<ReceivingAddress>('/api/admin/purchase-orders/receiving-addresses', {
      method: 'POST',
      body: payload,
    }),
  toggleReceivingAddressStatus: (addressId: string, isActive: boolean, note?: string) =>
    apiRequest<ReceivingAddress>(
      `/api/admin/purchase-orders/receiving-addresses/${encodeURIComponent(addressId)}/status`,
      { method: 'PATCH', body: { isActive, note } }
    ),
  fetchAdminPurchaseOrders: () =>
    apiRequest<ManualPurchaseOrder[]>('/api/admin/purchase-orders'),
  reviewManualPurchaseOrder: (
    orderId: string,
    payload: {
      targetStatus: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
      checklist?: Partial<ManualPurchaseVerificationChecklist>;
      adminRemark?: string;
      rejectionReason?: string;
      expectedVersion?: number;
    }
  ) =>
    apiRequest<ManualPurchaseOrder>(
      `/api/admin/purchase-orders/${encodeURIComponent(orderId)}/review`,
      { method: 'POST', body: payload }
    ),
  fulfilManualPurchaseOrder: (
    orderId: string,
    payload: {
      finalCryptoAmount?: number;
      finalFeeUsdt?: number;
      adminRemark?: string;
      expectedVersion?: number;
    }
  ) =>
    apiRequest<ManualPurchaseOrder>(
      `/api/admin/purchase-orders/${encodeURIComponent(orderId)}/fulfil`,
      { method: 'POST', body: payload }
    ),

  // Admin security & login activity
  fetchSecurityProviderStatus: () =>
    apiRequest<SecurityProviderStatusPayload>('/api/security/provider-status'),
  fetchAdminSecurityEvents: (limit = 100, eventType?: string) => {
    const q = new URLSearchParams();
    q.set('limit', String(limit));
    if (eventType && eventType !== 'ALL') q.set('eventType', eventType);
    return apiRequest<SecurityEventsPayload>(`/api/security/events?${q.toString()}`);
  },
};
