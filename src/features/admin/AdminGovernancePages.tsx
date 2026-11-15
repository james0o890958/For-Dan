import React, { useMemo, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { SearchInput } from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import { exchangeService } from '../../services/platformService';
import type { AppRole } from '../../types/domain';

export const AdminRolesPage: React.FC = () => {
  const { profiles, userRoles, currentRole, updateAdminRole } = useAppState();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const adminRows = useMemo(() => {
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    return userRoles
      .filter((r) => r.role !== 'customer')
      .map((r) => ({
        ...r,
        profile: profileMap.get(r.userId),
      }));
  }, [profiles, userRoles]);

  return (
    <AdminLayout title="Admin Management">
      <div className="space-y-4">
        <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 text-xs text-[#686D76] dark:text-[#7E828A]">
          Supported roles: <strong>Super Admin</strong>, <strong>Operations Admin</strong>,{' '}
          <strong>Finance Admin</strong>, and <strong>Compliance Admin</strong>. Role assignments are restricted to Super Admins.
        </div>

        {msg && (
          <p className={`text-xs font-medium ${msg.ok ? 'text-[#10C478]' : 'text-[#F0525E]'}`}>
            {msg.text}
          </p>
        )}

        <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                  <th className="py-3 px-4 font-medium">Administrator</th>
                  <th className="py-3 px-4 font-medium">Email</th>
                  <th className="py-3 px-4 font-medium">Current Role</th>
                  <th className="py-3 px-4 font-medium text-right">Assign Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                {adminRows.map((row) => (
                  <tr key={row.id}>
                    <td className="py-3 px-4">
                      <p className="font-semibold">{row.profile?.fullName}</p>
                      <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                        ID {row.profile?.publicUserId}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-xs">{row.profile?.email}</td>
                    <td className="py-3 px-4 text-xs font-semibold text-[#004AE2] dark:text-[#60A5FA]">
                      {exchangeService.getRoleLabel(row.role)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <select
                        aria-label={`Assign role for ${row.profile?.fullName}`}
                        disabled={currentRole !== 'super_admin'}
                        value={row.role}
                        onChange={(e) => {
                          const res = updateAdminRole(row.userId, e.target.value as AppRole);
                          setMsg({ ok: res.ok, text: res.message });
                        }}
                        className="h-9 px-3 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs disabled:opacity-50"
                      >
                        <option value="super_admin">Super Admin</option>
                        <option value="operations_admin">Operations Admin</option>
                        <option value="finance_admin">Finance Admin</option>
                        <option value="compliance_admin">Compliance Admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
};

export const AdminAuditLogsPage: React.FC = () => {
  const { auditLogs } = useAppState();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.adminLabel.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q) ||
        (l.affectedPublicUserId?.toLowerCase().includes(q) ?? false)
    );
  }, [auditLogs, search]);

  return (
    <AdminLayout title="Audit Logs">
      <div className="space-y-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search admin, action, User ID, or details"
          ariaLabel="Search audit logs"
          className="sm:w-96"
        />

        <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                  <th className="py-3 px-4 font-medium">Admin</th>
                  <th className="py-3 px-4 font-medium">Action</th>
                  <th className="py-3 px-4 font-medium">Affected Customer</th>
                  <th className="py-3 px-4 font-medium">Record</th>
                  <th className="py-3 px-4 font-medium">Details</th>
                  <th className="py-3 px-4 font-medium">Date &amp; Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                {filtered.map((log) => (
                  <tr key={log.id}>
                    <td className="py-3 px-4 text-xs font-medium">{log.adminLabel}</td>
                    <td className="py-3 px-4 text-xs font-semibold">{log.action}</td>
                    <td className="py-3 px-4 font-mono-num text-xs">
                      {log.affectedPublicUserId || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-[#686D76] dark:text-[#7E828A]">
                      {log.recordType}
                    </td>
                    <td className="py-3 px-4 text-xs">{log.details}</td>
                    <td className="py-3 px-4 font-mono-num text-xs text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
};
