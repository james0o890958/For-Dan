import React, { useMemo, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { EmptyState, WithdrawalStatusLabel } from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import { formatQty } from '../../utils/tradingMath';

export const AdminWithdrawalsPage: React.FC = () => {
  const {
    withdrawals,
    profiles,
    reviewWithdrawal,
    dispatchApprovedWithdrawal,
    finalizeWithdrawalRecord,
    refundFailedWithdrawal,
  } = useAppState();

  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const activeQueue = useMemo(
    () =>
      withdrawals.filter(
        (w) =>
          w.status === 'REQUESTED' ||
          w.status === 'RISK_REVIEW' ||
          w.status === 'PENDING_ADMIN_APPROVAL' ||
          w.status === 'APPROVED' ||
          w.status === 'PROCESSING' ||
          w.status === 'BROADCAST' ||
          w.status === 'CONFIRMING' ||
          w.status === 'FAILED'
      ),
    [withdrawals]
  );

  const terminalHistory = useMemo(
    () =>
      withdrawals.filter(
        (w) =>
          w.status === 'COMPLETED' ||
          w.status === 'REJECTED' ||
          w.status === 'CANCELLED' ||
          w.status === 'REFUNDED'
      ),
    [withdrawals]
  );

  return (
    <AdminLayout title="Withdrawal Operations & Dual Control">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('queue')}
              className={`px-4 py-2 rounded-full text-xs font-semibold ${
                tab === 'queue'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Active Withdrawal Queue ({activeQueue.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('history')}
              className={`px-4 py-2 rounded-full text-xs font-semibold ${
                tab === 'history'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Completed / Closed ({terminalHistory.length})
            </button>
          </div>

          {feedback && (
            <p
              role="status"
              className={`text-xs font-medium ${feedback.ok ? 'text-[#10C478]' : 'text-[#F0525E]'}`}
            >
              {feedback.text}
            </p>
          )}
        </div>

        {tab === 'queue' ? (
          activeQueue.length === 0 ? (
            <EmptyState
              title="No active withdrawal requests"
              description="Customer withdrawal requests enter this queue after balance reservation and 2FA check. High-risk withdrawals enforce distinct dual-admin approval."
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {activeQueue.map((w) => {
                const customer = profileMap.get(w.userId);
                const approvedCount = w.approvals.filter((a) => a.decision === 'approved').length;
                return (
                  <div
                    key={w.id}
                    className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold">{customer?.fullName ?? 'Customer'}</p>
                        <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                          {customer?.email} ·{' '}
                          <span className="font-mono-num">ID {customer?.publicUserId}</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-bold font-mono-num">
                          {formatQty(w.grossAmount)} {w.assetSymbol}
                        </p>
                        <WithdrawalStatusLabel status={w.status} />
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 gap-3 text-xs rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] p-3">
                      <div>
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Network</dt>
                        <dd className="font-medium mt-0.5">{w.networkCode}</dd>
                      </div>
                      <div>
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Net Payout</dt>
                        <dd className="font-mono-num font-semibold mt-0.5">
                          {formatQty(w.netAmount)} {w.assetSymbol}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Destination</dt>
                        <dd className="font-mono-num break-all mt-0.5">
                          {w.destinationAddress}
                          {w.memoOrTag ? ` (Tag: ${w.memoOrTag})` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Risk / KYT</dt>
                        <dd className="capitalize font-semibold mt-0.5">
                          {w.riskLevel} · KYT {w.kytStatus}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Approvals (Maker-Checker)</dt>
                        <dd className="font-mono-num font-semibold mt-0.5">
                          {approvedCount} / {w.requiredApprovals}
                        </dd>
                      </div>
                    </dl>

                    {w.status === 'PENDING_ADMIN_APPROVAL' && (
                      <>
                        <div>
                          <label
                            htmlFor={`wd-note-${w.id}`}
                            className="block text-xs font-medium mb-1"
                          >
                            Review / Rejection Note
                          </label>
                          <input
                            id={`wd-note-${w.id}`}
                            type="text"
                            value={notes[w.id] ?? ''}
                            onChange={(e) =>
                              setNotes((prev) => ({ ...prev, [w.id]: e.target.value }))
                            }
                            placeholder="Approval note or mandatory rejection reason"
                            className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              const res = reviewWithdrawal(w.id, 'approved', notes[w.id] ?? '');
                              setFeedback({ ok: res.ok, text: res.message });
                            }}
                            className="flex-1 h-10 rounded-full bg-[#10C478] text-white text-xs font-semibold hover:opacity-95"
                          >
                            Record Approval ({approvedCount}/{w.requiredApprovals})
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const res = reviewWithdrawal(w.id, 'rejected', notes[w.id] ?? '');
                              setFeedback({ ok: res.ok, text: res.message });
                            }}
                            className="flex-1 h-10 rounded-full bg-[#F0525E] text-white text-xs font-semibold hover:opacity-95"
                          >
                            Reject &amp; Release
                          </button>
                        </div>
                      </>
                    )}

                    {w.status === 'APPROVED' && (
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await dispatchApprovedWithdrawal(w.id);
                            setFeedback({ ok: res.ok, text: res.message });
                          }}
                          className="flex-1 h-10 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
                        >
                          Dispatch via Custody Provider
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const res = refundFailedWithdrawal(
                              w.id,
                              'Cancelled / refunded before custody broadcast'
                            );
                            setFeedback({ ok: res.ok, text: res.message });
                          }}
                          className="px-4 h-10 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold"
                        >
                          Refund Reserve
                        </button>
                      </div>
                    )}

                    {w.status === 'CONFIRMING' && (
                      <button
                        type="button"
                        onClick={() => {
                          const res = finalizeWithdrawalRecord(w.id);
                          setFeedback({ ok: res.ok, text: res.message });
                        }}
                        className="w-full h-10 rounded-full bg-[#10C478] text-white text-xs font-semibold"
                      >
                        Finalize Settlement ({w.confirmations}/{w.requiredConfirmations})
                      </button>
                    )}

                    {(w.status === 'FAILED' || w.status === 'PROCESSING') && (
                      <button
                        type="button"
                        onClick={() => {
                          const res = refundFailedWithdrawal(w.id, 'Failed broadcast refunded');
                          setFeedback({ ok: res.ok, text: res.message });
                        }}
                        className="w-full h-10 rounded-full bg-[#D97706] text-white text-xs font-semibold"
                      >
                        Refund Reserved Balance
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : terminalHistory.length === 0 ? (
          <EmptyState
            title="No completed or closed withdrawals"
            description="Completed, rejected, cancelled, and refunded withdrawal requests appear here."
          />
        ) : (
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                    <th className="py-3 px-4 font-medium">Customer</th>
                    <th className="py-3 px-4 font-medium">Asset / Network</th>
                    <th className="py-3 px-4 font-medium">Destination</th>
                    <th className="py-3 px-4 font-medium text-right">Net Amount</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {terminalHistory.map((w) => {
                    const customer = profileMap.get(w.userId);
                    return (
                      <tr key={w.id}>
                        <td className="py-3 px-4">
                          <p className="font-semibold">{customer?.fullName}</p>
                          <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                            ID {customer?.publicUserId}
                          </p>
                        </td>
                        <td className="py-3 px-4 text-xs">
                          {w.assetSymbol} ({w.networkCode})
                        </td>
                        <td className="py-3 px-4 font-mono-num text-xs truncate max-w-[160px]">
                          {w.destinationAddress}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num font-semibold">
                          {formatQty(w.netAmount)}
                        </td>
                        <td className="py-3 px-4">
                          <WithdrawalStatusLabel status={w.status} />
                        </td>
                        <td className="py-3 px-4 font-mono-num text-xs text-[#686D76] dark:text-[#7E828A]">
                          {new Date(w.updatedAt).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};
