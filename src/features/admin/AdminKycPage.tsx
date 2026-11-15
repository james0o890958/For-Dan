import React, { useMemo, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { EmptyState, KycStatusLabel } from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';

export const AdminKycPage: React.FC = () => {
  const { kycSubmissions, profiles, reviewKyc } = useAppState();
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const pendingList = useMemo(
    () => kycSubmissions.filter((k) => k.status === 'pending'),
    [kycSubmissions]
  );

  const historyList = useMemo(
    () => kycSubmissions.filter((k) => k.status !== 'pending'),
    [kycSubmissions]
  );

  const handleDecision = (id: string, decision: 'approved' | 'rejected') => {
    const res = reviewKyc(id, decision, rejectionReasons[id]);
    setFeedback({ ok: res.ok, text: res.message });
  };

  return (
    <AdminLayout title="KYC & Sanctions Review">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('pending')}
              className={`px-4 py-2 rounded-full text-xs font-semibold ${
                tab === 'pending'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Pending Submissions ({pendingList.length})
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
              Review History ({historyList.length})
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

        {tab === 'pending' ? (
          pendingList.length === 0 ? (
            <EmptyState
              title="No pending KYC submissions"
              description="Customer identity and sanctions verification submissions appear here for compliance review."
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {pendingList.map((k) => {
                const customer = profileMap.get(k.userId);
                return (
                  <div
                    key={k.id}
                    className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold">{k.fullName}</p>
                        <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                          {customer?.email} · <span className="font-mono-num">ID {customer?.publicUserId}</span>
                        </p>
                      </div>
                      <KycStatusLabel status={k.status} />
                    </div>

                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] p-3">
                      <div>
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Country</dt>
                        <dd className="font-medium mt-0.5">{k.country}</dd>
                      </div>
                      <div>
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Document</dt>
                        <dd className="font-medium mt-0.5">{k.documentType}</dd>
                      </div>
                      <div>
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Number</dt>
                        <dd className="font-mono-num font-semibold mt-0.5">{k.documentNumber}</dd>
                      </div>
                      <div>
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Sanctions</dt>
                        <dd className="font-semibold capitalize mt-0.5">{k.sanctionsStatus}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-[#686D76] dark:text-[#7E828A]">IDV Provider</dt>
                        <dd className="font-medium mt-0.5">{k.providerName}</dd>
                      </div>
                    </dl>

                    <div>
                      <label
                        htmlFor={`reject-${k.id}`}
                        className="block text-xs font-medium mb-1"
                      >
                        Rejection Reason (required if rejecting)
                      </label>
                      <input
                        id={`reject-${k.id}`}
                        type="text"
                        value={rejectionReasons[k.id] ?? ''}
                        onChange={(e) =>
                          setRejectionReasons((prev) => ({ ...prev, [k.id]: e.target.value }))
                        }
                        placeholder="State clear compliance reason if rejecting"
                        className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleDecision(k.id, 'approved')}
                        className="flex-1 h-10 rounded-full bg-[#10C478] text-white text-xs font-semibold hover:opacity-95"
                      >
                        Approve KYC
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecision(k.id, 'rejected')}
                        className="flex-1 h-10 rounded-full bg-[#F0525E] text-white text-xs font-semibold hover:opacity-95"
                      >
                        Reject KYC
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                    <th className="py-3 px-4 font-medium">Customer</th>
                    <th className="py-3 px-4 font-medium">Document</th>
                    <th className="py-3 px-4 font-medium">Sanctions</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium">Reason / Note</th>
                    <th className="py-3 px-4 font-medium">Reviewed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {historyList.map((k) => {
                    const customer = profileMap.get(k.userId);
                    return (
                      <tr key={k.id}>
                        <td className="py-3 px-4">
                          <p className="font-semibold">{k.fullName}</p>
                          <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                            ID {customer?.publicUserId}
                          </p>
                        </td>
                        <td className="py-3 px-4 text-xs">
                          {k.documentType} · <span className="font-mono-num">{k.documentNumber}</span>
                        </td>
                        <td className="py-3 px-4 text-xs capitalize">{k.sanctionsStatus}</td>
                        <td className="py-3 px-4">
                          <KycStatusLabel status={k.status} />
                        </td>
                        <td className="py-3 px-4 text-xs text-[#686D76] dark:text-[#7E828A]">
                          {k.rejectionReason || 'Verified'}
                        </td>
                        <td className="py-3 px-4 font-mono-num text-xs text-[#686D76] dark:text-[#7E828A]">
                          {k.reviewedAt ? new Date(k.reviewedAt).toLocaleString() : '—'}
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
