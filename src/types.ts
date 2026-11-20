import type { Timestamp } from 'firebase/firestore';

export type EventStatus = 'upcoming' | 'active' | 'completed' | 'archived';
export type AttendanceStatus = 'pending' | 'present' | 'late' | 'absent';
export type CheckInMethod =
  | 'individual_qr'
  | 'shared_qr'
  | 'manual_staff'
  | 'admin_override'
  | 'none';
export type RegistrationSource = 'online' | 'admin_manual' | 'bulk_import';
export type StaffRoleType = 'admin' | 'staff';
export type EffectiveRole = 'admin' | 'staff' | 'participant';

export type AuditAction =
  | 'event_created'
  | 'event_updated'
  | 'shared_qr_toggled'
  | 'participant_registered'
  | 'participant_updated'
  | 'participant_deleted'
  | 'checkin_individual_qr'
  | 'checkin_shared_qr'
  | 'checkin_manual_staff'
  | 'attendance_corrected'
  | 'staff_role_updated'
  | 'report_exported';

export interface EventRecord {
  id: string;
  title: string;
  description: string;
  eventDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  lateCutoffMinutes: number;
  venue: string;
  capacity: number;
  status: EventStatus;
  sharedQrEnabled: boolean;
  registrationOpen: boolean;
  createdByUid: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface QrTokenRecord {
  token: string;
  eventId: string;
  active: boolean;
  createdByUid: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface StaffRoleRecord {
  email: string;
  displayName: string;
  role: StaffRoleType;
  active: boolean;
  addedByEmail: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ParticipantRecord {
  id: string;
  eventId: string;
  fullName: string;
  email: string;
  mobile: string;
  company: string;
  position: string;
  qrSecret: string;
  registeredByUid: string;
  registrationSource: RegistrationSource;
  registrationDate: Timestamp | null;
  attendanceStatus: AttendanceStatus;
  checkInAt: Timestamp | null;
  checkInMethod: CheckInMethod;
  checkedInByUid: string;
  checkedInByEmail: string;
  notes: string;
  updatedAt: Timestamp | null;
}

export interface AttendanceLogRecord {
  participantId: string;
  eventId: string;
  participantName: string;
  company: string;
  status: 'present' | 'late';
  method: Exclude<CheckInMethod, 'none'>;
  qrTokenUsed: string;
  checkedInByUid: string;
  checkedInByEmail: string;
  checkedInAt: Timestamp | null;
}

export interface AuditLogRecord {
  id: string;
  eventId: string;
  action: AuditAction;
  actorUid: string;
  actorEmail: string;
  actorRole: EffectiveRole;
  targetId: string;
  targetLabel: string;
  details: string;
  createdAt: Timestamp | null;
}

export interface QrTicketPayload {
  t: 'EAS_TICKET';
  e: string; // eventId
  p: string; // participantId
  k: string; // qrSecret
}

export type AppView =
  | 'dashboard'
  | 'scanner'
  | 'registration'
  | 'shared-qr'
  | 'attendance'
  | 'reports'
  | 'access';
