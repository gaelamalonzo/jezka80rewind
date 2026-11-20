import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  QrCode,
  Ticket,
} from 'lucide-react';
import {
  fetchPublicEvents,
  fetchPublicEventStatus,
  fetchPublicTicket,
  performPublicSelfCheckIn,
  registerParticipantPublic,
} from '../lib/attendanceService';
import {
  formatTimestamp,
  sanitizeEmail,
  validateParticipantInput,
} from '../lib/validation';
import type {
  EffectiveRole,
  EventRecord,
  ParticipantRecord,
} from '../types';
import { ParticipantTicketCard } from './ParticipantTicketCard';
import { NotificationBanner, type NotificationState } from './NotificationBanner';

interface Props {
  mode: 'register' | 'self-checkin' | 'ticket';
  eventIdParam?: string;
  tokenParam?: string;
  ticketIdParam?: string;
  role: EffectiveRole;
  canReturnToConsole: boolean;
  onReturnToConsole: () => void;
}

export const ParticipantPortal: React.FC<Props> = ({
  mode,
  eventIdParam,
  tokenParam,
  ticketIdParam,
  role,
  canReturnToConsole,
  onReturnToConsole,
}) => {
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState(eventIdParam || '');
  const [myTickets, setMyTickets] = useState<Array<{ participant: ParticipantRecord; event: EventRecord }>>([]);
  const [loading, setLoading] = useState(true);

  // Registration state
  const [employeeId, setEmployeeId] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [company, setCompany] = useState('');
  const [position, setPosition] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Self Check-In state
  const [selfEvent, setSelfEvent] = useState<EventRecord | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [identifierInput, setIdentifierInput] = useState('');
  const [verifyInput, setVerifyInput] = useState('');
  const [checkInCompleted, setCheckInCompleted] = useState<{
    status: 'present' | 'late';
    message: string;
    participant: ParticipantRecord;
  } | null>(null);

  const notify = (type: NotificationState['type'], title: string, message?: string) => {
    setNotification({ id: Date.now(), type, title, message });
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        if (mode === 'self-checkin' && eventIdParam) {
          try {
            const res = await fetchPublicEventStatus(eventIdParam, tokenParam);
            if (!cancelled) {
              setSelfEvent(res.event);
              setTokenValid(res.tokenValid);
            }
          } catch {
            if (!cancelled) {
              setSelfEvent(null);
              setTokenValid(false);
            }
          }
        } else if (mode === 'ticket' && eventIdParam && ticketIdParam) {
          try {
            const res = await fetchPublicTicket(eventIdParam, ticketIdParam);
            if (!cancelled) {
              setMyTickets([{ event: res.event, participant: res.participant }]);
            }
          } catch {
            if (!cancelled) {
              setMyTickets([]);
              notify('error', 'Ticket Not Found', 'This QR pass link does not match a registered participant.');
            }
          }
        } else {
          const loadedEvents = await fetchPublicEvents();
          if (!cancelled) {
            setEvents(loadedEvents);
            if (loadedEvents.length > 0) {
              const initialId =
                eventIdParam && loadedEvents.some((e) => e.id === eventIdParam)
                  ? eventIdParam
                  : loadedEvents[0].id;
              setSelectedEventId(initialId);
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          notify('error', 'Load Error', error instanceof Error ? error.message : 'Unable to load portal data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [mode, eventIdParam, tokenParam, ticketIdParam]);

  const handleSelfRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEvent = events.find((ev) => ev.id === selectedEventId);
    if (!targetEvent) {
      notify('warning', 'Select Event', 'Please choose an active event.');
      return;
    }
    if (!targetEvent.registrationOpen) {
      notify('error', 'Registration Closed', 'Online registration is closed for this event.');
      return;
    }

    const cleanEmail = sanitizeEmail(email);
    const err = validateParticipantInput({
      fullName,
      email: cleanEmail,
      mobile,
      company,
      position,
    });
    if (err) {
      notify('error', 'Validation Error', err);
      return;
    }

    setSubmitting(true);
    try {
      const { participant, event } = await registerParticipantPublic({
        eventId: targetEvent.id,
        employeeId: employeeId.trim(),
        useEmployeeIdAsId: true,
        fullName,
        email: cleanEmail,
        mobile,
        company,
        position,
      });

      setMyTickets((prev) => [{ participant, event }, ...prev]);
      setEmployeeId('');
      setFullName('');
      setEmail('');
      setMobile('');
      setCompany('');
      setPosition('');
      notify(
        'success',
        'Registration Confirmed',
        `Your Unique ID is ${participant.id}. Download or screenshot your Individual QR Ticket below.`
      );
    } catch (error) {
      notify('error', 'Registration Failed', error instanceof Error ? error.message : 'Unable to register.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelfCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selfEvent || !tokenParam) return;
    if (!identifierInput.trim() || !verifyInput.trim()) {
      notify('error', 'Missing Details', 'Enter your Email or Participant ID and verification detail.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await performPublicSelfCheckIn({
        eventId: selfEvent.id,
        token: tokenParam,
        identifier: identifierInput.trim(),
        verifyValue: verifyInput.trim(),
      });

      setCheckInCompleted({
        status: res.assignedStatus,
        message: res.message,
        participant: res.participant,
      });
    } catch (error) {
      notify(
        'warning',
        'Check-In Not Completed',
        error instanceof Error ? error.message : 'Unable to complete self-check-in.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Corporate Header */}
      <header className="h-16 bg-[#0B1D3A] text-white px-4 sm:px-8 flex items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <QrCode className="w-5 h-5 text-amber-300 shrink-0" />
          <span className="font-display font-semibold text-base tracking-tight whitespace-nowrap">
            Event Attendance System
          </span>
        </div>

        <div className="flex items-center gap-3">
          {canReturnToConsole && (
            <button
              type="button"
              onClick={onReturnToConsole}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Staff Console ({role})</span>
            </button>
          )}
          {!canReturnToConsole && (
            <button
              type="button"
              onClick={onReturnToConsole}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Staff Sign In</span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-8">
        <NotificationBanner notification={notification} onDismiss={() => setNotification(null)} />

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
            Loading event details...
          </div>
        ) : mode === 'self-checkin' ? (
          <div className="max-w-lg mx-auto space-y-6">
            {!selfEvent ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
                <AlertTriangle className="w-8 h-8 text-red-700 mx-auto" />
                <h2 className="font-display text-lg font-semibold text-slate-900">Event Not Found</h2>
                <p className="text-sm text-slate-600">
                  This Shared Event QR link does not reference an active event.
                </p>
              </div>
            ) : !selfEvent.sharedQrEnabled || selfEvent.status !== 'active' || !tokenValid ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
                <AlertTriangle className="w-8 h-8 text-amber-700 mx-auto" />
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Self-Check-In Unavailable
                </h2>
                <p className="text-sm text-slate-600">
                  {!selfEvent.sharedQrEnabled
                    ? 'The event administrator has currently disabled Shared Event QR self-check-in.'
                    : !tokenValid
                      ? 'This Shared Event QR code has expired or been rotated. Please scan the latest QR poster at the venue.'
                      : `Event status is currently ${selfEvent.status}.`}
                </p>
              </div>
            ) : checkInCompleted ? (
              <div className="bg-white border border-emerald-300 rounded-xl overflow-hidden">
                <div className="bg-emerald-700 text-white px-6 py-6 text-center space-y-2">
                  <CheckCircle2 className="w-12 h-12 mx-auto" />
                  <h2 className="font-display text-2xl font-semibold">Check-In Confirmed</h2>
                  <p className="text-sm text-emerald-100">
                    {checkInCompleted.status === 'late' ? 'Recorded as Late Arrival' : 'Recorded On Time'}
                  </p>
                </div>
                <div className="p-6 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Event</span>
                    <span className="font-medium text-slate-900">{selfEvent.title}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Participant</span>
                    <span className="font-medium text-slate-900">{checkInCompleted.participant.fullName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Participant ID</span>
                    <span className="font-mono font-semibold text-[#0B1D3A]">{checkInCompleted.participant.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Company</span>
                    <span className="text-slate-800">{checkInCompleted.participant.company}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Check-In Time</span>
                    <span className="font-mono text-xs text-slate-700">
                      {formatTimestamp(checkInCompleted.participant.checkInAt)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 pt-3 border-t border-slate-100">
                    Single-use attendance lock is now active for your registration. Duplicate submissions are automatically blocked.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-gradient-to-br from-[#061226] via-[#0B1D3A] to-[#172554] text-white px-6 py-5">
                  <p className="text-xs font-semibold text-amber-300">JEZKA80 REWIND · MOBILE SELF-CHECK-IN</p>
                  <h1 className="font-display text-xl font-semibold mt-1">{selfEvent.title}</h1>
                  <p className="text-xs text-slate-300 mt-1 tabular-nums">
                    {selfEvent.eventDate} · {selfEvent.startTime} – {selfEvent.endTime} · {selfEvent.venue}
                  </p>
                </div>
                <div className="h-1 w-full bg-amber-500" />
                <div className="h-1 w-full bg-rose-600" />
                <div className="h-1 w-full bg-sky-400" />

                <div className="p-6 space-y-5">
                  <form onSubmit={handleSelfCheckIn} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Registered Email, Employee ID No., or Participant ID
                      </label>
                      <input
                        type="text"
                        required
                        value={identifierInput}
                        onChange={(e) => setIdentifierInput(e.target.value)}
                        placeholder="alex.mercer@company.com or EMP-1042"
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Verify Employee ID No., Participant ID, or Last 4+ Digits of Mobile
                      </label>
                      <input
                        type="text"
                        required
                        value={verifyInput}
                        onChange={(e) => setVerifyInput(e.target.value)}
                        placeholder="e.g. EMP-1042, EVT-A9K2M4, or 2834"
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-3 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg disabled:opacity-50"
                    >
                      {submitting ? 'Confirming Check-In...' : 'Complete Single-Use Check-In'}
                    </button>
                  </form>

                  {selfEvent.registrationOpen && (
                    <div className="pt-4 border-t border-slate-100 text-center text-xs text-slate-500">
                      Not registered yet?{' '}
                      <a
                        href={`?mode=register&eventId=${encodeURIComponent(selfEvent.id)}`}
                        className="font-semibold text-[#1E40AF] hover:underline"
                      >
                        Register online first
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Online Registration & My QR Tickets */
          <div className="space-y-8">
            {mode !== 'ticket' && (
              <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 no-print">
                <div className="flex items-center gap-2.5 mb-2">
                  <Calendar className="w-5 h-5 text-[#0B1D3A]" />
                  <h1 className="font-display text-xl font-semibold text-[#0B1D3A]">
                    Online Event Registration
                  </h1>
                </div>
                <p className="text-sm text-slate-600 mb-6">
                  Complete your registration details to receive your Unique Participant ID and Individual QR Ticket.
                </p>

                {events.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4">
                    No open events are currently accepting online registrations.
                  </p>
                ) : (
                  <form onSubmit={handleSelfRegister} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Select Event
                      </label>
                      <select
                        value={selectedEventId}
                        onChange={(e) => setSelectedEventId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      >
                        {events.map((ev) => (
                          <option key={ev.id} value={ev.id}>
                            {ev.title} — {ev.eventDate} ({ev.venue})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Employee ID No. (Optional)
                        </label>
                        <input
                          type="text"
                          maxLength={64}
                          value={employeeId}
                          onChange={(e) => setEmployeeId(e.target.value)}
                          placeholder="EMP-1042"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Full Name
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={100}
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Alex Mercer"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Email Address
                        </label>
                        <input
                          type="email"
                          required
                          maxLength={120}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="alex.mercer@company.com"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Mobile Number
                        </label>
                        <input
                          type="tel"
                          required
                          maxLength={25}
                          value={mobile}
                          onChange={(e) => setMobile(e.target.value)}
                          placeholder="+1 555 019 2834"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Company / Department
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={100}
                          value={company}
                          onChange={(e) => setCompany(e.target.value)}
                          placeholder="Engineering"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Position
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={100}
                          value={position}
                          onChange={(e) => setPosition(e.target.value)}
                          placeholder="Software Engineer"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-6 py-2.5 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg disabled:opacity-50"
                    >
                      {submitting ? 'Issuing Ticket...' : 'Submit Registration & Generate QR Ticket'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Generated / Direct QR Tickets */}
            {myTickets.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 no-print">
                  <Ticket className="w-5 h-5 text-[#0B1D3A]" />
                  <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
                    Your QR Event Pass ({myTickets.length})
                  </h2>
                </div>

                <div className="space-y-6">
                  {myTickets.map(({ participant, event }) => (
                    <ParticipantTicketCard
                      key={`${event.id}-${participant.id}`}
                      participant={participant}
                      event={event}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
