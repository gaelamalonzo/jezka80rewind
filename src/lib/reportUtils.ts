import * as XLSX from 'xlsx';
import type { EventRecord, ParticipantRecord } from '../types';
import { formatTimestamp } from './validation';

export interface AttendanceStats {
  totalRegistered: number;
  checkedIn: number;
  presentOnTime: number;
  lateArrivals: number;
  absent: number;
  pending: number;
  attendanceRate: number;
  individualQrCount: number;
  sharedQrCount: number;
  manualStaffCount: number;
  adminOverrideCount: number;
}

export function computeAttendanceStats(participants: ParticipantRecord[]): AttendanceStats {
  let presentOnTime = 0;
  let lateArrivals = 0;
  let absent = 0;
  let pending = 0;
  let individualQrCount = 0;
  let sharedQrCount = 0;
  let manualStaffCount = 0;
  let adminOverrideCount = 0;

  for (const p of participants) {
    if (p.attendanceStatus === 'present') presentOnTime++;
    else if (p.attendanceStatus === 'late') lateArrivals++;
    else if (p.attendanceStatus === 'absent') absent++;
    else pending++;

    if (p.checkInMethod === 'individual_qr') individualQrCount++;
    else if (p.checkInMethod === 'shared_qr') sharedQrCount++;
    else if (p.checkInMethod === 'manual_staff') manualStaffCount++;
    else if (p.checkInMethod === 'admin_override') adminOverrideCount++;
  }

  const totalRegistered = participants.length;
  const checkedIn = presentOnTime + lateArrivals;
  const attendanceRate = totalRegistered > 0 ? Math.round((checkedIn / totalRegistered) * 1000) / 10 : 0;

  return {
    totalRegistered,
    checkedIn,
    presentOnTime,
    lateArrivals,
    absent,
    pending,
    attendanceRate,
    individualQrCount,
    sharedQrCount,
    manualStaffCount,
    adminOverrideCount,
  };
}

function mapParticipantRow(p: ParticipantRecord) {
  return {
    'Participant ID': p.id,
    'Employee ID No.': p.employeeId || '—',
    'Full Name': p.fullName,
    Email: p.email || '—',
    Mobile: p.mobile || '—',
    Company: p.company,
    Position: p.position,
    'Registration Source': p.registrationSource,
    'Registration Date': formatTimestamp(p.registrationDate),
    'Attendance Status': p.attendanceStatus.toUpperCase(),
    'Check-In Time': formatTimestamp(p.checkInAt),
    'Check-In Method': p.checkInMethod === 'none' ? '—' : p.checkInMethod.replace('_', ' '),
    'Verified By': p.checkedInByEmail || '—',
    Notes: p.notes || '',
  };
}

export function exportEventWorkbookXlsx(event: EventRecord, participants: ParticipantRecord[]): void {
  const stats = computeAttendanceStats(participants);

  const summaryRows = [
    { Metric: 'Event Title', Value: event.title },
    { Metric: 'Event ID', Value: event.id },
    { Metric: 'Event Date', Value: event.eventDate },
    { Metric: 'Schedule', Value: `${event.startTime} - ${event.endTime} (Late cutoff: +${event.lateCutoffMinutes} min)` },
    { Metric: 'Venue', Value: event.venue },
    { Metric: 'Capacity', Value: event.capacity },
    { Metric: 'Total Registered', Value: stats.totalRegistered },
    { Metric: 'Total Checked In', Value: stats.checkedIn },
    { Metric: 'Present (On Time)', Value: stats.presentOnTime },
    { Metric: 'Late Arrivals', Value: stats.lateArrivals },
    { Metric: 'Pending', Value: stats.pending },
    { Metric: 'Absent', Value: stats.absent },
    { Metric: 'Attendance Percentage', Value: `${stats.attendanceRate}%` },
    { Metric: 'Individual QR Scans', Value: stats.individualQrCount },
    { Metric: 'Shared Event QR Check-Ins', Value: stats.sharedQrCount },
    { Metric: 'Authorized Manual Entries', Value: stats.manualStaffCount },
    { Metric: 'Admin Overrides', Value: stats.adminOverrideCount },
    { Metric: 'Generated At', Value: new Date().toLocaleString() },
  ];

  const allRows = participants.map(mapParticipantRow);
  const lateRows = participants.filter((p) => p.attendanceStatus === 'late').map(mapParticipantRow);
  const pendingAbsentRows = participants
    .filter((p) => p.attendanceStatus === 'pending' || p.attendanceStatus === 'absent')
    .map(mapParticipantRow);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRows), 'All Participants');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lateRows), 'Late Arrivals');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendingAbsentRows), 'Pending & Absent');

  XLSX.writeFile(wb, `Attendance-Report-${event.id}-${event.eventDate}.xlsx`);
}

export function exportParticipantsCsv(event: EventRecord, participants: ParticipantRecord[]): void {
  const rows = participants.map(mapParticipantRow);
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Attendance-${event.id}-${event.eventDate}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadBulkImportTemplateCsv(): void {
  const sample = [
    'Employee ID No,Full Name,Email,Mobile,Company,Position',
    'EMP-1001,Elena Rostova,elena.rostova@company.com,+15550104421,Engineering,Principal Architect',
    'EMP-1002,Marcus Vance,marcus.vance@company.com,+15550108832,Operations,Program Director',
  ].join('\n');
  const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Participant-Import-Template.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export interface ParsedBulkRow {
  employeeId: string;
  fullName: string;
  email: string;
  mobile: string;
  company: string;
  position: string;
}

export async function parseBulkSpreadsheet(file: File): Promise<ParsedBulkRow[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });

  const normalizeKey = (k: string) =>
    k
      .trim()
      .toLowerCase()
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ');

  return rawRows
    .map((r) => {
      const getField = (keys: string[]) => {
        for (const k of Object.keys(r)) {
          if (keys.includes(normalizeKey(k))) {
            return String(r[k] ?? '').trim();
          }
        }
        return '';
      };

      const directName = getField([
        'full name',
        'fullname',
        'name',
        'attendee name',
        'employee name',
        'participant name',
        'attendee',
      ]);
      const firstName = getField(['first name', 'firstname', 'given name']);
      const middleName = getField(['middle name', 'middlename', 'mi']);
      const lastName = getField(['last name', 'lastname', 'surname', 'family name']);
      const combinedName = [firstName, middleName, lastName].filter(Boolean).join(' ').trim();

      return {
        employeeId: getField([
          'employee id no',
          'employee id',
          'employee no',
          'emp id no',
          'emp id',
          'emp no',
          'id no',
          'id number',
          'staff id',
          'badge no',
          'badge id',
          'participant id',
          'id',
        ]),
        fullName: directName || combinedName,
        email: getField(['email', 'email address', 'e mail', 'work email', 'mail']).toLowerCase(),
        mobile: getField([
          'mobile',
          'mobile no',
          'mobile number',
          'phone',
          'phone no',
          'phone number',
          'contact',
          'contact no',
          'contact number',
        ]),
        company:
          getField(['company', 'department', 'dept', 'organization', 'division', 'team', 'unit', 'section']) ||
          'Company',
        position:
          getField(['position', 'role', 'title', 'job title', 'designation', 'rank']) || 'Attendee',
      };
    })
    .filter((row) => row.fullName.length >= 2);
}
