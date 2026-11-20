import React, { useState } from 'react';
import { Check, Copy, Download, Mail, Printer, Rewind } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { EventRecord, ParticipantRecord } from '../types';
import {
  buildParticipantTicketUrl,
  downloadParticipantTicketPng,
  openTicketEmailDraft,
  type QrDesignTheme,
} from '../lib/ticketUtils';
import { encodeParticipantQrPayload, formatTimestamp } from '../lib/validation';

interface Props {
  participant: ParticipantRecord;
  event: EventRecord;
}

export const ParticipantTicketCard: React.FC<Props> = ({ participant, event }) => {
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<QrDesignTheme>('jezka80_rewind');

  const isRewind = theme === 'jezka80_rewind';

  const qrValue = encodeParticipantQrPayload({
    t: 'EAS_TICKET',
    e: event.id,
    p: participant.id,
    k: participant.qrSecret,
  });

  const ticketUrl = buildParticipantTicketUrl(event.id, participant.id);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ticketUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard fallback
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-3">
      {/* Theme Toggle Control */}
      <div className="flex items-center justify-between gap-3 no-print">
        <span className="text-xs font-medium text-slate-500">QR Pass Design Theme</span>
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setTheme('jezka80_rewind')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              isRewind ? 'bg-[#0B1D3A] text-amber-300' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            JEZKA80 REWIND
          </button>
          <button
            type="button"
            onClick={() => setTheme('corporate_navy')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              !isRewind ? 'bg-white text-[#0B1D3A]' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Corporate Classic
          </button>
        </div>
      </div>

      {/* Ticket Card */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Header Artwork */}
        <div className="relative bg-gradient-to-br from-[#061226] via-[#0B1D3A] to-[#172554] text-white px-6 py-6 overflow-hidden">
          {isRewind && (
            <>
              {/* Retro Horizon Grid SVG */}
              <svg
                aria-hidden="true"
                className="absolute inset-0 w-full h-full opacity-25 pointer-events-none"
                viewBox="0 0 600 180"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="rewindSun" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F59E0B" />
                    <stop offset="100%" stopColor="#E11D48" />
                  </linearGradient>
                </defs>
                <circle cx="515" cy="90" r="64" fill="url(#rewindSun)" opacity="0.55" />
                <rect x="440" y="92" width="150" height="5" fill="#0B1D3A" />
                <rect x="440" y="106" width="150" height="5" fill="#0B1D3A" />
                <rect x="440" y="120" width="150" height="5" fill="#0B1D3A" />
                <rect x="440" y="134" width="150" height="5" fill="#0B1D3A" />
                <path
                  d="M0 130 H600 M0 150 H600 M0 170 H600 M480 20 L120 180 M520 20 L340 180 M560 20 L560 180"
                  stroke="#38BDF8"
                  strokeWidth="1"
                  opacity="0.45"
                />
              </svg>
            </>
          )}

          <div className="relative z-10">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wide">
              {isRewind ? (
                <>
                  <Rewind className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="text-amber-300">JEZKA80 REWIND · OFFICIAL QR ENTRY PASS</span>
                </>
              ) : (
                <span className="text-slate-300">EVENT ATTENDANCE SYSTEM · INDIVIDUAL QR PASS</span>
              )}
            </div>

            <h3 className="font-display text-2xl font-semibold mt-1.5 text-balance max-w-md">
              {event.title}
            </h3>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-300 tabular-nums">
              <span>{event.eventDate}</span>
              <span aria-hidden="true">·</span>
              <span>
                {event.startTime} – {event.endTime}
              </span>
              <span aria-hidden="true">·</span>
              <span>{event.venue}</span>
            </div>
          </div>
        </div>

        {/* Triple 80s Rewind Ribbon Bar */}
        {isRewind && (
          <div className="flex flex-col">
            <div className="h-1.5 w-full bg-amber-500" />
            <div className="h-1.5 w-full bg-rose-600" />
            <div className="h-1.5 w-full bg-sky-400" />
          </div>
        )}

        {/* QR & Attendee Details */}
        <div className="p-6 flex flex-col sm:flex-row items-center gap-6">
          <div className="relative p-3.5 bg-white border border-slate-200 rounded-lg shrink-0">
            {isRewind && (
              <>
                <span className="absolute -top-0.5 -left-0.5 w-4 h-4 border-t-2 border-l-2 border-rose-600" />
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 border-t-2 border-r-2 border-rose-600" />
                <span className="absolute -bottom-0.5 -left-0.5 w-4 h-4 border-b-2 border-l-2 border-rose-600" />
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 border-b-2 border-r-2 border-rose-600" />
              </>
            )}
            <QRCodeSVG value={qrValue} size={172} level="H" fgColor="#0B1D3A" />
          </div>

          <div className="flex-1 min-w-0 w-full space-y-3">
            <div
              className={`px-3.5 py-2.5 rounded-lg flex flex-wrap items-center justify-between gap-3 ${
                isRewind ? 'bg-[#0B1D3A] text-white' : 'bg-slate-100 text-[#0B1D3A]'
              }`}
            >
              <div>
                <p className={`text-[11px] font-semibold ${isRewind ? 'text-amber-300' : 'text-slate-500'}`}>
                  UNIQUE PARTICIPANT ID
                </p>
                <p className="font-mono tabular-nums text-lg font-semibold tracking-tight">
                  {participant.id}
                </p>
              </div>
              {participant.employeeId && (
                <div className="text-left sm:text-right">
                  <p className={`text-[11px] font-semibold ${isRewind ? 'text-slate-300' : 'text-slate-500'}`}>
                    EMPLOYEE ID NO.
                  </p>
                  <p className={`font-mono tabular-nums text-sm font-semibold ${isRewind ? 'text-amber-300' : 'text-[#0B1D3A]'}`}>
                    {participant.employeeId}
                  </p>
                </div>
              )}
            </div>

            <div className="pt-1 space-y-1.5 text-sm">
              <p className="font-semibold text-slate-900 truncate">{participant.fullName}</p>
              <p className="text-slate-600 truncate">
                {participant.company} · {participant.position}
              </p>
              {participant.email && <p className="text-slate-500 text-xs truncate">{participant.email}</p>}
              {participant.mobile && <p className="text-slate-500 text-xs tabular-nums">{participant.mobile}</p>}
              {participant.registrationDate && (
                <p className="text-slate-400 text-xs tabular-nums">
                  Registered {formatTimestamp(participant.registrationDate)}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-dashed border-slate-300 flex flex-wrap items-center gap-2.5 no-print">
          <button
            type="button"
            onClick={() => downloadParticipantTicketPng(participant, event, theme)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download PNG Ticket</span>
          </button>

          <button
            type="button"
            onClick={() => openTicketEmailDraft(participant, event)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Email Pass Draft</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Link Copied' : 'Copy Pass Link'}</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
        </div>
      </div>
    </div>
  );
};
