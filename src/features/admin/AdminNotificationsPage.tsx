import React, { useMemo, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import {
  AccountStatusLabel,
  ConfirmDialog,
  KycStatusLabel,
  SearchInput,
} from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import type {
  AccountStatus,
  KycStatus,
  NotificationCategory,
  NotificationRecipientType,
} from '../../types/domain';
import { resolveNotificationRecipients } from '../../utils/tradingMath';

export const AdminNotificationsPage: React.FC = () => {
  const {
    customerProfiles,
    notificationCampaigns,
    notifications,
    sendNotificationCampaign,
  } = useAppState();

  const [recipientType, setRecipientType] = useState<NotificationRecipientType>('everyone');
  const [kycFilter, setKycFilter] = useState<KycStatus | 'all'>('all');
  const [accountStatusFilter, setAccountStatusFilter] = useState<AccountStatus | 'all'>('all');
  const [manualSelectedIds, setManualSelectedIds] = useState<string[]>([]);
  const [individualSearch, setIndividualSearch] = useState('');
  const [individualUserId, setIndividualUserId] = useState<string>(
    customerProfiles[0]?.id ?? ''
  );

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<NotificationCategory>('Notice');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    notificationCampaigns[0]?.id ?? null
  );

  const groupCandidates = useMemo(
    () =>
      resolveNotificationRecipients(customerProfiles, {
        recipientType: 'selected_group',
        kycFilter,
        accountStatusFilter,
      }),
    [customerProfiles, kycFilter, accountStatusFilter]
  );

  const individualMatches = useMemo(() => {
    const q = individualSearch.trim().toLowerCase();
    if (!q) return customerProfiles;
    return customerProfiles.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.publicUserId.toLowerCase().includes(q)
    );
  }, [customerProfiles, individualSearch]);

  const resolvedRecipients = useMemo(
    () =>
      resolveNotificationRecipients(customerProfiles, {
        recipientType,
        kycFilter,
        accountStatusFilter,
        manualUserIds: manualSelectedIds,
        individualUserId,
      }),
    [
      customerProfiles,
      recipientType,
      kycFilter,
      accountStatusFilter,
      manualSelectedIds,
      individualUserId,
    ]
  );

  const filterSummary = useMemo(() => {
    if (recipientType === 'everyone') {
      return `Everyone (${resolvedRecipients.length})`;
    }
    if (recipientType === 'individual') {
      const target = resolvedRecipients[0];
      return target ? `Customer ${target.publicUserId} (${target.fullName})` : 'None selected';
    }
    return `Group · KYC: ${kycFilter}, Status: ${accountStatusFilter} (${resolvedRecipients.length})`;
  }, [recipientType, resolvedRecipients, kycFilter, accountStatusFilter]);

  const toggleManualId = (id: string) => {
    setManualSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleOpenPreview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      setFeedback({ ok: false, text: 'Enter both a notification title and message.' });
      return;
    }
    if (resolvedRecipients.length === 0) {
      setFeedback({ ok: false, text: 'Select at least one matching recipient.' });
      return;
    }
    setFeedback(null);
    setConfirmOpen(true);
  };

  const handleConfirmSend = () => {
    const res = sendNotificationCampaign({
      title,
      message,
      category,
      recipientType,
      recipientUserIds: resolvedRecipients.map((r) => r.id),
      filterSummary,
    });
    setConfirmOpen(false);
    setFeedback({ ok: res.ok, text: res.message });
    if (res.ok) {
      setTitle('');
      setMessage('');
      setManualSelectedIds([]);
    }
  };

  const profileMap = useMemo(
    () => new Map(customerProfiles.map((p) => [p.id, p])),
    [customerProfiles]
  );

  const activeCampaign =
    notificationCampaigns.find((c) => c.id === selectedCampaignId) ??
    notificationCampaigns[0] ??
    null;

  const campaignDeliveries = useMemo(() => {
    if (!activeCampaign) return [];
    return notifications.filter((n) => n.campaignId === activeCampaign.id);
  }, [activeCampaign, notifications]);

  return (
    <AdminLayout title="Notification Management">
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Compose Notification Campaign */}
          <form
            onSubmit={handleOpenPreview}
            className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4"
          >
            <h2 className="text-base font-semibold">Compose In-App Notification</h2>

            <div>
              <span className="block text-xs font-medium mb-1.5">Recipient Targeting</span>
              <div className="grid grid-cols-3 p-1 rounded-full bg-[#E8EAEE] dark:bg-[#242528]">
                {(
                  [
                    { key: 'everyone', label: 'Everyone' },
                    { key: 'selected_group', label: 'Selected Group' },
                    { key: 'individual', label: 'Individual' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setRecipientType(opt.key)}
                    className={`py-2 rounded-full text-xs font-semibold transition-colors ${
                      recipientType === opt.key
                        ? 'bg-[#004AE2] text-white'
                        : 'text-[#686D76] dark:text-[#9CA0A8]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {recipientType === 'everyone' && (
              <div className="p-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] text-xs">
                Will send to all <strong>{customerProfiles.length}</strong> registered customer accounts.
              </div>
            )}

            {recipientType === 'selected_group' && (
              <div className="space-y-3 p-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="grp-kyc" className="block text-[11px] font-medium mb-1">
                      Filter by KYC Status
                    </label>
                    <select
                      id="grp-kyc"
                      value={kycFilter}
                      onChange={(e) => {
                        setKycFilter(e.target.value as KycStatus | 'all');
                        setManualSelectedIds([]);
                      }}
                      className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#141518] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                    >
                      <option value="all">All KYC Statuses</option>
                      <option value="approved">Approved</option>
                      <option value="pending">Pending</option>
                      <option value="rejected">Rejected</option>
                      <option value="not_submitted">Not Submitted</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="grp-status" className="block text-[11px] font-medium mb-1">
                      Filter by Account Status
                    </label>
                    <select
                      id="grp-status"
                      value={accountStatusFilter}
                      onChange={(e) => {
                        setAccountStatusFilter(e.target.value as AccountStatus | 'all');
                        setManualSelectedIds([]);
                      }}
                      className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#141518] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                    >
                      <option value="all">All Account Statuses</option>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-[#686D76] dark:text-[#7E828A]">
                    <span>
                      Optional manual selection ({manualSelectedIds.length > 0 ? `${manualSelectedIds.length} checked` : `All ${groupCandidates.length} matched`})
                    </span>
                    {manualSelectedIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setManualSelectedIds([])}
                        className="text-[#004AE2] dark:text-[#60A5FA] font-medium"
                      >
                        Clear manual picks
                      </button>
                    )}
                  </div>
                  <div className="max-h-36 overflow-y-auto divide-y divide-[#E2E4E9] dark:divide-[#22242A] rounded-lg border border-[#E2E4E9] dark:border-[#22242A] bg-white dark:bg-[#141518]">
                    {groupCandidates.map((c) => (
                      <label
                        key={c.id}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={manualSelectedIds.includes(c.id)}
                            onChange={() => toggleManualId(c.id)}
                            className="accent-[#004AE2]"
                          />
                          <span className="truncate font-medium">{c.fullName}</span>
                          <span className="font-mono-num text-[11px] text-[#686D76]">
                            {c.publicUserId}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <KycStatusLabel status={c.kycStatus} />
                          <AccountStatusLabel status={c.accountStatus} />
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {recipientType === 'individual' && (
              <div className="space-y-2.5 p-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A]">
                <SearchInput
                  value={individualSearch}
                  onChange={setIndividualSearch}
                  placeholder="Search by name, email, or User ID"
                  ariaLabel="Search individual customer"
                />
                <div className="max-h-36 overflow-y-auto divide-y divide-[#E2E4E9] dark:divide-[#22242A] rounded-lg border border-[#E2E4E9] dark:border-[#22242A] bg-white dark:bg-[#141518]">
                  {individualMatches.map((c) => (
                    <label
                      key={c.id}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="individual-recipient"
                          checked={individualUserId === c.id}
                          onChange={() => setIndividualUserId(c.id)}
                          className="accent-[#004AE2]"
                        />
                        <span className="font-medium">{c.fullName}</span>
                        <span className="text-[#686D76]">{c.email}</span>
                      </span>
                      <span className="font-mono-num text-[11px]">ID {c.publicUserId}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="notif-title" className="block text-xs font-medium mb-1">
                  Title
                </label>
                <input
                  id="notif-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Notification headline"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                />
              </div>
              <div>
                <label htmlFor="notif-cat" className="block text-xs font-medium mb-1">
                  Category
                </label>
                <select
                  id="notif-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as NotificationCategory)}
                  className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                >
                  <option value="Notice">Notice</option>
                  <option value="Account">Account</option>
                  <option value="Deposit">Deposit</option>
                  <option value="Withdrawal">Withdrawal</option>
                  <option value="KYC">KYC</option>
                  <option value="Market">Market</option>
                  <option value="Compliance">Compliance</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="notif-msg" className="block text-xs font-medium mb-1">
                Message
              </label>
              <textarea
                id="notif-msg"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write clear notification content for the customer inbox..."
                className="w-full p-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-xs text-[#686D76] dark:text-[#7E828A]">
                Target recipient count:{' '}
                <strong className="font-mono-num text-[#111214] dark:text-white">
                  {resolvedRecipients.length}
                </strong>
              </span>
              <button
                type="submit"
                className="px-6 h-11 rounded-full bg-[#004AE2] text-white text-sm font-semibold hover:bg-[#003ec0]"
              >
                Preview &amp; Send
              </button>
            </div>

            {feedback && (
              <p
                role="status"
                className={`text-xs font-medium ${
                  feedback.ok ? 'text-[#10C478]' : 'text-[#F0525E]'
                }`}
              >
                {feedback.text}
              </p>
            )}
          </form>

          {/* Campaign History & Per-Recipient Read Tracking */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E2E4E9] dark:border-[#22242A]">
                <h2 className="text-sm font-semibold">
                  Sent Campaigns ({notificationCampaigns.length})
                </h2>
              </div>
              {notificationCampaigns.length === 0 ? (
                <p className="p-4 text-xs text-[#686D76] dark:text-[#7E828A]">
                  No notification campaigns dispatched yet.
                </p>
              ) : (
                <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] max-h-64 overflow-y-auto">
                  {notificationCampaigns.map((camp) => (
                    <button
                      key={camp.id}
                      type="button"
                      onClick={() => setSelectedCampaignId(camp.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-[#F4F5F7] dark:hover:bg-[#1A1B20] ${
                        activeCampaign?.id === camp.id ? 'bg-[#F4F5F7] dark:bg-[#1A1B20]' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#004AE2] dark:text-[#60A5FA]">
                          {camp.category}
                        </span>
                        <span className="font-mono-num text-[#686D76] dark:text-[#7E828A]">
                          {camp.recipientCount} recipient(s)
                        </span>
                      </div>
                      <p className="text-sm font-semibold mt-0.5">{camp.title}</p>
                      <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] mt-0.5">
                        {camp.filterSummary}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {activeCampaign && (
              <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    Recipient Read Status · {activeCampaign.title}
                  </h3>
                  <p className="text-xs text-[#686D76] dark:text-[#7E828A] mt-0.5">
                    {campaignDeliveries.filter((d) => d.isRead).length} of{' '}
                    {campaignDeliveries.length} read
                  </p>
                </div>
                <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] max-h-56 overflow-y-auto">
                  {campaignDeliveries.map((del) => {
                    const cust = profileMap.get(del.userId);
                    return (
                      <div key={del.id} className="py-2 flex items-center justify-between text-xs">
                        <div>
                          <p className="font-medium">{cust?.fullName ?? del.userId}</p>
                          <p className="text-[11px] font-mono-num text-[#686D76]">
                            ID {cust?.publicUserId}
                          </p>
                        </div>
                        <span
                          className={`font-semibold ${
                            del.isRead ? 'text-[#10C478]' : 'text-[#D97706]'
                          }`}
                        >
                          {del.isRead ? 'Read' : 'Unread'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm Notification Dispatch"
        description={`Message preview: "${message}"`}
        details={[
          { label: 'Title', value: title },
          { label: 'Category', value: category },
          { label: 'Targeting', value: filterSummary },
          { label: 'Recipient Count', value: String(resolvedRecipients.length) },
        ]}
        confirmLabel="Send Notification"
        onConfirm={handleConfirmSend}
        onCancel={() => setConfirmOpen(false)}
      />
    </AdminLayout>
  );
};
