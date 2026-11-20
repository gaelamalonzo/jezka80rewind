import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Persistent signing secret for Bearer tokens
const SECRET_FILE = path.join(DATA_DIR, '.session_secret');
let SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  if (fs.existsSync(SECRET_FILE)) {
    SESSION_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } else {
    SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, SESSION_SECRET, { mode: 0o600 });
  }
}

// Initialize SQLite Database
const db = new DatabaseSync(path.join(DATA_DIR, 'attendance.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'staff')),
    active INTEGER NOT NULL DEFAULT 1,
    added_by_email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    late_cutoff_minutes INTEGER NOT NULL DEFAULT 15,
    venue TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 800,
    status TEXT NOT NULL CHECK(status IN ('upcoming', 'active', 'completed', 'archived')),
    shared_qr_enabled INTEGER NOT NULL DEFAULT 1,
    registration_open INTEGER NOT NULL DEFAULT 1,
    created_by_uid TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qr_tokens (
    token TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 1,
    created_by_uid TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL DEFAULT '',
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    mobile TEXT NOT NULL,
    company TEXT NOT NULL,
    position TEXT NOT NULL,
    qr_secret TEXT NOT NULL,
    registered_by_uid TEXT NOT NULL,
    registration_source TEXT NOT NULL CHECK(registration_source IN ('online', 'admin_manual', 'bulk_import')),
    registration_date TEXT NOT NULL,
    attendance_status TEXT NOT NULL CHECK(attendance_status IN ('pending', 'present', 'late', 'absent')),
    check_in_at TEXT,
    check_in_method TEXT NOT NULL CHECK(check_in_method IN ('individual_qr', 'shared_qr', 'manual_staff', 'admin_override', 'none')),
    checked_in_by_uid TEXT NOT NULL DEFAULT '',
    checked_in_by_email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id);
  CREATE INDEX IF NOT EXISTS idx_participants_email ON participants(event_id, email);

  CREATE TABLE IF NOT EXISTS attendance_logs (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    participant_name TEXT NOT NULL,
    company TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('present', 'late')),
    method TEXT NOT NULL CHECK(method IN ('individual_qr', 'shared_qr', 'manual_staff', 'admin_override')),
    qr_token_used TEXT NOT NULL DEFAULT '',
    checked_in_by_uid TEXT NOT NULL,
    checked_in_by_email TEXT NOT NULL,
    checked_in_at TEXT NOT NULL,
    PRIMARY KEY (event_id, participant_id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    actor_uid TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_label TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_id, created_at DESC);
`);

// Safe migration for existing databases created before employee_id was added
const participantCols = db.prepare('PRAGMA table_info(participants)').all() as Array<{ name: string }>;
if (!participantCols.some((c) => c.name === 'employee_id')) {
  db.exec("ALTER TABLE participants ADD COLUMN employee_id TEXT NOT NULL DEFAULT '';");
}
db.exec('CREATE INDEX IF NOT EXISTS idx_participants_emp ON participants(event_id, employee_id);');

// Optional environment-driven admin bootstrap (never hardcodes passwords in source)
const envAdminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const envAdminPass = process.env.ADMIN_PASS || '';
if (envAdminEmail && envAdminPass.length >= 8) {
  const existing = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (existing.c === 0) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, role, active, added_by_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', 1, ?, ?, ?)`
    ).run(
      `usr_${crypto.randomBytes(6).toString('hex')}`,
      envAdminEmail,
      'Event Administrator',
      hashPassword(envAdminPass),
      envAdminEmail,
      now,
      now
    );
  }
}

// ---------------------------------------------------------------------------
// Crypto & Auth Helpers
// ---------------------------------------------------------------------------
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

interface SessionUser {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'staff';
}

function signToken(user: SessionUser): string {
  const payload = Buffer.from(
    JSON.stringify({
      ...user,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token: string): SessionUser | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionUser & {
      exp: number;
    };
    if (!decoded.exp || Date.now() > decoded.exp) return null;
    // Verify user still exists and is active in SQLite
    const row = db
      .prepare('SELECT id, email, display_name, role, active FROM users WHERE id = ?')
      .get(decoded.uid) as
      | { id: string; email: string; display_name: string; role: 'admin' | 'staff'; active: number }
      | undefined;
    if (!row || row.active !== 1) return null;
    return {
      uid: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    };
  } catch {
    return null;
  }
}

function randomCode(len: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function generateParticipantId(): string {
  return `EVT-${randomCode(6)}`;
}

function resolveParticipantId(employeeId: string, useEmployeeIdAsId: boolean): string {
  if (useEmployeeIdAsId && employeeId) {
    const candidate = employeeId.trim().replace(/\s+/g, '-').slice(0, 64);
    if (/^[a-zA-Z0-9_.\-]{2,64}$/.test(candidate)) {
      const exists = db.prepare('SELECT 1 FROM participants WHERE id = ?').get(candidate);
      if (!exists) return candidate;
    }
  }
  return generateParticipantId();
}

function generateQrSecret(): string {
  return `sec_${randomCode(16)}`;
}

function generateSharedToken(): string {
  return `SQ_${randomCode(20)}`;
}

function generateLogId(): string {
  return `log_${Date.now()}_${randomCode(6)}`;
}

function generateEventId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const suffix = randomCode(6).toLowerCase();
  return (slug ? `${slug}-${suffix}` : `event-${suffix}`).slice(0, 64);
}

function computeAttendanceStatus(eventDate: string, startTime: string, lateCutoffMinutes: number): 'present' | 'late' {
  const [y, m, d] = eventDate.split('-').map(Number);
  const [hh, mm] = startTime.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return 'present';
  const start = new Date(y, m - 1, d, hh, mm, 0, 0);
  const cutoffMs = start.getTime() + lateCutoffMinutes * 60 * 1000;
  return Date.now() > cutoffMs ? 'late' : 'present';
}

// ---------------------------------------------------------------------------
// SSE Real-time Broadcast Registry
// ---------------------------------------------------------------------------
const sseClients = new Map<string, Set<Response>>();

function broadcastUpdate(eventId: string, type: string) {
  const targets = [sseClients.get(eventId), sseClients.get('*')];
  const payload = `data: ${JSON.stringify({ eventId, type, ts: Date.now() })}\n\n`;
  for (const set of targets) {
    if (!set) continue;
    for (const res of set) {
      res.write(payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Row Mappers
// ---------------------------------------------------------------------------
function mapEvent(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description || ''),
    eventDate: String(row.event_date),
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    lateCutoffMinutes: Number(row.late_cutoff_minutes),
    venue: String(row.venue),
    capacity: Number(row.capacity),
    status: String(row.status),
    sharedQrEnabled: Boolean(row.shared_qr_enabled),
    registrationOpen: Boolean(row.registration_open),
    createdByUid: String(row.created_by_uid),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapParticipant(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    employeeId: String(row.employee_id || ''),
    eventId: String(row.event_id),
    fullName: String(row.full_name),
    email: String(row.email),
    mobile: String(row.mobile),
    company: String(row.company),
    position: String(row.position),
    qrSecret: String(row.qr_secret),
    registeredByUid: String(row.registered_by_uid),
    registrationSource: String(row.registration_source),
    registrationDate: String(row.registration_date),
    attendanceStatus: String(row.attendance_status),
    checkInAt: row.check_in_at ? String(row.check_in_at) : null,
    checkInMethod: String(row.check_in_method),
    checkedInByUid: String(row.checked_in_by_uid || ''),
    checkedInByEmail: String(row.checked_in_by_email || ''),
    notes: String(row.notes || ''),
    updatedAt: String(row.updated_at),
  };
}

function mapAuditLog(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    action: String(row.action),
    actorUid: String(row.actor_uid),
    actorEmail: String(row.actor_email),
    actorRole: String(row.actor_role),
    targetId: String(row.target_id),
    targetLabel: String(row.target_label),
    details: String(row.details),
    createdAt: String(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Express App & Middlewares
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '5mb' }));

interface AuthedRequest extends Request {
  authUser?: SessionUser;
}

function requireStaff(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  req.authUser = user;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  requireStaff(req, res, () => {
    if (req.authUser?.role !== 'admin') {
      res.status(403).json({ error: 'Administrator privileges required.' });
      return;
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// Auth Routes
// ---------------------------------------------------------------------------
app.get('/api/auth/status', (req: AuthedRequest, res: Response) => {
  const countRow = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  const needsBootstrap = countRow.c === 0;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? verifyToken(token) : null;
  res.json({ needsBootstrap, user });
});

app.post('/api/auth/bootstrap', (req: Request, res: Response) => {
  const countRow = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (countRow.c > 0) {
    res.status(409).json({ error: 'Administrator already initialized. Please sign in.' });
    return;
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const displayName = String(req.body?.displayName || 'Event Administrator').trim().slice(0, 100);
  const password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Valid administrator email is required.' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }

  const now = new Date().toISOString();
  const uid = `usr_${crypto.randomBytes(6).toString('hex')}`;
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, role, active, added_by_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', 1, ?, ?, ?)`
  ).run(uid, email, displayName, hashPassword(password), email, now, now);

  const user: SessionUser = { uid, email, displayName, role: 'admin' };
  res.json({ token: signToken(user), user });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const row = db
    .prepare('SELECT id, email, display_name, password_hash, role, active FROM users WHERE email = ?')
    .get(email) as
    | {
        id: string;
        email: string;
        display_name: string;
        password_hash: string;
        role: 'admin' | 'staff';
        active: number;
      }
    | undefined;

  if (!row || !verifyPassword(password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  if (row.active !== 1) {
    res.status(403).json({ error: 'This staff account has been suspended by an administrator.' });
    return;
  }
  const user: SessionUser = {
    uid: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
  res.json({ token: signToken(user), user });
});

// ---------------------------------------------------------------------------
// Staff Management Routes (Admin)
// ---------------------------------------------------------------------------
app.get('/api/staff', requireAdmin, (_req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(
      'SELECT email, display_name, role, active, added_by_email, created_at, updated_at FROM users ORDER BY created_at DESC'
    )
    .all() as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => ({
      email: String(r.email),
      displayName: String(r.display_name),
      role: String(r.role),
      active: Boolean(r.active),
      addedByEmail: String(r.added_by_email),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }))
  );
});

app.post('/api/staff', requireAdmin, (req: AuthedRequest, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const displayName = String(req.body?.displayName || '').trim().slice(0, 100);
  const role = req.body?.role === 'admin' ? 'admin' : 'staff';
  const active = req.body?.active !== false ? 1 : 0;
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const eventIdForAudit = typeof req.body?.eventIdForAudit === 'string' ? req.body.eventIdForAudit : '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !displayName) {
    res.status(400).json({ error: 'Valid email and display name are required.' });
    return;
  }

  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;

  if (existing) {
    if (password && password.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }
    if (password) {
      db.prepare(
        `UPDATE users SET display_name = ?, role = ?, active = ?, password_hash = ?, added_by_email = ?, updated_at = ? WHERE email = ?`
      ).run(displayName, role, active, hashPassword(password), req.authUser!.email, now, email);
    } else {
      db.prepare(
        `UPDATE users SET display_name = ?, role = ?, active = ?, added_by_email = ?, updated_at = ? WHERE email = ?`
      ).run(displayName, role, active, req.authUser!.email, now, email);
    }
  } else {
    if (password.length < 8) {
      res.status(400).json({ error: 'Password (min 8 characters) is required for new staff accounts.' });
      return;
    }
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, role, active, added_by_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `usr_${crypto.randomBytes(6).toString('hex')}`,
      email,
      displayName,
      hashPassword(password),
      role,
      active,
      req.authUser!.email,
      now,
      now
    );
  }

  if (eventIdForAudit) {
    const ev = db.prepare('SELECT id FROM events WHERE id = ?').get(eventIdForAudit);
    if (ev) {
      db.prepare(
        `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
         VALUES (?, ?, 'staff_role_updated', ?, ?, 'admin', ?, ?, ?, ?)`
      ).run(
        generateLogId(),
        eventIdForAudit,
        req.authUser!.uid,
        req.authUser!.email,
        email,
        displayName,
        `Set ${email} role to ${role.toUpperCase()} (${active ? 'Active' : 'Suspended'}).`,
        now
      );
    }
  }

  res.json({ ok: true });
});

app.delete('/api/staff/:email', requireAdmin, (req: AuthedRequest, res: Response) => {
  const email = decodeURIComponent(req.params.email).trim().toLowerCase();
  if (email === req.authUser!.email) {
    res.status(400).json({ error: 'You cannot delete your own signed-in administrator account.' });
    return;
  }
  const admins = db
    .prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND active = 1 AND email != ?")
    .get(email) as { c: number };
  if (admins.c === 0) {
    res.status(400).json({ error: 'At least one active administrator account must remain.' });
    return;
  }
  db.prepare('DELETE FROM users WHERE email = ?').run(email);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Public Event, Registration & Mobile Self-Check-In Routes
// ---------------------------------------------------------------------------
app.get('/api/events/public', (_req: Request, res: Response) => {
  const rows = db
    .prepare("SELECT * FROM events WHERE status IN ('upcoming', 'active') ORDER BY event_date DESC")
    .all() as Array<Record<string, unknown>>;
  res.json(rows.map(mapEvent));
});

app.get('/api/events/public/:eventId', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.eventId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Event not found.' });
    return;
  }
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let tokenValid = false;
  if (token) {
    const tRow = db
      .prepare('SELECT active FROM qr_tokens WHERE event_id = ? AND token = ?')
      .get(req.params.eventId, token) as { active: number } | undefined;
    tokenValid = Boolean(tRow && tRow.active === 1);
  }
  res.json({ event: mapEvent(row), tokenValid });
});

app.get('/api/public/ticket', (req: Request, res: Response) => {
  const eventId = typeof req.query.eventId === 'string' ? req.query.eventId.trim() : '';
  const participantId = typeof req.query.participantId === 'string' ? req.query.participantId.trim() : '';
  if (!eventId || !participantId) {
    res.status(400).json({ error: 'Event ID and Participant ID are required.' });
    return;
  }
  const evRow = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
    | Record<string, unknown>
    | undefined;
  const pRow = db
    .prepare('SELECT * FROM participants WHERE event_id = ? AND id = ?')
    .get(eventId, participantId) as Record<string, unknown> | undefined;
  if (!evRow || !pRow) {
    res.status(404).json({ error: 'Ticket not found.' });
    return;
  }
  res.json({ event: mapEvent(evRow), participant: mapParticipant(pRow) });
});

app.post('/api/public/register', (req: Request, res: Response) => {
  const eventId = String(req.body?.eventId || '').trim();
  const employeeId = String(req.body?.employeeId || '').trim().slice(0, 64);
  const useEmployeeIdAsId = req.body?.useEmployeeIdAsId !== false;
  const fullName = String(req.body?.fullName || '').trim().slice(0, 100);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 120);
  const mobile = String(req.body?.mobile || '').trim().slice(0, 25);
  const company = String(req.body?.company || '').trim().slice(0, 100);
  const position = String(req.body?.position || '').trim().slice(0, 100);

  if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || mobile.length < 6 || !company || !position) {
    res.status(400).json({ error: 'Please complete all required registration fields.' });
    return;
  }

  const evRow = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
    | Record<string, unknown>
    | undefined;
  if (!evRow) {
    res.status(404).json({ error: 'Selected event not found.' });
    return;
  }
  if (!evRow.registration_open || !['upcoming', 'active'].includes(String(evRow.status))) {
    res.status(403).json({ error: 'Online registration is currently closed for this event.' });
    return;
  }

  const qrSecret = generateQrSecret();
  const now = new Date().toISOString();
  let participantId = '';

  db.exec('BEGIN IMMEDIATE');
  try {
    participantId = resolveParticipantId(employeeId, useEmployeeIdAsId);
    db.prepare(
      `INSERT INTO participants (
        id, employee_id, event_id, full_name, email, mobile, company, position, qr_secret,
        registered_by_uid, registration_source, registration_date, attendance_status,
        check_in_at, check_in_method, checked_in_by_uid, checked_in_by_email, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', 'online', ?, 'pending', NULL, 'none', '', '', '', ?)`
    ).run(participantId, employeeId, eventId, fullName, email, mobile, company, position, qrSecret, now, now);

    db.prepare(
      `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
       VALUES (?, ?, 'participant_registered', 'public', ?, 'participant', ?, ?, ?, ?)`
    ).run(
      generateLogId(),
      eventId,
      email,
      participantId,
      `${fullName} (${email})`,
      `Registered online for ${String(evRow.title)}${employeeId ? ` [Emp ID: ${employeeId}]` : ''}.`,
      now
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const pRow = db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId) as Record<string, unknown>;
  broadcastUpdate(eventId, 'participant_registered');
  res.json({ participant: mapParticipant(pRow), event: mapEvent(evRow) });
});

app.post('/api/public/self-checkin', (req: Request, res: Response) => {
  const eventId = String(req.body?.eventId || '').trim();
  const token = String(req.body?.token || '').trim();
  const identifier = String(req.body?.identifier || '').trim().toLowerCase();
  const verifyValue = String(req.body?.verifyValue || '').trim().toLowerCase();

  if (!eventId || !token || !identifier || !verifyValue) {
    res.status(400).json({ error: 'Provide your registered Email or Participant ID and verification detail.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const evRow = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | Record<string, unknown>
      | undefined;
    if (!evRow) {
      db.exec('ROLLBACK');
      res.status(404).json({ error: 'Event not found.' });
      return;
    }
    if (!evRow.shared_qr_enabled || evRow.status !== 'active') {
      db.exec('ROLLBACK');
      res.status(403).json({ error: 'Shared Event QR self-check-in is disabled or event is not active.' });
      return;
    }

    const tokRow = db
      .prepare('SELECT active FROM qr_tokens WHERE event_id = ? AND token = ?')
      .get(eventId, token) as { active: number } | undefined;
    if (!tokRow || tokRow.active !== 1) {
      db.exec('ROLLBACK');
      res.status(403).json({ error: 'This Shared Event QR token has expired or been rotated.' });
      return;
    }

    const pRow = db
      .prepare(
        `SELECT * FROM participants
         WHERE event_id = ?
           AND (LOWER(id) = ? OR LOWER(email) = ? OR (employee_id != '' AND LOWER(employee_id) = ?))
         LIMIT 1`
      )
      .get(eventId, identifier, identifier, identifier) as Record<string, unknown> | undefined;

    if (!pRow) {
      db.exec('ROLLBACK');
      res.status(404).json({ error: 'No registration found matching that Email, Employee ID No., or Participant ID.' });
      return;
    }

    const pId = String(pRow.id);
    const pEmpId = String(pRow.employee_id || '').toLowerCase();
    const pMobileDigits = String(pRow.mobile).replace(/\D/g, '');
    const vDigits = verifyValue.replace(/\D/g, '');
    const idMatched = pId.toLowerCase() === verifyValue || (pEmpId !== '' && pEmpId === verifyValue);
    const mobileMatched = vDigits.length >= 4 && pMobileDigits.endsWith(vDigits);

    if (!idMatched && !mobileMatched) {
      db.exec('ROLLBACK');
      res.status(403).json({
        error: 'Identity verification failed: Employee ID No., Participant ID, or Mobile digits did not match.',
      });
      return;
    }

    const existingLog = db
      .prepare('SELECT checked_in_at FROM attendance_logs WHERE event_id = ? AND participant_id = ?')
      .get(eventId, pId) as { checked_in_at: string } | undefined;

    if (pRow.attendance_status !== 'pending' || existingLog) {
      db.exec('ROLLBACK');
      res.status(409).json({
        code: 'DUPLICATE',
        error: `Duplicate check-in rejected: ${String(pRow.full_name)} already checked in (${String(pRow.attendance_status).toUpperCase()}).`,
        participant: mapParticipant(pRow),
      });
      return;
    }

    const assignedStatus = computeAttendanceStatus(
      String(evRow.event_date),
      String(evRow.start_time),
      Number(evRow.late_cutoff_minutes)
    );
    const now = new Date().toISOString();
    const pEmail = String(pRow.email);

    db.prepare(
      `INSERT INTO attendance_logs (
        event_id, participant_id, participant_name, company, status, method,
        qr_token_used, checked_in_by_uid, checked_in_by_email, checked_in_at
      ) VALUES (?, ?, ?, ?, ?, 'shared_qr', ?, 'self', ?, ?)`
    ).run(eventId, pId, String(pRow.full_name), String(pRow.company), assignedStatus, token, pEmail, now);

    db.prepare(
      `UPDATE participants
       SET attendance_status = ?, check_in_at = ?, check_in_method = 'shared_qr',
           checked_in_by_uid = 'self', checked_in_by_email = ?, updated_at = ?
       WHERE id = ? AND event_id = ?`
    ).run(assignedStatus, now, pEmail, now, pId, eventId);

    db.prepare(
      `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
       VALUES (?, ?, 'checkin_shared_qr', 'self', ?, 'participant', ?, ?, ?, ?)`
    ).run(
      generateLogId(),
      eventId,
      pEmail,
      pId,
      String(pRow.full_name),
      `Self-checked in as ${assignedStatus.toUpperCase()} via Shared Event QR.`,
      now
    );

    db.exec('COMMIT');

    const updated = db.prepare('SELECT * FROM participants WHERE id = ?').get(pId) as Record<string, unknown>;
    broadcastUpdate(eventId, 'checkin_shared_qr');
    res.json({
      ok: true,
      assignedStatus,
      message: `Check-in confirmed for ${String(pRow.full_name)} (${assignedStatus === 'late' ? 'Late Arrival' : 'On Time'}).`,
      participant: mapParticipant(updated),
    });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // already rolled back
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Authenticated Admin & Staff Routes
// ---------------------------------------------------------------------------
app.get('/api/events', requireStaff, (_req: AuthedRequest, res: Response) => {
  const rows = db.prepare('SELECT * FROM events ORDER BY event_date DESC, created_at DESC').all() as Array<
    Record<string, unknown>
  >;
  res.json(rows.map(mapEvent));
});

app.post('/api/events', requireAdmin, (req: AuthedRequest, res: Response) => {
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const description = String(req.body?.description || '').trim().slice(0, 500);
  const eventDate = String(req.body?.eventDate || '').trim();
  const startTime = String(req.body?.startTime || '').trim();
  const endTime = String(req.body?.endTime || '').trim();
  const lateCutoffMinutes = Number(req.body?.lateCutoffMinutes ?? 15);
  const venue = String(req.body?.venue || '').trim().slice(0, 150);
  const capacity = Number(req.body?.capacity ?? 800);
  const status = ['upcoming', 'active', 'completed', 'archived'].includes(req.body?.status)
    ? req.body.status
    : 'active';
  const sharedQrEnabled = req.body?.sharedQrEnabled !== false ? 1 : 0;
  const registrationOpen = req.body?.registrationOpen !== false ? 1 : 0;

  if (title.length < 2 || venue.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    res.status(400).json({ error: 'Invalid event title, date, or venue.' });
    return;
  }

  const eventId = generateEventId(title);
  const sharedToken = generateSharedToken();
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO events (
        id, title, description, event_date, start_time, end_time, late_cutoff_minutes,
        venue, capacity, status, shared_qr_enabled, registration_open, created_by_uid, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId,
      title,
      description,
      eventDate,
      startTime,
      endTime,
      lateCutoffMinutes,
      venue,
      capacity,
      status,
      sharedQrEnabled,
      registrationOpen,
      req.authUser!.uid,
      now,
      now
    );

    db.prepare(
      `INSERT INTO qr_tokens (token, event_id, active, created_by_uid, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    ).run(sharedToken, eventId, req.authUser!.uid, now, now);

    db.prepare(
      `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
       VALUES (?, ?, 'event_created', ?, ?, 'admin', ?, ?, ?, ?)`
    ).run(
      generateLogId(),
      eventId,
      req.authUser!.uid,
      req.authUser!.email,
      eventId,
      title,
      `Created event on ${eventDate} (${startTime}-${endTime}) at ${venue}.`,
      now
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastUpdate('*', 'event_created');
  res.json({ eventId, sharedToken });
});

app.patch('/api/events/:eventId', requireAdmin, (req: AuthedRequest, res: Response) => {
  const eventId = req.params.eventId;
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Event not found.' });
    return;
  }

  const title = String(req.body?.title ?? existing.title).trim().slice(0, 120);
  const description = String(req.body?.description ?? existing.description).trim().slice(0, 500);
  const eventDate = String(req.body?.eventDate ?? existing.event_date).trim();
  const startTime = String(req.body?.startTime ?? existing.start_time).trim();
  const endTime = String(req.body?.endTime ?? existing.end_time).trim();
  const lateCutoffMinutes = Number(req.body?.lateCutoffMinutes ?? existing.late_cutoff_minutes);
  const venue = String(req.body?.venue ?? existing.venue).trim().slice(0, 150);
  const capacity = Number(req.body?.capacity ?? existing.capacity);
  const status = String(req.body?.status ?? existing.status);
  const sharedQrEnabled =
    req.body?.sharedQrEnabled !== undefined ? (req.body.sharedQrEnabled ? 1 : 0) : Number(existing.shared_qr_enabled);
  const registrationOpen =
    req.body?.registrationOpen !== undefined ? (req.body.registrationOpen ? 1 : 0) : Number(existing.registration_open);
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE events
     SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?,
         late_cutoff_minutes = ?, venue = ?, capacity = ?, status = ?,
         shared_qr_enabled = ?, registration_open = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    title,
    description,
    eventDate,
    startTime,
    endTime,
    lateCutoffMinutes,
    venue,
    capacity,
    status,
    sharedQrEnabled,
    registrationOpen,
    now,
    eventId
  );

  db.prepare(
    `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
     VALUES (?, ?, 'event_updated', ?, ?, 'admin', ?, ?, ?, ?)`
  ).run(
    generateLogId(),
    eventId,
    req.authUser!.uid,
    req.authUser!.email,
    eventId,
    title,
    `Updated event configuration (Status: ${status}, Shared QR: ${sharedQrEnabled ? 'Enabled' : 'Disabled'}).`,
    now
  );

  broadcastUpdate(eventId, 'event_updated');
  res.json({ ok: true });
});

app.get('/api/events/:eventId/qr-tokens', requireAdmin, (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare('SELECT * FROM qr_tokens WHERE event_id = ? AND active = 1 ORDER BY created_at DESC')
    .all(req.params.eventId) as Array<Record<string, unknown>>;
  res.json(
    rows.map((r) => ({
      token: String(r.token),
      eventId: String(r.event_id),
      active: Boolean(r.active),
      createdByUid: String(r.created_by_uid),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }))
  );
});

app.post('/api/events/:eventId/qr-tokens/rotate', requireAdmin, (req: AuthedRequest, res: Response) => {
  const eventId = req.params.eventId;
  const evRow = db.prepare('SELECT title FROM events WHERE id = ?').get(eventId) as { title: string } | undefined;
  if (!evRow) {
    res.status(404).json({ error: 'Event not found.' });
    return;
  }
  const newToken = generateSharedToken();
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE qr_tokens SET active = 0, updated_at = ? WHERE event_id = ?').run(now, eventId);
    db.prepare(
      `INSERT INTO qr_tokens (token, event_id, active, created_by_uid, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    ).run(newToken, eventId, req.authUser!.uid, now, now);

    db.prepare(
      `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
       VALUES (?, ?, 'shared_qr_toggled', ?, ?, 'admin', ?, ?, 'Rotated Shared Event QR token; previous tokens deactivated.', ?)`
    ).run(generateLogId(), eventId, req.authUser!.uid, req.authUser!.email, newToken, evRow.title, now);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastUpdate(eventId, 'qr_token_rotated');
  res.json({ token: newToken });
});

app.get('/api/events/:eventId/participants', requireStaff, (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare('SELECT * FROM participants WHERE event_id = ? ORDER BY registration_date DESC')
    .all(req.params.eventId) as Array<Record<string, unknown>>;
  res.json(rows.map(mapParticipant));
});

app.post('/api/events/:eventId/participants', requireStaff, (req: AuthedRequest, res: Response) => {
  const eventId = req.params.eventId;
  const evRow = db.prepare('SELECT title FROM events WHERE id = ?').get(eventId) as { title: string } | undefined;
  if (!evRow) {
    res.status(404).json({ error: 'Event not found.' });
    return;
  }

  const employeeId = String(req.body?.employeeId || '').trim().slice(0, 64);
  const useEmployeeIdAsId = req.body?.useEmployeeIdAsId !== false;
  const fullName = String(req.body?.fullName || '').trim().slice(0, 100);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 120);
  const mobile = String(req.body?.mobile || '').trim().slice(0, 25);
  const company = String(req.body?.company || '').trim().slice(0, 100);
  const position = String(req.body?.position || '').trim().slice(0, 100);
  const source = req.authUser!.role === 'admin' ? 'admin_manual' : 'online';

  if (fullName.length < 2 || !company || !position) {
    res.status(400).json({ error: 'Full name, company/department, and position are required.' });
    return;
  }

  const participantId = resolveParticipantId(employeeId, useEmployeeIdAsId);
  const qrSecret = generateQrSecret();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO participants (
      id, employee_id, event_id, full_name, email, mobile, company, position, qr_secret,
      registered_by_uid, registration_source, registration_date, attendance_status,
      check_in_at, check_in_method, checked_in_by_uid, checked_in_by_email, notes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 'none', '', '', '', ?)`
  ).run(
    participantId,
    employeeId,
    eventId,
    fullName,
    email,
    mobile,
    company,
    position,
    qrSecret,
    req.authUser!.uid,
    source,
    now,
    now
  );

  db.prepare(
    `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
     VALUES (?, ?, 'participant_registered', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    generateLogId(),
    eventId,
    req.authUser!.uid,
    req.authUser!.email,
    req.authUser!.role,
    participantId,
    `${fullName}${email ? ` (${email})` : ''}`,
    `Registered via ${source} for ${evRow.title}${employeeId ? ` [Emp ID: ${employeeId}]` : ''}.`,
    now
  );

  const pRow = db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId) as Record<string, unknown>;
  broadcastUpdate(eventId, 'participant_registered');
  res.json({ participant: mapParticipant(pRow) });
});

app.post('/api/events/:eventId/participants/bulk', requireAdmin, (req: AuthedRequest, res: Response) => {
  const eventId = req.params.eventId;
  const evRow = db.prepare('SELECT title FROM events WHERE id = ?').get(eventId) as { title: string } | undefined;
  if (!evRow) {
    res.status(404).json({ error: 'Event not found.' });
    return;
  }

  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const useEmployeeIdAsId = req.body?.useEmployeeIdAsId !== false;
  if (rows.length === 0) {
    res.status(400).json({ error: 'No participant rows supplied.' });
    return;
  }

  const now = new Date().toISOString();
  const checkEmpDuplicateStmt = db.prepare(
    "SELECT 1 FROM participants WHERE event_id = ? AND employee_id != '' AND LOWER(employee_id) = LOWER(?)"
  );
  const insertStmt = db.prepare(
    `INSERT INTO participants (
      id, employee_id, event_id, full_name, email, mobile, company, position, qr_secret,
      registered_by_uid, registration_source, registration_date, attendance_status,
      check_in_at, check_in_method, checked_in_by_uid, checked_in_by_email, notes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_import', ?, 'pending', NULL, 'none', '', '', '', ?)`
  );

  let count = 0;
  let skipped = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of rows) {
      const employeeId = String(r.employeeId || '').trim().slice(0, 64);
      const fullName = String(r.fullName || '').trim().slice(0, 100);
      const email = String(r.email || '').trim().toLowerCase().slice(0, 120);
      const mobile = String(r.mobile || '').trim().slice(0, 25);
      const company = String(r.company || 'Company').trim().slice(0, 100) || 'Company';
      const position = String(r.position || 'Attendee').trim().slice(0, 100) || 'Attendee';
      if (fullName.length < 2) {
        skipped++;
        continue;
      }
      if (employeeId && checkEmpDuplicateStmt.get(eventId, employeeId)) {
        skipped++;
        continue;
      }

      const participantId = resolveParticipantId(employeeId, useEmployeeIdAsId);
      insertStmt.run(
        participantId,
        employeeId,
        eventId,
        fullName,
        email,
        mobile,
        company,
        position,
        generateQrSecret(),
        req.authUser!.uid,
        now,
        now
      );
      count++;
    }

    db.prepare(
      `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
       VALUES (?, ?, 'participant_registered', ?, ?, 'admin', ?, ?, ?, ?)`
    ).run(
      generateLogId(),
      eventId,
      req.authUser!.uid,
      req.authUser!.email,
      eventId,
      evRow.title,
      `Bulk imported ${count} attendees via spreadsheet (${skipped} skipped).`,
      now
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastUpdate(eventId, 'bulk_imported');
  res.json({ imported: count, skipped });
});

app.post('/api/events/:eventId/checkin', requireStaff, (req: AuthedRequest, res: Response) => {
  const eventId = req.params.eventId;
  const lookupId = String(req.body?.participantId || '').trim();
  const expectedSecret = typeof req.body?.expectedSecret === 'string' ? req.body.expectedSecret : undefined;
  const method = req.body?.method === 'manual_staff' ? 'manual_staff' : 'individual_qr';

  db.exec('BEGIN IMMEDIATE');
  try {
    const evRow = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | Record<string, unknown>
      | undefined;
    if (!evRow) {
      db.exec('ROLLBACK');
      res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Event not found.' });
      return;
    }

    const pRow = db
      .prepare(
        `SELECT * FROM participants
         WHERE event_id = ?
           AND (LOWER(id) = LOWER(?) OR (employee_id != '' AND LOWER(employee_id) = LOWER(?)))
         LIMIT 1`
      )
      .get(eventId, lookupId, lookupId) as Record<string, unknown> | undefined;

    if (!pRow) {
      db.exec('ROLLBACK');
      res.json({
        ok: false,
        code: 'NOT_FOUND',
        message: `ID "${lookupId}" does not match any registered participant or Employee ID No. for ${String(evRow.title)}.`,
      });
      return;
    }

    const participantId = String(pRow.id);

    if (expectedSecret && String(pRow.qr_secret) !== expectedSecret) {
      db.exec('ROLLBACK');
      res.json({
        ok: false,
        code: 'INVALID_SECRET',
        message: 'QR security token mismatch. This ticket could not be verified.',
        participant: mapParticipant(pRow),
      });
      return;
    }

    const existingLog = db
      .prepare('SELECT checked_in_at FROM attendance_logs WHERE event_id = ? AND participant_id = ?')
      .get(eventId, participantId);

    if (pRow.attendance_status !== 'pending' || existingLog) {
      db.exec('ROLLBACK');
      res.json({
        ok: false,
        code: 'DUPLICATE',
        message: `Duplicate check-in rejected: ${String(pRow.full_name)} already checked in (${String(pRow.attendance_status).toUpperCase()}).`,
        participant: mapParticipant(pRow),
      });
      return;
    }

    const assignedStatus = computeAttendanceStatus(
      String(evRow.event_date),
      String(evRow.start_time),
      Number(evRow.late_cutoff_minutes)
    );
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO attendance_logs (
        event_id, participant_id, participant_name, company, status, method,
        qr_token_used, checked_in_by_uid, checked_in_by_email, checked_in_at
      ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?)`
    ).run(
      eventId,
      participantId,
      String(pRow.full_name),
      String(pRow.company),
      assignedStatus,
      method,
      req.authUser!.uid,
      req.authUser!.email,
      now
    );

    db.prepare(
      `UPDATE participants
       SET attendance_status = ?, check_in_at = ?, check_in_method = ?,
           checked_in_by_uid = ?, checked_in_by_email = ?, updated_at = ?
       WHERE id = ? AND event_id = ?`
    ).run(assignedStatus, now, method, req.authUser!.uid, req.authUser!.email, now, participantId, eventId);

    db.prepare(
      `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generateLogId(),
      eventId,
      method === 'individual_qr' ? 'checkin_individual_qr' : 'checkin_manual_staff',
      req.authUser!.uid,
      req.authUser!.email,
      req.authUser!.role,
      participantId,
      String(pRow.full_name),
      `Checked in as ${assignedStatus.toUpperCase()} via ${method.replace('_', ' ')}.`,
      now
    );

    db.exec('COMMIT');

    const updated = db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId) as Record<string, unknown>;
    broadcastUpdate(eventId, 'checkin');
    res.json({
      ok: true,
      code: 'SUCCESS',
      assignedStatus,
      message: `Check-in confirmed for ${String(pRow.full_name)} (${assignedStatus === 'late' ? 'Late Arrival' : 'On Time'}).`,
      participant: mapParticipant(updated),
    });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
});

app.patch('/api/events/:eventId/participants/:participantId', requireAdmin, (req: AuthedRequest, res: Response) => {
  const { eventId, participantId } = req.params;
  const pRow = db
    .prepare('SELECT * FROM participants WHERE event_id = ? AND id = ?')
    .get(eventId, participantId) as Record<string, unknown> | undefined;
  if (!pRow) {
    res.status(404).json({ error: 'Participant not found.' });
    return;
  }

  const employeeId = String(req.body?.employeeId ?? pRow.employee_id ?? '').trim().slice(0, 64);
  const fullName = String(req.body?.fullName ?? pRow.full_name).trim().slice(0, 100);
  const email = String(req.body?.email ?? pRow.email).trim().toLowerCase().slice(0, 120);
  const mobile = String(req.body?.mobile ?? pRow.mobile).trim().slice(0, 25);
  const company = String(req.body?.company ?? pRow.company).trim().slice(0, 100);
  const position = String(req.body?.position ?? pRow.position).trim().slice(0, 100);
  const nextStatus = String(req.body?.attendanceStatus ?? pRow.attendance_status);
  const notes = String(req.body?.notes ?? pRow.notes).trim().slice(0, 300);

  if (!['pending', 'present', 'late', 'absent'].includes(nextStatus)) {
    res.status(400).json({ error: 'Invalid attendance status.' });
    return;
  }

  const now = new Date().toISOString();
  const becomingIn = nextStatus === 'present' || nextStatus === 'late';
  const wasIn = pRow.attendance_status === 'present' || pRow.attendance_status === 'late';

  let checkInAt = pRow.check_in_at ? String(pRow.check_in_at) : null;
  let method = String(pRow.check_in_method);
  let byUid = String(pRow.checked_in_by_uid || '');
  let byEmail = String(pRow.checked_in_by_email || '');

  db.exec('BEGIN IMMEDIATE');
  try {
    if (becomingIn) {
      if (!wasIn || !checkInAt) {
        checkInAt = now;
        method = 'admin_override';
        byUid = req.authUser!.uid;
        byEmail = req.authUser!.email;
      }
      db.prepare(
        `INSERT INTO attendance_logs (
          event_id, participant_id, participant_name, company, status, method,
          qr_token_used, checked_in_by_uid, checked_in_by_email, checked_in_at
        ) VALUES (?, ?, ?, ?, ?, 'admin_override', '', ?, ?, ?)
        ON CONFLICT(event_id, participant_id) DO UPDATE SET
          status = excluded.status,
          method = 'admin_override',
          checked_in_by_uid = excluded.checked_in_by_uid,
          checked_in_by_email = excluded.checked_in_by_email,
          checked_in_at = excluded.checked_in_at`
      ).run(eventId, participantId, fullName, company, nextStatus, req.authUser!.uid, req.authUser!.email, now);
    } else {
      checkInAt = null;
      method = 'none';
      byUid = '';
      byEmail = '';
      db.prepare('DELETE FROM attendance_logs WHERE event_id = ? AND participant_id = ?').run(eventId, participantId);
    }

    db.prepare(
      `UPDATE participants
       SET employee_id = ?, full_name = ?, email = ?, mobile = ?, company = ?, position = ?,
           attendance_status = ?, check_in_at = ?, check_in_method = ?,
           checked_in_by_uid = ?, checked_in_by_email = ?, notes = ?, updated_at = ?
       WHERE id = ? AND event_id = ?`
    ).run(
      employeeId,
      fullName,
      email,
      mobile,
      company,
      position,
      nextStatus,
      checkInAt,
      method,
      byUid,
      byEmail,
      notes,
      now,
      participantId,
      eventId
    );

    db.prepare(
      `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
       VALUES (?, ?, 'attendance_corrected', ?, ?, 'admin', ?, ?, ?, ?)`
    ).run(
      generateLogId(),
      eventId,
      req.authUser!.uid,
      req.authUser!.email,
      participantId,
      fullName,
      `Admin updated record (${String(pRow.attendance_status)} -> ${nextStatus}). ${notes ? 'Note: ' + notes : ''}`,
      now
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastUpdate(eventId, 'participant_corrected');
  res.json({ ok: true });
});

app.delete('/api/events/:eventId/participants/:participantId', requireAdmin, (req: AuthedRequest, res: Response) => {
  const { eventId, participantId } = req.params;
  const pRow = db
    .prepare('SELECT full_name, email FROM participants WHERE event_id = ? AND id = ?')
    .get(eventId, participantId) as { full_name: string; email: string } | undefined;
  if (!pRow) {
    res.status(404).json({ error: 'Participant not found.' });
    return;
  }
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM attendance_logs WHERE event_id = ? AND participant_id = ?').run(eventId, participantId);
    db.prepare('DELETE FROM participants WHERE event_id = ? AND id = ?').run(eventId, participantId);
    db.prepare(
      `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
       VALUES (?, ?, 'participant_deleted', ?, ?, 'admin', ?, ?, ?, ?)`
    ).run(
      generateLogId(),
      eventId,
      req.authUser!.uid,
      req.authUser!.email,
      participantId,
      pRow.full_name,
      `Removed registration for ${pRow.email}.`,
      now
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcastUpdate(eventId, 'participant_deleted');
  res.json({ ok: true });
});

app.post('/api/events/:eventId/mark-pending-absent', requireAdmin, (req: AuthedRequest, res: Response) => {
  const eventId = req.params.eventId;
  const evRow = db.prepare('SELECT title FROM events WHERE id = ?').get(eventId) as { title: string } | undefined;
  if (!evRow) {
    res.status(404).json({ error: 'Event not found.' });
    return;
  }
  const now = new Date().toISOString();
  const info = db
    .prepare("UPDATE participants SET attendance_status = 'absent', updated_at = ? WHERE event_id = ? AND attendance_status = 'pending'")
    .run(now, eventId);

  const count = Number(info.changes || 0);
  if (count > 0) {
    db.prepare(
      `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
       VALUES (?, ?, 'attendance_corrected', ?, ?, 'admin', ?, ?, ?, ?)`
    ).run(
      generateLogId(),
      eventId,
      req.authUser!.uid,
      req.authUser!.email,
      eventId,
      evRow.title,
      `Marked ${count} pending participants as ABSENT.`,
      now
    );
    broadcastUpdate(eventId, 'marked_absent');
  }
  res.json({ count });
});

app.get('/api/events/:eventId/audit-logs', requireAdmin, (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare('SELECT * FROM audit_logs WHERE event_id = ? ORDER BY created_at DESC LIMIT 250')
    .all(req.params.eventId) as Array<Record<string, unknown>>;
  res.json(rows.map(mapAuditLog));
});

app.post('/api/events/:eventId/audit-logs', requireStaff, (req: AuthedRequest, res: Response) => {
  const eventId = req.params.eventId;
  const action = String(req.body?.action || 'report_exported');
  const targetId = String(req.body?.targetId || eventId).slice(0, 128);
  const targetLabel = String(req.body?.targetLabel || '').slice(0, 160);
  const details = String(req.body?.details || '').slice(0, 500);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO audit_logs (id, event_id, action, actor_uid, actor_email, actor_role, target_id, target_label, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    generateLogId(),
    eventId,
    action,
    req.authUser!.uid,
    req.authUser!.email,
    req.authUser!.role,
    targetId,
    targetLabel,
    details,
    now
  );
  res.json({ ok: true });
});

// Live SSE Stream
app.get('/api/events/:eventId/stream', (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!verifyToken(token)) {
    res.status(401).end();
    return;
  }
  const eventId = req.params.eventId;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(eventId)) sseClients.set(eventId, new Set());
  sseClients.get(eventId)!.add(res);

  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.get(eventId)?.delete(res);
  });
});

// ---------------------------------------------------------------------------
// Vite Dev Middleware or Static Production Build Serving
// ---------------------------------------------------------------------------
async function startServer() {
  const distPath = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Event Attendance System server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
