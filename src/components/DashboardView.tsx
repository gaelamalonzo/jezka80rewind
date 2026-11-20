import React, { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  Plus,
  QrCode,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type {
  AuthUser,
  EffectiveRole,
  EventRecord,
  EventStatus,
  ParticipantRecord,
} from '../types';
import { computeAttendanceStats } from '../lib/reportUtils';
import {
  createEvent,
  markPendingAsAbsent,
  toggleSharedQrStatus,
  updateEventDetails,
} from '../lib/attendanceService';
import { formatTimeOnly, toMillis, validateEventInput } from '../lib/validation';

interface Props {
  role: EffectiveRole;
  user: AuthUser;
  events: EventRecord[];
  selectedEvent: EventRecord | null;
  participants: ParticipantRecord[];
  loadingParticipants: boolean;
  onSelectEvent: (eventId: string) => void;
  onRefresh: () => Promise<void> | void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => void;
  onNavigate: (view: 'scanner' | 'registration' | 'shared-qr' | 'attendance' | 'reports') => void;
}

export const DashboardView: React.FC<Props> = ({
  role,
  events,
  selectedEvent,
  participants,
  loadingParticipants,
  onSelectEvent,
  onRefresh,
  onNotify,
  onNavigate,
}) => {
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [saving, setSaving] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState(todayStr);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [lateCutoffMinutes, setLateCutoffMinutes] = useState(15);
  const [venue, setVenue] = useState('');
  const [capacity, setCapacity] = useState(600);
  const [status, setStatus] = useState<EventStatus>('active');
  const [sharedQrEnabled, setSharedQrEnabled] = useState(true);
  const [registrationOpen, setRegistrationOpen] = useState(true);

  const stats = computeAttendanceStats(participants);

  const recentCheckIns = [...participants]
    .filter((p) => p.checkInAt !== null)
    .sort((a, b) => toMillis(b.checkInAt) - toMillis(a.checkInAt))
    .slice(0, 8);

  const openCreateModal = () => {
    setTitle(events.length === 0 ? 'JEZKA80 REWIND' : '');
    setDescription(
      events.length === 0
        ? 'JEZKA80 REWIND 1-day company event — registration, individual QR passes, and live check-in.'
        : ''
    );
    setEventDate(todayStr);
    setStartTime('09:00');
    setEndTime('17:00');
    setLateCutoffMinutes(15);
    setVenue('Main Corporate Auditorium');
    setCapacity(800);
    setStatus('active');
    setSharedQrEnabled(true);
    setRegistrationOpen(true);
    setModalMode('create');
  };

  const openEditModal = () => {
    if (!selectedEvent) return;
    setTitle(selectedEvent.title);
    setDescription(selectedEvent.description);
    setEventDate(selectedEvent.eventDate);
    setStartTime(selectedEvent.startTime);
    setEndTime(selectedEvent.endTime);
    setLateCutoffMinutes(selectedEvent.lateCutoffMinutes);
    setVenue(selectedEvent.venue);
    setCapacity(selectedEvent.capacity);
    setStatus(selectedEvent.status);
    setSharedQrEnabled(selectedEvent.sharedQrEnabled);
    setRegistrationOpen(selectedEvent.registrationOpen);
    setModalMode('edit');
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateEventInput({
      title,
      eventDate,
      startTime,
      endTime,
      lateCutoffMinutes: Number(lateCutoffMinutes),
      venue,
      capacity: Number(capacity),
    });
    if (err) {
      onNotify('error', 'Invalid Event Details', err);
      return;
    }

    setSaving(true);
    try {
      if (modalMode === 'create') {
        const { eventId } = await createEvent({
          title,
          description,
          eventDate,
          startTime,
          endTime,
          lateCutoffMinutes: Number(lateCutoffMinutes),
          venue,
          capacity: Number(capacity),
          status,
          sharedQrEnabled,
          registrationOpen,
        });
        onSelectEvent(eventId);
        await onRefresh();
        onNotify('success', 'Event Created', `${title} is ready for participant registration and QR check-in.`);
      } else if (modalMode === 'edit' && selectedEvent) {
        await updateEventDetails({
          eventId: selectedEvent.id,
          updates: {
            title,
            description,
            eventDate,
            startTime,
            endTime,
            lateCutoffMinutes: Number(lateCutoffMinutes),
            venue,
            capacity: Number(capacity),
            status,
            sharedQrEnabled,
            registrationOpen,
          },
        });
        await onRefresh();
        onNotify('success', 'Event Updated', `Saved changes for ${title}.`);
      }
      setModalMode(null);
    } catch (error) {
      onNotify('error', 'Failed to Save Event', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSharedQr = async () => {
    if (!selectedEvent || role !== 'admin') return;
    try {
      await toggleSharedQrStatus({
        eventId: selectedEvent.id,
        enabled: !selectedEvent.sharedQrEnabled,
      });
      await onRefresh();
      onNotify(
        'success',
        `Shared Event QR ${!selectedEvent.sharedQrEnabled ? 'Enabled' : 'Disabled'}`,
        !selectedEvent.sharedQrEnabled
          ? 'Participants can now self-check-in using the Shared Event QR.'
          : 'Shared Event QR self-check-in has been paused.'
      );
    } catch (error) {
      onNotify('error', 'Update Failed', error instanceof Error ? error.message : 'Could not update Shared QR setting.');
    }
  };

  const handleCloseOutAbsent = async () => {
    if (!selectedEvent || role !== 'admin') return;
    const pendingList = participants.filter((p) => p.attendanceStatus === 'pending');
    if (pendingList.length === 0) {
      onNotify('info', 'No Pending Participants', 'All registered participants already have a recorded status.');
      return;
    }
    try {
      const count = await markPendingAsAbsent(selectedEvent.id);
      await onRefresh();
      onNotify('success', 'Attendance Finalized', `Marked ${count} remaining pending participants as Absent.`);
    } catch (error) {
      onNotify('error', 'Action Failed', error instanceof Error ? error.message : 'Could not mark pending as absent.');
    }
  };

  if (events.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-2xl mx-auto mt-8">
        <Calendar className="w-10 h-10 text-[#0B1D3A] mx-auto mb-4" />
        <h2 className="font-display text-2xl font-semibold text-slate-900">
          No Events Configured Yet
        </h2>
        <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto leading-relaxed">
          Create your company&apos;s 1-day event to enable online participant registration, individual QR passes, and live attendance scanning.
        </p>
        {role === 'admin' ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create Company Event</span>
          </button>
        ) : (
          <p className="text-xs text-slate-500 mt-4">
            Contact an event administrator to create or activate an event.
          </p>
        )}
        {modalMode && renderEventModal()}
      </div>
    );
  }

  function renderEventModal() {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full max-h-[90vh] overflow-y-auto text-left">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-[#0B1D3A]">
              {modalMode === 'create' ? 'Create New Event' : 'Edit Event Configuration'}
            </h3>
            <button
              type="button"
              onClick={() => setModalMode(null)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleSaveEvent} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Event Title</label>
              <input
                type="text"
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Annual Company Town Hall 2026"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Venue / Location</label>
              <input
                type="text"
                required
                maxLength={150}
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="Grand Ballroom, HQ Building"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Event Date</label>
                <input
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Start Time</label>
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">End Time</label>
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Late Cutoff (min)
                </label>
                <input
                  type="number"
                  min={0}
                  max={480}
                  required
                  value={lateCutoffMinutes}
                  onChange={(e) => setLateCutoffMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Capacity</label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  required
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Event Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as EventStatus)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                >
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active (Check-In Live)</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Description (Optional)
              </label>
              <textarea
                rows={2}
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One-day company assembly, keynote sessions, and department breakout check-ins."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 pt-1">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={registrationOpen}
                  onChange={(e) => setRegistrationOpen(e.target.checked)}
                  className="rounded border-slate-300 text-[#1E40AF] focus:ring-[#1E40AF]"
                />
                <span>Online Registration Open</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sharedQrEnabled}
                  onChange={(e) => setSharedQrEnabled(e.target.checked)}
                  className="rounded border-slate-300 text-[#1E40AF] focus:ring-[#1E40AF]"
                />
                <span>Shared Event QR Self-Check-In Enabled</span>
              </label>
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-[#0B1D3A] hover:bg-[#132B52] text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Saving...' : modalMode === 'create' ? 'Create Event' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Event Header Summary & Admin Actions */}
      {selectedEvent && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
              <span className="font-semibold text-[#0B1D3A] uppercase tracking-wider">
                {selectedEvent.status}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{selectedEvent.eventDate}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {selectedEvent.startTime} – {selectedEvent.endTime}
              </span>
              <span aria-hidden="true">·</span>
              <span>{selectedEvent.venue}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Late after +{selectedEvent.lateCutoffMinutes} min</span>
            </div>
            <h1 className="font-display text-2xl font-semibold text-[#0B1D3A] text-balance">
              {selectedEvent.title}
            </h1>
            {selectedEvent.description && (
              <p className="text-sm text-slate-600 max-w-2xl">{selectedEvent.description}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('scanner')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              <QrCode className="w-4 h-4" />
              <span>Open QR Scanner</span>
            </button>

            {role === 'admin' && (
              <>
                <button
                  type="button"
                  onClick={handleToggleSharedQr}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 border rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    selectedEvent.sharedQrEnabled
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                      : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span>
                    Shared QR: {selectedEvent.sharedQrEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={openEditModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  <Edit3 className="w-4 h-4" />
                  <span>Edit Event</span>
                </button>

                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>New Event</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 4-Column Live KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Total Registered</span>
            <Users className="w-4 h-4 text-[#0B1D3A]" />
          </div>
          <p className="font-mono tabular-nums text-3xl font-semibold text-[#0B1D3A] mt-2">
            {loadingParticipants ? '—' : stats.totalRegistered}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Capacity: {selectedEvent?.capacity ?? 0} seats
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Checked In</span>
            <UserCheck className="w-4 h-4 text-emerald-700" />
          </div>
          <p className="font-mono tabular-nums text-3xl font-semibold text-emerald-700 mt-2">
            {loadingParticipants ? '—' : stats.checkedIn}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {stats.presentOnTime} on time · {stats.lateArrivals} late
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Pending &amp; Absent</span>
            <Clock className="w-4 h-4 text-amber-700" />
          </div>
          <p className="font-mono tabular-nums text-3xl font-semibold text-slate-900 mt-2">
            {loadingParticipants ? '—' : stats.pending + stats.absent}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {stats.pending} pending · {stats.absent} absent
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Attendance Rate</span>
            <CheckCircle2 className="w-4 h-4 text-[#1E40AF]" />
          </div>
          <p className="font-mono tabular-nums text-3xl font-semibold text-[#1E40AF] mt-2">
            {loadingParticipants ? '—' : `${stats.attendanceRate}%`}
          </p>
          <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2.5 overflow-hidden">
            <div
              className="h-full bg-[#1E40AF] transition-all duration-300"
              style={{ width: `${Math.min(100, stats.attendanceRate)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Breakdown & Live Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[#0B1D3A]">
              Check-In Channel Breakdown
            </h2>
            {role === 'admin' && stats.pending > 0 && (
              <button
                type="button"
                onClick={handleCloseOutAbsent}
                className="text-xs font-medium text-red-700 hover:underline whitespace-nowrap"
              >
                Mark {stats.pending} Pending Absent
              </button>
            )}
          </div>

          <div className="space-y-3.5 text-sm">
            {[
              { label: 'Individual QR Scans', count: stats.individualQrCount },
              { label: 'Shared Event QR Self-Check-In', count: stats.sharedQrCount },
              { label: 'Authorized Manual Staff Entry', count: stats.manualStaffCount },
              { label: 'Admin Corrections / Overrides', count: stats.adminOverrideCount },
            ].map((row) => {
              const pct = stats.checkedIn > 0 ? Math.round((row.count / stats.checkedIn) * 100) : 0;
              return (
                <div key={row.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-700 font-medium">{row.label}</span>
                    <span className="font-mono tabular-nums text-slate-900 font-semibold">
                      {row.count} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#0B1D3A]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-100 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate('registration')}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg transition-colors"
            >
              Register / Import Participants
            </button>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg transition-colors"
            >
              Export Excel &amp; CSV Reports
            </button>
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[#0B1D3A]">
              Live Check-In Feed
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="text-xs font-medium text-[#1E40AF] hover:underline whitespace-nowrap"
            >
              View Full Roster
            </button>
          </div>

          {recentCheckIns.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No check-ins recorded for this event yet. Use the QR Scanner or Shared Event QR to begin checking in attendees.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Participant</th>
                    <th className="py-2.5 px-4">ID</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Method</th>
                    <th className="py-2.5 px-4 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentCheckIns.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{p.fullName}</div>
                        <div className="text-xs text-slate-500">{p.company}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-700">
                        {p.id}
                      </td>
                      <td className="py-2.5 px-4 text-xs font-semibold">
                        <span
                          className={
                            p.attendanceStatus === 'late' ? 'text-amber-700' : 'text-emerald-700'
                          }
                        >
                          {p.attendanceStatus === 'late' ? 'Late' : 'Present'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 capitalize">
                        {p.checkInMethod.replace('_', ' ')}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                        {formatTimeOnly(p.checkInAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modalMode && renderEventModal()}
    </div>
  );
};
