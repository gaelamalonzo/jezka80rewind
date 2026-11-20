import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Power,
  Printer,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { rotateSharedQrToken, toggleSharedQrStatus } from '../lib/attendanceService';
import { buildSharedEventQrUrl, downloadSharedQrPosterPng } from '../lib/ticketUtils';
import type { EffectiveRole, EventRecord, QrTokenRecord } from '../types';

interface Props {
  event: EventRecord | null;
  role: EffectiveRole;
  user: User;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => void;
}

export const SharedQrView: React.FC<Props> = ({ event, role, user, onNotify }) => {
  const [tokens, setTokens] = useState<QrTokenRecord[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!event || role !== 'admin') {
      setTokens([]);
      return;
    }
    setLoadingTokens(true);
    const path = `events/${event.id}/qr_tokens`;
    const q = query(collection(db, 'events', event.id, 'qr_tokens'), where('active', '==', true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as QrTokenRecord);
        setTokens(list);
        setLoadingTokens(false);
      },
      (error) => {
        setLoadingTokens(false);
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );
    return () => unsub();
  }, [event, role]);

  if (!event) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
        Select an event from the header to manage its Shared Event QR.
      </div>
    );
  }

  if (role !== 'admin') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-xl mx-auto text-center space-y-3">
        <ShieldAlert className="w-8 h-8 text-[#0B1D3A] mx-auto" />
        <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
          Shared Event QR Status
        </h2>
        <p className="text-sm text-slate-600">
          Self-check-in via Shared Event QR for <span className="font-semibold">{event.title}</span> is currently{' '}
          <span className={event.sharedQrEnabled ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
            {event.sharedQrEnabled ? 'ENABLED' : 'DISABLED'}
          </span>
          .
        </p>
        <p className="text-xs text-slate-500">
          Only administrators can generate, rotate, or enable/disable the Shared Event QR poster.
        </p>
      </div>
    );
  }

  const activeToken = tokens[0]?.token || '';
  const selfCheckInUrl = activeToken ? buildSharedEventQrUrl(event.id, activeToken) : '';

  const handleToggle = async () => {
    setBusy(true);
    try {
      await toggleSharedQrStatus({
        event,
        enabled: !event.sharedQrEnabled,
        user,
      });
      onNotify(
        'success',
        `Shared Event QR ${!event.sharedQrEnabled ? 'Enabled' : 'Disabled'}`,
        !event.sharedQrEnabled
          ? 'Participants can now check in from mobile devices.'
          : 'Mobile self-check-in has been locked.'
      );
    } catch (error) {
      onNotify('error', 'Failed to Toggle', error instanceof Error ? error.message : 'Unable to update status.');
    } finally {
      setBusy(false);
    }
  };

  const handleRotate = async () => {
    setBusy(true);
    try {
      const nextToken = await rotateSharedQrToken({
        eventId: event.id,
        eventTitle: event.title,
        existingTokens: tokens.map((t) => t.token),
        user,
      });
      onNotify('success', 'QR Token Rotated', `Generated new Shared Event QR token (${nextToken}).`);
    } catch (error) {
      onNotify('error', 'Token Rotation Failed', error instanceof Error ? error.message : 'Unable to rotate token.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!selfCheckInUrl) return;
    try {
      await navigator.clipboard.writeText(selfCheckInUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
            Shared Event QR Self-Check-In Control
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Display this single QR poster at the venue entrance. Attendees scan it on their phones, verify identity, and receive single-use attendance confirmation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={handleToggle}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              event.sharedQrEnabled
                ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
            }`}
          >
            <Power className="w-4 h-4" />
            <span>{event.sharedQrEnabled ? 'Shared QR Enabled' : 'Shared QR Disabled'}</span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handleRotate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{activeToken ? 'Rotate QR Token' : 'Generate QR Token'}</span>
          </button>
        </div>
      </div>

      {event.status !== 'active' && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 text-sm no-print">
          Note: Event status is currently <span className="font-semibold uppercase">{event.status}</span>. Set Event Status to <span className="font-semibold">Active</span> in Event Settings so participants can submit Shared Event QR check-ins.
        </div>
      )}

      {loadingTokens ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          Loading Shared Event QR configuration...
        </div>
      ) : !activeToken ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
          <p className="text-sm text-slate-600">
            No active Shared Event QR token found for this event. Generate one to display the venue check-in poster.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={handleRotate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Generate Shared Event QR</span>
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden max-w-2xl mx-auto">
          <div className="bg-[#0B1D3A] text-white px-8 py-6 text-center">
            <p className="text-xs font-medium text-slate-300 tracking-wide">
              Self-Check-In Station · Scan with Mobile Camera
            </p>
            <h3 className="font-display text-2xl font-semibold mt-1 text-balance">{event.title}</h3>
            <p className="text-xs text-slate-300 mt-2 tabular-nums">
              {event.eventDate} · {event.startTime} – {event.endTime} · {event.venue}
            </p>
          </div>

          <div className="p-8 flex flex-col items-center text-center space-y-5">
            <div className="p-4 bg-white border border-slate-200 rounded-xl">
              <QRCodeSVG value={selfCheckInUrl} size={260} level="H" fgColor="#0B1D3A" />
            </div>

            <div className="space-y-1">
              <p className="text-xs text-slate-500">Active Security Token</p>
              <p className="font-mono text-xs text-slate-700">{activeToken}</p>
            </div>

            <div className="text-xs text-slate-600 max-w-md space-y-1">
              <p>1. Attendees scan this QR code using their mobile phone camera.</p>
              <p>2. Verify Google identity and confirm Participant ID or Mobile number.</p>
              <p>3. Anti-duplicate lock prevents multiple check-ins for the same attendee.</p>
            </div>
          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-center gap-2.5 no-print">
            <button
              type="button"
              onClick={() => downloadSharedQrPosterPng(event, activeToken)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-medium rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Poster PNG</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Poster</span>
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Link Copied' : 'Copy Check-In Link'}</span>
            </button>

            <a
              href={selfCheckInUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#1E40AF] hover:bg-[#1B3B6F] text-white text-xs font-medium rounded-lg"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open Mobile Self-Check-In</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
