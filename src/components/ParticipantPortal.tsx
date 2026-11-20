import React, { useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  LogOut,
  QrCode,
  ShieldCheck,
  Ticket,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType, signInWithGoogle, signOutUser } from '../lib/firebase';
import {
  findParticipantForSelfCheckIn,
  performAtomicCheckIn,
  registerParticipant,
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
  QrTokenRecord,
} from '../types';
import { ParticipantTicketCard } from './ParticipantTicketCard';
import { NotificationBanner, type NotificationState } from './NotificationBanner';

interface Props {
  mode: 'register' | 'self-checkin' | 'ticket';
  eventIdParam?: string;
  tokenParam?: string;
  ticketIdParam?: string;
  user: User | null;
  role: EffectiveRole;
  canReturnToConsole: boolean;
  onReturnToConsole: () => void;
}

export const ParticipantPortal: React.FC<Props> = ({
  mode,
  eventIdParam,
  tokenParam,
  ticketIdParam,
  user,
  role,
  canReturnToConsole,
  onReturnToConsole,
}) => {
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState(eventIdParam || '');
  const [myTickets, setMyTickets] = useState<Array<{ participant: ParticipantRecord; event: EventRecord }>>([]);
  const [loading, setLoading] = useState(false);

  // Registration state
  const [fullName, setFullName] = useState(user?.displayName || '');
  const [mobile, setMobile] = useState('');
  const [company, setCompany] = useState('');
  const [position, setPosition] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Self Check-In state
  const [selfEvent, setSelfEvent] = useState<EventRecord | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [matchedRegistrations, setMatchedRegistrations] = useState<ParticipantRecord[]>([]);
  const [selectedRegId, setSelectedRegId] = useState('');
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
    if (user?.displayName && !fullName) {
      setFullName(user.displayName);
    }
  }, [user?.displayName, fullName]);

  // Load portal data once signed in
  useEffect(() => {
    if (!user) return;
    const activeUser = user;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        if (mode === 'self-checkin' && eventIdParam) {
          const evSnap = await getDoc(doc(db, 'events', eventIdParam));
          if (!evSnap.exists()) {
            if (!cancelled) {
              setSelfEvent(null);
              setTokenValid(false);
            }
            return;
          }
          const ev = evSnap.data() as EventRecord;
          if (!cancelled) setSelfEvent(ev);

          if (tokenParam) {
            const tokSnap = await getDoc(doc(db, 'events', eventIdParam, 'qr_tokens', tokenParam));
            const tokOk = tokSnap.exists() && (tokSnap.data() as QrTokenRecord).active === true;
            if (!cancelled) setTokenValid(tokOk);
          } else {
            if (!cancelled) setTokenValid(false);
          }

          const regs = await findParticipantForSelfCheckIn({ eventId: eventIdParam, user: activeUser });
          if (!cancelled) {
            setMatchedRegistrations(regs);
            if (regs.length > 0) setSelectedRegId(regs[0].id);
          }
        } else if (mode === 'ticket' && eventIdParam && ticketIdParam) {
          const evSnap = await getDoc(doc(db, 'events', eventIdParam));
          const pSnap = await getDoc(doc(db, 'events', eventIdParam, 'participants', ticketIdParam));
          if (!cancelled && evSnap.exists() && pSnap.exists()) {
            setMyTickets([{ event: evSnap.data() as EventRecord, participant: pSnap.data() as ParticipantRecord }]);
          }
        } else {
          // Registration + My Tickets mode
          const evSnaps = await getDocs(
            query(collection(db, 'events'), where('status', 'in', ['upcoming', 'active']))
          );
          const loadedEvents = evSnaps.docs.map((d) => d.data() as EventRecord);
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

          const tickets: Array<{ participant: ParticipantRecord; event: EventRecord }> = [];
          for (const ev of loadedEvents) {
            const regs = await findParticipantForSelfCheckIn({ eventId: ev.id, user: activeUser });
            for (const p of regs) {
              tickets.push({ participant: p, event: ev });
            }
          }
          if (!cancelled) setMyTickets(tickets);
        }
      } catch (error) {
        if (!cancelled) {
          handleFirestoreError(error, OperationType.GET, 'events');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user, mode, eventIdParam, tokenParam, ticketIdParam]);

  const handleSelfRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.email) return;
    const targetEvent = events.find((ev) => ev.id === selectedEventId);
    if (!targetEvent) {
      notify('warning', 'Select Event', 'Please choose an active event.');
      return;
    }
    if (!targetEvent.registrationOpen) {
      notify('error', 'Registration Closed', 'Online registration is closed for this event.');
      return;
    }

    const cleanEmail = sanitizeEmail(user.email);
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
      const { participantId, qrSecret } = await registerParticipant({
        eventId: targetEvent.id,
        eventTitle: targetEvent.title,
        fullName,
        email: cleanEmail,
        mobile,
        company,
        position,
        source: 'online',
        actorRole: 'participant',
        user,
      });

      const created: ParticipantRecord = {
        id: participantId,
        eventId: targetEvent.id,
        fullName: fullName.trim(),
        email: cleanEmail,
        mobile: mobile.trim(),
        company: company.trim(),
        position: position.trim(),
        qrSecret,
        registeredByUid: user.uid,
        registrationSource: 'online',
        registrationDate: null,
        attendanceStatus: 'pending',
        checkInAt: null,
        checkInMethod: 'none',
        checkedInByUid: '',
        checkedInByEmail: '',
        notes: '',
        updatedAt: null,
      };

      setMyTickets((prev) => [{ participant: created, event: targetEvent }, ...prev]);
      setMobile('');
      setCompany('');
      setPosition('');
      notify('success', 'Registration Confirmed', `Your Unique ID is ${participantId}. Download your Individual QR Ticket below.`);
    } catch (error) {
      notify('error', 'Registration Failed', error instanceof Error ? error.message : 'Unable to register.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelfCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selfEvent || !tokenParam) return;
    const target = matchedRegistrations.find((r) => r.id === selectedRegId);
    if (!target) {
      notify('error', 'Registration Not Found', 'No matching participant registration found.');
      return;
    }

    // Identity & registration verification: match Participant ID OR last 4+ digits of mobile
    const trimmed = verifyInput.trim().toLowerCase();
    const cleanTargetMobile = target.mobile.replace(/\D/g, '');
    const cleanInputDigits = trimmed.replace(/\D/g, '');
    const idMatches = target.id.toLowerCase() === trimmed;
    const mobileMatches =
      cleanInputDigits.length >= 4 && cleanTargetMobile.endsWith(cleanInputDigits);

    if (!idMatches && !mobileMatches) {
      notify(
        'error',
        'Verification Mismatch',
        'Entered Participant ID or Mobile Number does not match your registration record.'
      );
      return;
    }

    if (target.attendanceStatus !== 'pending') {
      notify(
        'warning',
        'Duplicate Check-In Prevented',
        `You are already checked in (${target.attendanceStatus.toUpperCase()}) at ${formatTimestamp(target.checkInAt)}.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await performAtomicCheckIn({
        event: selfEvent,
        participantId: target.id,
        method: 'shared_qr',
        sharedQrToken: tokenParam,
        actorRole: 'participant',
        user,
      });

      if (res.ok && res.participant) {
        setCheckInCompleted({
          status: res.assignedStatus || 'present',
          message: res.message,
          participant: res.participant,
        });
        setMatchedRegistrations((prev) =>
          prev.map((p) => (p.id === target.id ? res.participant! : p))
        );
      } else {
        notify('warning', 'Check-In Blocked', res.message);
      }
    } catch (error) {
      notify('error', 'Check-In Failed', error instanceof Error ? error.message : 'Unable to complete self-check-in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Corporate Header */}
      <header className="h-16 bg-[#0B1D3A] text-white px-4 sm:px-8 flex items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <QrCode className="w-5 h-5 text-blue-300 shrink-0" />
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
          {user && (
            <button
              type="button"
              onClick={() => signOutUser()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-8">
        <NotificationBanner notification={notification} onDismiss={() => setNotification(null)} />

        {!user ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md mx-auto text-center space-y-5 mt-8">
            <ShieldCheck className="w-10 h-10 text-[#0B1D3A] mx-auto" />
            <div>
              <h1 className="font-display text-xl font-semibold text-[#0B1D3A]">
                {mode === 'self-checkin'
                  ? 'Verify Identity for Event Check-In'
                  : mode === 'ticket'
                    ? 'Verify Identity to View QR Ticket'
                    : 'Online Event Registration'}
              </h1>
              <p className="text-sm text-slate-600 mt-2">
                Sign in with your Google account to verify your identity, access your QR pass, or complete event check-in.
              </p>
            </div>
            <button
              type="button"
              onClick={() => signInWithGoogle()}
              className="w-full py-3 px-4 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg transition-colors"
            >
              Continue with Google
            </button>
          </div>
        ) : loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
            Loading event details and verifying registration...
          </div>
        ) : mode === 'self-checkin' ? (
          <div className="max-w-lg mx-auto space-y-6">
            {!selfEvent ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
                <AlertTriangle className="w-8 h-8 text-red-700 mx-auto" />
                <h2 className="font-display text-lg font-semibold text-slate-900">Event Not Found</h2>
                <p className="text-sm text-slate-600">This Shared Event QR link does not reference an active event.</p>
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
                  <p className="text-xs text-slate-500 pt-3 border-t border-slate-100">
                    Single-use attendance lock is now active for your registration. Duplicate submissions are automatically blocked.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-[#0B1D3A] text-white px-6 py-5">
                  <p className="text-xs text-slate-300">Mobile Self-Check-In</p>
                  <h1 className="font-display text-xl font-semibold mt-1">{selfEvent.title}</h1>
                  <p className="text-xs text-slate-300 mt-1 tabular-nums">
                    {selfEvent.eventDate} · {selfEvent.startTime} – {selfEvent.endTime} · {selfEvent.venue}
                  </p>
                </div>

                <div className="p-6 space-y-5">
                  <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                    Signed in as <span className="font-semibold text-slate-900">{user.email}</span>
                  </div>

                  {matchedRegistrations.length === 0 ? (
                    <div className="text-center space-y-3 py-4">
                      <AlertTriangle className="w-8 h-8 text-amber-700 mx-auto" />
                      <p className="text-sm font-medium text-slate-900">
                        No Registration Found for {user.email}
                      </p>
                      <p className="text-xs text-slate-600">
                        Register online first or ask the registration desk staff to locate your Participant ID.
                      </p>
                      {selfEvent.registrationOpen && (
                        <a
                          href={`?mode=register&eventId=${encodeURIComponent(selfEvent.id)}`}
                          className="inline-block px-4 py-2 bg-[#0B1D3A] text-white text-xs font-medium rounded-lg"
                        >
                          Register for {selfEvent.title}
                        </a>
                      )}
                    </div>
                  ) : (
                    <form onSubmit={handleSelfCheckIn} className="space-y-4">
                      {matchedRegistrations.length > 1 && (
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Select Registration
                          </label>
                          <select
                            value={selectedRegId}
                            onChange={(e) => setSelectedRegId(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                          >
                            {matchedRegistrations.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.fullName} ({r.id})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {(() => {
                        const chosen = matchedRegistrations.find((r) => r.id === selectedRegId);
                        if (!chosen) return null;
                        if (chosen.attendanceStatus !== 'pending') {
                          return (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 space-y-1">
                              <p className="font-semibold">Already Checked In</p>
                              <p className="text-xs">
                                {chosen.fullName} ({chosen.id}) checked in at{' '}
                                <span className="font-mono">{formatTimestamp(chosen.checkInAt)}</span>.
                              </p>
                            </div>
                          );
                        }
                        return (
                          <>
                            <div className="text-sm space-y-1">
                              <p className="font-semibold text-slate-900">{chosen.fullName}</p>
                              <p className="text-xs text-slate-500">
                                {chosen.company} · {chosen.position}
                              </p>
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">
                                Confirm Participant ID or Last 4+ Digits of Mobile
                              </label>
                              <input
                                type="text"
                                required
                                value={verifyInput}
                                onChange={(e) => setVerifyInput(e.target.value)}
                                placeholder="e.g. EVT-A9K2M4 or 2834"
                                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                              />
                            </div>

                            <button
                              type="submit"
                              disabled={submitting}
                              className="w-full py-3 bg-[#1E40AF] hover:bg-[#1B3B6F] text-white text-sm font-medium rounded-lg disabled:opacity-50"
                            >
                              {submitting ? 'Confirming Check-In...' : 'Complete Self-Check-In'}
                            </button>
                          </>
                        );
                      })()}
                    </form>
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Verified Email
                        </label>
                        <input
                          type="email"
                          readOnly
                          value={user.email || ''}
                          className="w-full px-3 py-2 border border-slate-200 bg-slate-50 text-slate-600 rounded-lg text-sm"
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

            {/* My QR Tickets */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 no-print">
                <Ticket className="w-5 h-5 text-[#0B1D3A]" />
                <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
                  My QR Event Tickets ({myTickets.length})
                </h2>
              </div>

              {myTickets.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
                  You do not have any QR tickets under {user.email} yet.
                </div>
              ) : (
                <div className="space-y-6">
                  {myTickets.map(({ participant, event }) => (
                    <ParticipantTicketCard
                      key={`${event.id}-${participant.id}`}
                      participant={participant}
                      event={event}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
