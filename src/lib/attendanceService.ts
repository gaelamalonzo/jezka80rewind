import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  computeAttendanceStatus,
  CONSTRAINTS,
  generateEventId,
  generateLogId,
  generateParticipantId,
  generateQrSecret,
  generateSharedQrToken,
  sanitizeEmail,
  sanitizeText,
} from './validation';
import type {
  AttendanceStatus,
  AuditAction,
  CheckInMethod,
  EffectiveRole,
  EventRecord,
  EventStatus,
  ParticipantRecord,
  RegistrationSource,
  StaffRoleType,
} from '../types';

export async function writeAuditLog(params: {
  eventId: string;
  action: AuditAction;
  user: User;
  actorRole: EffectiveRole;
  targetId: string;
  targetLabel: string;
  details: string;
}): Promise<void> {
  const logId = generateLogId();
  const path = `events/${params.eventId}/audit_logs/${logId}`;
  try {
    await setDoc(doc(db, 'events', params.eventId, 'audit_logs', logId), {
      id: logId,
      eventId: params.eventId,
      action: params.action,
      actorUid: params.user.uid,
      actorEmail: sanitizeEmail(params.user.email || ''),
      actorRole: params.actorRole,
      targetId: params.targetId.slice(0, 128),
      targetLabel: sanitizeText(params.targetLabel, CONSTRAINTS.AUDIT.TARGET_LABEL_MAX),
      details: sanitizeText(params.details, CONSTRAINTS.AUDIT.DETAILS_MAX),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
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
  user: User;
}): Promise<{ eventId: string; sharedToken: string }> {
  const eventId = generateEventId(params.title);
  const sharedToken = generateSharedQrToken();
  const eventPath = `events/${eventId}`;

  try {
    await setDoc(doc(db, 'events', eventId), {
      id: eventId,
      title: sanitizeText(params.title, CONSTRAINTS.EVENT.TITLE_MAX),
      description: sanitizeText(params.description, CONSTRAINTS.EVENT.DESC_MAX),
      eventDate: params.eventDate,
      startTime: params.startTime,
      endTime: params.endTime,
      lateCutoffMinutes: params.lateCutoffMinutes,
      venue: sanitizeText(params.venue, CONSTRAINTS.EVENT.VENUE_MAX),
      capacity: params.capacity,
      status: params.status,
      sharedQrEnabled: params.sharedQrEnabled,
      registrationOpen: params.registrationOpen,
      createdByUid: params.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'events', eventId, 'qr_tokens', sharedToken), {
      token: sharedToken,
      eventId,
      active: true,
      createdByUid: params.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await writeAuditLog({
      eventId,
      action: 'event_created',
      user: params.user,
      actorRole: 'admin',
      targetId: eventId,
      targetLabel: params.title,
      details: `Created event on ${params.eventDate} (${params.startTime}-${params.endTime}) at ${params.venue}.`,
    });

    return { eventId, sharedToken };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, eventPath);
  }
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
  user: User;
}): Promise<void> {
  const path = `events/${params.eventId}`;
  try {
    await updateDoc(doc(db, 'events', params.eventId), {
      title: sanitizeText(params.updates.title, CONSTRAINTS.EVENT.TITLE_MAX),
      description: sanitizeText(params.updates.description, CONSTRAINTS.EVENT.DESC_MAX),
      eventDate: params.updates.eventDate,
      startTime: params.updates.startTime,
      endTime: params.updates.endTime,
      lateCutoffMinutes: params.updates.lateCutoffMinutes,
      venue: sanitizeText(params.updates.venue, CONSTRAINTS.EVENT.VENUE_MAX),
      capacity: params.updates.capacity,
      status: params.updates.status,
      sharedQrEnabled: params.updates.sharedQrEnabled,
      registrationOpen: params.updates.registrationOpen,
      updatedAt: serverTimestamp(),
    });

    await writeAuditLog({
      eventId: params.eventId,
      action: 'event_updated',
      user: params.user,
      actorRole: 'admin',
      targetId: params.eventId,
      targetLabel: params.updates.title,
      details: `Updated event configuration (Status: ${params.updates.status}, Shared QR: ${params.updates.sharedQrEnabled ? 'Enabled' : 'Disabled'}).`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function toggleSharedQrStatus(params: {
  event: EventRecord;
  enabled: boolean;
  user: User;
}): Promise<void> {
  const path = `events/${params.event.id}`;
  try {
    await updateDoc(doc(db, 'events', params.event.id), {
      sharedQrEnabled: params.enabled,
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog({
      eventId: params.event.id,
      action: 'shared_qr_toggled',
      user: params.user,
      actorRole: 'admin',
      targetId: params.event.id,
      targetLabel: params.event.title,
      details: `Shared Event QR self-check-in ${params.enabled ? 'enabled' : 'disabled'}.`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function rotateSharedQrToken(params: {
  eventId: string;
  eventTitle: string;
  existingTokens: string[];
  user: User;
}): Promise<string> {
  const newToken = generateSharedQrToken();
  const path = `events/${params.eventId}/qr_tokens/${newToken}`;
  try {
    const batch = writeBatch(db);
    for (const oldToken of params.existingTokens) {
      batch.update(doc(db, 'events', params.eventId, 'qr_tokens', oldToken), {
        active: false,
        updatedAt: serverTimestamp(),
      });
    }
    batch.set(doc(db, 'events', params.eventId, 'qr_tokens', newToken), {
      token: newToken,
      eventId: params.eventId,
      active: true,
      createdByUid: params.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    await writeAuditLog({
      eventId: params.eventId,
      action: 'shared_qr_toggled',
      user: params.user,
      actorRole: 'admin',
      targetId: newToken,
      targetLabel: params.eventTitle,
      details: 'Rotated Shared Event QR token; previous tokens deactivated.',
    });

    return newToken;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function registerParticipant(params: {
  eventId: string;
  eventTitle: string;
  fullName: string;
  email: string;
  mobile: string;
  company: string;
  position: string;
  source: RegistrationSource;
  actorRole: EffectiveRole;
  user: User;
}): Promise<{ participantId: string; qrSecret: string }> {
  const participantId = generateParticipantId();
  const qrSecret = generateQrSecret();
  const path = `events/${params.eventId}/participants/${participantId}`;
  const cleanEmail = sanitizeEmail(params.email);

  try {
    await setDoc(doc(db, 'events', params.eventId, 'participants', participantId), {
      id: participantId,
      eventId: params.eventId,
      fullName: sanitizeText(params.fullName, CONSTRAINTS.PARTICIPANT.NAME_MAX),
      email: cleanEmail,
      mobile: sanitizeText(params.mobile, CONSTRAINTS.PARTICIPANT.MOBILE_MAX),
      company: sanitizeText(params.company, CONSTRAINTS.PARTICIPANT.COMPANY_MAX),
      position: sanitizeText(params.position, CONSTRAINTS.PARTICIPANT.POSITION_MAX),
      qrSecret,
      registeredByUid: params.user.uid,
      registrationSource: params.source,
      registrationDate: serverTimestamp(),
      attendanceStatus: 'pending',
      checkInAt: null,
      checkInMethod: 'none',
      checkedInByUid: '',
      checkedInByEmail: '',
      notes: '',
      updatedAt: serverTimestamp(),
    });

    await writeAuditLog({
      eventId: params.eventId,
      action: 'participant_registered',
      user: params.user,
      actorRole: params.actorRole,
      targetId: participantId,
      targetLabel: `${params.fullName} (${cleanEmail})`,
      details: `Registered via ${params.source} for ${params.eventTitle}.`,
    });

    return { participantId, qrSecret };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function bulkImportParticipants(params: {
  eventId: string;
  eventTitle: string;
  rows: Array<{
    fullName: string;
    email: string;
    mobile: string;
    company: string;
    position: string;
  }>;
  user: User;
}): Promise<number> {
  const path = `events/${params.eventId}/participants`;
  const chunkSize = 400;
  let imported = 0;

  try {
    for (let i = 0; i < params.rows.length; i += chunkSize) {
      const slice = params.rows.slice(i, i + chunkSize);
      const batch = writeBatch(db);

      for (const row of slice) {
        const participantId = generateParticipantId();
        const qrSecret = generateQrSecret();
        const ref = doc(db, 'events', params.eventId, 'participants', participantId);
        batch.set(ref, {
          id: participantId,
          eventId: params.eventId,
          fullName: sanitizeText(row.fullName, CONSTRAINTS.PARTICIPANT.NAME_MAX),
          email: sanitizeEmail(row.email),
          mobile: sanitizeText(row.mobile, CONSTRAINTS.PARTICIPANT.MOBILE_MAX),
          company: sanitizeText(row.company, CONSTRAINTS.PARTICIPANT.COMPANY_MAX),
          position: sanitizeText(row.position, CONSTRAINTS.PARTICIPANT.POSITION_MAX),
          qrSecret,
          registeredByUid: params.user.uid,
          registrationSource: 'bulk_import',
          registrationDate: serverTimestamp(),
          attendanceStatus: 'pending',
          checkInAt: null,
          checkInMethod: 'none',
          checkedInByUid: '',
          checkedInByEmail: '',
          notes: '',
          updatedAt: serverTimestamp(),
        });
        imported++;
      }

      await batch.commit();
    }

    await writeAuditLog({
      eventId: params.eventId,
      action: 'participant_registered',
      user: params.user,
      actorRole: 'admin',
      targetId: params.eventId,
      targetLabel: params.eventTitle,
      details: `Bulk imported ${imported} participants via spreadsheet.`,
    });

    return imported;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface CheckInResult {
  ok: boolean;
  code: 'SUCCESS' | 'DUPLICATE' | 'NOT_FOUND' | 'WRONG_EVENT' | 'INVALID_SECRET' | 'EVENT_DISABLED';
  message: string;
  participant?: ParticipantRecord;
  assignedStatus?: 'present' | 'late';
}

export async function performAtomicCheckIn(params: {
  event: EventRecord;
  participantId: string;
  expectedSecret?: string;
  method: 'individual_qr' | 'manual_staff' | 'shared_qr';
  sharedQrToken?: string;
  actorRole: EffectiveRole;
  user: User;
}): Promise<CheckInResult> {
  const participantRef = doc(db, 'events', params.event.id, 'participants', params.participantId);
  const attendanceLogRef = doc(db, 'events', params.event.id, 'attendance_logs', params.participantId);
  const logId = generateLogId();
  const auditLogRef = doc(db, 'events', params.event.id, 'audit_logs', logId);
  const path = `events/${params.event.id}/participants/${params.participantId}`;

  if (params.method === 'shared_qr' && (!params.event.sharedQrEnabled || params.event.status !== 'active')) {
    return {
      ok: false,
      code: 'EVENT_DISABLED',
      message: 'Shared Event QR self-check-in is currently disabled or event is not active.',
    };
  }

  try {
    const result = await runTransaction(db, async (tx): Promise<CheckInResult> => {
      const snap = await tx.get(participantRef);
      if (!snap.exists()) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: `Participant ID "${params.participantId}" is not registered for ${params.event.title}.`,
        };
      }

      const data = snap.data() as ParticipantRecord;

      if (params.expectedSecret && data.qrSecret !== params.expectedSecret) {
        return {
          ok: false,
          code: 'INVALID_SECRET',
          message: 'QR security token mismatch. This ticket could not be verified.',
          participant: data,
        };
      }

      const existingLog = await tx.get(attendanceLogRef);
      if (data.attendanceStatus !== 'pending' || existingLog.exists()) {
        return {
          ok: false,
          code: 'DUPLICATE',
          message: `Duplicate check-in rejected: ${data.fullName} already checked in (${data.attendanceStatus.toUpperCase()}).`,
          participant: data,
        };
      }

      const assignedStatus = computeAttendanceStatus(params.event);
      const actorEmail = sanitizeEmail(params.user.email || '');

      tx.set(attendanceLogRef, {
        participantId: params.participantId,
        eventId: params.event.id,
        participantName: data.fullName,
        company: data.company,
        status: assignedStatus,
        method: params.method,
        qrTokenUsed: params.sharedQrToken || '',
        checkedInByUid: params.user.uid,
        checkedInByEmail: actorEmail,
        checkedInAt: serverTimestamp(),
      });

      tx.update(participantRef, {
        attendanceStatus: assignedStatus,
        checkInAt: serverTimestamp(),
        checkInMethod: params.method,
        checkedInByUid: params.user.uid,
        checkedInByEmail: actorEmail,
        updatedAt: serverTimestamp(),
      });

      const auditAction: AuditAction =
        params.method === 'individual_qr'
          ? 'checkin_individual_qr'
          : params.method === 'shared_qr'
            ? 'checkin_shared_qr'
            : 'checkin_manual_staff';

      tx.set(auditLogRef, {
        id: logId,
        eventId: params.event.id,
        action: auditAction,
        actorUid: params.user.uid,
        actorEmail,
        actorRole: params.actorRole,
        targetId: params.participantId,
        targetLabel: data.fullName,
        details: `Checked in as ${assignedStatus.toUpperCase()} via ${params.method.replace('_', ' ')}.`,
        createdAt: serverTimestamp(),
      });

      return {
        ok: true,
        code: 'SUCCESS',
        message: `Check-in confirmed for ${data.fullName} (${assignedStatus === 'late' ? 'Late Arrival' : 'On Time'}).`,
        participant: {
          ...data,
          attendanceStatus: assignedStatus,
          checkInMethod: params.method,
        },
        assignedStatus,
      };
    });

    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function adminCorrectParticipant(params: {
  eventId: string;
  participant: ParticipantRecord;
  updates: {
    fullName: string;
    email: string;
    mobile: string;
    company: string;
    position: string;
    attendanceStatus: AttendanceStatus;
    notes: string;
  };
  user: User;
}): Promise<void> {
  const participantRef = doc(db, 'events', params.eventId, 'participants', params.participant.id);
  const attendanceLogRef = doc(db, 'events', params.eventId, 'attendance_logs', params.participant.id);
  const logId = generateLogId();
  const auditLogRef = doc(db, 'events', params.eventId, 'audit_logs', logId);
  const path = `events/${params.eventId}/participants/${params.participant.id}`;
  const actorEmail = sanitizeEmail(params.user.email || '');

  try {
    await runTransaction(db, async (tx) => {
      const existingLogSnap = await tx.get(attendanceLogRef);
      const becomingCheckedIn =
        params.updates.attendanceStatus === 'present' || params.updates.attendanceStatus === 'late';
      const wasCheckedIn =
        params.participant.attendanceStatus === 'present' || params.participant.attendanceStatus === 'late';

      let nextCheckInAt = params.participant.checkInAt;
      let nextMethod: CheckInMethod = params.participant.checkInMethod;
      let nextByUid = params.participant.checkedInByUid;
      let nextByEmail = params.participant.checkedInByEmail;

      if (becomingCheckedIn) {
        if (!wasCheckedIn || !nextCheckInAt) {
          nextCheckInAt = serverTimestamp() as unknown as ParticipantRecord['checkInAt'];
          nextMethod = 'admin_override';
          nextByUid = params.user.uid;
          nextByEmail = actorEmail;
        }
        if (existingLogSnap.exists()) {
          tx.update(attendanceLogRef, {
            status: params.updates.attendanceStatus,
            method: 'admin_override',
            checkedInByUid: params.user.uid,
            checkedInByEmail: actorEmail,
            checkedInAt: serverTimestamp(),
          });
        } else {
          tx.set(attendanceLogRef, {
            participantId: params.participant.id,
            eventId: params.eventId,
            participantName: sanitizeText(params.updates.fullName, CONSTRAINTS.PARTICIPANT.NAME_MAX),
            company: sanitizeText(params.updates.company, CONSTRAINTS.PARTICIPANT.COMPANY_MAX),
            status: params.updates.attendanceStatus,
            method: 'admin_override',
            qrTokenUsed: '',
            checkedInByUid: params.user.uid,
            checkedInByEmail: actorEmail,
            checkedInAt: serverTimestamp(),
          });
        }
      } else {
        nextCheckInAt = null;
        nextMethod = 'none';
        nextByUid = '';
        nextByEmail = '';
        if (existingLogSnap.exists()) {
          tx.delete(attendanceLogRef);
        }
      }

      tx.update(participantRef, {
        fullName: sanitizeText(params.updates.fullName, CONSTRAINTS.PARTICIPANT.NAME_MAX),
        email: sanitizeEmail(params.updates.email),
        mobile: sanitizeText(params.updates.mobile, CONSTRAINTS.PARTICIPANT.MOBILE_MAX),
        company: sanitizeText(params.updates.company, CONSTRAINTS.PARTICIPANT.COMPANY_MAX),
        position: sanitizeText(params.updates.position, CONSTRAINTS.PARTICIPANT.POSITION_MAX),
        attendanceStatus: params.updates.attendanceStatus,
        checkInAt: nextCheckInAt,
        checkInMethod: nextMethod,
        checkedInByUid: nextByUid,
        checkedInByEmail: nextByEmail,
        notes: sanitizeText(params.updates.notes, CONSTRAINTS.PARTICIPANT.NOTES_MAX),
        updatedAt: serverTimestamp(),
      });

      tx.set(auditLogRef, {
        id: logId,
        eventId: params.eventId,
        action: 'attendance_corrected',
        actorUid: params.user.uid,
        actorEmail,
        actorRole: 'admin',
        targetId: params.participant.id,
        targetLabel: params.updates.fullName,
        details: `Admin updated record (${params.participant.attendanceStatus} -> ${params.updates.attendanceStatus}). ${params.updates.notes ? 'Note: ' + params.updates.notes : ''}`,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminDeleteParticipant(params: {
  eventId: string;
  participant: ParticipantRecord;
  user: User;
}): Promise<void> {
  const path = `events/${params.eventId}/participants/${params.participant.id}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'events', params.eventId, 'participants', params.participant.id));
    batch.delete(doc(db, 'events', params.eventId, 'attendance_logs', params.participant.id));
    await batch.commit();

    await writeAuditLog({
      eventId: params.eventId,
      action: 'participant_deleted',
      user: params.user,
      actorRole: 'admin',
      targetId: params.participant.id,
      targetLabel: params.participant.fullName,
      details: `Removed registration for ${params.participant.email}.`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function markPendingAsAbsent(params: {
  eventId: string;
  eventTitle: string;
  pendingParticipants: ParticipantRecord[];
  user: User;
}): Promise<number> {
  if (params.pendingParticipants.length === 0) return 0;
  const path = `events/${params.eventId}/participants`;
  const chunkSize = 400;
  let count = 0;

  try {
    for (let i = 0; i < params.pendingParticipants.length; i += chunkSize) {
      const slice = params.pendingParticipants.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const p of slice) {
        batch.update(doc(db, 'events', params.eventId, 'participants', p.id), {
          attendanceStatus: 'absent',
          updatedAt: serverTimestamp(),
        });
        count++;
      }
      await batch.commit();
    }

    await writeAuditLog({
      eventId: params.eventId,
      action: 'attendance_corrected',
      user: params.user,
      actorRole: 'admin',
      targetId: params.eventId,
      targetLabel: params.eventTitle,
      details: `Marked ${count} pending participants as ABSENT.`,
    });

    return count;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function upsertStaffRole(params: {
  email: string;
  displayName: string;
  role: StaffRoleType;
  active: boolean;
  eventIdForAudit?: string;
  user: User;
}): Promise<void> {
  const cleanEmail = sanitizeEmail(params.email);
  const path = `staff_roles/${cleanEmail}`;
  const actorEmail = sanitizeEmail(params.user.email || '');

  try {
    const ref = doc(db, 'staff_roles', cleanEmail);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      await updateDoc(ref, {
        displayName: sanitizeText(params.displayName, CONSTRAINTS.STAFF.NAME_MAX),
        role: params.role,
        active: params.active,
        addedByEmail: actorEmail,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        email: cleanEmail,
        displayName: sanitizeText(params.displayName, CONSTRAINTS.STAFF.NAME_MAX),
        role: params.role,
        active: params.active,
        addedByEmail: actorEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (params.eventIdForAudit) {
      await writeAuditLog({
        eventId: params.eventIdForAudit,
        action: 'staff_role_updated',
        user: params.user,
        actorRole: 'admin',
        targetId: cleanEmail,
        targetLabel: params.displayName,
        details: `Set ${cleanEmail} role to ${params.role.toUpperCase()} (${params.active ? 'Active' : 'Disabled'}).`,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteStaffRole(email: string): Promise<void> {
  const cleanEmail = sanitizeEmail(email);
  const path = `staff_roles/${cleanEmail}`;
  try {
    await deleteDoc(doc(db, 'staff_roles', cleanEmail));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function findParticipantForSelfCheckIn(params: {
  eventId: string;
  user: User;
}): Promise<ParticipantRecord[]> {
  const cleanEmail = sanitizeEmail(params.user.email || '');
  const path = `events/${params.eventId}/participants`;
  try {
    const byEmail = await getDocs(
      query(collection(db, 'events', params.eventId, 'participants'), where('email', '==', cleanEmail))
    );
    const results = new Map<string, ParticipantRecord>();
    byEmail.forEach((d) => results.set(d.id, d.data() as ParticipantRecord));

    const byUid = await getDocs(
      query(collection(db, 'events', params.eventId, 'participants'), where('registeredByUid', '==', params.user.uid))
    );
    byUid.forEach((d) => results.set(d.id, d.data() as ParticipantRecord));

    return Array.from(results.values());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}
