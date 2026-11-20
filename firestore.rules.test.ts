/**
 * Security Rules Verification Suite (Dirty Dozen Attack Payloads)
 * Reference specification matching security_spec.md and firestore.rules.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
  enforcedByRule: string;
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Event Creation',
    operation: 'create',
    path: '/events/evt_test_01',
    auth: null,
    payload: { id: 'evt_test_01', title: 'Rogue Event' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: 'isAdmin() -> isVerifiedUser() -> request.auth != null',
  },
  {
    id: 2,
    name: 'Role Self-Elevation',
    operation: 'create',
    path: '/staff_roles/attacker@company.com',
    auth: { uid: 'uid_attacker', email: 'attacker@company.com', email_verified: true },
    payload: {
      email: 'attacker@company.com',
      displayName: 'Attacker',
      role: 'admin',
      active: true,
      addedByEmail: 'attacker@company.com',
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: 'match /staff_roles/{emailKey} allow create: if isAdmin()',
  },
  {
    id: 3,
    name: 'Unverified Email Admin Spoof',
    operation: 'create',
    path: '/events/evt_spoof',
    auth: { uid: 'uid_spoof', email: 'gaelamalonzo@gmail.com', email_verified: false },
    payload: { id: 'evt_spoof', title: 'Spoofed Event' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: 'isVerifiedUser() requires request.auth.token.email_verified == true',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Participant',
    operation: 'create',
    path: '/events/evt_company_2026/participants/P-SHADOW1',
    auth: { uid: 'uid_user', email: 'user@company.com', email_verified: true },
    payload: {
      id: 'P-SHADOW1',
      eventId: 'evt_company_2026',
      fullName: 'Shadow User',
      email: 'user@company.com',
      mobile: '+15550101234',
      company: 'Acme Corp',
      position: 'Engineer',
      qrSecret: 'sec_12345678',
      registeredByUid: 'uid_user',
      registrationSource: 'online',
      attendanceStatus: 'pending',
      isVipOverride: true,
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidParticipant() data.keys().hasOnly([...])',
  },
  {
    id: 5,
    name: '1MB ID Resource Poisoning',
    operation: 'create',
    path: `/events/${'A'.repeat(1500)}`,
    auth: { uid: 'uid_admin', email: 'gaelamalonzo@gmail.com', email_verified: true },
    payload: { id: 'A'.repeat(1500), title: 'Poison Event' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidId(eventId) requires id.size() <= 128 and regex match',
  },
  {
    id: 6,
    name: 'Orphaned Participant Creation',
    operation: 'create',
    path: '/events/nonexistent_event/participants/P-ORPHAN1',
    auth: { uid: 'uid_user', email: 'user@company.com', email_verified: true },
    payload: { id: 'P-ORPHAN1', eventId: 'nonexistent_event', email: 'user@company.com' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: 'eventExists(eventId) -> exists(/events/$(eventId))',
  },
  {
    id: 7,
    name: 'Client Timestamp Forgery',
    operation: 'create',
    path: '/events/evt_company_2026/participants/P-TIME1',
    auth: { uid: 'uid_user', email: 'user@company.com', email_verified: true },
    payload: {
      id: 'P-TIME1',
      eventId: 'evt_company_2026',
      registrationDate: '2020-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: 'incoming().registrationDate == request.time',
  },
  {
    id: 8,
    name: 'Staff Privilege Escalation on Participant PII',
    operation: 'update',
    path: '/events/evt_company_2026/participants/P-100001',
    auth: { uid: 'uid_staff', email: 'staff@company.com', email_verified: true },
    payload: { fullName: 'Tampered Name', email: 'tampered@company.com' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: 'Staff Tier 2A affectedKeys().hasOnly([attendanceStatus, checkInAt, ...])',
  },
  {
    id: 9,
    name: 'Duplicate Check-In Replay',
    operation: 'update',
    path: '/events/evt_company_2026/participants/P-ALREADY-IN',
    auth: { uid: 'uid_staff', email: 'staff@company.com', email_verified: true },
    payload: { attendanceStatus: 'present', checkInMethod: 'individual_qr' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: "existing().attendanceStatus == 'pending' required for non-admin check-in",
  },
  {
    id: 10,
    name: 'Desynchronized Check-In Missing Attendance Log',
    operation: 'update',
    path: '/events/evt_company_2026/participants/P-100002',
    auth: { uid: 'uid_staff', email: 'staff@company.com', email_verified: true },
    payload: { attendanceStatus: 'present', checkInMethod: 'individual_qr' },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: 'existsAfter(/events/$(eventId)/attendance_logs/$(participantId))',
  },
  {
    id: 11,
    name: 'Shared QR Bypass When Disabled or Invalid Token',
    operation: 'create',
    path: '/events/evt_company_2026/attendance_logs/P-100003',
    auth: { uid: 'uid_user', email: 'user@company.com', email_verified: true },
    payload: {
      participantId: 'P-100003',
      eventId: 'evt_company_2026',
      method: 'shared_qr',
      qrTokenUsed: 'FAKE_TOKEN_12345',
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: 'getEventData(eventId).sharedQrEnabled == true && exists(qr_tokens/qrTokenUsed)',
  },
  {
    id: 12,
    name: 'Audit Log Deletion or Tampering',
    operation: 'delete',
    path: '/events/evt_company_2026/audit_logs/LOG-001',
    auth: { uid: 'uid_admin', email: 'gaelamalonzo@gmail.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
    enforcedByRule: 'match /audit_logs/{logId} allow update: if false; allow delete: if false;',
  },
];
