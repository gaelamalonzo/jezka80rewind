import type {
  AttendanceStatus,
  AuditAction,
  AuditLogRecord,
  AuthUser,
  EventRecord,
  EventStatus,
  ParticipantRecord,
  QrTokenRecord,
  StaffRoleRecord,
  StaffRoleType,
} from '../types';

const TOKEN_STORAGE_KEY = 'eas_session_token';

export function getStoredSessionToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredSessionToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage restriction
  }
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredSessionToken();
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchAuthStatus(): Promise<{ needsBootstrap: boolean; user: AuthUser | null }> {
  return apiFetch('/api/auth/status');
}

export async function bootstrapAdmin(params: {
  email: string;
  displayName: string;
  password: string;
}): Promise<{ token: string; user: AuthUser }> {
  const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/bootstrap', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  setStoredSessionToken(res.token);
  return res;
}

export async function loginStaff(params: {
  email: string;
  password: string;
}): Promise<{ token: string; user: AuthUser }> {
  const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  setStoredSessionToken(res.token);
  return res;
}

export function logoutStaff(): void {
  setStoredSessionToken('');
}

export async function fetchEvents(): Promise<EventRecord[]> {
  return apiFetch('/api/events');
}

export async function fetchPublicEvents(): Promise<EventRecord[]> {
  return apiFetch('/api/events/public');
}

export async function fetchPublicEventStatus(
  eventId: string,
  token?: string
): Promise<{ event: EventRecord; tokenValid: boolean }> {
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  return apiFetch(`/api/events/public/${encodeURIComponent(eventId)}${qs}`);
}

export async function fetchPublicTicket(
  eventId: string,
  participantId: string
): Promise<{ event: EventRecord; participant: ParticipantRecord }> {
  return apiFetch(
    `/api/public/ticket?eventId=${encodeURIComponent(eventId)}&participantId=${encodeURIComponent(participantId)}`
  );
}

export async function fetchParticipants(eventId: string): Promise<ParticipantRecord[]> {
  return apiFetch(`/api/events/${encodeURIComponent(eventId)}/participants`);
}

export async function fetchAuditLogs(eventId: string): Promise<AuditLogRecord[]> {
  return apiFetch(`/api/events/${encodeURIComponent(eventId)}/audit-logs`);
}

export async function fetchQrTokens(eventId: string): Promise<QrTokenRecord[]> {
  return apiFetch(`/api/events/${encodeURIComponent(eventId)}/qr-tokens`);
}

export async function fetchStaffList(): Promise<StaffRoleRecord[]> {
  return apiFetch('/api/staff');
}

export async function createEvent(params: {
  title: string;
  description: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  lateCutoffMinutes: number;
  venue: string;
  capacity: number;
  status: EventStatus;
  sharedQrEnabled: boolean;
  registrationOpen: boolean;
}): Promise<{ eventId: string; sharedToken: string }> {
  return apiFetch('/api/events', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function updateEventDetails(params: {
  eventId: string;
  updates: {
    title: string;
    description: string;
    eventDate: string;
    startTime: string;
    endTime: string;
    lateCutoffMinutes: number;
    venue: string;
    capacity: number;
    status: EventStatus;
    sharedQrEnabled: boolean;
    registrationOpen: boolean;
  };
}): Promise<void> {
  await apiFetch(`/api/events/${encodeURIComponent(params.eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(params.updates),
  });
}

export async function toggleSharedQrStatus(params: {
  eventId: string;
  enabled: boolean;
}): Promise<void> {
  await apiFetch(`/api/events/${encodeURIComponent(params.eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sharedQrEnabled: params.enabled }),
  });
}

export async function rotateSharedQrToken(eventId: string): Promise<string> {
  const res = await apiFetch<{ token: string }>(
    `/api/events/${encodeURIComponent(eventId)}/qr-tokens/rotate`,
    { method: 'POST' }
  );
  return res.token;
}

export async function registerParticipantStaff(params: {
  eventId: string;
  employeeId?: string;
  useEmployeeIdAsId?: boolean;
  fullName: string;
  email: string;
  mobile: string;
  company: string;
  position: string;
}): Promise<{ participant: ParticipantRecord }> {
  return apiFetch(`/api/events/${encodeURIComponent(params.eventId)}/participants`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function registerParticipantPublic(params: {
  eventId: string;
  employeeId?: string;
  useEmployeeIdAsId?: boolean;
  fullName: string;
  email: string;
  mobile: string;
  company: string;
  position: string;
}): Promise<{ participant: ParticipantRecord; event: EventRecord }> {
  return apiFetch('/api/public/register', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function bulkImportParticipants(params: {
  eventId: string;
  useEmployeeIdAsId?: boolean;
  rows: Array<{
    employeeId?: string;
    fullName: string;
    email: string;
    mobile: string;
    company: string;
    position: string;
  }>;
}): Promise<{ imported: number; skipped: number }> {
  return apiFetch<{ imported: number; skipped: number }>(
    `/api/events/${encodeURIComponent(params.eventId)}/participants/bulk`,
    {
      method: 'POST',
      body: JSON.stringify({
        useEmployeeIdAsId: params.useEmployeeIdAsId ?? true,
        rows: params.rows,
      }),
    }
  );
}

export interface CheckInResult {
  ok: boolean;
  code: 'SUCCESS' | 'DUPLICATE' | 'NOT_FOUND' | 'WRONG_EVENT' | 'INVALID_SECRET' | 'EVENT_DISABLED';
  message: string;
  participant?: ParticipantRecord;
  assignedStatus?: 'present' | 'late';
}

export async function performStaffCheckIn(params: {
  eventId: string;
  participantId: string;
  expectedSecret?: string;
  method: 'individual_qr' | 'manual_staff';
}): Promise<CheckInResult> {
  return apiFetch(`/api/events/${encodeURIComponent(params.eventId)}/checkin`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function performPublicSelfCheckIn(params: {
  eventId: string;
  token: string;
  identifier: string;
  verifyValue: string;
}): Promise<{
  ok: boolean;
  assignedStatus: 'present' | 'late';
  message: string;
  participant: ParticipantRecord;
}> {
  return apiFetch('/api/public/self-checkin', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function adminCorrectParticipant(params: {
  eventId: string;
  participantId: string;
  updates: {
    employeeId?: string;
    fullName: string;
    email: string;
    mobile: string;
    company: string;
    position: string;
    attendanceStatus: AttendanceStatus;
    notes: string;
  };
}): Promise<void> {
  await apiFetch(
    `/api/events/${encodeURIComponent(params.eventId)}/participants/${encodeURIComponent(params.participantId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(params.updates),
    }
  );
}

export async function adminDeleteParticipant(eventId: string, participantId: string): Promise<void> {
  await apiFetch(
    `/api/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(participantId)}`,
    { method: 'DELETE' }
  );
}

export async function markPendingAsAbsent(eventId: string): Promise<number> {
  const res = await apiFetch<{ count: number }>(
    `/api/events/${encodeURIComponent(eventId)}/mark-pending-absent`,
    { method: 'POST' }
  );
  return res.count;
}

export async function writeAuditLog(params: {
  eventId: string;
  action: AuditAction;
  targetId: string;
  targetLabel: string;
  details: string;
}): Promise<void> {
  await apiFetch(`/api/events/${encodeURIComponent(params.eventId)}/audit-logs`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function upsertStaffUser(params: {
  email: string;
  displayName: string;
  role: StaffRoleType;
  active: boolean;
  password?: string;
  eventIdForAudit?: string;
}): Promise<void> {
  await apiFetch('/api/staff', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function deleteStaffUser(email: string): Promise<void> {
  await apiFetch(`/api/staff/${encodeURIComponent(email)}`, { method: 'DELETE' });
}
