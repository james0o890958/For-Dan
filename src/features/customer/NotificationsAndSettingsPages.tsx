import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  BookOpen,
  CheckCheck,
  Globe,
  KeyRound,
  Lock,
  ReceiptText,
  ShieldCheck,
  User,
  UserCheck,
} from 'lucide-react';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import {
  AccountStatusLabel,
  EmptyState,
  KycStatusLabel,
  LanguageModal,
} from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import type { NotificationItem } from '../../types/domain';

export const NotificationsPage: React.FC = () => {
  const {
    currentProfile,
    currentUserNotifications,
    markNotificationRead,
    markAllNotificationsRead,
  } = useAppState();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [selected, setSelected] = useState<NotificationItem | null>(null);

  if (!currentProfile) {
    return (
      <CustomerLayout title="Notifications">
        <EmptyState
          title="Sign in to view notifications"
          description="Security alerts, deposit confirmations, withdrawal updates, and compliance notices appear here."
          action={
            <Link
              to="/login"
              className="inline-flex px-5 py-2.5 rounded-full bg-[#004AE2] text-white text-sm font-semibold"
            >
              Sign in
            </Link>
          }
        />
      </CustomerLayout>
    );
  }

  const list =
    filter === 'unread'
      ? currentUserNotifications.filter((n) => !n.isRead)
      : currentUserNotifications;

  return (
    <CustomerLayout title="Notifications">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3.5 py-2 rounded-full text-xs font-medium ${
                filter === 'all'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              All ({currentUserNotifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={`px-3.5 py-2 rounded-full text-xs font-medium ${
                filter === 'unread'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Unread ({currentUserNotifications.filter((n) => !n.isRead).length})
            </button>
          </div>

          <button
            type="button"
            onClick={markAllNotificationsRead}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium hover:opacity-90"
          >
            <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Mark all read</span>
          </button>
        </div>

        {list.length === 0 ? (
          <EmptyState
            title="No notifications"
            description="Account updates and compliance messages will appear in this inbox."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-6 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
              {list.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    markNotificationRead(item.id);
                    setSelected({ ...item, isRead: true });
                  }}
                  className={`w-full text-left p-4 hover:bg-[#F4F5F7] dark:hover:bg-[#1A1B20] transition-colors ${
                    selected?.id === item.id ? 'bg-[#F4F5F7] dark:bg-[#1A1B20]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#004AE2] dark:text-[#60A5FA]">
                      {item.category}
                    </span>
                    <span className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                      {item.isRead ? 'Read' : 'Unread'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs text-[#686D76] dark:text-[#7E828A] line-clamp-2">
                    {item.message}
                  </p>
                  <p className="mt-2 text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </button>
              ))}
            </div>

            <div className="lg:col-span-6 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5">
              {selected ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-[#686D76] dark:text-[#7E828A]">
                    <span>{selected.category}</span>
                    <span className="font-mono-num">
                      {new Date(selected.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold">{selected.title}</h2>
                  <p className="text-sm text-[#4B5059] dark:text-[#C5C8D0] leading-relaxed">
                    {selected.message}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  Select a notification to read the full message and update its read status.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </CustomerLayout>
  );
};

export const SettingsPage: React.FC = () => {
  const {
    currentProfile,
    language,
    setLanguage,
    theme,
    toggleTheme,
    updateCustomerProfile,
    toggleTwoFactor,
    logout,
    isAdmin,
  } = useAppState();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState(currentProfile?.fullName ?? '');
  const [phone, setPhone] = useState(currentProfile?.phone ?? '');
  const [langOpen, setLangOpen] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [twoFaMsg, setTwoFaMsg] = useState<string | null>(null);

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);

  if (!currentProfile) {
    return (
      <CustomerLayout title="Settings">
        <EmptyState
          title="Sign in to view settings"
          description="Manage your personal information, Two-Factor Authentication, and security controls."
          action={
            <Link
              to="/login"
              className="inline-flex px-5 py-2.5 rounded-full bg-[#004AE2] text-white text-sm font-semibold"
            >
              Sign in
            </Link>
          }
        />
      </CustomerLayout>
    );
  }

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const res = updateCustomerProfile({
      fullName,
      phone,
      preferredLanguage: language,
    });
    setProfileMsg(res.message);
  };

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPwd || newPwd.length < 8) {
      setPwdMsg('Enter your current password and a new password (min 8 characters).');
      return;
    }
    setCurrentPwd('');
    setNewPwd('');
    setPwdMsg('Password rotation requires an active backend authentication session.');
  };

  return (
    <CustomerLayout title="Profile & Settings">
      <div className="max-w-3xl space-y-6">
        <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#E8EAEE] dark:bg-[#2C2D30] flex items-center justify-center">
              <User className="w-7 h-7 text-[#686D76] dark:text-[#9CA0A8]" aria-hidden="true" />
            </div>
            <div>
              <p className="text-base font-bold">
                {currentProfile.fullName}{' '}
                <span className="text-xs font-normal text-[#686D76] dark:text-[#7E828A]">
                  (Member)
                </span>
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#686D76] dark:text-[#7E828A]">
                <span className="font-mono-num">ID: {currentProfile.publicUserId}</span>
                <span aria-hidden="true">·</span>
                <KycStatusLabel status={currentProfile.kycStatus} />
                <span aria-hidden="true">·</span>
                <AccountStatusLabel status={currentProfile.accountStatus} />
              </div>
            </div>
          </div>

          {isAdmin && (
            <Link
              to="/admin"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#004AE2] text-white text-xs font-semibold"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Admin Console</span>
            </Link>
          )}
        </section>

        {/* Quick Links & Security Controls */}
        <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold mb-3">Account Services</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <Link
                to="/transactions"
                className="p-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] flex flex-col items-center gap-2 hover:opacity-90"
              >
                <ReceiptText className="w-5 h-5" />
                <span className="text-xs">Ledger History</span>
              </Link>
              <Link
                to="/kyc"
                className="p-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] flex flex-col items-center gap-2 hover:opacity-90"
              >
                <UserCheck className="w-5 h-5" />
                <span className="text-xs">Verify Identity</span>
              </Link>
              <Link
                to="/notifications"
                className="p-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] flex flex-col items-center gap-2 hover:opacity-90"
              >
                <Bell className="w-5 h-5" />
                <span className="text-xs">Notifications</span>
              </Link>
              <button
                type="button"
                onClick={() => setLangOpen(true)}
                className="p-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] flex flex-col items-center gap-2 hover:opacity-90"
              >
                <Globe className="w-5 h-5" />
                <span className="text-xs">Language ({language})</span>
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-[#E2E4E9] dark:border-[#22242A] space-y-3">
            <h2 className="text-sm font-semibold">Security & Preferences</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <button
                type="button"
                onClick={toggleTheme}
                className="p-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] flex items-center justify-between"
              >
                <span>Appearance</span>
                <span className="font-semibold capitalize">{theme} mode</span>
              </button>
              <Link
                to="/markets"
                className="p-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] flex items-center gap-2"
              >
                <BookOpen className="w-4 h-4 shrink-0" />
                <span>Market Overview</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  const res = toggleTwoFactor(!currentProfile.twoFactorEnabled);
                  setTwoFaMsg(res.message);
                }}
                className="p-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span>2FA Withdrawals</span>
                </span>
                <span
                  className={`font-semibold ${
                    currentProfile.twoFactorEnabled ? 'text-[#10C478]' : 'text-[#D97706]'
                  }`}
                >
                  {currentProfile.twoFactorEnabled ? 'Enabled' : 'Enable'}
                </span>
              </button>
            </div>
            {twoFaMsg && <p className="text-xs font-medium text-[#10C478]">{twoFaMsg}</p>}
          </div>
        </section>

        {/* Personal Information & Password Forms */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <form
            onSubmit={handleSaveProfile}
            className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4"
          >
            <h2 className="text-sm font-semibold">Personal Information</h2>
            <div>
              <label htmlFor="prof-email" className="block text-xs font-medium mb-1">
                Email
              </label>
              <input
                id="prof-email"
                type="email"
                value={currentProfile.email}
                disabled
                className="w-full h-10 px-3 rounded-xl bg-[#E8EAEE] dark:bg-[#1C1D22] text-xs text-[#686D76] dark:text-[#7E828A]"
              />
            </div>
            <div>
              <label htmlFor="prof-name" className="block text-xs font-medium mb-1">
                Full Name
              </label>
              <input
                id="prof-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
              />
            </div>
            <div>
              <label htmlFor="prof-phone" className="block text-xs font-medium mb-1">
                Mobile Number
              </label>
              <input
                id="prof-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
              />
            </div>
            {profileMsg && <p className="text-xs text-[#10C478]">{profileMsg}</p>}
            <button
              type="submit"
              className="px-5 h-10 rounded-full bg-[#004AE2] text-white text-xs font-semibold"
            >
              Save Changes
            </button>
          </form>

          <form
            onSubmit={handlePasswordChange}
            className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4"
          >
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Lock className="w-4 h-4" />
              <span>Modify Login Password</span>
            </h2>
            <div>
              <label htmlFor="cur-pwd" className="block text-xs font-medium mb-1">
                Current Password
              </label>
              <input
                id="cur-pwd"
                type="password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
              />
            </div>
            <div>
              <label htmlFor="new-pwd" className="block text-xs font-medium mb-1">
                New Password (min 8 characters)
              </label>
              <input
                id="new-pwd"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
              />
            </div>
            {pwdMsg && <p className="text-xs text-[#D97706]">{pwdMsg}</p>}
            <button
              type="submit"
              className="px-5 h-10 rounded-full bg-[#E8EAEE] dark:bg-[#2C2D30] text-xs font-semibold"
            >
              Update Password
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={() => {
            logout();
            navigate('/login');
          }}
          className="w-full h-12 rounded-full bg-[#E8EAEE] dark:bg-[#2C2D30] text-sm font-semibold hover:opacity-90"
        >
          Log out
        </button>
      </div>

      <LanguageModal
        open={langOpen}
        selected={language}
        onSelect={setLanguage}
        onClose={() => setLangOpen(false)}
      />
    </CustomerLayout>
  );
};
