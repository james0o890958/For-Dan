import React from 'react';
import { Check, Search, X } from 'lucide-react';
import { SUPPORTED_LANGUAGES } from '../../data/exchangeSeed';
import type {
  AccountStatus,
  DepositStatus,
  KycStatus,
  ManualPurchaseOrderStatus,
  MarketDataStatus,
  WithdrawalStatus,
} from '../../types/domain';

export const SearchInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  shape?: 'rounded' | 'pill';
}> = ({
  value,
  onChange,
  placeholder = 'Search keywords',
  ariaLabel = 'Search',
  className = '',
  shape = 'rounded',
}) => (
  <div
    className={`relative flex items-center ${shape === 'pill' ? 'rounded-full' : 'rounded-lg'} bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#24262E] focus-within:border-[#004AE2] transition-colors ${className}`}
  >
    <Search className="w-4 h-4 text-[#686D76] dark:text-[#7E828A] ml-3.5 shrink-0" aria-hidden="true" />
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-full bg-transparent px-3 py-2 text-xs sm:text-sm text-[#111214] dark:text-[#F4F5F7] placeholder:text-[#686D76] dark:placeholder:text-[#6E7178] focus:outline-none min-h-[38px]"
    />
  </div>
);

export const ChangeBadge: React.FC<{
  changePct: number;
  variant?: 'block' | 'text';
  unavailable?: boolean;
}> = ({ changePct, variant = 'block', unavailable = false }) => {
  if (unavailable) {
    return (
      <span className="inline-flex items-center justify-center min-w-[78px] px-2.5 py-1.5 rounded-md font-mono-num text-xs font-medium bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#7E828A] whitespace-nowrap shrink-0">
        —
      </span>
    );
  }
  const isPositive = changePct >= 0;
  const formatted = `${isPositive ? '+' : ''}${changePct.toFixed(2)}%`;

  if (variant === 'text') {
    return (
      <span
        className={`font-mono-num text-sm font-semibold whitespace-nowrap ${
          isPositive ? 'text-[#10C478]' : 'text-[#F0525E]'
        }`}
      >
        {formatted}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center min-w-[78px] px-2.5 py-1.5 rounded-md font-mono-num text-xs font-semibold text-white whitespace-nowrap shrink-0 ${
        isPositive ? 'bg-[#10C478]' : 'bg-[#F0525E]'
      }`}
    >
      {formatted}
    </span>
  );
};

export const CoinAvatar: React.FC<{
  symbol: string;
  color?: string;
  size?: 'sm' | 'md';
}> = ({ symbol, color = '#004AE2', size = 'md' }) => {
  const dims = size === 'sm' ? 'w-7 h-7 text-[11px]' : 'w-9 h-9 text-xs';
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: color }}
      className={`${dims} rounded-full inline-flex items-center justify-center font-bold text-white shrink-0`}
    >
      {symbol.slice(0, 3)}
    </span>
  );
};

export const KycStatusLabel: React.FC<{ status: KycStatus }> = ({ status }) => {
  const map: Record<KycStatus, { label: string; color: string }> = {
    approved: { label: 'Verified', color: 'text-[#10C478]' },
    pending: { label: 'Pending Review', color: 'text-[#D97706]' },
    rejected: { label: 'Rejected', color: 'text-[#F0525E]' },
    not_submitted: { label: 'Not Verified', color: 'text-[#686D76] dark:text-[#7E828A]' },
  };
  const info = map[status];
  return <span className={`text-xs font-semibold ${info.color}`}>{info.label}</span>;
};

export const AccountStatusLabel: React.FC<{ status: AccountStatus }> = ({ status }) => {
  const color =
    status === 'active'
      ? 'text-[#10C478]'
      : status === 'closed'
        ? 'text-[#686D76] dark:text-[#9CA0A8]'
        : 'text-[#F0525E]';
  const label = status === 'active' ? 'Active' : status === 'closed' ? 'Closed' : 'Suspended';
  return <span className={`text-xs font-semibold ${color}`}>{label}</span>;
};

export const DepositStatusLabel: React.FC<{ status: DepositStatus }> = ({ status }) => {
  const map: Record<DepositStatus, { label: string; color: string }> = {
    PENDING_DETECTION: { label: 'Pending Detection', color: 'text-[#686D76] dark:text-[#9CA0A8]' },
    DETECTED: { label: 'Detected', color: 'text-[#004AE2] dark:text-[#60A5FA]' },
    AWAITING_CONFIRMATIONS: { label: 'Awaiting Confirmations', color: 'text-[#D97706]' },
    PENDING_ADMIN_REVIEW: { label: 'Pending Admin Review', color: 'text-[#D97706]' },
    APPROVED: { label: 'Approved', color: 'text-[#10C478]' },
    CREDITED: { label: 'Credited', color: 'text-[#10C478]' },
    REJECTED: { label: 'Rejected', color: 'text-[#F0525E]' },
  };
  const info = map[status];
  return <span className={`text-xs font-semibold whitespace-nowrap ${info.color}`}>{info.label}</span>;
};

export const ManualPurchaseStatusLabel: React.FC<{ status: ManualPurchaseOrderStatus }> = ({
  status,
}) => {
  const map: Record<ManualPurchaseOrderStatus, { label: string; color: string }> = {
    PENDING_PAYMENT: { label: 'Pending Payment', color: 'text-[#D97706]' },
    PAYMENT_SUBMITTED: { label: 'Payment Submitted', color: 'text-[#004AE2] dark:text-[#60A5FA]' },
    UNDER_REVIEW: { label: 'Under Review', color: 'text-[#D97706]' },
    APPROVED: { label: 'Approved', color: 'text-[#10C478]' },
    COMPLETED: { label: 'Completed', color: 'text-[#10C478]' },
    REJECTED: { label: 'Rejected', color: 'text-[#F0525E]' },
    CANCELLED: { label: 'Cancelled', color: 'text-[#686D76] dark:text-[#7E828A]' },
  };
  const info = map[status];
  return <span className={`text-xs font-semibold whitespace-nowrap ${info.color}`}>{info.label}</span>;
};

export const WithdrawalStatusLabel: React.FC<{ status: WithdrawalStatus }> = ({ status }) => {
  const map: Record<WithdrawalStatus, { label: string; color: string }> = {
    REQUESTED: { label: 'Requested', color: 'text-[#686D76] dark:text-[#9CA0A8]' },
    RISK_REVIEW: { label: 'Risk Review', color: 'text-[#D97706]' },
    PENDING_ADMIN_APPROVAL: { label: 'Pending Approval', color: 'text-[#D97706]' },
    APPROVED: { label: 'Approved', color: 'text-[#004AE2] dark:text-[#60A5FA]' },
    PROCESSING: { label: 'Processing', color: 'text-[#004AE2] dark:text-[#60A5FA]' },
    BROADCAST: { label: 'Broadcast', color: 'text-[#004AE2] dark:text-[#60A5FA]' },
    CONFIRMING: { label: 'Confirming', color: 'text-[#D97706]' },
    COMPLETED: { label: 'Completed', color: 'text-[#10C478]' },
    REJECTED: { label: 'Rejected', color: 'text-[#F0525E]' },
    CANCELLED: { label: 'Cancelled', color: 'text-[#686D76] dark:text-[#7E828A]' },
    FAILED: { label: 'Failed', color: 'text-[#F0525E]' },
    REFUNDED: { label: 'Refunded', color: 'text-[#D97706]' },
  };
  const info = map[status];
  return <span className={`text-xs font-semibold whitespace-nowrap ${info.color}`}>{info.label}</span>;
};

export const MarketFeedLabel: React.FC<{ status: MarketDataStatus }> = ({ status }) => {
  const map: Record<MarketDataStatus, { label: string; color: string }> = {
    live: { label: 'Live Market Feed', color: 'text-[#10C478]' },
    delayed: { label: 'Delayed Market Feed', color: 'text-[#D97706]' },
    unavailable: { label: 'Market Feed Offline', color: 'text-[#F0525E]' },
  };
  const info = map[status];
  return <span className={`text-xs font-semibold ${info.color}`}>{info.label}</span>;
};

export const EmptyState: React.FC<{
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ title, description, action }) => (
  <div className="py-10 px-4 text-center rounded-xl border border-[#E2E4E9] dark:border-[#22242A] bg-white dark:bg-[#141518]">
    <p className="text-sm font-semibold text-[#111214] dark:text-[#F4F5F7]">{title}</p>
    <p className="mt-1 text-xs text-[#686D76] dark:text-[#7E828A] max-w-md mx-auto">{description}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  description: string;
  details?: { label: string; value: string }[];
  confirmLabel?: string;
  confirmTone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  description,
  details,
  confirmLabel = 'Confirm',
  confirmTone = 'primary',
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#24252C] p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="confirm-dialog-title" className="text-base font-semibold text-[#111214] dark:text-[#F4F5F7]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="p-1.5 rounded-lg text-[#686D76] hover:text-[#111214] dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-[#686D76] dark:text-[#9CA0A8]">{description}</p>

        {details && details.length > 0 && (
          <dl className="mt-4 space-y-2 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] p-3.5 border border-[#E2E4E9] dark:border-[#22242A]">
            {details.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 text-xs">
                <dt className="text-[#686D76] dark:text-[#7E828A]">{item.label}</dt>
                <dd className="font-mono-num font-semibold text-[#111214] dark:text-[#F4F5F7] text-right">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-full text-sm font-medium bg-[#E8EAEE] dark:bg-[#242528] text-[#111214] dark:text-[#F4F5F7] hover:opacity-90 whitespace-nowrap shrink-0 min-h-[42px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-5 py-2.5 rounded-full text-sm font-semibold text-white whitespace-nowrap shrink-0 min-h-[42px] ${
              confirmTone === 'danger'
                ? 'bg-[#F0525E] hover:bg-[#dc3f4b]'
                : 'bg-[#004AE2] hover:bg-[#003ec0]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const LanguageModal: React.FC<{
  open: boolean;
  selected: string;
  onSelect: (lang: string) => void;
  onClose: () => void;
}> = ({ open, selected, onSelect, onClose }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="language-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1C1D20] border border-[#E2E4E9] dark:border-[#2C2D32] p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <span className="w-6" aria-hidden="true" />
          <h2 id="language-modal-title" className="text-base font-semibold text-[#111214] dark:text-white">
            Language
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close language modal"
            className="p-1.5 rounded-lg text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = selected === lang;
            return (
              <button
                key={lang}
                type="button"
                onClick={() => {
                  onSelect(lang);
                  onClose();
                }}
                className={`relative py-3 px-3 rounded-lg text-sm font-medium transition-colors min-h-[46px] ${
                  active
                    ? 'bg-[#E8EAEE] dark:bg-[#2C2D30] text-[#111214] dark:text-white border border-[#111214] dark:border-white'
                    : 'bg-[#F4F5F7] dark:bg-[#2C2D30] text-[#3A3D45] dark:text-[#D5D7DC] border border-transparent hover:border-[#686D76]/40'
                }`}
              >
                {lang}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 right-0 w-5 h-5 rounded-tl-lg rounded-br-md bg-[#111214] dark:bg-white text-white dark:text-[#111214] flex items-center justify-center"
                  >
                    <Check className="w-3 h-3 stroke-[3]" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
