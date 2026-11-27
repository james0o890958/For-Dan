import React, { useEffect, useMemo, useState } from 'react';
import { Shield, ShieldAlert, ShieldCheck, RefreshCw, X, Globe, Server, AlertCircle } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { EmptyState, SearchInput } from '../../components/ui/CommonPrimitives';
import { exchangeApi, type AuthSecurityEventRecord, type SecurityProviderStatusPayload } from '../../services/exchangeApi';

export const AdminSecurityPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [providerStatus, setProviderStatus] = useState<SecurityProviderStatusPayload | null>(null);
  const [events, setEvents] = useState<AuthSecurityEventRecord[]>([]);
  const [dataSource, setDataSource] = useState<'database' | 'runtime'>('database');
  const [locationNotice, setLocationNotice] = useState<string>('');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [limit, setLimit] = useState(100);

  const [selectedEvent, setSelectedEvent] = useState<AuthSecurityEventRecord | null>(null);

  const loadSecurityData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setFeedback(null);

    try {
      const [statusRes, eventsRes] = await Promise.all([
        exchangeApi.fetchSecurityProviderStatus(),
        exchangeApi.fetchAdminSecurityEvents(limit, typeFilter),
      ]);

      if (statusRes.ok && statusRes.data) {
        setProviderStatus(statusRes.data);
      }
      if (eventsRes.ok && eventsRes.data) {
        setEvents(eventsRes.data.events);
        setDataSource(eventsRes.data.source);
        setLocationNotice(eventsRes.data.locationNotice);
      } else {
        setFeedback(eventsRes.message || statusRes.message || 'Failed to load security telemetry.');
      }
    } catch {
      setFeedback('Network error while connecting to security telemetry service.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSecurityData();
  }, [typeFilter, limit]);

  const stats = useMemo(() => {
    const total = events.length;
    const loginsSuccess = events.filter((e) => e.eventType === 'login_success').length;
    const loginsFailure = events.filter((e) => e.eventType === 'login_failure').length;
    const registrations = events.filter((e) => e.eventType === 'register').length;
    return { total, loginsSuccess, loginsFailure, registrations };
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => {
      return (
        (e.ipAddress?.toLowerCase().includes(q) ?? false) ||
        (e.identifierAttempted?.toLowerCase().includes(q) ?? false) ||
        (e.userId?.toLowerCase().includes(q) ?? false) ||
        (e.countryName?.toLowerCase().includes(q) ?? false) ||
        (e.approximateCity?.toLowerCase().includes(q) ?? false) ||
        (e.isp?.toLowerCase().includes(q) ?? false) ||
        e.eventType.toLowerCase().includes(q)
      );
    });
  }, [events, search]);

  const renderEventTypeBadge = (type: AuthSecurityEventRecord['eventType']) => {
    switch (type) {
      case 'login_success':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#10C478]/15 text-[#10C478] text-[11px] font-semibold">
            <ShieldCheck className="w-3 h-3" /> Login Success
          </span>
        );
      case 'login_failure':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#F0525E]/15 text-[#F0525E] text-[11px] font-semibold">
            <ShieldAlert className="w-3 h-3" /> Login Failure
          </span>
        );
      case 'register':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#004AE2]/15 text-[#004AE2] text-[11px] font-semibold">
            <Shield className="w-3 h-3" /> Registration
          </span>
        );
      default:
        return <span className="px-2.5 py-0.5 rounded-full bg-gray-500/15 text-xs">{type}</span>;
    }
  };

  return (
    <AdminLayout title="Security &amp; Login Activity">
      <div className="space-y-6">
        {/* Provider Status & Geolocation Config Bar */}
        <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#004AE2]/10 text-[#004AE2] dark:text-[#60A5FA] flex items-center justify-center">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">IP Intelligence &amp; Geolocation Engine</h2>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                      providerStatus?.configured
                        ? 'bg-[#10C478]/15 text-[#10C478]'
                        : 'bg-[#D97706]/15 text-[#D97706]'
                    }`}
                  >
                    {providerStatus?.configured ? 'Active (API Configured)' : 'Sandbox / Unconfigured'}
                  </span>
                </div>
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  Provider: {providerStatus?.provider ?? 'ipgeolocation.io'} · Endpoint: {providerStatus?.endpoint ?? '—'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadSecurityData(true)}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold hover:opacity-90 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span>Refresh Logs</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3">
              <span className="text-[#686D76] dark:text-[#7E828A]">Data Source</span>
              <p className="font-semibold capitalize mt-0.5">{dataSource} Storage</p>
            </div>
            <div className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3">
              <span className="text-[#686D76] dark:text-[#7E828A]">Trusted Proxy Hops</span>
              <p className="font-mono-num font-semibold mt-0.5">{providerStatus?.trustedProxyHops ?? 1}</p>
            </div>
            <div className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3">
              <span className="text-[#686D76] dark:text-[#7E828A]">IP Cache Entries</span>
              <p className="font-mono-num font-semibold mt-0.5">{providerStatus?.cacheEntries ?? 0}</p>
            </div>
            <div className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3">
              <span className="text-[#686D76] dark:text-[#7E828A]">Location Accuracy Notice</span>
              <p className="text-[11px] text-[#686D76] dark:text-[#9CA0A8] truncate mt-0.5" title={locationNotice}>
                {locationNotice || 'IP-based geolocation is approximate.'}
              </p>
            </div>
          </div>
        </div>

        {/* Summary Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Total Telemetry Events</p>
            <p className="mt-1 text-2xl font-bold font-mono-num">{stats.total}</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Successful Logins</p>
            <p className="mt-1 text-2xl font-bold font-mono-num text-[#10C478]">{stats.loginsSuccess}</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Failed Logins</p>
            <p className="mt-1 text-2xl font-bold font-mono-num text-[#F0525E]">{stats.loginsFailure}</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Registrations</p>
            <p className="mt-1 text-2xl font-bold font-mono-num text-[#004AE2] dark:text-[#60A5FA]">
              {stats.registrations}
            </p>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search IP, user ID, email, or country..."
              ariaLabel="Search security events"
              className="w-full sm:w-80"
            />
            <select
              aria-label="Filter by event type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-10 px-3 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
            >
              <option value="ALL">All Event Types</option>
              <option value="login_success">Login Success</option>
              <option value="login_failure">Login Failure</option>
              <option value="register">Registration</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Result limit"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-10 px-3 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
            >
              <option value={50}>Show 50</option>
              <option value={100}>Show 100</option>
              <option value={200}>Show 200</option>
            </select>
          </div>
        </div>

        {feedback && (
          <div className="rounded-xl bg-[#FEF2F2] dark:bg-[#2A1416] border border-[#F0525E]/40 p-4 text-xs font-medium text-[#F0525E] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{feedback}</span>
          </div>
        )}

        {/* Security Events Table */}
        {loading ? (
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-12 text-center text-xs text-[#686D76]">
            Loading security telemetry...
          </div>
        ) : filteredEvents.length === 0 ? (
          <EmptyState
            title="No security events found"
            description="Authentication telemetry events matching your search or filters will appear here."
          />
        ) : (
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm" data-testid="admin-security-events-table">
                <thead>
                  <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                    <th className="py-3 px-4 font-medium">Timestamp</th>
                    <th className="py-3 px-4 font-medium">Event Type</th>
                    <th className="py-3 px-4 font-medium">User / Identifier</th>
                    <th className="py-3 px-4 font-medium">IP Address &amp; Source</th>
                    <th className="py-3 px-4 font-medium">Approximate Location</th>
                    <th className="py-3 px-4 font-medium text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {filteredEvents.map((ev) => (
                    <tr key={ev.id} className="hover:bg-[#F4F5F7]/50 dark:hover:bg-[#1A1C20]/50">
                      <td className="py-3 px-4 whitespace-nowrap font-mono-num text-xs text-[#686D76]">
                        {new Date(ev.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">{renderEventTypeBadge(ev.eventType)}</td>
                      <td className="py-3 px-4">
                        <p className="font-semibold truncate max-w-[200px]">{ev.identifierAttempted || '—'}</p>
                        {ev.userId && (
                          <p className="font-mono-num text-[11px] text-[#686D76] truncate">UUID: {ev.userId}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <p className="font-mono-num font-semibold">{ev.ipAddress || 'Unknown IP'}</p>
                        <p className="text-[10px] text-[#686D76] uppercase">
                          v{ev.ipVersion ?? '4'} · {ev.ipSource}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium">
                          {ev.countryName ? `${ev.countryName} (${ev.countryCode})` : 'Unknown Location'}
                        </p>
                        <p className="text-[11px] text-[#686D76] truncate">
                          {[ev.approximateCity, ev.regionState].filter(Boolean).join(', ') || 'Approximate region'}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedEvent(ev)}
                          className="px-3 py-1.5 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Event Details Inspection Modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="security-event-modal-title"
        >
          <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <h2 id="security-event-modal-title" className="text-base font-semibold">
                  Security Event Telemetry Inspection
                </h2>
                {renderEventTypeBadge(selectedEvent.eventType)}
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg hover:bg-[#E8EAEE] dark:hover:bg-[#242528]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-xs rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] p-4">
              <div>
                <dt className="text-[#686D76]">Event ID</dt>
                <dd className="font-mono-num font-semibold mt-0.5 truncate">{selectedEvent.id}</dd>
              </div>
              <div>
                <dt className="text-[#686D76]">Timestamp</dt>
                <dd className="font-mono-num font-semibold mt-0.5">
                  {new Date(selectedEvent.createdAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-[#686D76]">Attempted Identifier / User</dt>
                <dd className="font-semibold mt-0.5 truncate">{selectedEvent.identifierAttempted || '—'}</dd>
              </div>
              <div>
                <dt className="text-[#686D76]">User UUID</dt>
                <dd className="font-mono-num text-[11px] mt-0.5 truncate">{selectedEvent.userId || 'Unauthenticated / Anonymous'}</dd>
              </div>
              <div>
                <dt className="text-[#686D76]">IP Address &amp; Version</dt>
                <dd className="font-mono-num font-bold mt-0.5">
                  {selectedEvent.ipAddress || '—'} (IPv{selectedEvent.ipVersion ?? '4'})
                </dd>
              </div>
              <div>
                <dt className="text-[#686D76]">IP Extraction Source</dt>
                <dd className="font-mono-num mt-0.5">{selectedEvent.ipSource}</dd>
              </div>
              <div>
                <dt className="text-[#686D76]">Country &amp; Region</dt>
                <dd className="font-semibold mt-0.5">
                  {selectedEvent.countryName ? `${selectedEvent.countryName} (${selectedEvent.countryCode})` : 'Unknown'}
                  {selectedEvent.regionState ? ` · ${selectedEvent.regionState}` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-[#686D76]">Approximate City</dt>
                <dd className="font-semibold mt-0.5">{selectedEvent.approximateCity || '—'}</dd>
              </div>
              <div>
                <dt className="text-[#686D76]">ISP &amp; ASN</dt>
                <dd className="font-semibold mt-0.5">
                  {selectedEvent.isp || '—'} {selectedEvent.asn ? `(AS${selectedEvent.asn})` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-[#686D76]">ASN Organization</dt>
                <dd className="font-semibold mt-0.5">{selectedEvent.asnOrganization || '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[#686D76]">User Agent Summary</dt>
                <dd className="font-mono-num text-[11px] mt-0.5 break-all">
                  {selectedEvent.userAgentSummary || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[#686D76]">Device &amp; OS</dt>
                <dd className="font-medium mt-0.5">
                  {selectedEvent.deviceType} / {selectedEvent.operatingSystem}
                </dd>
              </div>
              <div>
                <dt className="text-[#686D76]">Browser</dt>
                <dd className="font-medium mt-0.5">{selectedEvent.browser}</dd>
              </div>
              <div className="col-span-2 rounded-lg bg-white dark:bg-[#141518] p-3 border border-[#E2E4E9] dark:border-[#22242A]">
                <p className="text-[11px] text-[#686D76] leading-relaxed">
                  <strong>Geolocation Notice:</strong> {selectedEvent.locationNotice}
                </p>
              </div>
            </dl>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};
