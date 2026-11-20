import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, QrCode, ShieldCheck, UserCheck } from 'lucide-react';
import {
  bootstrapAdmin,
  fetchAuthStatus,
  fetchEvents,
  fetchParticipants,
  getStoredSessionToken,
  loginStaff,
  logoutStaff,
} from './lib/attendanceService';
import type {
  AppView,
  AuthUser,
  EventRecord,
  ParticipantRecord,
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
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  // Auth form fields
  const [authDisplayName, setAuthDisplayName] = useState('Event Administrator');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [signInBusy, setSignInBusy] = useState(false);

  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);

  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [notification, setNotification] = useState<NotificationState | null>(null);

  const notify = (type: NotificationState['type'], title: string, message?: string) => {
    setNotification({ id: Date.now(), type, title, message });
  };

  useEffect(() => {
    let cancelled = false;
    async function initAuth() {
      try {
        const res = await fetchAuthStatus();
        if (!cancelled) {
          setNeedsBootstrap(res.needsBootstrap);
          setAuthUser(res.user);
        }
      } catch {
        if (!cancelled) {
          setAuthUser(null);
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    }
    void initAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadEventsData = useCallback(async () => {
    if (!authUser) return;
    try {
      const list = await fetchEvents();
      setEvents(list);
      setSelectedEventId((prev) => {
        if (prev && list.some((e) => e.id === prev)) return prev;
        const activeOne = list.find((e) => e.status === 'active');
        return activeOne?.id || list[0]?.id || '';
      });
    } catch (error) {
      notify('error', 'Failed to Load Events', error instanceof Error ? error.message : 'Unable to fetch events.');
    }
  }, [authUser]);

  const loadParticipantsData = useCallback(
    async (eventId: string) => {
      if (!authUser || !eventId) {
        setParticipants([]);
        return;
      }
      setLoadingParticipants(true);
      try {
        const list = await fetchParticipants(eventId);
        setParticipants(list);
      } catch (error) {
        notify(
          'error',
          'Failed to Load Roster',
          error instanceof Error ? error.message : 'Unable to fetch participants.'
        );
      } finally {
        setLoadingParticipants(false);
      }
    },
    [authUser]
  );

  const refreshAll = useCallback(async () => {
    await loadEventsData();
    if (selectedEventId) {
      await loadParticipantsData(selectedEventId);
    }
  }, [loadEventsData, loadParticipantsData, selectedEventId]);

  useEffect(() => {
    if (!authReady || !authUser || urlState.portalMode) {
      setEvents([]);
      return;
    }
    void loadEventsData();
  }, [authReady, authUser, urlState.portalMode, loadEventsData]);

  useEffect(() => {
    if (!authReady || !authUser || !selectedEventId || urlState.portalMode) {
      setParticipants([]);
      return;
    }
    void loadParticipantsData(selectedEventId);

    // Subscribe to live SSE updates for simultaneous multi-device staff sync
    const token = getStoredSessionToken();
    if (!token) return;
    const es = new EventSource(
      `/api/events/${encodeURIComponent(selectedEventId)}/stream?token=${encodeURIComponent(token)}`
    );
    es.onmessage = () => {
      void loadEventsData();
      void loadParticipantsData(selectedEventId);
    };
    return () => {
      es.close();
    };
  }, [authReady, authUser, selectedEventId, urlState.portalMode, loadEventsData, loadParticipantsData]);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignInBusy(true);
    try {
      const res = await bootstrapAdmin({
        email: authEmail,
        displayName: authDisplayName,
        password: authPassword,
      });
      setNeedsBootstrap(false);
      setAuthUser(res.user);
      setAuthPassword('');
      notify('success', 'Administrator Initialized', `Signed in as ${res.user.email}.`);
    } catch (error) {
      notify(
        'error',
        'Setup Failed',
        error instanceof Error ? error.message : 'Unable to initialize administrator.'
      );
    } finally {
      setSignInBusy(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignInBusy(true);
    try {
      const res = await loginStaff({ email: authEmail, password: authPassword });
      setAuthUser(res.user);
      setAuthPassword('');
    } catch (error) {
      notify(
        'error',
        'Sign-In Failed',
        error instanceof Error ? error.message : 'Invalid email or password.'
      );
    } finally {
      setSignInBusy(false);
    }
  };

  const handleSignOut = () => {
    logoutStaff();
    setAuthUser(null);
    setEvents([]);
    setParticipants([]);
    setSelectedEventId('');
  };

  if (!authReady) {
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
        role={authUser?.role || 'participant'}
        canReturnToConsole={Boolean(authUser)}
        onReturnToConsole={() => {
          window.history.replaceState({}, '', window.location.pathname);
          setUrlState({
            portalMode: null,
            eventIdParam: undefined,
            tokenParam: undefined,
            ticketParam: undefined,
          });
        }}
      />
    );
  }

  // Signed-out Corporate Landing & Auth / First-Time Admin Setup Screen
  if (!authUser) {
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
              className="px-4 py-2 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              Online Participant Registration
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="lg:col-span-7 p-8 sm:p-10 space-y-6">
              <div>
                <p className="text-xs font-semibold text-[#1E40AF] uppercase tracking-wider">
                  {needsBootstrap ? 'First-Time Server Setup' : 'Corporate Event Operations'}
                </p>
                <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#0B1D3A] mt-2 text-balance">
                  {needsBootstrap
                    ? 'Initialize Administrator Account'
                    : 'QR Code Event Attendance & Check-In'}
                </h1>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                  {needsBootstrap
                    ? 'Create the primary Administrator login to configure your company event, manage staff scanners, and issue JEZKA80 REWIND QR passes.'
                    : 'Sign in with your Administrator or Staff credentials for 500–1,000 participant check-in, live dashboard updates, and Excel/CSV exports.'}
                </p>
              </div>

              {notification && (
                <NotificationBanner notification={notification} onDismiss={() => setNotification(null)} />
              )}

              <form onSubmit={needsBootstrap ? handleBootstrap : handleLogin} className="space-y-4">
                {needsBootstrap && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Administrator Name
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={authDisplayName}
                      onChange={(e) => setAuthDisplayName(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="admin@company.com"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Password {needsBootstrap && '(min. 8 characters)'}
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="password"
                      required
                      minLength={needsBootstrap ? 8 : 1}
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="Enter password"
                      className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={signInBusy}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    <UserCheck className="w-4 h-4" />
                    <span>
                      {signInBusy
                        ? 'Authenticating...'
                        : needsBootstrap
                          ? 'Create Admin & Enter Console'
                          : 'Admin & Staff Sign In'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUrlState({ portalMode: 'register' })}
                    className="px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium rounded-lg transition-colors"
                  >
                    Participant Registration
                  </button>
                </div>
              </form>
            </div>

            <div className="lg:col-span-5 bg-[#0B1D3A] text-white p-8 sm:p-10 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold tracking-wide">
                  <QrCode className="w-4 h-4" />
                  <span>JEZKA80 REWIND READY</span>
                </div>
                <h2 className="font-display text-lg font-semibold">Platform Capabilities</h2>
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <div>
                    <p className="font-semibold text-white">Event Administrator</p>
                    <p>Full event setup, bulk CSV/XLSX imports, staff account management, attendance corrections, and Shared QR toggle.</p>
                  </div>
                  <div className="border-t border-white/10 pt-3">
                    <p className="font-semibold text-white">Check-In Staff</p>
                    <p>Simultaneous multi-device QR scanning, authorized manual entry, and real-time attendance roster viewing.</p>
                  </div>
                  <div className="border-t border-white/10 pt-3">
                    <p className="font-semibold text-white">Participants</p>
                    <p>Open online registration, downloadable JEZKA80 REWIND QR tickets, and mobile Shared QR self-check-in.</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Self-contained SQLite Database + Live SSE Sync ($0 Free)</span>
              </div>
            </div>
          </div>
        </main>

        <footer className="py-4 px-6 text-center text-xs text-slate-500">
          Event Attendance System · Standalone Corporate Check-In &amp; Reporting
        </footer>
      </div>
    );
  }

  const selectedEvent = events.find((e) => e.id === selectedEventId) || null;
  const role = authUser.role;

  return (
    <SidebarLayout
      activeView={activeView}
      onSelectView={(v) => {
        if (v === 'access' && role !== 'admin') return;
        setActiveView(v);
      }}
      role={role}
      userEmail={authUser.email}
      userName={authUser.displayName}
      events={events}
      selectedEventId={selectedEventId}
      onSelectEvent={(id) => setSelectedEventId(id)}
      onSignOut={handleSignOut}
    >
      <NotificationBanner notification={notification} onDismiss={() => setNotification(null)} />

      {activeView === 'dashboard' && (
        <DashboardView
          role={role}
          user={authUser}
          events={events}
          selectedEvent={selectedEvent}
          participants={participants}
          loadingParticipants={loadingParticipants}
          onSelectEvent={(id) => setSelectedEventId(id)}
          onRefresh={refreshAll}
          onNotify={notify}
          onNavigate={(view) => setActiveView(view)}
        />
      )}

      {activeView === 'scanner' && (
        <ScannerView
          event={selectedEvent}
          participants={participants}
          role={role}
          user={authUser}
          onRefresh={refreshAll}
          onNotify={notify}
        />
      )}

      {activeView === 'registration' && (
        <RegistrationView
          events={events}
          selectedEvent={selectedEvent}
          role={role}
          user={authUser}
          onRefresh={refreshAll}
          onNotify={notify}
        />
      )}

      {activeView === 'shared-qr' && (
        <SharedQrView
          event={selectedEvent}
          role={role}
          user={authUser}
          onRefresh={refreshAll}
          onNotify={notify}
        />
      )}

      {activeView === 'attendance' && (
        <AttendanceAuditView
          event={selectedEvent}
          participants={participants}
          role={role}
          user={authUser}
          onRefresh={refreshAll}
          onNotify={notify}
        />
      )}

      {activeView === 'reports' && (
        <ReportsView
          event={selectedEvent}
          participants={participants}
          role={role}
          user={authUser}
          onNotify={notify}
        />
      )}

      {activeView === 'access' && role === 'admin' && (
        <AccessSetupView
          user={authUser}
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
