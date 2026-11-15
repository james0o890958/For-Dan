import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { EmptyState, KycStatusLabel } from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';

export const KycPage: React.FC = () => {
  const { currentProfile, currentUserKyc, submitKyc } = useAppState();

  const [fullName, setFullName] = useState(currentProfile?.fullName ?? '');
  const [country, setCountry] = useState(currentUserKyc?.country ?? '');
  const [documentType, setDocumentType] = useState<'National ID' | 'Passport' | 'Driver License'>(
    currentUserKyc?.documentType ?? 'Passport'
  );
  const [documentNumber, setDocumentNumber] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  if (!currentProfile) {
    return (
      <CustomerLayout title="KYC Verification">
        <EmptyState
          title="Sign in to submit KYC"
          description="Identity verification and sanctions screening are required before cryptocurrency deposits, spot trading, or withdrawals."
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

  const canSubmit =
    currentProfile.kycStatus === 'not_submitted' || currentProfile.kycStatus === 'rejected';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = submitKyc({
      fullName,
      country,
      documentType,
      documentNumber,
    });
    setFeedback({ ok: res.ok, text: res.message });
    if (res.ok) {
      setDocumentNumber('');
    }
  };

  return (
    <CustomerLayout title="KYC Verification">
      <div className="max-w-2xl space-y-5">
        <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Identity & Compliance Status</h2>
            <KycStatusLabel status={currentProfile.kycStatus} />
          </div>
          <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
            Identity verification and sanctions screening are required prior to issuing custody deposit addresses, executing spot orders, or requesting withdrawals.
          </p>

          {currentProfile.kycStatus === 'rejected' && currentUserKyc?.rejectionReason && (
            <div className="p-3.5 rounded-xl bg-[#F0525E]/10 border border-[#F0525E]/40 text-xs">
              <p className="font-semibold text-[#F0525E]">Rejection Reason</p>
              <p className="mt-1 text-[#111214] dark:text-[#F4F5F7]">
                {currentUserKyc.rejectionReason}
              </p>
            </div>
          )}

          {currentUserKyc && (
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 text-xs border-t border-[#E2E4E9] dark:border-[#22242A]">
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Submitted Name</dt>
                <dd className="font-medium mt-0.5">{currentUserKyc.fullName}</dd>
              </div>
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Country</dt>
                <dd className="font-medium mt-0.5">{currentUserKyc.country}</dd>
              </div>
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Document Type</dt>
                <dd className="font-medium mt-0.5">{currentUserKyc.documentType}</dd>
              </div>
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Document No.</dt>
                <dd className="font-mono-num font-medium mt-0.5">{currentUserKyc.documentNumber}</dd>
              </div>
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Sanctions Screening</dt>
                <dd className="font-medium capitalize mt-0.5">{currentUserKyc.sanctionsStatus}</dd>
              </div>
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Verification Provider</dt>
                <dd className="font-medium mt-0.5">{currentUserKyc.providerName}</dd>
              </div>
            </dl>
          )}
        </div>

        {canSubmit ? (
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4"
          >
            <h2 className="text-base font-semibold">
              {currentProfile.kycStatus === 'rejected'
                ? 'Resubmit Identity Verification'
                : 'Submit Identity Verification'}
            </h2>

            <div>
              <label htmlFor="kyc-name" className="block text-xs font-medium mb-1.5">
                Legal Full Name
              </label>
              <input
                id="kyc-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm focus:outline-none focus:border-[#004AE2]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="kyc-country" className="block text-xs font-medium mb-1.5">
                  Country / Region
                </label>
                <input
                  id="kyc-country"
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g. United Kingdom"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm focus:outline-none focus:border-[#004AE2]"
                />
              </div>

              <div>
                <label htmlFor="kyc-doc-type" className="block text-xs font-medium mb-1.5">
                  Government Document Type
                </label>
                <select
                  id="kyc-doc-type"
                  value={documentType}
                  onChange={(e) =>
                    setDocumentType(
                      e.target.value as 'National ID' | 'Passport' | 'Driver License'
                    )
                  }
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm focus:outline-none focus:border-[#004AE2]"
                >
                  <option value="Passport">Passport</option>
                  <option value="National ID">National ID</option>
                  <option value="Driver License">Driver License</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="kyc-doc-num" className="block text-xs font-medium mb-1.5">
                Government Document Number
              </label>
              <input
                id="kyc-doc-num"
                type="text"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder="Enter document number"
                className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm focus:outline-none focus:border-[#004AE2]"
              />
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

            <button
              type="submit"
              className="px-6 h-11 rounded-full bg-[#004AE2] text-white text-sm font-semibold hover:bg-[#003ec0]"
            >
              {currentProfile.kycStatus === 'rejected' ? 'Resubmit KYC' : 'Submit KYC'}
            </button>
          </form>
        ) : (
          <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 text-xs text-[#686D76] dark:text-[#7E828A]">
            {currentProfile.kycStatus === 'pending'
              ? 'Your verification submission is queued for compliance review.'
              : 'Your identity verification is approved. No further submission is needed.'}
          </div>
        )}
      </div>
    </CustomerLayout>
  );
};
