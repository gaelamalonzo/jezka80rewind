# Security Specification & Payload-First TDD

## 1. Data Invariants
1. **Default Deny**: All unmatched paths are strictly denied (`allow read, write: if false`).
2. **Email Verification Mandate**: Every authenticated write requires `request.auth != null && request.auth.token.email_verified == true`.
3. **RBAC Isolation**: Role privileges (`admin`, `staff`) are strictly resolved server-side in Firestore Rules via `/staff_roles/$(request.auth.token.email)` and the bootstrapped owner email (`gaelamalonzo@gmail.com`). Users can never elevate their own role or write to `/staff_roles` unless already an Admin.
4. **Master Gate & Orphan Prevention**: A participant, attendance log, QR token, or audit log cannot exist without an existing parent `/events/{eventId}` verified via `exists()`.
5. **Single-Use Atomic Attendance**: Every check-in must atomically update `/events/{eventId}/participants/{participantId}` from `attendanceStatus == 'pending'` AND create `/events/{eventId}/attendance_logs/{participantId}` in the same transaction (`existsAfter()`). Duplicate check-ins fail unconditionally for Staff and Participants.
6. **PII Isolation**: Participant records (`email`, `mobile`, `fullName`) are strictly restricted on `get` and `list` to Admin, authorized Staff, or the matching verified owner (`email == request.auth.token.email || registeredByUid == request.auth.uid`).
7. **Shared QR Token Protection**: `/events/{eventId}/qr_tokens` cannot be listed by non-admins; participants can only validate a specific token if they already possess it from scanning the physical/displayed Shared Event QR AND `sharedQrEnabled == true`.
8. **Temporal Integrity & Immutability**: `createdAt`, `registrationDate`, `updatedAt`, `checkInAt`, and `checkedInAt` must equal `request.time`. `createdByUid`, `registeredByUid`, `eventId`, `id`, and `qrSecret` are immutable after creation.
9. **Append-Only Audit Trail**: `/events/{eventId}/audit_logs` cannot be updated or deleted by any client.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Event Creation**: `POST /events/evt1` with `request.auth == null`.
2. **Role Self-Elevation**: Non-admin authenticated user creates `/staff_roles/attacker@evil.com` with `role: "admin"`.
3. **Unverified Email Spoof**: User with `email: "gaelamalonzo@gmail.com"` and `email_verified: false` attempts admin write.
4. **Shadow Field Injection on Participant**: Valid participant create payload + extra ghost key `isVipOverride: true` (blocked by `keys().hasOnly`).
5. **1MB ID Resource Poisoning**: Creating `/events/<1500-char-string>` (blocked by `isValidId` size & regex).
6. **Orphaned Participant Creation**: Creating `/events/nonexistent_event/participants/P-123456` (blocked by `exists(parentEvent)`).
7. **Client Timestamp Forgery**: Creating a participant with `registrationDate` backdated by 3 days instead of `request.time`.
8. **Staff Privilege Escalation on Update**: Staff user updates `fullName` or `email` on a participant, or modifies `sharedQrEnabled` on an event.
9. **Duplicate Check-In Replay**: Staff or participant tries to update a participant whose `attendanceStatus` is already `'present'` back to `'present'` or overwrite `checkInAt`.
10. **Desynchronized Check-In (Missing Attendance Log)**: Staff updates `participant.attendanceStatus` to `'present'` outside a transaction without creating `/attendance_logs/{participantId}` (blocked by `existsAfter`).
11. **Shared QR Bypass When Disabled**: Participant attempts self-check-in via `shared_qr` when parent event `sharedQrEnabled == false` or using a fabricated `qrTokenUsed`.
12. **Audit Log Tampering / PII Scraping**: Non-staff user issues blanket `list` on `/events/{eventId}/participants` without filtering to own email/uid, or any user attempts `update`/`delete` on `/events/{eventId}/audit_logs/{logId}`.
