import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppStateProvider } from './context/AppStateContext';
import { LandingPage } from './features/public/LandingPage';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
} from './features/auth/AuthPages';
import { DashboardPage } from './features/customer/DashboardPage';
import { MarketsPage } from './features/customer/MarketsPage';
import { MarketDetailPage } from './features/customer/MarketDetailPage';
import { TradingPage } from './features/customer/TradingPage';
import { WalletPage } from './features/customer/WalletPage';
import { AssetWalletDetailPage } from './features/customer/AssetWalletDetailPage';
import { PortfolioPage } from './features/customer/PortfolioPage';
import { TransactionsPage } from './features/customer/TransactionsPage';
import { KycPage } from './features/customer/KycPage';
import {
  NotificationsPage,
  SettingsPage,
} from './features/customer/NotificationsAndSettingsPages';
import { AdminDashboardPage } from './features/admin/AdminDashboardPage';
import { AdminCustomersPage } from './features/admin/AdminCustomersPage';
import { AdminKycPage } from './features/admin/AdminKycPage';
import { AdminDepositsPage } from './features/admin/AdminDepositsPage';
import { AdminWithdrawalsPage } from './features/admin/AdminWithdrawalsPage';
import { AdminAdjustmentsPage } from './features/admin/AdminAdjustmentsPage';
import {
  AdminAssetsPage,
  AdminMarketSettingsPage,
  AdminPairsPage,
} from './features/admin/AdminCatalogPages';
import {
  AdminTradesPage,
  AdminTransactionsPage,
} from './features/admin/AdminLedgerPages';
import { AdminNotificationsPage } from './features/admin/AdminNotificationsPage';
import { AdminSecurityPage } from './features/admin/AdminSecurityPage';
import {
  AdminAuditLogsPage,
  AdminRolesPage,
} from './features/admin/AdminGovernancePages';

export default function App() {
  return (
    <AppStateProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />

          {/* Customer */}
          <Route path="/overview" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/markets" element={<MarketsPage />} />
          <Route path="/markets/:symbol" element={<MarketDetailPage />} />
          <Route path="/trade" element={<TradingPage />} />
          <Route path="/wallets" element={<WalletPage mode="wallets" />} />
          <Route path="/wallets/:symbol" element={<AssetWalletDetailPage />} />
          <Route path="/wallet" element={<WalletPage mode="wallets" />} />
          <Route path="/deposit" element={<WalletPage mode="deposit" />} />
          <Route path="/withdraw" element={<WalletPage mode="withdraw" />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/kyc" element={<KycPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          {/* Admin */}
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/customers" element={<AdminCustomersPage />} />
          <Route path="/admin/kyc" element={<AdminKycPage />} />
          <Route path="/admin/deposits" element={<AdminDepositsPage />} />
          <Route path="/admin/withdrawals" element={<AdminWithdrawalsPage />} />
          <Route path="/admin/adjustments" element={<AdminAdjustmentsPage />} />
          <Route path="/admin/assets" element={<AdminAssetsPage />} />
          <Route path="/admin/pairs" element={<AdminPairsPage />} />
          <Route path="/admin/market-settings" element={<AdminMarketSettingsPage />} />
          <Route path="/admin/trades" element={<AdminTradesPage />} />
          <Route path="/admin/transactions" element={<AdminTransactionsPage />} />
          <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
          <Route path="/admin/admins" element={<AdminRolesPage />} />
          <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />} />
          <Route path="/admin/security" element={<AdminSecurityPage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppStateProvider>
  );
}
