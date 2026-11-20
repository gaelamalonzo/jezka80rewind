import React, { useRef, useState } from 'react';
import { Check, Copy, ExternalLink, FileSpreadsheet, Upload, UserPlus, X } from 'lucide-react';
import type { AuthUser, EffectiveRole, EventRecord, ParticipantRecord } from '../types';
import { bulkImportParticipants, registerParticipantStaff } from '../lib/attendanceService';
import { buildOnlineRegistrationUrl } from '../lib/ticketUtils';
import {
  downloadBulkImportTemplateCsv,
  parseBulkSpreadsheet,
  type ParsedBulkRow,
} from '../lib/reportUtils';
import { validateParticipantInput } from '../lib/validation';
import { ParticipantTicketCard } from './ParticipantTicketCard';

interface Props {
  events: EventRecord[];
  selectedEvent: EventRecord | null;
  role: EffectiveRole;
  user: AuthUser;
  onRefresh: () => Promise<void> | void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => void;
}

export const RegistrationView: React.FC<Props> = ({
  events,
  selectedEvent,
  role,
  onRefresh,
  onNotify,
}) => {
  const [targetEventId, setTargetEventId] = useState(selectedEvent?.id || events[0]?.id || '');
  const [employeeId, setEmployeeId] = useState('');
  const [useEmpIdSingle, setUseEmpIdSingle] = useState(true);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [company, setCompany] = useState('');
  const [position, setPosition] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [importing, setImporting] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<string>('');
  const [pendingImportRows, setPendingImportRows] = useState<ParsedBulkRow[]>([]);
  const [useEmployeeIdAsId, setUseEmployeeIdAsId] = useState(true);

  const [copiedLink, setCopiedLink] = useState(false);
  const [issuedTicket, setIssuedTicket] = useState<{
    participant: ParticipantRecord;
    event: EventRecord;
  } | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  const activeEvent =
    events.find((e) => e.id === (targetEventId || selectedEvent?.id)) || selectedEvent || events[0];

  const publicRegUrl = buildOnlineRegistrationUrl(activeEvent?.id);

  const handleCopyPortalLink = async () => {
    try {
      await navigator.clipboard.writeText(publicRegUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent) {
      onNotify('warning', 'Select an Event', 'Please select an event before registering.');
      return;
    }

    const validationErr = validateParticipantInput(
      {
        fullName,
        email,
        mobile,
        company,
        position,
      },
      { allowBlankContact: Boolean(employeeId.trim()) }
    );
    if (validationErr) {
      onNotify('error', 'Validation Error', validationErr);
      return;
    }

    setSubmitting(true);
    try {
      const { participant } = await registerParticipantStaff({
        eventId: activeEvent.id,
        employeeId: employeeId.trim(),
        useEmployeeIdAsId: useEmpIdSingle,
        fullName,
        email,
        mobile,
        company,
        position,
      });

      setIssuedTicket({ participant, event: activeEvent });
      setEmployeeId('');
      setFullName('');
      setEmail('');
      setMobile('');
      setCompany('');
      setPosition('');
      await onRefresh();
      onNotify(
        'success',
        'Participant Registered',
        `Issued Pass ID ${participant.id}${participant.employeeId ? ` (Emp ID: ${participant.employeeId})` : ''}.`
      );
    } catch (error) {
      onNotify('error', 'Registration Failed', error instanceof Error ? error.message : 'Unable to register.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectBulkFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeEvent) return;
    try {
      const rows = await parseBulkSpreadsheet(file);
      if (rows.length === 0) {
        onNotify(
          'warning',
          'No Attendees Found',
          'Ensure your Excel/CSV has at least a Full Name column (plus optional Employee ID No, Email, Mobile, Company, Position).'
        );
        return;
      }
      setPendingImportFile(file.name);
      setPendingImportRows(rows);
    } catch (error) {
      onNotify('error', 'File Read Failed', error instanceof Error ? error.message : 'Unable to parse spreadsheet.');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleConfirmBulkImport = async () => {
    if (!activeEvent || pendingImportRows.length === 0) return;
    setImporting(true);
    try {
      const { imported, skipped } = await bulkImportParticipants({
        eventId: activeEvent.id,
        useEmployeeIdAsId,
        rows: pendingImportRows,
      });

      setPendingImportRows([]);
      setPendingImportFile('');
      await onRefresh();
      onNotify(
        'success',
        'Bulk Import Complete',
        `Imported ${imported} attendees into ${activeEvent.title}${skipped > 0 ? ` (${skipped} duplicates/invalid rows skipped)` : ''}.`
      );
    } catch (error) {
      onNotify('error', 'Bulk Import Failed', error instanceof Error ? error.message : 'Unable to import attendees.');
    } finally {
      setImporting(false);
    }
  };

  if (events.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
        Create an event first on the Dashboard before registering participants.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Public Portal Share Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="font-display text-base font-semibold text-[#0B1D3A]">
            Public Online Registration Link
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Share this link with employees so they can register online and download their own QR ticket.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyPortalLink}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Copied URL' : 'Copy Registration URL'}</span>
          </button>
          <a
            href={publicRegUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-medium rounded-lg"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open Public Form</span>
          </a>
        </div>
      </div>

      {/* Bulk Import Preview Drawer / Card */}
      {role === 'admin' && pendingImportRows.length > 0 && (
        <div className="bg-white border border-[#1E40AF]/40 rounded-xl overflow-hidden no-print">
          <div className="px-6 py-4 bg-[#0B1D3A] text-white flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold">
                Import Preview: {pendingImportFile}
              </h3>
              <p className="text-xs text-slate-300 tabular-nums mt-0.5">
                {pendingImportRows.length} attendees ready to import into {activeEvent?.title}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setPendingImportRows([]);
                setPendingImportFile('');
              }}
              className="p-1.5 rounded-lg text-slate-300 hover:bg-white/10"
              aria-label="Cancel import preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
              <label className="inline-flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useEmployeeIdAsId}
                  onChange={(e) => setUseEmployeeIdAsId(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-[#1E40AF] focus:ring-[#1E40AF]"
                />
                <span>
                  <span className="font-semibold text-[#0B1D3A] block">
                    Use Employee ID No. as Check-In / Participant ID (when unique)
                  </span>
                  <span className="text-slate-500">
                    Allows employees and staff scanners to check in directly using their Employee ID No.
                  </span>
                </span>
              </label>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPendingImportRows([]);
                    setPendingImportFile('');
                  }}
                  className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={importing}
                  onClick={handleConfirmBulkImport}
                  className="px-4 py-2 bg-[#1E40AF] hover:bg-[#1B3B6F] text-white text-xs font-medium rounded-lg disabled:opacity-50 whitespace-nowrap"
                >
                  {importing
                    ? 'Importing Roster...'
                    : `Confirm & Import ${pendingImportRows.length} Attendees`}
                </button>
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Employee ID No.</th>
                    <th className="py-2 px-3">Full Name</th>
                    <th className="py-2 px-3">Email</th>
                    <th className="py-2 px-3">Mobile</th>
                    <th className="py-2 px-3">Company / Dept</th>
                    <th className="py-2 px-3">Position</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingImportRows.slice(0, 100).map((row, idx) => (
                    <tr key={`${row.employeeId}-${row.fullName}-${idx}`}>
                      <td className="py-2 px-3 font-mono text-slate-400 tabular-nums">{idx + 1}</td>
                      <td className="py-2 px-3 font-mono font-medium text-[#0B1D3A]">
                        {row.employeeId || 'Auto (EVT-...)'}
                      </td>
                      <td className="py-2 px-3 font-medium text-slate-900">{row.fullName}</td>
                      <td className="py-2 px-3 text-slate-600">{row.email || '—'}</td>
                      <td className="py-2 px-3 tabular-nums text-slate-600">{row.mobile || '—'}</td>
                      <td className="py-2 px-3 text-slate-700">{row.company}</td>
                      <td className="py-2 px-3 text-slate-600">{row.position}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pendingImportRows.length > 100 && (
              <p className="text-xs text-slate-500">
                Showing first 100 of {pendingImportRows.length} parsed attendees. All {pendingImportRows.length} rows will be imported.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Registration Form + Bulk Import */}
        <div className="lg:col-span-6 space-y-6 no-print">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2.5 mb-5">
              <UserPlus className="w-5 h-5 text-[#0B1D3A]" />
              <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
                Register Participant
              </h2>
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Event Selection
                </label>
                <select
                  value={activeEvent?.id || ''}
                  onChange={(e) => setTargetEventId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                >
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title} ({ev.eventDate})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Alex Mercer"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Employee ID No. (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={64}
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    placeholder="EMP-1042"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  />
                </div>
              </div>

              {employeeId.trim() && (
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useEmpIdSingle}
                    onChange={(e) => setUseEmpIdSingle(e.target.checked)}
                    className="rounded border-slate-300 text-[#1E40AF] focus:ring-[#1E40AF]"
                  />
                  <span>Use Employee ID No. as Participant Check-In ID</span>
                </label>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address {employeeId.trim() ? '(Optional)' : ''}
                  </label>
                  <input
                    type="email"
                    required={!employeeId.trim()}
                    maxLength={120}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alex.mercer@company.com"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mobile Number {employeeId.trim() ? '(Optional)' : ''}
                  </label>
                  <input
                    type="tel"
                    required={!employeeId.trim()}
                    maxLength={25}
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    placeholder="+1 555 019 2834"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Company / Department
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Engineering"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Position / Title
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    placeholder="Senior Product Manager"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {submitting ? 'Generating QR Ticket...' : 'Register & Generate Individual QR Ticket'}
              </button>
            </form>
          </div>

          {/* Admin Bulk CSV / XLSX Import */}
          {role === 'admin' && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <FileSpreadsheet className="w-5 h-5 text-[#0B1D3A]" />
                  <h3 className="font-display text-base font-semibold text-[#0B1D3A]">
                    Bulk Roster Import (500–1,000+ Attendees)
                  </h3>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Upload an Excel (<code className="font-mono">.xlsx</code> / <code className="font-mono">.xls</code>) or CSV file with columns:{' '}
                <span className="font-medium">Employee ID No, Full Name, Email, Mobile, Company / Department, Position</span>. Email and Mobile are optional when importing employee lists; Employee ID No. can be used directly for check-in.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleSelectBulkFile}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => importInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#1E40AF] hover:bg-[#1B3B6F] text-white text-xs font-medium rounded-lg disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{importing ? 'Importing Roster...' : 'Select XLSX / CSV Roster'}</span>
                </button>
                <button
                  type="button"
                  onClick={downloadBulkImportTemplateCsv}
                  className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg"
                >
                  Download CSV Template
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Individual QR Ticket Preview */}
        <div className="lg:col-span-6">
          {issuedTicket ? (
            <ParticipantTicketCard
              participant={issuedTicket.participant}
              event={issuedTicket.event}
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <p className="font-display text-base font-semibold text-slate-900">
                Individual QR Ticket Preview
              </p>
              <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
                Complete the registration form or upload your employee Excel/CSV list to issue JEZKA80 REWIND QR passes.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
