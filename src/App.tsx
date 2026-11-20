import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { QrCode, ShieldCheck, UserCheck } from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  signInWithGoogle,
  signOutUser,
  testConnection,
} from './lib/firebase';
import { BOOTSTRAPPED_ADMIN_EMAIL, sanitizeEmail } from './lib/validation';
import type {
  AppView,
  EffectiveRole,
  EventRecord,
  ParticipantRecord,
  StaffRoleRecord,
} from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SidebarLayout } from './components/SidebarLayout';
import { NotificationBanner, type NotificationState } from './components/NotificationBanner';
import { DashboardView } from './components/DashboardView';
import { ScannerView } from './components/ScannerView';
import { RegistrationView } from './components/RegistrationView';
import { SharedQrView } from './components/SharedQrView';
import { AttendanceAuditView } from './components/AttendanceAuditView';
import { ReportsView } from './components/ReportsView';
import { AccessSetupView } from './components/AccessSetupView';
import { ParticipantPortal } from './components/ParticipantPortal';

interface UrlPortalState {
  portalMode: 'self-checkin' | 'register' | 'ticket' | null;
  eventIdParam?: string;
  tokenParam?: string;
  ticketParam?: string;
}

function parseUrlParams(): UrlPortalState {
  const params = new URLSearchParams(window.location.search);
  const modeParam = params.get('mode');
  const ticketParam = params.get('ticket') || undefined;
  const eventIdParam = params.get('eventId') || params.get('event') || undefined;
  const tokenParam = params.get('token') || undefined;

  if (modeParam === 'self-checkin') {
    return { portalMode: 'self-checkin', eventIdParam, tokenParam, ticketParam };
  }
  if (modeParam === 'register') {
    return { portalMode: 'register', eventIdParam, tokenParam, ticketParam };
  }
  if (ticketParam && eventIdParam) {
    return { portalMode: 'ticket', eventIdParam, tokenParam, ticketParam };
  }
  return { portalMode: null, eventIdParam, tokenParam, ticketParam };
}

function EventAttendanceApp() {
  const [urlState, setUrlState] = useState(parseUrlParams);
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [role, setRole] = useState<EffectiveRole>('participant');
  const [resolvingRole, setResolvingRole] = useState(false);

  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);

  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [signInBusy, setSignInBusy] = useState(false);

  const notify = (type: NotificationState['type'], title: string, message?: string) => {
    setNotification({ id: Date.now(), type, title, message });
  };

  useEffect(() => {
    void testConnection();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (!user || !user.email) {
        setRole('participant');
        setAuthReady(true);
        return;
      }

      setResolvingRole(true);
      try {
        const cleanEmail = sanitizeEmail(user.email);
        if (cleanEmail === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified) {
          setRole('admin');
        } else if (user.emailVerified) {
          const staffSnap = await getDoc(doc(db, 'staff_roles', cleanEmail));
          if (staffSnap.exists()) {
            const staffData = staffSnap.data() as StaffRoleRecord;
            if (staffData.active) {
              setRole(staffData.role);
            } else {
              setRole('participant');
            }
          } else {
            setRole('participant');
          }
        } else {
          setRole('participant');
        }
      } catch {
        setRole('participant');
      } finally {
        setResolvingRole(false);
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, []);

  // Load events list for Admin / Staff workspace
  useEffect(() => {
    if (!authReady || !currentUser || (role !== 'admin' && role !== 'staff') || urlState.portalMode) {
      setEvents([]);
      return;
    }

    const path = 'events';
    const q = query(collection(db, 'events'), orderBy('eventDate', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as EventRecord);
        setEvents(list);
        setSelectedEventId((prev) => {
          if (prev && list.some((e) => e.id === prev)) return prev;
          const activeOne = list.find((e) => e.status === 'active');
          return activeOne?.id || list[0]?.id || '';
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );

    return () => unsub();
  }, [authReady, currentUser, role, urlState.portalMode]);

  // Load real-time participants for active event (Admin / Staff)
  useEffect(() => {
    if (
      !authReady ||
      !currentUser ||
      !selectedEventId ||
      (role !== 'admin' && role !== 'staff') ||
      urlState.portalMode
    ) {
      setParticipants([]);
      return;
    }

    setLoadingParticipants(true);
    const path = `events/${selectedEventId}/participants`;
    const q = query(
      collection(db, 'events', selectedEventId, 'participants'),
      orderBy('registrationDate', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setParticipants(snap.docs.map((d) => d.data() as ParticipantRecord));
        setLoadingParticipants(false);
      },
      (error) => {
        setLoadingParticipants(false);
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );

    return () => unsub();
  }, [authReady, currentUser, selectedEventId, role, urlState.portalMode]);

  const handleGoogleSignIn = async () => {
    setSignInBusy(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      notify(
        'error',
        'Sign-In Failed',
        error instanceof Error ? error.message : 'Unable to complete Google sign-in.'
      );
    } finally {
      setSignInBusy(false);
    }
  };

  if (!authReady || resolvingRole) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-[#0B1D3A] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-600">Loading Event Attendance System...</p>
        </div>
      </div>
    );
  }

  // Dedicated Participant Portal (Online Registration / Mobile Self-Check-In / Direct Ticket View)
  if (urlState.portalMode) {
    return (
      <ParticipantPortal
        mode={urlState.portalMode}
        eventIdParam={urlState.eventIdParam}
        tokenParam={urlState.tokenParam}
        ticketIdParam={urlState.ticketParam}
        user={currentUser}
        role={role}
        canReturnToConsole={role === 'admin' || role === 'staff'}
        onReturnToConsole={() => {
          window.history.replaceState({}, '', window.location.pathname);
          setUrlState({ portalMode: null, eventIdParam: undefined, tokenParam: undefined, ticketParam: undefined });
        }}
      />
    );
  }

  // Signed-out Corporate Landing Screen
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
        <header className="h-16 bg-white border-b border-slate-200 px-6 sm:px-10 flex items-center justify-between gap-8">
          <span className="font-display text-lg font-bold tracking-tight text-[#0B1D3A] whitespace-nowrap">
            Event Attendance System
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setUrlState({ portalMode: 'register' })}
              className="text-sm font-medium text-slate-600 hover:text-[#0B1D3A] whitespace-nowrap"
            >
              Participant Registration
            </button>
            <button
              type="button"
              disabled={signInBusy}
              onClick={handleGoogleSignIn}
              className="px-4 py-2 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {signInBusy ? 'Signing In...' : 'Sign In with Google'}
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="lg:col-span-7 p-8 sm:p-10 space-y-6">
              <div>
                <p className="text-xs font-semibold text-[#1E40AF] uppercase tracking-wider">
                  Corporate Event Operations
                </p>
                <h1 className="font-display text-3xl font-semibold text-[#0B1D3A] mt-2 text-balance">
                  QR Code Event Attendance &amp; Check-In Platform
                </h1>
                <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                  Built for 500–1,000 participant company events with simultaneous multi-staff scanning, online ticket registration, mobile self-check-in, and real-time Excel/CSV reporting.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 text-xs text-slate-700">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                  <div className="flex items-center gap-2 font-semibold text-[#0B1D3A]">
                    <QrCode className="w-4 h-4" />
                    <span>Dual QR Modes</span>
                  </div>
                  <p className="text-slate-600">
                    Individual participant QR tickets plus toggleable Shared Event QR self-check-in.
                  </p>
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                  <div className="flex items-center gap-2 font-semibold text-[#0B1D3A]">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Atomic Anti-Duplicate</span>
                  </div>
                  <p className="text-slate-600">
                    Cloud Firestore transactions prevent duplicate scans and maintain audit history.
                  </p>
                </div>
              </div>

              {notification && (
                <NotificationBanner notification={notification} onDismiss={() => setNotification(null)} />
              )}

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={signInBusy}
                  onClick={handleGoogleSignIn}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>{signInBusy ? 'Signing In...' : 'Admin & Staff Sign In'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUrlState({ portalMode: 'register' })}
                  className="px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium rounded-lg transition-colors"
                >
                  Participant Registration Portal
                </button>
              </div>
            </div>

            <div className="lg:col-span-5 bg-[#0B1D3A] text-white p-8 sm:p-10 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <h2 className="font-display text-lg font-semibold">Role Permissions</h2>
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <div>
                    <p className="font-semibold text-white">Event Administrator</p>
                    <p>Full event setup, bulk CSV/XLSX imports, staff access control, attendance corrections, and Shared QR toggle.</p>
                  </div>
                  <div className="border-t border-white/10 pt-3">
                    <p className="font-semibold text-white">Check-In Staff</p>
                    <p>Camera QR scanning, authorized manual check-in, and real-time attendance roster viewing.</p>
                  </div>
                  <div className="border-t border-white/10 pt-3">
                    <p className="font-semibold text-white">Participants</p>
                    <p>Online registration, downloadable Individual QR Tickets, and mobile self-check-in.</p>
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Backed by Firebase Authentication &amp; Cloud Firestore
              </p>
            </div>
          </div>
        </main>

        <footer className="py-4 px-6 text-center text-xs text-slate-500">
          Event Attendance System · Corporate Check-In &amp; Reporting
        </footer>
      </div>
    );
  }

  // Signed-in regular user without Admin/Staff role -> Route to Participant Portal cleanly
  if (role === 'participant') {
    return (
      <ParticipantPortal
        mode="register"
        user={currentUser}
        role={role}
        canReturnToConsole={false}
        onReturnToConsole={() => {}}
      />
    );
  }

  const selectedEvent = events.find((e) => e.id === selectedEventId) || null;

  return (
    <SidebarLayout
      activeView={activeView}
      onSelectView={(v) => {
        if (v === 'access' && role !== 'admin') return;
        setActiveView(v);
      }}
      role={role}
      userEmail={currentUser.email || ''}
      userName={currentUser.displayName || ''}
      events={events}
      selectedEventId={selectedEventId}
      onSelectEvent={(id) => setSelectedEventId(id)}
      onSignOut={() => signOutUser()}
    >
      <NotificationBanner notification={notification} onDismiss={() => setNotification(null)} />

      {activeView === 'dashboard' && (
        <DashboardView
          role={role}
          user={currentUser}
          events={events}
          selectedEvent={selectedEvent}
          participants={participants}
          loadingParticipants={loadingParticipants}
          onSelectEvent={(id) => setSelectedEventId(id)}
          onNotify={notify}
          onNavigate={(view) => setActiveView(view)}
        />
      )}

      {activeView === 'scanner' && (
        <ScannerView
          event={selectedEvent}
          participants={participants}
          role={role}
          user={currentUser}
          onNotify={notify}
        />
      )}

      {activeView === 'registration' && (
        <RegistrationView
          events={events}
          selectedEvent={selectedEvent}
          role={role}
          user={currentUser}
          onNotify={notify}
        />
      )}

      {activeView === 'shared-qr' && (
        <SharedQrView
          event={selectedEvent}
          role={role}
          user={currentUser}
          onNotify={notify}
        />
      )}

      {activeView === 'attendance' && (
        <AttendanceAuditView
          event={selectedEvent}
          participants={participants}
          role={role}
          user={currentUser}
          onNotify={notify}
        />
      )}

      {activeView === 'reports' && (
        <ReportsView
          event={selectedEvent}
          participants={participants}
          role={role}
          user={currentUser}
          onNotify={notify}
        />
      )}

      {activeView === 'access' && role === 'admin' && (
        <AccessSetupView
          user={currentUser}
          selectedEventId={selectedEventId}
          onNotify={notify}
        />
      )}
    </SidebarLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <EventAttendanceApp />
    </ErrorBoundary>
  );
}
