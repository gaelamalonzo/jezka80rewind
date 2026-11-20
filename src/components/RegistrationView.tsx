import React, { useRef, useState } from 'react';
import { Check, Copy, ExternalLink, FileSpreadsheet, Upload, UserPlus } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { EffectiveRole, EventRecord, ParticipantRecord } from '../types';
import { bulkImportParticipants, registerParticipant } from '../lib/attendanceService';
import { buildOnlineRegistrationUrl } from '../lib/ticketUtils';
import { downloadBulkImportTemplateCsv, parseBulkSpreadsheet } from '../lib/reportUtils';
import { validateParticipantInput } from '../lib/validation';
import { ParticipantTicketCard } from './ParticipantTicketCard';

interface Props {
  events: EventRecord[];
  selectedEvent: EventRecord | null;
  role: EffectiveRole;
  user: User;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => void;
}

export const RegistrationView: React.FC<Props> = ({
  events,
  selectedEvent,
  role,
  user,
  onNotify,
}) => {
  const [targetEventId, setTargetEventId] = useState(selectedEvent?.id || events[0]?.id || '');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [company, setCompany] = useState('');
  const [position, setPosition] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
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

    const validationErr = validateParticipantInput({
      fullName,
      email,
      mobile,
      company,
      position,
    });
    if (validationErr) {
      onNotify('error', 'Validation Error', validationErr);
      return;
    }

    setSubmitting(true);
    try {
      const { participantId, qrSecret } = await registerParticipant({
        eventId: activeEvent.id,
        eventTitle: activeEvent.title,
        fullName,
        email,
        mobile,
        company,
        position,
        source: role === 'admin' ? 'admin_manual' : 'online',
        actorRole: role,
        user,
      });

      const created: ParticipantRecord = {
        id: participantId,
        eventId: activeEvent.id,
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        mobile: mobile.trim(),
        company: company.trim(),
        position: position.trim(),
        qrSecret,
        registeredByUid: user.uid,
        registrationSource: role === 'admin' ? 'admin_manual' : 'online',
        registrationDate: null,
        attendanceStatus: 'pending',
        checkInAt: null,
        checkInMethod: 'none',
        checkedInByUid: '',
        checkedInByEmail: '',
        notes: '',
        updatedAt: null,
      };

      setIssuedTicket({ participant: created, event: activeEvent });
      setFullName('');
      setEmail('');
      setMobile('');
      setCompany('');
      setPosition('');
      onNotify(
        'success',
        'Participant Registered',
        `Issued Unique ID ${participantId} and generated individual QR ticket.`
      );
    } catch (error) {
      onNotify('error', 'Registration Failed', error instanceof Error ? error.message : 'Unable to register.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeEvent) return;
    setImporting(true);
    try {
      const rows = await parseBulkSpreadsheet(file);
      if (rows.length === 0) {
        onNotify('warning', 'Empty Spreadsheet', 'Ensure columns include Full Name, Email, Mobile, Company, and Position.');
        return;
      }

      const validRows = rows.filter(
        (r) =>
          !validateParticipantInput({
            fullName: r.fullName,
            email: r.email,
            mobile: r.mobile || '0000000',
            company: r.company,
            position: r.position,
          })
      );

      if (validRows.length === 0) {
        onNotify('error', 'No Valid Rows', 'Check email addresses and required fields in your spreadsheet.');
        return;
      }

      const count = await bulkImportParticipants({
        eventId: activeEvent.id,
        eventTitle: activeEvent.title,
        rows: validRows.map((r) => ({ ...r, mobile: r.mobile || 'N/A-0000' })),
        user,
      });

      onNotify(
        'success',
        'Bulk Import Complete',
        `Imported ${count} participants into ${activeEvent.title} with unique QR secrets.`
      );
    } catch (error) {
      onNotify('error', 'Bulk Import Failed', error instanceof Error ? error.message : 'Unable to parse spreadsheet.');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    maxLength={120}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alex.mercer@company.com"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mobile Number
                  </label>
                  <input
                    type="tel"
                    required
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
                    Bulk Roster Import (500–1,000 Participants)
                  </h3>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Upload an Excel (<code className="font-mono">.xlsx</code>) or CSV file with columns:{' '}
                <span className="font-medium">Full Name, Email, Mobile, Company, Position</span>. Unique IDs and QR tokens are generated automatically in batches.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleBulkUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => importInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#1E40AF] hover:bg-[#1B3B6F] text-white text-xs font-medium rounded-lg disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{importing ? 'Importing Roster...' : 'Upload XLSX / CSV Roster'}</span>
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
                Complete the registration form to generate a unique Participant ID and downloadable corporate QR pass.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
