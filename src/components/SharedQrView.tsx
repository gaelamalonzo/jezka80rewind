import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Power,
  Printer,
  RefreshCw,
  Rewind,
  ShieldAlert,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { fetchQrTokens, rotateSharedQrToken, toggleSharedQrStatus } from '../lib/attendanceService';
import {
  buildSharedEventQrUrl,
  downloadSharedQrPosterPng,
  type QrDesignTheme,
} from '../lib/ticketUtils';
import type { AuthUser, EffectiveRole, EventRecord, QrTokenRecord } from '../types';

interface Props {
  event: EventRecord | null;
  role: EffectiveRole;
  user: AuthUser;
  onRefresh: () => Promise<void> | void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => void;
}

export const SharedQrView: React.FC<Props> = ({ event, role, onRefresh, onNotify }) => {
  const [tokens, setTokens] = useState<QrTokenRecord[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<QrDesignTheme>('jezka80_rewind');

  const isRewind = theme === 'jezka80_rewind';

  const loadTokens = async (eventId: string) => {
    setLoadingTokens(true);
    try {
      const list = await fetchQrTokens(eventId);
      setTokens(list);
    } catch (error) {
      onNotify('error', 'Token Load Failed', error instanceof Error ? error.message : 'Could not fetch QR tokens.');
    } finally {
      setLoadingTokens(false);
    }
  };

  useEffect(() => {
    if (!event || role !== 'admin') {
      setTokens([]);
      return;
    }
    void loadTokens(event.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, role]);

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
        eventId: event.id,
        enabled: !event.sharedQrEnabled,
      });
      await onRefresh();
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
      const nextToken = await rotateSharedQrToken(event.id);
      await loadTokens(event.id);
      await onRefresh();
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
        <div className="max-w-2xl mx-auto space-y-3">
          {/* Poster Theme Selector */}
          <div className="flex items-center justify-between gap-3 no-print">
            <span className="text-xs font-medium text-slate-500">Poster Artwork Theme</span>
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

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Poster Header */}
            <div className="relative bg-gradient-to-br from-[#061226] via-[#0B1D3A] to-[#172554] text-white px-8 py-7 text-center overflow-hidden">
              {isRewind && (
                <svg
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full opacity-25 pointer-events-none"
                  viewBox="0 0 800 220"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="posterSun" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F59E0B" />
                      <stop offset="100%" stopColor="#E11D48" />
                    </linearGradient>
                  </defs>
                  <circle cx="400" cy="120" r="88" fill="url(#posterSun)" opacity="0.45" />
                  <rect x="300" y="122" width="200" height="6" fill="#0B1D3A" />
                  <rect x="300" y="140" width="200" height="6" fill="#0B1D3A" />
                  <rect x="300" y="158" width="200" height="6" fill="#0B1D3A" />
                  <path
                    d="M0 165 H800 M0 190 H800 M400 20 L60 220 M400 20 L230 220 M400 20 L570 220 M400 20 L740 220"
                    stroke="#38BDF8"
                    strokeWidth="1.2"
                    opacity="0.4"
                  />
                </svg>
              )}

              <div className="relative z-10">
                <div className="inline-flex items-center justify-center gap-2 text-xs font-semibold tracking-wide">
                  {isRewind ? (
                    <>
                      <Rewind className="w-4 h-4 text-amber-300 shrink-0" />
                      <span className="text-amber-300">JEZKA80 REWIND · MOBILE SELF-CHECK-IN</span>
                    </>
                  ) : (
                    <span className="text-slate-300">SELF-CHECK-IN STATION · SCAN WITH MOBILE CAMERA</span>
                  )}
                </div>
                <h3 className="font-display text-3xl font-semibold mt-1.5 text-balance">
                  {event.title}
                </h3>
                <p className="text-xs text-slate-300 mt-2 tabular-nums">
                  {event.eventDate} · {event.startTime} – {event.endTime} · {event.venue}
                </p>
              </div>
            </div>

            {isRewind && (
              <div className="flex flex-col">
                <div className="h-1.5 w-full bg-amber-500" />
                <div className="h-1.5 w-full bg-rose-600" />
                <div className="h-1.5 w-full bg-sky-400" />
              </div>
            )}

            <div className="p-8 flex flex-col items-center text-center space-y-5">
              <div className="relative p-5 bg-white border border-slate-200 rounded-xl">
                {isRewind && (
                  <>
                    <span className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-[3px] border-l-[3px] border-rose-600" />
                    <span className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-[3px] border-r-[3px] border-rose-600" />
                    <span className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-[3px] border-l-[3px] border-rose-600" />
                    <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-[3px] border-r-[3px] border-rose-600" />
                  </>
                )}
                <QRCodeSVG value={selfCheckInUrl} size={260} level="H" fgColor="#0B1D3A" />
              </div>

              <div className="space-y-1">
                <p className="text-xs text-slate-500">Active Security Token</p>
                <p className="font-mono text-xs text-slate-700">{activeToken}</p>
              </div>

              <div className="text-xs text-slate-600 max-w-md space-y-1">
                <p>1. Attendees scan this QR code using their mobile phone camera.</p>
                <p>2. Enter registered Email or ID and verify Participant ID or Mobile number.</p>
                <p>3. Anti-duplicate lock prevents multiple check-ins for the same attendee.</p>
              </div>
            </div>

            {isRewind && (
              <div className="flex flex-col">
                <div className="h-1 w-full bg-amber-500" />
                <div className="h-1 w-full bg-rose-600" />
                <div className="h-1 w-full bg-sky-400" />
              </div>
            )}

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-center gap-2.5 no-print">
              <button
                type="button"
                onClick={() => downloadSharedQrPosterPng(event, activeToken, theme)}
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
        </div>
      )}
    </div>
  );
};
