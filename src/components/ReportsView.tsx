import React, { useMemo } from 'react';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { EffectiveRole, EventRecord, ParticipantRecord } from '../types';
import {
  computeAttendanceStats,
  exportEventWorkbookXlsx,
  exportParticipantsCsv,
} from '../lib/reportUtils';
import { writeAuditLog } from '../lib/attendanceService';
import { formatTimestamp } from '../lib/validation';

interface Props {
  event: EventRecord | null;
  participants: ParticipantRecord[];
  role: EffectiveRole;
  user: User;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => void;
}

export const ReportsView: React.FC<Props> = ({
  event,
  participants,
  role,
  user,
  onNotify,
}) => {
  const stats = computeAttendanceStats(participants);

  const companyBreakdown = useMemo(() => {
    const map = new Map<string, { registered: number; checkedIn: number; late: number }>();
    for (const p of participants) {
      const key = p.company || 'Unassigned';
      const cur = map.get(key) || { registered: 0, checkedIn: 0, late: 0 };
      cur.registered++;
      if (p.attendanceStatus === 'present' || p.attendanceStatus === 'late') cur.checkedIn++;
      if (p.attendanceStatus === 'late') cur.late++;
      map.set(key, cur);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].registered - a[1].registered);
  }, [participants]);

  const lateArrivals = useMemo(
    () =>
      participants
        .filter((p) => p.attendanceStatus === 'late')
        .sort((a, b) => (a.checkInAt?.toMillis() || 0) - (b.checkInAt?.toMillis() || 0)),
    [participants]
  );

  if (!event) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
        Select an event from the header to generate attendance reports.
      </div>
    );
  }

  const handleExportXlsx = async () => {
    exportEventWorkbookXlsx(event, participants);
    try {
      await writeAuditLog({
        eventId: event.id,
        action: 'report_exported',
        user,
        actorRole: role,
        targetId: event.id,
        targetLabel: event.title,
        details: `Exported multi-sheet Excel (.xlsx) report (${participants.length} participants).`,
      });
    } catch {
      // non-blocking audit log
    }
    onNotify('success', 'Excel Report Downloaded', `Saved Attendance-Report-${event.id}-${event.eventDate}.xlsx`);
  };

  const handleExportCsv = async () => {
    exportParticipantsCsv(event, participants);
    try {
      await writeAuditLog({
        eventId: event.id,
        action: 'report_exported',
        user,
        actorRole: role,
        targetId: event.id,
        targetLabel: event.title,
        details: `Exported CSV attendance sheet (${participants.length} participants).`,
      });
    } catch {
      // non-blocking audit log
    }
    onNotify('success', 'CSV Report Downloaded', `Saved Attendance-${event.id}-${event.eventDate}.csv`);
  };

  return (
    <div className="space-y-6">
      {/* Export Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
            Attendance Reports &amp; Exports
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Download multi-sheet Excel workbooks, CSV sheets, or print an official corporate attendance sheet.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportXlsx}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Excel (.xlsx)</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>Print Attendance Sheet</span>
          </button>
        </div>
      </div>

      {/* Printable Header (visible in print & screen) */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Official Event Attendance Summary
            </p>
            <h3 className="font-display text-xl font-semibold text-[#0B1D3A] mt-1">
              {event.title}
            </h3>
            <p className="text-xs text-slate-600 mt-1 tabular-nums">
              {event.eventDate} · {event.startTime} – {event.endTime} · {event.venue}
            </p>
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            Generated: {new Date().toLocaleString()}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500">Total Registered</p>
            <p className="font-mono tabular-nums text-xl font-semibold text-[#0B1D3A] mt-0.5">
              {stats.totalRegistered}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Checked In</p>
            <p className="font-mono tabular-nums text-xl font-semibold text-emerald-700 mt-0.5">
              {stats.checkedIn}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Late Arrivals</p>
            <p className="font-mono tabular-nums text-xl font-semibold text-amber-700 mt-0.5">
              {stats.lateArrivals}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Pending / Absent</p>
            <p className="font-mono tabular-nums text-xl font-semibold text-slate-700 mt-0.5">
              {stats.pending + stats.absent}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Attendance Rate</p>
            <p className="font-mono tabular-nums text-xl font-semibold text-[#1E40AF] mt-0.5">
              {stats.attendanceRate}%
            </p>
          </div>
        </div>
      </div>

      {/* Department / Company Breakdown & Late Arrivals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="font-display text-base font-semibold text-[#0B1D3A]">
              Attendance by Company / Department
            </h3>
          </div>
          {companyBreakdown.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No participants registered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Company / Dept</th>
                    <th className="py-2.5 px-4 text-right">Registered</th>
                    <th className="py-2.5 px-4 text-right">Checked In</th>
                    <th className="py-2.5 px-4 text-right">Late</th>
                    <th className="py-2.5 px-4 text-right">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {companyBreakdown.map(([company, data]) => {
                    const rate =
                      data.registered > 0 ? Math.round((data.checkedIn / data.registered) * 100) : 0;
                    return (
                      <tr key={company}>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{company}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                          {data.registered}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700 font-medium">
                          {data.checkedIn}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-amber-700">
                          {data.late}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#0B1D3A] font-semibold">
                          {rate}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="font-display text-base font-semibold text-[#0B1D3A]">
              Late Arrivals ({lateArrivals.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Checked in more than {event.lateCutoffMinutes} minutes after {event.startTime}
            </p>
          </div>
          {lateArrivals.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No late arrivals recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4">ID</th>
                    <th className="py-2.5 px-4">Name</th>
                    <th className="py-2.5 px-4">Company</th>
                    <th className="py-2.5 px-4 text-right">Arrival Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lateArrivals.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-700">
                        {p.id}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900">{p.fullName}</td>
                      <td className="py-2.5 px-4 text-xs text-slate-600">{p.company}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-amber-700 font-medium">
                        {formatTimestamp(p.checkInAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Full Printable Participant List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="font-display text-base font-semibold text-[#0B1D3A]">
            Complete Participant Sheet ({participants.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                <th className="py-2.5 px-3">ID</th>
                <th className="py-2.5 px-3">Full Name</th>
                <th className="py-2.5 px-3">Email</th>
                <th className="py-2.5 px-3">Company</th>
                <th className="py-2.5 px-3">Position</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Check-In Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {participants.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 px-3 font-mono tabular-nums">{p.id}</td>
                  <td className="py-2 px-3 font-medium text-slate-900">{p.fullName}</td>
                  <td className="py-2 px-3 text-slate-600">{p.email}</td>
                  <td className="py-2 px-3 text-slate-700">{p.company}</td>
                  <td className="py-2 px-3 text-slate-600">{p.position}</td>
                  <td className="py-2 px-3 uppercase font-semibold">{p.attendanceStatus}</td>
                  <td className="py-2 px-3 font-mono tabular-nums text-slate-600">
                    {formatTimestamp(p.checkInAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
