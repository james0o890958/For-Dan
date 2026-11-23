import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronLeft, Eye, EyeOff } from 'lucide-react';
import { useAppState } from '../../context/AppStateContext';
import { LanguageModal } from '../../components/ui/CommonPrimitives';

const AuthShell: React.FC<{
  bannerTitle: string;
  children: React.ReactNode;
}> = ({ bannerTitle, children }) => {
  const { language, setLanguage } = useAppState();
  const [langOpen, setLangOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F4F5F7] dark:bg-[#0B0C0E] text-[#111214] dark:text-[#F4F5F7] flex flex-col">
      <header className="max-w-lg w-full mx-auto px-4 pt-4 pb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="p-2 -ml-2 rounded-full hover:bg-[#E8EAEE] dark:hover:bg-[#242528] min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => setLangOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium min-h-[36px]"
        >
          <span>{language}</span>
          <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </header>

      <main className="flex-1 flex items-start sm:items-center justify-center px-4 py-4">
        <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
          <div className="relative h-28 px-6 flex items-center bg-gradient-to-r from-[#092867] via-[#133A8A] to-[#2F2E7E] text-white">
            <h1 className="text-2xl font-bold tracking-tight">{bannerTitle}</h1>
          </div>
          <div className="p-6">{children}</div>
        </div>
      </main>

      <LanguageModal
        open={langOpen}
        selected={language}
        onSelect={setLanguage}
        onClose={() => setLangOpen(false)}
      />
    </div>
  );
};

export const LoginPage: React.FC = () => {
  const { login } = useAppState();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await login(identifier, password);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    const role = res.role ?? 'customer';
    const isAdminAccount =
      role === 'super_admin' ||
      role === 'operations_admin' ||
      role === 'finance_admin' ||
      role === 'compliance_admin';
    navigate(isAdminAccount ? '/admin' : '/overview');
  };

  return (
    <AuthShell bannerTitle="Sign in">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-identifier" className="block text-sm font-medium mb-1.5">
            Account email, phone, or User ID
          </label>
          <input
            id="login-identifier"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="Enter email, phone, or User ID"
            autoComplete="username"
            className="w-full h-12 px-4 rounded-xl bg-[#F4F5F7] dark:bg-[#141518] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm focus:outline-none focus:border-[#004AE2]"
          />
        </div>

        <div>
          <label htmlFor="login-password" className="block text-sm font-medium mb-1.5">
            Password
          </label>
          <div className="relative flex items-center">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              className="w-full h-12 pl-4 pr-12 rounded-xl bg-[#F4F5F7] dark:bg-[#141518] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm focus:outline-none focus:border-[#004AE2]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-2 p-2 text-[#686D76] dark:text-[#7E828A] hover:text-[#111214] dark:hover:text-white"
            >
              {showPassword ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-xs font-medium text-[#F0525E]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full h-12 rounded-full bg-[#004AE2] text-white text-sm font-semibold hover:bg-[#003ec0] transition-colors disabled:opacity-60"
        >
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>

        <label className="flex items-center gap-2.5 text-xs text-[#686D76] dark:text-[#9CA0A8] cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-4 h-4 rounded accent-[#004AE2]"
          />
          <span>Remember this device</span>
        </label>

        <Link
          to="/register"
          className="w-full h-12 rounded-full border border-[#111214]/40 dark:border-white/80 flex items-center justify-center text-sm font-semibold hover:bg-[#F4F5F7] dark:hover:bg-white/5"
        >
          Create New Account
        </Link>

        <div className="text-center pt-1">
          <Link to="/forgot-password" className="text-sm font-medium hover:underline">
            Forgot password?
          </Link>
        </div>
      </form>
    </AuthShell>
  );
};

export const RegisterPage: React.FC = () => {
  const { register, language } = useAppState();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'email' | 'mobile'>('email');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !password) {
      setError('Please complete all required fields.');
      return;
    }
    if (mode === 'mobile' && !phone.trim()) {
      setError('Please enter your mobile number in international E.164 format (e.g. +15550102030).');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await register({
      fullName,
      email,
      phone: phone.trim() || undefined,
      password,
      preferredLanguage: language,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    navigate('/overview');
  };

  return (
    <AuthShell bannerTitle="Create New Account">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 p-1 rounded-full bg-[#E8EAEE] dark:bg-[#242528]">
          <button
            type="button"
            onClick={() => setMode('mobile')}
            className={`py-2 rounded-full text-xs font-semibold transition-colors ${
              mode === 'mobile'
                ? 'bg-white dark:bg-[#0B0C0E] text-[#111214] dark:text-white'
                : 'text-[#686D76] dark:text-[#7E828A]'
            }`}
          >
            Mobile
          </button>
          <button
            type="button"
            onClick={() => setMode('email')}
            className={`py-2 rounded-full text-xs font-semibold transition-colors ${
              mode === 'email'
                ? 'bg-white dark:bg-[#0B0C0E] text-[#111214] dark:text-white'
                : 'text-[#686D76] dark:text-[#7E828A]'
            }`}
          >
            Email
          </button>
        </div>

        <div>
          <label htmlFor="reg-fullname" className="block text-sm font-medium mb-1.5">
            Legal Full Name
          </label>
          <input
            id="reg-fullname"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Enter your legal full name"
            className="w-full h-12 px-4 rounded-xl bg-[#F4F5F7] dark:bg-[#141518] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm focus:outline-none focus:border-[#004AE2]"
          />
        </div>

        <div>
          <label htmlFor="reg-email" className="block text-sm font-medium mb-1.5">
            Email
          </label>
          <input
            id="reg-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            className="w-full h-12 px-4 rounded-xl bg-[#F4F5F7] dark:bg-[#141518] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm focus:outline-none focus:border-[#004AE2]"
          />
        </div>

        <div>
          <label htmlFor="reg-phone" className="block text-sm font-medium mb-1.5">
            Mobile Number ({mode === 'mobile' ? 'Required E.164' : 'Optional E.164'})
          </label>
          <input
            id="reg-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 010 2030"
            autoComplete="tel"
            className="w-full h-12 px-4 rounded-xl bg-[#F4F5F7] dark:bg-[#141518] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm focus:outline-none focus:border-[#004AE2]"
          />
        </div>

        <div>
          <label htmlFor="reg-password" className="block text-sm font-medium mb-1.5">
            Password (min 8 characters)
          </label>
          <div className="relative flex items-center">
            <input
              id="reg-password"
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a strong password"
              autoComplete="new-password"
              className="w-full h-12 pl-4 pr-12 rounded-xl bg-[#F4F5F7] dark:bg-[#141518] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm focus:outline-none focus:border-[#004AE2]"
            />
            <button
              type="button"
              onClick={() => setShowPwd((p) => !p)}
              aria-label={showPwd ? 'Hide password' : 'Show password'}
              className="absolute right-2 p-2 text-[#686D76]"
            >
              {showPwd ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="reg-confirm" className="block text-sm font-medium mb-1.5">
            Confirm password
          </label>
          <input
            id="reg-confirm"
            type={showPwd ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            className="w-full h-12 px-4 rounded-xl bg-[#F4F5F7] dark:bg-[#141518] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm focus:outline-none focus:border-[#004AE2]"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs font-medium text-[#F0525E]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full h-12 rounded-full bg-[#004AE2] text-white text-sm font-semibold hover:bg-[#003ec0] disabled:opacity-60"
        >
          {submitting ? 'Creating Account...' : 'Create New Account'}
        </button>

        <p className="text-center text-xs text-[#686D76] dark:text-[#7E828A]">
          New accounts start with 0.00 available and 0.00 reserved balances across all assets and require KYC approval prior to deposits, trading, or withdrawals.
        </p>

        <div className="text-center pt-1">
          <Link to="/login" className="text-sm font-medium hover:underline">
            Already have an account? Sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
};

export const ForgotPasswordPage: React.FC = () => {
  const { recoverPassword } = useAppState();
  const [account, setAccount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account.trim()) {
      setError('Enter your account email, phone, or User ID.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const res = await recoverPassword(account);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNotice(res.message);
  };

  return (
    <AuthShell bannerTitle="Account Recovery">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="fp-account" className="block text-sm font-medium mb-1.5">
            Account email, phone, or User ID
          </label>
          <input
            id="fp-account"
            type="text"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="Enter account email or User ID"
            className="w-full h-12 px-4 rounded-xl bg-[#F4F5F7] dark:bg-[#141518] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm focus:outline-none focus:border-[#004AE2]"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs font-medium text-[#F0525E]">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-xs font-medium text-[#10C478]">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full h-12 rounded-full bg-[#004AE2] text-white text-sm font-semibold hover:bg-[#003ec0] disabled:opacity-60"
        >
          {submitting ? 'Sending...' : 'Request Reset Link'}
        </button>

        <div className="text-center pt-1">
          <Link to="/login" className="text-sm font-medium hover:underline">
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
};
