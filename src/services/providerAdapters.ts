import type {
  KytStatus,
  MarketPrice,
  ProviderHealth,
  TradeSide,
} from '../types/domain';

export interface ProviderCallResult<T> {
  ok: boolean;
  code: 'OK' | 'PROVIDER_NOT_CONFIGURED' | 'VALIDATION_ERROR' | 'UPSTREAM_ERROR';
  message: string;
  data?: T;
}

export interface CustodyDepositAddressResult {
  custodyVaultId: string;
  address: string;
  memoOrTag: string | null;
}

export interface CustodyBroadcastResult {
  custodyTxId: string;
  txHash: string;
}

export interface ICustodyProvider {
  readonly providerName: string;
  readonly isConfigured: boolean;
  getOrCreateDepositAddress(params: {
    userId: string;
    assetSymbol: string;
    networkCode: string;
  }): Promise<ProviderCallResult<CustodyDepositAddressResult>>;
  submitWithdrawal(params: {
    withdrawalId: string;
    assetSymbol: string;
    networkCode: string;
    destinationAddress: string;
    memoOrTag: string | null;
    netAmount: number;
    idempotencyKey: string;
  }): Promise<ProviderCallResult<CustodyBroadcastResult>>;
}

export interface VenueOrderExecutionResult {
  venueName: string;
  venueOrderId: string;
  venueTradeId: string;
  executedPrice: number;
  filledBaseQty: number;
  filledQuoteAmount: number;
  status: 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED';
  rejectReason: string | null;
}

export interface ILiquidityProvider {
  readonly providerName: string;
  readonly isConfigured: boolean;
  submitMarketOrder(params: {
    clientOrderId: string;
    venueSymbol: string;
    side: TradeSide;
    requestedAmount: number;
  }): Promise<ProviderCallResult<VenueOrderExecutionResult>>;
}

export interface IMarketDataProvider {
  readonly providerName: string;
  readonly isConfigured: boolean;
  fetchLatestQuotes(symbols: string[]): Promise<ProviderCallResult<MarketPrice[]>>;
}

export interface IKytProvider {
  readonly providerName: string;
  readonly isConfigured: boolean;
  screenTransaction(params: {
    networkCode: string;
    txHash?: string;
    address: string;
    direction: 'inbound' | 'outbound';
  }): Promise<ProviderCallResult<{ kytStatus: KytStatus; riskScore: number }>>;
}

export interface IKycProvider {
  readonly providerName: string;
  readonly isConfigured: boolean;
  createApplicantSession(params: {
    userId: string;
    fullName: string;
    country: string;
  }): Promise<ProviderCallResult<{ applicantId: string }>>;
}

/**
 * Phase A Boundary Adapters:
 * Explicitly return PROVIDER_NOT_CONFIGURED rather than fabricating addresses,
 * transactions, balances, or exchange executions.
 */
export const unconfiguredCustodyProvider: ICustodyProvider = {
  providerName: 'Institutional MPC Custody (Unconfigured)',
  isConfigured: false,
  async getOrCreateDepositAddress() {
    return {
      ok: false,
      code: 'PROVIDER_NOT_CONFIGURED',
      message:
        'Custody provider credentials are not configured yet (Phase D). Real deposit addresses cannot be generated in Phase A.',
    };
  },
  async submitWithdrawal() {
    return {
      ok: false,
      code: 'PROVIDER_NOT_CONFIGURED',
      message:
        'Custody MPC signer is not configured yet (Phase D). Real blockchain payouts cannot be broadcast in Phase A.',
    };
  },
};

export const unconfiguredLiquidityProvider: ILiquidityProvider = {
  providerName: 'Spot Liquidity Venue (Unconfigured)',
  isConfigured: false,
  async submitMarketOrder() {
    return {
      ok: false,
      code: 'PROVIDER_NOT_CONFIGURED',
      message:
        'External exchange / liquidity provider credentials are not configured yet (Phase D). Spot orders require an active venue.',
    };
  },
};

export const unconfiguredMarketDataProvider: IMarketDataProvider = {
  providerName: 'Exchange Market Data Feed (Unconfigured)',
  isConfigured: false,
  async fetchLatestQuotes() {
    return {
      ok: false,
      code: 'PROVIDER_NOT_CONFIGURED',
      message:
        'Live market data feed credentials are not configured yet (Phase C).',
    };
  },
};

export const INITIAL_PROVIDER_HEALTH: ProviderHealth[] = [
  {
    id: 'prov-market',
    name: 'Market Data Feed (WebSocket / REST)',
    category: 'market_data',
    status: 'not_configured',
    requiredPhase: 'Phase C',
    details: 'Awaiting external exchange/aggregator feed credentials.',
    lastCheckedAt: null,
  },
  {
    id: 'prov-custody',
    name: 'Institutional Custody & MPC Signer',
    category: 'custody',
    status: 'not_configured',
    requiredPhase: 'Phase D',
    details: 'Awaiting Fireblocks / BitGo / Copper vault policy & API credentials.',
    lastCheckedAt: null,
  },
  {
    id: 'prov-liquidity',
    name: 'Spot Liquidity & OMS Execution Venue',
    category: 'liquidity',
    status: 'not_configured',
    requiredPhase: 'Phase D',
    details: 'Awaiting institutional exchange sub-account & execution API keys.',
    lastCheckedAt: null,
  },
  {
    id: 'prov-kyt',
    name: 'Blockchain Indexer & KYT Screening',
    category: 'kyt_indexer',
    status: 'not_configured',
    requiredPhase: 'Phase C',
    details: 'Awaiting RPC node & Chainalysis / Elliptic / TRM screening keys.',
    lastCheckedAt: null,
  },
  {
    id: 'prov-kyc',
    name: 'Identity Verification (KYC) & Sanctions',
    category: 'kyc_sanctions',
    status: 'not_configured',
    requiredPhase: 'Phase C',
    details: 'Awaiting Sumsub / Onfido / Persona verification credentials.',
    lastCheckedAt: null,
  },
];
