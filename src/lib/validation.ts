import type { EventRecord, QrTicketPayload } from '../types';

/**
 * Verbatim validation constants synchronized with firebase-blueprint.json & firestore.rules.
 */
export const CONSTRAINTS = {
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  EMAIL_PATTERN: /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/,
  DATE_PATTERN: /^\d{4}-\d{2}-\d{2}$/,
  TIME_PATTERN: /^\d{2}:\d{2}$/,

  EVENT: {
    ID_MIN: 2,
    ID_MAX: 64,
    TITLE_MIN: 2,
    TITLE_MAX: 120,
    DESC_MAX: 500,
    VENUE_MIN: 2,
    VENUE_MAX: 150,
    LATE_MIN: 0,
    LATE_MAX: 480,
    CAPACITY_MIN: 1,
    CAPACITY_MAX: 10000,
  },
  PARTICIPANT: {
    ID_MIN: 6,
    ID_MAX: 64,
    NAME_MIN: 2,
    NAME_MAX: 100,
    EMAIL_MIN: 5,
    EMAIL_MAX: 120,
    MOBILE_MIN: 6,
    MOBILE_MAX: 25,
    COMPANY_MIN: 1,
    COMPANY_MAX: 100,
    POSITION_MIN: 1,
    POSITION_MAX: 100,
    SECRET_MIN: 8,
    SECRET_MAX: 64,
    NOTES_MAX: 300,
  },
  STAFF: {
    NAME_MIN: 1,
    NAME_MAX: 100,
    EMAIL_MIN: 5,
    EMAIL_MAX: 120,
  },
  QR_TOKEN: {
    MIN: 12,
    MAX: 64,
  },
  AUDIT: {
    TARGET_LABEL_MAX: 160,
    DETAILS_MAX: 500,
  },
} as const;

export const BOOTSTRAPPED_ADMIN_EMAIL = 'gaelamalonzo@gmail.com';

export function sanitizeText(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

export function sanitizeEmail(value: string): string {
  return value.trim().toLowerCase().slice(0, CONSTRAINTS.PARTICIPANT.EMAIL_MAX);
}

export function generateRandomCode(length: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[array[i] % chars.length];
  }
  return out;
}

export function generateParticipantId(): string {
  return `EVT-${generateRandomCode(6)}`;
}

export function generateQrSecret(): string {
  return `sec_${generateRandomCode(16)}`;
}

export function generateSharedQrToken(): string {
  return `SQ_${generateRandomCode(20)}`;
}

export function generateEventId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const suffix = generateRandomCode(6).toLowerCase();
  const raw = slug ? `${slug}-${suffix}` : `event-${suffix}`;
  return raw.slice(0, CONSTRAINTS.EVENT.ID_MAX);
}

export function generateLogId(): string {
  return `log_${Date.now()}_${generateRandomCode(6)}`;
}

export function validateParticipantInput(input: {
  fullName: string;
  email: string;
  mobile: string;
  company: string;
  position: string;
}): string | null {
  const name = sanitizeText(input.fullName, CONSTRAINTS.PARTICIPANT.NAME_MAX);
  const email = sanitizeEmail(input.email);
  const mobile = sanitizeText(input.mobile, CONSTRAINTS.PARTICIPANT.MOBILE_MAX);
  const company = sanitizeText(input.company, CONSTRAINTS.PARTICIPANT.COMPANY_MAX);
  const position = sanitizeText(input.position, CONSTRAINTS.PARTICIPANT.POSITION_MAX);

  if (name.length < CONSTRAINTS.PARTICIPANT.NAME_MIN) {
    return 'Full name must be at least 2 characters.';
  }
  if (!CONSTRAINTS.EMAIL_PATTERN.test(email)) {
    return 'Please provide a valid email address.';
  }
  if (mobile.length < CONSTRAINTS.PARTICIPANT.MOBILE_MIN) {
    return 'Mobile number must be at least 6 characters.';
  }
  if (company.length < CONSTRAINTS.PARTICIPANT.COMPANY_MIN) {
    return 'Company / Department is required.';
  }
  if (position.length < CONSTRAINTS.PARTICIPANT.POSITION_MIN) {
    return 'Position / Role is required.';
  }
  return null;
}

export function validateEventInput(input: {
  title: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  lateCutoffMinutes: number;
  venue: string;
  capacity: number;
}): string | null {
  if (sanitizeText(input.title, CONSTRAINTS.EVENT.TITLE_MAX).length < CONSTRAINTS.EVENT.TITLE_MIN) {
    return 'Event title must be at least 2 characters.';
  }
  if (!CONSTRAINTS.DATE_PATTERN.test(input.eventDate)) {
    return 'Event date must follow YYYY-MM-DD format.';
  }
  if (!CONSTRAINTS.TIME_PATTERN.test(input.startTime) || !CONSTRAINTS.TIME_PATTERN.test(input.endTime)) {
    return 'Start and end times must follow HH:MM format.';
  }
  if (
    !Number.isInteger(input.lateCutoffMinutes) ||
    input.lateCutoffMinutes < CONSTRAINTS.EVENT.LATE_MIN ||
    input.lateCutoffMinutes > CONSTRAINTS.EVENT.LATE_MAX
  ) {
    return 'Late cutoff must be between 0 and 480 minutes.';
  }
  if (sanitizeText(input.venue, CONSTRAINTS.EVENT.VENUE_MAX).length < CONSTRAINTS.EVENT.VENUE_MIN) {
    return 'Venue must be at least 2 characters.';
  }
  if (
    !Number.isInteger(input.capacity) ||
    input.capacity < CONSTRAINTS.EVENT.CAPACITY_MIN ||
    input.capacity > CONSTRAINTS.EVENT.CAPACITY_MAX
  ) {
    return 'Capacity must be between 1 and 10,000 participants.';
  }
  return null;
}

export function computeAttendanceStatus(event: EventRecord, now: Date = new Date()): 'present' | 'late' {
  const [year, month, day] = event.eventDate.split('-').map(Number);
  const [hour, minute] = event.startTime.split(':').map(Number);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    return 'present';
  }
  const eventStart = new Date(year, month - 1, day, hour, minute, 0, 0);
  const cutoffMs = eventStart.getTime() + event.lateCutoffMinutes * 60 * 1000;
  return now.getTime() > cutoffMs ? 'late' : 'present';
}

export function encodeParticipantQrPayload(payload: QrTicketPayload): string {
  return JSON.stringify(payload);
}

export function parseScannedQrText(raw: string): {
  participantId: string;
  eventId?: string;
  qrSecret?: string;
} | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<QrTicketPayload>;
      if (parsed.t === 'EAS_TICKET' && typeof parsed.p === 'string') {
        return {
          participantId: parsed.p.trim(),
          eventId: typeof parsed.e === 'string' ? parsed.e.trim() : undefined,
          qrSecret: typeof parsed.k === 'string' ? parsed.k.trim() : undefined,
        };
      }
    } catch {
      // fall through to URL / raw ID parsing
    }
  }

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const url = new URL(trimmed);
      const p = url.searchParams.get('ticket') || url.searchParams.get('p');
      const e = url.searchParams.get('event') || url.searchParams.get('e') || undefined;
      const k = url.searchParams.get('k') || undefined;
      if (p) {
        return { participantId: p.trim(), eventId: e?.trim(), qrSecret: k?.trim() };
      }
    }
  } catch {
    // ignore URL parse error
  }

  if (CONSTRAINTS.ID_PATTERN.test(trimmed) && trimmed.length >= CONSTRAINTS.PARTICIPANT.ID_MIN) {
    return { participantId: trimmed };
  }

  return null;
}

export function formatTimestamp(ts: { toDate: () => Date } | null | undefined): string {
  if (!ts) return '—';
  const d = ts.toDate();
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatTimeOnly(ts: { toDate: () => Date } | null | undefined): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
