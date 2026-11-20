import React, { useEffect, useState } from 'react';
import { Database, KeyRound, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { deleteStaffUser, fetchStaffList, upsertStaffUser } from '../lib/attendanceService';
import { CONSTRAINTS, sanitizeEmail } from '../lib/validation';
import type { AuthUser, StaffRoleRecord, StaffRoleType } from '../types';

interface Props {
  user: AuthUser;
  selectedEventId?: string;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => void;
}

export const AccessSetupView: React.FC<Props> = ({ user, selectedEventId, onNotify }) => {
  const [staffList, setStaffList] = useState<StaffRoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<StaffRoleType>('staff');
  const [saving, setSaving] = useState(false);

  const loadStaff = async () => {
    setLoading(true);
    try {
      const list = await fetchStaffList();
      setStaffList(list);
    } catch (error) {
      onNotify('error', 'Failed to Load Staff', error instanceof Error ? error.message : 'Unable to load directory.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddOrUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = sanitizeEmail(email);
    if (!CONSTRAINTS.EMAIL_PATTERN.test(cleanEmail)) {
      onNotify('error', 'Invalid Email', 'Enter a valid staff email address.');
      return;
    }
    if (!displayName.trim()) {
      onNotify('error', 'Name Required', 'Enter the staff member display name.');
      return;
    }
    const isExisting = staffList.some((m) => m.email === cleanEmail);
    if (!isExisting && password.length < 8) {
      onNotify('error', 'Password Required', 'New staff accounts require a password of at least 8 characters.');
      return;
    }
    if (password && password.length < 8) {
      onNotify('error', 'Weak Password', 'Password must be at least 8 characters.');
      return;
    }

    setSaving(true);
    try {
      await upsertStaffUser({
        email: cleanEmail,
        displayName: displayName.trim(),
        role,
        active: true,
        password: password || undefined,
        eventIdForAudit: selectedEventId,
      });
      setEmail('');
      setDisplayName('');
      setPassword('');
      setRole('staff');
      await loadStaff();
      onNotify(
        'success',
        isExisting ? 'Account Updated' : 'Staff Account Created',
        `${cleanEmail} assigned as ${role.toUpperCase()}.`
      );
    } catch (error) {
      onNotify('error', 'Failed to Save Staff', error instanceof Error ? error.message : 'Unable to save account.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (member: StaffRoleRecord) => {
    if (member.email === user.email && member.active) {
      onNotify('warning', 'Action Blocked', 'You cannot suspend your own currently signed-in administrator account.');
      return;
    }
    try {
      await upsertStaffUser({
        email: member.email,
        displayName: member.displayName,
        role: member.role,
        active: !member.active,
        eventIdForAudit: selectedEventId,
      });
      await loadStaff();
      onNotify(
        'info',
        'Access Updated',
        `${member.email} is now ${!member.active ? 'Active' : 'Suspended'}.`
      );
    } catch (error) {
      onNotify('error', 'Update Failed', error instanceof Error ? error.message : 'Unable to update access.');
    }
  };

  const handleRemove = async (memberEmail: string) => {
    if (memberEmail === user.email) {
      onNotify('warning', 'Action Blocked', 'You cannot delete your own signed-in administrator account.');
      return;
    }
    try {
      await deleteStaffUser(memberEmail);
      await loadStaff();
      onNotify('info', 'Account Removed', `Revoked access for ${memberEmail}.`);
    } catch (error) {
      onNotify('error', 'Remove Failed', error instanceof Error ? error.message : 'Unable to remove staff.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Add / Update Staff Form */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <UserPlus className="w-5 h-5 text-[#0B1D3A]" />
            <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
              Create or Update Staff Account
            </h2>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Staff users can scan QR tickets, perform manual check-ins, and view attendance lists. Only Administrators can create events, manage accounts, correct records, or toggle Shared Event QR.
          </p>

          <form onSubmit={handleAddOrUpdateStaff} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Staff Email Address
              </label>
              <input
                type="email"
                required
                maxLength={120}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="desk.staff@company.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name / Desk Label
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Registration Desk Lead"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Password (min. 8 characters)
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Required for new account (or leave blank to keep)"
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Permission Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as StaffRoleType)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
              >
                <option value="staff">Staff (QR Scanner &amp; Attendance View Only)</option>
                <option value="admin">Administrator (Full Access)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving Account...' : 'Save Staff Credentials'}
            </button>
          </form>
        </div>

        {/* Authorized Team Directory */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-[#0B1D3A]" />
              <h2 className="font-display text-base font-semibold text-[#0B1D3A]">
                Authorized Personnel Directory
              </h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {staffList.length} accounts
            </span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading staff accounts...</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {staffList.map((m) => {
                const isSelf = m.email === user.email;
                return (
                  <div key={m.email} className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {m.displayName} {isSelf && <span className="text-xs text-[#1E40AF]">(You)</span>}
                      </p>
                      <p className="text-xs font-mono text-slate-500 truncate">{m.email}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-semibold uppercase text-[#0B1D3A]">
                        {m.role}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(m)}
                        disabled={isSelf}
                        className={`px-2.5 py-1 border rounded text-xs font-medium disabled:opacity-60 ${
                          m.active
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-slate-100 border-slate-300 text-slate-600'
                        }`}
                      >
                        {m.active ? 'Active' : 'Suspended'}
                      </button>
                      {!isSelf && (
                        <button
                          type="button"
                          onClick={() => handleRemove(m.email)}
                          aria-label={`Remove ${m.email}`}
                          className="p-1.5 text-red-700 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Standalone SQLite Database & Free Hosting Guide */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Database className="w-5 h-5 text-[#0B1D3A]" />
          <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
            Zero-Cloud SQLite Database &amp; Free Deployment Guide
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <p className="font-semibold text-[#0B1D3A]">Database Engine</p>
            <p className="font-mono text-slate-700">SQLite WAL (data/attendance.db)</p>
            <p className="text-slate-500">Zero Google Cloud or Firebase dependencies</p>
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <p className="font-semibold text-[#0B1D3A]">Concurrency &amp; Security</p>
            <p className="font-mono text-slate-700">BEGIN IMMEDIATE + SSE Live Sync</p>
            <p className="text-slate-500">Single-use attendance lock + PBKDF2 Auth</p>
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <p className="font-semibold text-[#0B1D3A]">Cost &amp; Quota</p>
            <p className="text-slate-700 font-medium">$0 Free Forever · No API/Region Quotas</p>
            <p className="text-slate-500">Supports 1,000+ attendees across multiple staff devices</p>
          </div>
        </div>

        <div className="text-xs text-slate-600 space-y-2 leading-relaxed pt-2">
          <p className="font-semibold text-slate-900">1-Day Company Event Deployment Options (Free):</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              <span className="font-medium text-slate-800">Local / Venue Wi-Fi Server (Fastest):</span> Run <code className="font-mono">npm run build &amp;&amp; npm start</code> on one laptop at the venue; all staff tablets, phones, and attendee QR scans connect directly over your company network or a free tunnel (e.g. Cloudflare Tunnel).
            </li>
            <li>
              <span className="font-medium text-slate-800">Free Node Hosting:</span> Deploy this standalone repository to Render, Railway, or Fly.io with <code className="font-mono">npm run build</code> and <code className="font-mono">npm start</code>—no GCP project or billing account required.
            </li>
            <li>
              <span className="font-medium text-slate-800">Multi-Device Staff Check-In:</span> Create separate <code className="font-mono">Staff</code> logins above so multiple registration desks can scan Individual QR Tickets simultaneously with real-time SSE dashboard updates.
            </li>
            <li>
              <span className="font-medium text-slate-800">Backup &amp; Reports:</span> Export complete Excel (<code className="font-mono">.xlsx</code>) and CSV reports anytime from the Reports tab, or copy <code className="font-mono">data/attendance.db</code> as an instant full backup.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};
