import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeftRight,
  ArrowUpRight,
  Bell,
  Coins,
  FileCheck2,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Radio,
  ReceiptText,
  Scale,
  Sliders,
  Sun,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useAppState } from '../../context/AppStateContext';
import { exchangeService } from '../../services/platformService';

const ADMIN_NAV = [
  { to: '/admin', label: 'Admin Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/customers', label: 'Customers', icon: Users },
  { to: '/admin/kyc', label: 'KYC Management', icon: FileCheck2 },
  { to: '/admin/deposits', label: 'Deposits', icon: Landmark },
  { to: '/admin/withdrawals', label: 'Withdrawals', icon: ArrowUpRight },
  { to: '/admin/adjustments', label: 'Ledger Adjustments', icon: Scale },
  { to: '/admin/assets', label: 'Assets', icon: Coins },
  { to: '/admin/pairs', label: 'Trading Pairs', icon: Sliders },
  { to: '/admin/market-settings', label: 'Market Settings', icon: Radio },
  { to: '/admin/trades', label: 'Orders & Trades', icon: ArrowLeftRight },
  { to: '/admin/transactions', label: 'Transactions', icon: ReceiptText },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell },
  { to: '/admin/admins', label: 'Admin Roles', icon: UserCog },
  { to: '/admin/audit-logs', label: 'Audit Logs', icon: History },
];

export const AdminLayout: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => {
  const { theme, toggleTheme, currentProfile, currentRole, isAdmin, logout } = useAppState();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();

  if (!currentProfile || !isAdmin) {
    return (
      <div className="min-h-screen bg-[#F4F5F7] dark:bg-[#0B0C0E] text-[#111214] dark:text-[#F4F5F7] flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 text-center">
          <h1 className="text-lg font-semibold">Administrator Access Required</h1>
          <p className="mt-2 text-sm text-[#686D76] dark:text-[#7E828A]">
            Customer accounts cannot access administrative tools. Sign in with an authorized operator account to continue.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              to="/login"
              className="px-5 py-2.5 rounded-full bg-[#004AE2] text-white text-sm font-semibold"
            >
              Sign in
            </Link>
            <Link
              to="/overview"
              className="px-5 py-2.5 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-sm font-medium"
            >
              Customer Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7] dark:bg-[#0B0C0E] text-[#111214] dark:text-[#F4F5F7] flex">
      {/* Desktop Admin Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-r border-[#E2E4E9] dark:border-[#22242A] bg-white dark:bg-[#111215]">
        <div className="px-5 py-5 border-b border-[#E2E4E9] dark:border-[#22242A]">
          <p className="text-sm font-semibold">Administration</p>
          <p className="mt-0.5 text-xs text-[#686D76] dark:text-[#7E828A]">
            {exchangeService.getRoleLabel(currentRole)}
          </p>
        </div>

        <nav aria-label="Admin navigation" className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {ADMIN_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#004AE2] text-white'
                      : 'text-[#4B5059] dark:text-[#9CA0A8] hover:bg-[#F4F5F7] dark:hover:bg-[#1A1C20] hover:text-[#111214] dark:hover:text-white'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[#E2E4E9] dark:border-[#22242A] space-y-2">
          <Link
            to="/overview"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold hover:opacity-90"
          >
            <Activity className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Customer View</span>
          </Link>
        </div>
      </aside>

      {/* Mobile Admin Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white dark:bg-[#141518] h-full flex flex-col border-r border-[#E2E4E9] dark:border-[#22242A]">
            <div className="flex items-center justify-between px-4 py-4 border-b border-[#E2E4E9] dark:border-[#22242A]">
              <div>
                <p className="text-sm font-semibold">Administration</p>
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  {exchangeService.getRoleLabel(currentRole)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close admin menu"
                className="p-2 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {ADMIN_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setDrawerOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium ${
                        isActive
                          ? 'bg-[#004AE2] text-white'
                          : 'text-[#4B5059] dark:text-[#9CA0A8] hover:bg-[#F4F5F7] dark:hover:bg-[#1C1E24]'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>
            <div className="p-3 border-t border-[#E2E4E9] dark:border-[#22242A] space-y-2">
              <Link
                to="/overview"
                onClick={() => setDrawerOpen(false)}
                className="block text-center w-full py-2.5 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold"
              >
                Customer View
              </Link>
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  setDrawerOpen(false);
                  navigate('/login');
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full bg-[#242528] text-white text-xs font-semibold"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 px-4 lg:px-6 flex items-center justify-between gap-4 bg-[#F4F5F7]/95 dark:bg-[#0B0C0E]/95 backdrop-blur-md border-b border-[#E2E4E9] dark:border-[#1E2026]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open admin navigation"
              className="lg:hidden p-2 -ml-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base sm:text-lg font-semibold truncate">{title}</h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline-block text-xs text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
              {currentProfile.fullName} · {exchangeService.getRoleLabel(currentRole)}
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-full hover:bg-[#E8EAEE] dark:hover:bg-[#242528] min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              aria-label="Sign out"
              className="p-2 rounded-full hover:bg-[#E8EAEE] dark:hover:bg-[#242528] min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 lg:px-6 py-5">{children}</main>
      </div>
    </div>
  );
};
