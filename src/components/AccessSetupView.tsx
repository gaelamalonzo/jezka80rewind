import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Database, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import type { User } from 'firebase/auth';
import { db, firebaseConfig, handleFirestoreError, OperationType } from '../lib/firebase';
import { deleteStaffRole, upsertStaffRole } from '../lib/attendanceService';
import { BOOTSTRAPPED_ADMIN_EMAIL, CONSTRAINTS, sanitizeEmail } from '../lib/validation';
import type { StaffRoleRecord, StaffRoleType } from '../types';

interface Props {
  user: User;
  selectedEventId?: string;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => void;
}

export const AccessSetupView: React.FC<Props> = ({ user, selectedEventId, onNotify }) => {
  const [staffList, setStaffList] = useState<StaffRoleRecord[]>([]);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<StaffRoleType>('staff');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const path = 'staff_roles';
    const q = query(collection(db, 'staff_roles'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setStaffList(snap.docs.map((d) => d.data() as StaffRoleRecord));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );
    return () => unsub();
  }, []);

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = sanitizeEmail(email);
    if (!CONSTRAINTS.EMAIL_PATTERN.test(cleanEmail)) {
      onNotify('error', 'Invalid Email', 'Enter a valid Google account email address.');
      return;
    }
    if (!displayName.trim()) {
      onNotify('error', 'Name Required', 'Enter the staff member display name.');
      return;
    }

    setSaving(true);
    try {
      await upsertStaffRole({
        email: cleanEmail,
        displayName: displayName.trim(),
        role,
        active: true,
        eventIdForAudit: selectedEventId,
        user,
      });
      setEmail('');
      setDisplayName('');
      setRole('staff');
      onNotify('success', 'Access Granted', `${cleanEmail} assigned as ${role.toUpperCase()}.`);
    } catch (error) {
      onNotify('error', 'Failed to Add Staff', error instanceof Error ? error.message : 'Unable to save role.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (member: StaffRoleRecord) => {
    try {
      await upsertStaffRole({
        email: member.email,
        displayName: member.displayName,
        role: member.role,
        active: !member.active,
        eventIdForAudit: selectedEventId,
        user,
      });
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
    if (memberEmail === BOOTSTRAPPED_ADMIN_EMAIL) {
      onNotify('warning', 'Protected Owner', 'Primary owner admin cannot be deleted.');
      return;
    }
    try {
      await deleteStaffRole(memberEmail);
      onNotify('info', 'Role Removed', `Revoked access for ${memberEmail}.`);
    } catch (error) {
      onNotify('error', 'Remove Failed', error instanceof Error ? error.message : 'Unable to remove staff.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Add Staff / Admin Form */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <UserPlus className="w-5 h-5 text-[#0B1D3A]" />
            <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
              Authorize Staff or Admin
            </h2>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Staff users can scan QR tickets, perform manual check-ins, and view attendance lists. Only Administrators can create events, manage roles, correct records, or toggle Shared Event QR.
          </p>

          <form onSubmit={handleAddStaff} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Google Account Email
              </label>
              <input
                type="email"
                required
                maxLength={120}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff.member@company.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Staff Name
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
              {saving ? 'Saving...' : 'Grant Access'}
            </button>
          </form>
        </div>

        {/* Authorized Team Directory */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#0B1D3A]" />
            <h2 className="font-display text-base font-semibold text-[#0B1D3A]">
              Authorized Personnel Directory
            </h2>
          </div>

          <div className="divide-y divide-slate-100">
            <div className="px-6 py-3.5 flex items-center justify-between gap-4 bg-slate-50/60">
              <div>
                <p className="text-sm font-semibold text-slate-900">Primary Owner Administrator</p>
                <p className="text-xs font-mono text-slate-600">{BOOTSTRAPPED_ADMIN_EMAIL}</p>
              </div>
              <span className="text-xs font-semibold text-[#0B1D3A]">ADMIN · BOOTSTRAPPED</span>
            </div>

            {staffList.map((m) => (
              <div key={m.email} className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{m.displayName}</p>
                  <p className="text-xs font-mono text-slate-500 truncate">{m.email}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold uppercase text-[#0B1D3A]">
                    {m.role}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(m)}
                    className={`px-2.5 py-1 border rounded text-xs font-medium ${
                      m.active
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-slate-100 border-slate-300 text-slate-600'
                    }`}
                  >
                    {m.active ? 'Active' : 'Suspended'}
                  </button>
                  {m.email !== BOOTSTRAPPED_ADMIN_EMAIL && (
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
            ))}
          </div>
        </div>
      </div>

      {/* Firebase Configuration & Free Tier Guide */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Database className="w-5 h-5 text-[#0B1D3A]" />
          <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
            Firebase Configuration &amp; Spark Free Tier Guide (1-Day Company Event)
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <p className="font-semibold text-[#0B1D3A]">Connected Firebase Project</p>
            <p className="font-mono text-slate-700">{firebaseConfig.projectId}</p>
            <p className="text-slate-500">Auth Domain: {firebaseConfig.authDomain}</p>
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <p className="font-semibold text-[#0B1D3A]">Cloud Firestore Database</p>
            <p className="font-mono text-slate-700 break-all">{firebaseConfig.firestoreDatabaseId}</p>
            <p className="text-slate-500">Security Rules Deployed &amp; Atomic Transactions Active</p>
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <p className="font-semibold text-[#0B1D3A]">Spark Free Tier Budget (500–1,000 Attendees)</p>
            <p className="text-slate-700 tabular-nums">Reads: ~2,000–6,000 / 50,000 daily free limit</p>
            <p className="text-slate-700 tabular-nums">Writes: ~2,000–3,000 / 20,000 daily free limit</p>
          </div>
        </div>

        <div className="text-xs text-slate-600 space-y-2 leading-relaxed pt-2">
          <p className="font-semibold text-slate-900">Checklist for Your 1-Day Company Event:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              <span className="font-medium text-slate-800">Authentication:</span> Google Sign-In is active and pre-configured. Add your registration desk staff emails above as <code className="font-mono">Staff</code> so they can scan QR tickets simultaneously from multiple tablets or phones.
            </li>
            <li>
              <span className="font-medium text-slate-800">Pre-Event Bulk Import:</span> Upload your employee CSV/Excel list in Registration to generate all 500–1,000 participant IDs and QR secrets in seconds, or share the Public Registration Link.
            </li>
            <li>
              <span className="font-medium text-slate-800">Venue Self-Check-In:</span> Print the Shared Event QR Poster and toggle <span className="font-medium">Shared QR Enabled</span> on event morning; disable it immediately after the keynote cutoff if desired.
            </li>
            <li>
              <span className="font-medium text-slate-800">Security Rules:</span> Firestore rules enforce strict email verification, PII isolation, and single-use atomic check-in receipts (<code className="font-mono">attendance_logs</code>). Review <code className="font-mono">firestore.rules</code> in the project root before broad sharing.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};
