import React, { useState } from 'react';
import { Check, Copy, Download, Mail, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { EventRecord, ParticipantRecord } from '../types';
import {
  buildParticipantTicketUrl,
  downloadParticipantTicketPng,
  openTicketEmailDraft,
} from '../lib/ticketUtils';
import { encodeParticipantQrPayload, formatTimestamp } from '../lib/validation';

interface Props {
  participant: ParticipantRecord;
  event: EventRecord;
}

export const ParticipantTicketCard: React.FC<Props> = ({ participant, event }) => {
  const [copied, setCopied] = useState(false);

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
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden max-w-xl mx-auto">
      {/* Corporate Navy Header */}
      <div className="bg-[#0B1D3A] text-white px-6 py-5">
        <p className="text-xs font-medium text-slate-300 tracking-wide">
          Event Attendance System · Individual QR Pass
        </p>
        <h3 className="font-display text-xl font-semibold mt-1 text-balance">{event.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-300 tabular-nums">
          <span>{event.eventDate}</span>
          <span aria-hidden="true">·</span>
          <span>
            {event.startTime} – {event.endTime}
          </span>
          <span aria-hidden="true">·</span>
          <span>{event.venue}</span>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 flex flex-col sm:flex-row items-center gap-6">
        <div className="p-3 bg-white border border-slate-200 rounded-lg shrink-0">
          <QRCodeSVG value={qrValue} size={172} level="H" fgColor="#0B1D3A" />
        </div>

        <div className="flex-1 min-w-0 w-full space-y-3">
          <div>
            <p className="text-xs text-slate-500">Unique Participant ID</p>
            <p className="font-mono tabular-nums text-lg font-semibold text-[#0B1D3A] tracking-tight">
              {participant.id}
            </p>
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-1.5 text-sm">
            <p className="font-semibold text-slate-900 truncate">{participant.fullName}</p>
            <p className="text-slate-600 truncate">
              {participant.company} · {participant.position}
            </p>
            <p className="text-slate-500 text-xs truncate">{participant.email}</p>
            <p className="text-slate-500 text-xs tabular-nums">{participant.mobile}</p>
            {participant.registrationDate && (
              <p className="text-slate-400 text-xs tabular-nums">
                Registered {formatTimestamp(participant.registrationDate)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center gap-2.5 no-print">
        <button
          type="button"
          onClick={() => downloadParticipantTicketPng(participant, event)}
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
  );
};
