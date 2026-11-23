import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Bell,
  Briefcase,
  CandlestickChart,
  CheckCheck,
  ChevronDown,
  Globe,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Moon,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useAppState } from '../../context/AppStateContext';
import { buildGlobalSearchMatches } from '../../utils/overviewModel';
import {
  AccountStatusLabel,
  KycStatusLabel,
  LanguageModal,
} from '../ui/CommonPrimitives';

interface NavItemConfig {
  to: string;
  label: string;
  icon: React.FC<{ className?: string; 'aria-hidden'?: boolean }>;
  matchPaths?: string[];
}

const MAIN_NAV: NavItemConfig[] = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard, matchPaths: ['/overview', '/dashboard'] },
  { to: '/markets', label: 'Markets', icon: CandlestickChart, matchPaths: ['/markets'] },
  { to: '/trade', label: 'Trade', icon: ArrowLeftRight, matchPaths: ['/trade'] },
  { to: '/wallets', label: 'Wallets', icon: Wallet, matchPaths: ['/wallets', '/wallet', '/portfolio'] },
  { to: '/deposit', label: 'Deposit', icon: ArrowDownToLine, matchPaths: ['/deposit'] },
  { to: '/withdraw', label: 'Withdraw', icon: ArrowUpFromLine, matchPaths: ['/withdraw'] },
  { to: '/transactions', label: 'Transactions', icon: ReceiptText, matchPaths: ['/transactions'] },
  { to: '/settings', label: 'Settings', icon: Settings, matchPaths: ['/settings'] },
];

const MOBILE_TABS: NavItemConfig[] = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard, matchPaths: ['/overview', '/dashboard'] },
  { to: '/markets', label: 'Markets', icon: CandlestickChart, matchPaths: ['/markets'] },
  { to: '/trade', label: 'Trade', icon: ArrowLeftRight, matchPaths: ['/trade'] },
  { to: '/wallets', label: 'Wallets', icon: Wallet, matchPaths: ['/wallets', '/wallet', '/portfolio'] },
  { to: '/transactions', label: 'Activity', icon: ReceiptText, matchPaths: ['/transactions'] },
];

function isNavItemActive(pathname: string, item: NavItemConfig): boolean {
  if (pathname === item.to) return true;
  if (item.matchPaths) {
    return item.matchPaths.some((p) => pathname === p || (p !== '/' && pathname.startsWith(`${p}/`)));
  }
  return pathname.startsWith(`${item.to}/`);
}

function getInitials(name?: string | null): string {
  if (!name) return 'SG';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

export const CustomerLayout: React.FC<{
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, actions, children }) => {
  const {
    theme,
    toggleTheme,
    language,
    setLanguage,
    currentProfile,
    isAdmin,
    authLoading,
    marketPrices,
    assets,
    currentUserNotifications,
    unreadNotificationsCount,
    markNotificationRead,
    markAllNotificationsRead,
    logout,
  } = useAppState();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const notifContainerRef = useRef<HTMLDivElement>(null);
  const profileContainerRef = useRef<HTMLDivElement>(null);

  const searchResults = useMemo(
    () =>
      buildGlobalSearchMatches({
        query: searchQuery,
        marketPrices,
        assets,
      }),
    [searchQuery, marketPrices, assets]
  );

  useEffect(() => {
    setDrawerOpen(false);
    setNotifOpen(false);
    setProfileOpen(false);
    setSearchFocused(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setSearchFocused(false);
      }
      if (notifContainerRef.current && !notifContainerRef.current.contains(target)) {
        setNotifOpen(false);
      }
      if (profileContainerRef.current && !profileContainerRef.current.contains(target)) {
        setProfileOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSearchFocused(false);
        setNotifOpen(false);
        setProfileOpen(false);
        setDrawerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const recentNotifications = currentUserNotifications.slice(0, 4);

  return (
    <div className="min-h-screen bg-[#F4F5F7] dark:bg-[#0B0C0E] text-[#111214] dark:text-[#F4F5F7] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-r border-[#E2E4E9] dark:border-[#22242A] bg-white dark:bg-[#111215]">
        <div className="h-16 px-5 border-b border-[#E2E4E9] dark:border-[#22242A] flex items-center justify-between gap-2">
          <Link to="/overview" className="flex items-center gap-2.5 min-w-0">
            <span
              aria-hidden="true"
              className="w-8 h-8 rounded-lg bg-[#004AE2] text-white flex items-center justify-center shrink-0"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2.2">
                <path d="M5 15l5-5 4 4 5-6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M16 8h3v3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold tracking-tight text-[#111214] dark:text-[#F4F5F7] truncate">
                Spot Exchange
              </span>
              <span className="block text-[11px] text-[#686D76] dark:text-[#7E828A] truncate">
                Sandbox Environment
              </span>
            </span>
          </Link>
        </div>

        <nav aria-label="Customer navigation" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {MAIN_NAV.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(location.pathname, item);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#004AE2] text-white'
                    : 'text-[#4B5059] dark:text-[#9CA0A8] hover:bg-[#F4F5F7] dark:hover:bg-[#1A1C21] hover:text-[#111214] dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden={true} />
                  <span>{item.label}</span>
                </span>
              </Link>
            );
          })}

          {currentProfile && isAdmin && (
            <div className="pt-4 mt-4 border-t border-[#E2E4E9] dark:border-[#22242A]">
              <p className="px-3 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-[#686D76] dark:text-[#7E828A]">
                Administration
              </p>
              <Link
                to="/admin"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[#004AE2] dark:text-[#60A5FA] hover:bg-[#004AE2]/10 whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden={true} />
                <span>Admin Console</span>
              </Link>
            </div>
          )}
        </nav>

        <div className="p-3 border-t border-[#E2E4E9] dark:border-[#22242A] space-y-2">
          {authLoading ? (
            <div className="px-3 py-2.5 rounded-lg bg-[#F4F5F7] dark:bg-[#141518] text-xs text-[#686D76] dark:text-[#7E828A]">
              Verifying session...
            </div>
          ) : currentProfile ? (
            <div className="px-3 py-2.5 rounded-lg bg-[#F4F5F7] dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A]">
              <p className="text-xs font-semibold truncate">{currentProfile.fullName}</p>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#686D76] dark:text-[#7E828A]">
                <span className="font-mono-num">ID {currentProfile.publicUserId}</span>
                <span aria-hidden="true">·</span>
                <KycStatusLabel status={currentProfile.kycStatus} />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="px-3 py-2 rounded-lg bg-[#F4F5F7] dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A]">
                <p className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7]">
                  Sandbox Guest
                </p>
                <p className="mt-0.5 text-[11px] text-[#686D76] dark:text-[#7E828A]">
                  Simulated preview · No active session
                </p>
              </div>
              <Link
                to="/login"
                className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0] transition-colors"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden={true} />
                <span>Sign in</span>
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white dark:bg-[#111215] h-full flex flex-col border-r border-[#E2E4E9] dark:border-[#22242A]">
            <div className="flex items-center justify-between px-4 h-14 border-b border-[#E2E4E9] dark:border-[#22242A]">
              <div>
                <p className="text-sm font-semibold">Spot Exchange</p>
                <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                  Sandbox Environment
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 rounded-lg text-[#686D76] hover:text-[#111214] dark:hover:text-white min-h-[40px] min-w-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav aria-label="Mobile drawer navigation" className="flex-1 p-3 space-y-1 overflow-y-auto">
              {MAIN_NAV.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(location.pathname, item);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium ${
                      active
                        ? 'bg-[#004AE2] text-white'
                        : 'text-[#4B5059] dark:text-[#9CA0A8] hover:bg-[#F4F5F7] dark:hover:bg-[#1C1E24]'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-4 h-4 shrink-0" aria-hidden={true} />
                      <span>{item.label}</span>
                    </span>
                  </Link>
                );
              })}

              <div className="pt-3 mt-3 border-t border-[#E2E4E9] dark:border-[#22242A] space-y-1">
                <Link
                  to="/portfolio"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[#4B5059] dark:text-[#9CA0A8] hover:bg-[#F4F5F7] dark:hover:bg-[#1C1E24]"
                >
                  <Briefcase className="w-4 h-4 shrink-0" aria-hidden={true} />
                  <span>Portfolio Analytics</span>
                </Link>
                <Link
                  to="/kyc"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[#4B5059] dark:text-[#9CA0A8] hover:bg-[#F4F5F7] dark:hover:bg-[#1C1E24]"
                >
                  <UserCheck className="w-4 h-4 shrink-0" aria-hidden={true} />
                  <span>KYC Verification</span>
                </Link>
                <Link
                  to="/notifications"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium text-[#4B5059] dark:text-[#9CA0A8] hover:bg-[#F4F5F7] dark:hover:bg-[#1C1E24]"
                >
                  <span className="flex items-center gap-3">
                    <Bell className="w-4 h-4 shrink-0" aria-hidden={true} />
                    <span>Notifications</span>
                  </span>
                  {unreadNotificationsCount > 0 && (
                    <span className="font-mono-num text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#F0525E] text-white">
                      {unreadNotificationsCount}
                    </span>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    setLangOpen(true);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium text-[#4B5059] dark:text-[#9CA0A8] hover:bg-[#F4F5F7] dark:hover:bg-[#1C1E24]"
                >
                  <span className="flex items-center gap-3">
                    <Globe className="w-4 h-4 shrink-0" aria-hidden={true} />
                    <span>Language</span>
                  </span>
                  <span className="text-xs text-[#686D76] dark:text-[#7E828A]">{language}</span>
                </button>
              </div>

              {currentProfile && isAdmin && (
                <div className="pt-3 mt-3 border-t border-[#E2E4E9] dark:border-[#22242A]">
                  <Link
                    to="/admin"
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[#004AE2] dark:text-[#60A5FA]"
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden={true} />
                    <span>Admin Console</span>
                  </Link>
                </div>
              )}
            </nav>

            <div className="p-3 border-t border-[#E2E4E9] dark:border-[#22242A]">
              {currentProfile ? (
                <button
                  type="button"
                  onClick={async () => {
                    await logout();
                    setDrawerOpen(false);
                    navigate('/login');
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#242528] text-white text-sm font-medium"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign out</span>
                </button>
              ) : (
                <Link
                  to="/login"
                  onClick={() => setDrawerOpen(false)}
                  className="block text-center w-full py-2.5 rounded-lg bg-[#004AE2] text-white text-sm font-semibold"
                >
                  Sign in
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col pb-20 lg:pb-8">
        <header className="sticky top-0 z-30 h-14 lg:h-16 px-4 lg:px-6 flex items-center justify-between gap-3 bg-[#F4F5F7]/95 dark:bg-[#0B0C0E]/95 backdrop-blur-md border-b border-[#E2E4E9] dark:border-[#1E2026]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 rounded-lg text-[#111214] dark:text-[#F4F5F7] min-h-[42px] min-w-[42px] flex items-center justify-center hover:bg-[#E8EAEE] dark:hover:bg-[#1C1E24]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0 flex items-center gap-2.5">
              <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
                {title}
              </h1>
              <span className="hidden xl:inline-flex items-center px-2 py-0.5 rounded border border-[#D4D7DF] dark:border-[#2A2C34] bg-white dark:bg-[#141518] text-[11px] font-medium text-[#686D76] dark:text-[#9CA0A8] whitespace-nowrap shrink-0">
                Sandbox · Simulated Funds
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Global Search Interface */}
            <div ref={searchContainerRef} className="relative hidden md:block w-64 xl:w-72">
              <div className="flex items-center rounded-lg bg-white dark:bg-[#141518] border border-[#D4D7DF] dark:border-[#24262E] focus-within:border-[#004AE2] transition-colors">
                <Search
                  className="w-4 h-4 text-[#686D76] dark:text-[#7E828A] ml-3 shrink-0"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onFocus={() => setSearchFocused(true)}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchFocused(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchResults.length > 0) {
                      navigate(searchResults[0].to);
                      setSearchQuery('');
                      setSearchFocused(false);
                    }
                  }}
                  placeholder="Search pairs, Deposit, Trade..."
                  aria-label="Global workspace and market search"
                  className="w-full bg-transparent px-2.5 py-1.5 text-xs text-[#111214] dark:text-[#F4F5F7] placeholder:text-[#686D76] dark:placeholder:text-[#6E7178] focus:outline-none min-h-[36px]"
                />
              </div>

              {searchFocused && searchQuery.trim().length > 0 && (
                <div
                  role="listbox"
                  aria-label="Search results"
                  className="absolute right-0 mt-1.5 w-80 rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#2A2C34] shadow-xl overflow-hidden z-50"
                >
                  {searchResults.length === 0 ? (
                    <div className="px-4 py-4 text-xs text-[#686D76] dark:text-[#7E828A]">
                      No markets or routes matching &ldquo;{searchQuery}&rdquo;.
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto divide-y divide-[#E2E4E9] dark:divide-[#1E2026]">
                      {searchResults.map((item) => (
                        <Link
                          key={item.id}
                          to={item.to}
                          onClick={() => {
                            setSearchQuery('');
                            setSearchFocused(false);
                          }}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[#F4F5F7] dark:hover:bg-[#1B1D22] transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7] truncate">
                              {item.label}
                            </p>
                            <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] truncate">
                              {item.subtitle}
                            </p>
                          </div>
                          <span className="text-[10px] font-medium uppercase tracking-wider text-[#686D76] dark:text-[#7E828A] shrink-0">
                            {item.group}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Notification Centre Popover */}
            <div ref={notifContainerRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((prev) => !prev);
                  setProfileOpen(false);
                }}
                aria-label="Open notifications"
                aria-expanded={notifOpen}
                className="relative p-2 rounded-lg hover:bg-[#E8EAEE] dark:hover:bg-[#1C1E24] min-h-[38px] min-w-[38px] flex items-center justify-center transition-colors"
              >
                <Bell className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded bg-[#F0525E] text-white text-[10px] font-mono-num font-bold flex items-center justify-center">
                    {unreadNotificationsCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div
                  role="dialog"
                  aria-label="Notification centre"
                  className="absolute right-0 mt-1.5 w-80 sm:w-96 rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#2A2C34] shadow-xl z-50 overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-[#E2E4E9] dark:border-[#22242A] flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">Notifications</span>
                    {currentProfile && unreadNotificationsCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllNotificationsRead}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#004AE2] dark:text-[#60A5FA] hover:underline"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span>Mark all read</span>
                      </button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto divide-y divide-[#E2E4E9] dark:divide-[#1E2026]">
                    {!currentProfile ? (
                      <div className="p-4 space-y-2 text-xs">
                        <p className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
                          Sandbox Workspace Notice
                        </p>
                        <p className="text-[#686D76] dark:text-[#7E828A] leading-relaxed">
                          Account alerts, deposit confirmations, and compliance messages appear here once you sign in.
                        </p>
                      </div>
                    ) : recentNotifications.length === 0 ? (
                      <div className="p-4 text-xs text-[#686D76] dark:text-[#7E828A]">
                        No account notifications recorded yet.
                      </div>
                    ) : (
                      recentNotifications.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            markNotificationRead(item.id);
                            setNotifOpen(false);
                            navigate('/notifications');
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-[#F4F5F7] dark:hover:bg-[#1A1C21] transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-[#004AE2] dark:text-[#60A5FA]">
                              {item.category}
                            </span>
                            <span className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                              {item.isRead ? 'Read' : 'Unread'}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs font-semibold truncate">{item.title}</p>
                          <p className="mt-0.5 text-[11px] text-[#686D76] dark:text-[#7E828A] line-clamp-2">
                            {item.message}
                          </p>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="px-4 py-2.5 bg-[#F4F5F7] dark:bg-[#101114] border-t border-[#E2E4E9] dark:border-[#22242A] flex items-center justify-between text-xs">
                    <Link
                      to="/notifications"
                      onClick={() => setNotifOpen(false)}
                      className="font-medium text-[#004AE2] dark:text-[#60A5FA] hover:underline"
                    >
                      Open notification inbox
                    </Link>
                    {!currentProfile && (
                      <Link
                        to="/login"
                        onClick={() => setNotifOpen(false)}
                        className="font-medium text-[#111214] dark:text-[#F4F5F7] hover:underline"
                      >
                        Sign in
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg hover:bg-[#E8EAEE] dark:hover:bg-[#1C1E24] min-h-[38px] min-w-[38px] flex items-center justify-center transition-colors"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
              ) : (
                <Moon className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
              )}
            </button>

            {/* User Profile Menu */}
            <div ref={profileContainerRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileOpen((prev) => !prev);
                  setNotifOpen(false);
                }}
                aria-label="Open account menu"
                aria-expanded={profileOpen}
                className="inline-flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-lg bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#24262E] hover:border-[#004AE2]/60 text-xs font-medium whitespace-nowrap shrink-0 min-h-[38px] transition-colors"
              >
                <span className="w-6 h-6 rounded-md bg-[#004AE2] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                  {getInitials(currentProfile?.fullName)}
                </span>
                <span className="hidden sm:inline max-w-[120px] truncate">
                  {currentProfile ? currentProfile.fullName : 'Sandbox Guest'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-[#686D76] dark:text-[#7E828A]" aria-hidden="true" />
              </button>

              {profileOpen && (
                <div
                  role="menu"
                  aria-label="User profile menu"
                  className="absolute right-0 mt-1.5 w-64 rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#2A2C34] shadow-xl z-50 overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-[#E2E4E9] dark:border-[#22242A]">
                    {currentProfile ? (
                      <>
                        <p className="text-xs font-semibold truncate">{currentProfile.fullName}</p>
                        <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] truncate">
                          {currentProfile.email}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#686D76] dark:text-[#7E828A]">
                          <span className="font-mono-num">ID {currentProfile.publicUserId}</span>
                          <span aria-hidden="true">·</span>
                          <KycStatusLabel status={currentProfile.kycStatus} />
                          <span aria-hidden="true">·</span>
                          <AccountStatusLabel status={currentProfile.accountStatus} />
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-semibold">Sandbox Preview Mode</p>
                        <p className="mt-0.5 text-[11px] text-[#686D76] dark:text-[#7E828A]">
                          Sign in for persistent KYC, ledger, and deposit/withdrawal access.
                        </p>
                      </>
                    )}
                  </div>

                  <div className="p-1.5 space-y-0.5 text-xs">
                    <Link
                      to="/portfolio"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#F4F5F7] dark:hover:bg-[#1C1E24]"
                    >
                      <Briefcase className="w-3.5 h-3.5 text-[#686D76] dark:text-[#7E828A]" />
                      <span>Portfolio Allocation</span>
                    </Link>
                    <Link
                      to="/kyc"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#F4F5F7] dark:hover:bg-[#1C1E24]"
                    >
                      <UserCheck className="w-3.5 h-3.5 text-[#686D76] dark:text-[#7E828A]" />
                      <span>KYC Verification</span>
                    </Link>
                    <Link
                      to="/settings"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#F4F5F7] dark:hover:bg-[#1C1E24]"
                    >
                      <Settings className="w-3.5 h-3.5 text-[#686D76] dark:text-[#7E828A]" />
                      <span>Settings & Security</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        setLangOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#F4F5F7] dark:hover:bg-[#1C1E24]"
                    >
                      <span className="flex items-center gap-2.5">
                        <Globe className="w-3.5 h-3.5 text-[#686D76] dark:text-[#7E828A]" />
                        <span>Language</span>
                      </span>
                      <span className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                        {language}
                      </span>
                    </button>

                    {currentProfile && isAdmin && (
                      <Link
                        to="/admin"
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[#004AE2] dark:text-[#60A5FA] hover:bg-[#004AE2]/10 font-medium"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Admin Console</span>
                      </Link>
                    )}
                  </div>

                  <div className="p-1.5 border-t border-[#E2E4E9] dark:border-[#22242A]">
                    {currentProfile ? (
                      <button
                        type="button"
                        onClick={async () => {
                          setProfileOpen(false);
                          await logout();
                          navigate('/login');
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-[#F0525E] hover:bg-[#F0525E]/10"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign out</span>
                      </button>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        <Link
                          to="/login"
                          onClick={() => setProfileOpen(false)}
                          className="text-center py-2 rounded-lg bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
                        >
                          Sign in
                        </Link>
                        <Link
                          to="/register"
                          onClick={() => setProfileOpen(false)}
                          className="text-center py-2 rounded-lg bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
                        >
                          Register
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 lg:px-6 py-5 space-y-5">
          {(subtitle || actions) && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {subtitle ? (
                <p className="text-xs sm:text-sm text-[#686D76] dark:text-[#7E828A]">
                  {subtitle}
                </p>
              ) : (
                <span />
              )}
              {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Mobile Bottom 5-Tab Bar */}
      <nav
        aria-label="Mobile quick navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 dark:bg-[#111215]/95 backdrop-blur-md border-t border-[#E2E4E9] dark:border-[#22242A] grid grid-cols-5 items-center"
      >
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isNavItemActive(location.pathname, tab);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center h-full gap-1 text-[11px] font-medium transition-colors ${
                active
                  ? 'text-[#004AE2] dark:text-white'
                  : 'text-[#686D76] dark:text-[#6E7178]'
              }`}
            >
              <Icon className="w-5 h-5" aria-hidden={true} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      <LanguageModal
        open={langOpen}
        selected={language}
        onSelect={setLanguage}
        onClose={() => setLangOpen(false)}
      />
    </div>
  );
};
