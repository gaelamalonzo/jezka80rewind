import React, { useEffect, useMemo, useState } from 'react';
import { Edit3, QrCode, Search, Trash2, X } from 'lucide-react';
import {
  adminCorrectParticipant,
  adminDeleteParticipant,
  fetchAuditLogs,
} from '../lib/attendanceService';
import { formatTimestamp, validateParticipantInput } from '../lib/validation';
import type {
  AttendanceStatus,
  AuditLogRecord,
  AuthUser,
  EffectiveRole,
  EventRecord,
  ParticipantRecord,
} from '../types';
import { ParticipantTicketCard } from './ParticipantTicketCard';

interface Props {
  event: EventRecord | null;
  participants: ParticipantRecord[];
  role: EffectiveRole;
  user: AuthUser;
  onRefresh: () => Promise<void> | void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => void;
}

const PAGE_SIZE = 50;

export const AttendanceAuditView: React.FC<Props> = ({
  event,
  participants,
  role,
  onRefresh,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<'roster' | 'audit'>('roster');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AttendanceStatus>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const [ticketModalParticipant, setTicketModalParticipant] = useState<ParticipantRecord | null>(null);
  const [editingParticipant, setEditingParticipant] = useState<ParticipantRecord | null>(null);
  const [editEmployeeId, setEditEmployeeId] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editMobile, setEditMobile] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editPosition, setEditPosition] = useState('');
  const [editStatus, setEditStatus] = useState<AttendanceStatus>('pending');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [searchText, statusFilter, methodFilter, event?.id]);

  const loadAudit = async (eventId: string) => {
    setLoadingAudit(true);
    try {
      const logs = await fetchAuditLogs(eventId);
      setAuditLogs(logs);
    } catch (error) {
      onNotify('error', 'Audit Load Failed', error instanceof Error ? error.message : 'Unable to fetch audit history.');
    } finally {
      setLoadingAudit(false);
    }
  };

  useEffect(() => {
    if (!event || role !== 'admin' || subTab !== 'audit') return;
    void loadAudit(event.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, role, subTab, participants.length]);

  const filteredParticipants = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return participants.filter((p) => {
      if (statusFilter !== 'all' && p.attendanceStatus !== statusFilter) return false;
      if (methodFilter !== 'all' && p.checkInMethod !== methodFilter) return false;
      if (!q) return true;
      return (
        p.id.toLowerCase().includes(q) ||
        (p.employeeId && p.employeeId.toLowerCase().includes(q)) ||
        p.fullName.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.company.toLowerCase().includes(q) ||
        p.position.toLowerCase().includes(q)
      );
    });
  }, [participants, searchText, statusFilter, methodFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredParticipants.length / PAGE_SIZE));
  const pagedParticipants = filteredParticipants.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openEditModal = (p: ParticipantRecord) => {
    setEditingParticipant(p);
    setEditEmployeeId(p.employeeId || '');
    setEditFullName(p.fullName);
    setEditEmail(p.email);
    setEditMobile(p.mobile);
    setEditCompany(p.company);
    setEditPosition(p.position);
    setEditStatus(p.attendanceStatus);
    setEditNotes(p.notes || '');
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || !editingParticipant) return;
    const err = validateParticipantInput(
      {
        fullName: editFullName,
        email: editEmail,
        mobile: editMobile,
        company: editCompany,
        position: editPosition,
      },
      { allowBlankContact: true }
    );
    if (err) {
      onNotify('error', 'Validation Error', err);
      return;
    }
    setSaving(true);
    try {
      await adminCorrectParticipant({
        eventId: event.id,
        participantId: editingParticipant.id,
        updates: {
          employeeId: editEmployeeId.trim(),
          fullName: editFullName,
          email: editEmail,
          mobile: editMobile,
          company: editCompany,
          position: editPosition,
          attendanceStatus: editStatus,
          notes: editNotes,
        },
      });
      setEditingParticipant(null);
      await onRefresh();
      onNotify('success', 'Record Updated', `Updated attendance record for ${editFullName} and logged to audit trail.`);
    } catch (error) {
      onNotify('error', 'Update Failed', error instanceof Error ? error.message : 'Unable to save correction.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteParticipant = async (p: ParticipantRecord) => {
    if (!event || role !== 'admin') return;
    setSaving(true);
    try {
      await adminDeleteParticipant(event.id, p.id);
      setEditingParticipant(null);
      await onRefresh();
      onNotify('info', 'Participant Removed', `Deleted registration ${p.id} (${p.fullName}).`);
    } catch (error) {
      onNotify('error', 'Delete Failed', error instanceof Error ? error.message : 'Unable to remove participant.');
    } finally {
      setSaving(false);
    }
  };

  if (!event) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
        Select an event from the header to manage attendance records.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sub-navigation tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('roster')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subTab === 'roster' ? 'bg-white text-[#0B1D3A]' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Participant Attendance ({participants.length})
          </button>
          {role === 'admin' && (
            <button
              type="button"
              onClick={() => setSubTab('audit')}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
                subTab === 'audit' ? 'bg-white text-[#0B1D3A]' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Audit History
            </button>
          )}
        </div>
      </div>

      {subTab === 'roster' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Filter Toolbar */}
          <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search ID, Employee ID No., name, email, company..."
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(['all', 'present', 'late', 'pending', 'absent'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                      statusFilter === st
                        ? 'bg-white text-[#0B1D3A]'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 bg-white"
              >
                <option value="all">All Methods</option>
                <option value="individual_qr">Individual QR</option>
                <option value="shared_qr">Shared Event QR</option>
                <option value="manual_staff">Manual Staff</option>
                <option value="admin_override">Admin Override</option>
                <option value="none">Not Checked In</option>
              </select>
            </div>
          </div>

          {pagedParticipants.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No participants match your current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">ID</th>
                    <th className="py-3 px-4">Participant</th>
                    <th className="py-3 px-4">Company &amp; Role</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Check-In Time</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedParticipants.map((p) => {
                    const statusColor =
                      p.attendanceStatus === 'present'
                        ? 'text-emerald-700'
                        : p.attendanceStatus === 'late'
                          ? 'text-amber-700'
                          : p.attendanceStatus === 'absent'
                            ? 'text-red-700'
                            : 'text-slate-500';
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-4 font-mono tabular-nums text-xs whitespace-nowrap">
                          <div className="font-medium text-[#0B1D3A]">{p.id}</div>
                          {p.employeeId && p.employeeId !== p.id && (
                            <div className="text-[11px] text-slate-500">Emp: {p.employeeId}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-900">{p.fullName}</div>
                          <div className="text-xs text-slate-500">
                            {p.email || '—'} · <span className="tabular-nums">{p.mobile || '—'}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="text-slate-800">{p.company}</div>
                          <div className="text-xs text-slate-500">{p.position}</div>
                        </td>
                        <td className={`py-2.5 px-4 text-xs font-semibold uppercase ${statusColor}`}>
                          {p.attendanceStatus}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                          {formatTimestamp(p.checkInAt)}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-600 capitalize whitespace-nowrap">
                          {p.checkInMethod === 'none' ? '—' : p.checkInMethod.replace('_', ' ')}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setTicketModalParticipant(p)}
                              title="View QR Ticket"
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                            </button>
                            {role === 'admin' && (
                              <button
                                type="button"
                                onClick={() => openEditModal(p)}
                                title="Edit / Correct Attendance"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Correct</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
            <span className="tabular-nums">
              Showing {pagedParticipants.length} of {filteredParticipants.length} matching records
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 bg-white border border-slate-300 rounded disabled:opacity-40"
              >
                Previous
              </button>
              <span className="font-mono tabular-nums">
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1 bg-white border border-slate-300 rounded disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="font-display text-base font-semibold text-[#0B1D3A]">
              Immutable Audit History
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Append-only log of registrations, QR check-ins, shared QR toggles, and administrative corrections.
            </p>
          </div>
          {loadingAudit ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading audit logs...</div>
          ) : auditLogs.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No audit entries recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-4">Actor</th>
                    <th className="py-2.5 px-4">Target</th>
                    <th className="py-2.5 px-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap">
                        {formatTimestamp(log.createdAt)}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs font-medium text-[#0B1D3A] whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-700">
                        {log.actorEmail}{' '}
                        <span className="text-slate-400">({log.actorRole})</span>
                      </td>
                      <td className="py-2.5 px-4 text-xs font-medium text-slate-900">
                        {log.targetLabel}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* QR Ticket Modal */}
      {ticketModalParticipant && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-xl w-full relative">
            <button
              type="button"
              onClick={() => setTicketModalParticipant(null)}
              aria-label="Close ticket modal"
              className="absolute -top-3 -right-3 z-10 p-2 bg-white border border-slate-200 rounded-full text-slate-700 hover:bg-slate-100 no-print"
            >
              <X className="w-4 h-4" />
            </button>
            <ParticipantTicketCard participant={ticketModalParticipant} event={event} />
          </div>
        </div>
      )}

      {/* Admin Correction Modal */}
      {editingParticipant && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold text-[#0B1D3A]">
                  Admin Attendance Correction
                </h3>
                <p className="font-mono text-xs text-slate-500">{editingParticipant.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingParticipant(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCorrection} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Attendance Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as AttendanceStatus)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  >
                    <option value="pending">Pending (Resets check-in lock)</option>
                    <option value="present">Present (On Time)</option>
                    <option value="late">Late Arrival</option>
                    <option value="absent">Absent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Employee ID No.
                  </label>
                  <input
                    type="text"
                    maxLength={64}
                    value={editEmployeeId}
                    onChange={(e) => setEditEmployeeId(e.target.value)}
                    placeholder="EMP-1042"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    maxLength={120}
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Mobile</label>
                  <input
                    type="text"
                    maxLength={25}
                    value={editMobile}
                    onChange={(e) => setEditMobile(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Company</label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Position</label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={editPosition}
                    onChange={(e) => setEditPosition(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Correction Reason / Audit Note
                </label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Reason for administrative override..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleDeleteParticipant(editingParticipant)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Registration</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingParticipant(null)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-[#0B1D3A] hover:bg-[#132B52] text-white rounded-lg text-xs font-medium disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Correction'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
