import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  ImageUp,
  Search,
  UserCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { EffectiveRole, EventRecord, ParticipantRecord } from '../types';
import { performAtomicCheckIn, type CheckInResult } from '../lib/attendanceService';
import { formatTimestamp, parseScannedQrText } from '../lib/validation';

interface Props {
  event: EventRecord | null;
  participants: ParticipantRecord[];
  role: EffectiveRole;
  user: User;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) => void;
}

export const ScannerView: React.FC<Props> = ({
  event,
  participants,
  role,
  user,
  onNotify,
}) => {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<CheckInResult | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [manualIdInput, setManualIdInput] = useState('');

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const cooldownRef = useRef<{ code: string; until: number }>({ code: '', until: 0 });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const playTone = (success: boolean) => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = success ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(success ? 880 : 240, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (success ? 0.14 : 0.25));
    } catch {
      // ignore audio context restrictions
    }
  };

  const stopCamera = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        // ignore stop cleanup error
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      void stopCamera();
    };
  }, []);

  const handleDecodedScan = async (decodedText: string) => {
    if (!event) return;
    const now = Date.now();
    if (cooldownRef.current.code === decodedText && now < cooldownRef.current.until) {
      return;
    }
    cooldownRef.current = { code: decodedText, until: now + 2600 };

    const parsed = parseScannedQrText(decodedText);
    if (!parsed) {
      playTone(false);
      setLastResult({
        ok: false,
        code: 'INVALID_SECRET',
        message: 'Unrecognized QR format. Please scan an official Individual QR Ticket.',
      });
      return;
    }

    if (parsed.eventId && parsed.eventId !== event.id) {
      playTone(false);
      setLastResult({
        ok: false,
        code: 'WRONG_EVENT',
        message: `Ticket belongs to a different event (${parsed.eventId}). Active event is ${event.title}.`,
      });
      return;
    }

    setProcessing(true);
    try {
      const res = await performAtomicCheckIn({
        event,
        participantId: parsed.participantId,
        expectedSecret: parsed.qrSecret,
        method: 'individual_qr',
        actorRole: role,
        user,
      });
      setLastResult(res);
      playTone(res.ok);
    } catch (error) {
      playTone(false);
      onNotify('error', 'Scan Error', error instanceof Error ? error.message : 'Check-in transaction failed.');
    } finally {
      setProcessing(false);
    }
  };

  const startCamera = async () => {
    if (!event) {
      onNotify('warning', 'No Event Selected', 'Select or create an event before scanning.');
      return;
    }
    try {
      const devices = await Html5Qrcode.getCameras();
      setCameras(devices.map((d) => ({ id: d.id, label: d.label || `Camera ${d.id.slice(0, 6)}` })));
      const preferred =
        selectedCameraId ||
        devices.find((d) => /back|rear|environment/i.test(d.label))?.id ||
        devices[0]?.id;

      if (!preferred) {
        onNotify('error', 'No Camera Found', 'No camera device was detected. You can upload a QR image or use Manual Entry.');
        return;
      }
      setSelectedCameraId(preferred);

      const qr = new Html5Qrcode('qr-reader-viewport');
      scannerRef.current = qr;
      setCameraActive(true);

      await qr.start(
        preferred,
        { fps: 10, qrbox: { width: 280, height: 280 }, aspectRatio: 1.333 },
        (text) => {
          void handleDecodedScan(text);
        },
        () => {
          // ignore per-frame decode misses
        }
      );
    } catch (error) {
      setCameraActive(false);
      onNotify(
        'error',
        'Camera Permission Needed',
        error instanceof Error
          ? error.message
          : 'Allow camera permissions in your browser, or use QR Image Upload / Manual Entry.'
      );
    }
  };

  const handleScanImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !event) return;
    try {
      const qr = new Html5Qrcode('qr-file-temp');
      const decoded = await qr.scanFile(file, false);
      qr.clear();
      await handleDecodedScan(decoded);
    } catch {
      playTone(false);
      setLastResult({
        ok: false,
        code: 'INVALID_SECRET',
        message: 'Could not detect a valid QR code in the uploaded image.',
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleManualCheckIn = async (participantId: string) => {
    if (!event) return;
    const cleanId = participantId.trim();
    if (!cleanId) return;
    setProcessing(true);
    try {
      const res = await performAtomicCheckIn({
        event,
        participantId: cleanId,
        method: 'manual_staff',
        actorRole: role,
        user,
      });
      setLastResult(res);
      playTone(res.ok);
      if (res.ok) setManualIdInput('');
    } catch (error) {
      onNotify('error', 'Manual Check-In Failed', error instanceof Error ? error.message : 'Unable to check in.');
    } finally {
      setProcessing(false);
    }
  };

  const filteredMatches = manualQuery.trim()
    ? participants
        .filter((p) => {
          const q = manualQuery.trim().toLowerCase();
          return (
            p.id.toLowerCase().includes(q) ||
            p.fullName.toLowerCase().includes(q) ||
            p.email.toLowerCase().includes(q) ||
            p.company.toLowerCase().includes(q)
          );
        })
        .slice(0, 8)
    : [];

  if (!event) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
        Select an active event from the top header to begin scanning QR tickets.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Live Verification Result Banner */}
      {lastResult && (
        <div
          role="alert"
          className={`border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            lastResult.ok
              ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
              : lastResult.code === 'DUPLICATE'
                ? 'bg-amber-50 border-amber-300 text-amber-950'
                : 'bg-red-50 border-red-300 text-red-950'
          }`}
        >
          <div className="flex items-start gap-3.5">
            {lastResult.ok ? (
              <CheckCircle2 className="w-7 h-7 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle
                className={`w-7 h-7 shrink-0 mt-0.5 ${
                  lastResult.code === 'DUPLICATE' ? 'text-amber-700' : 'text-red-700'
                }`}
              />
            )}
            <div>
              <p className="font-display text-lg font-semibold">
                {lastResult.ok
                  ? `Check-In Confirmed (${lastResult.assignedStatus === 'late' ? 'Late Arrival' : 'On Time'})`
                  : lastResult.code === 'DUPLICATE'
                    ? 'Duplicate Check-In Rejected'
                    : 'Verification Failed'}
              </p>
              <p className="text-sm mt-0.5">{lastResult.message}</p>
              {lastResult.participant && (
                <p className="text-xs font-mono tabular-nums mt-1.5 opacity-80">
                  ID: {lastResult.participant.id} · {lastResult.participant.company} (
                  {lastResult.participant.position})
                  {lastResult.participant.checkInAt &&
                    ` · Original Check-In: ${formatTimestamp(lastResult.participant.checkInAt)}`}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLastResult(null)}
            className="px-3 py-1.5 text-xs font-medium bg-white/80 hover:bg-white border border-black/10 rounded-lg self-start sm:self-center shrink-0"
          >
            Clear
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Large Camera QR Scanner */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
                Individual QR Ticket Scanner
              </h2>
              <p className="text-xs text-slate-500">
                Validates participant identity, event match, and prevents duplicate entries.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSoundEnabled(!soundEnabled)}
                aria-label="Toggle confirmation sound"
                className="p-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>

              {!cameraActive ? (
                <button
                  type="button"
                  onClick={startCamera}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  <Camera className="w-4 h-4" />
                  <span>Start Camera</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  <CameraOff className="w-4 h-4" />
                  <span>Stop Camera</span>
                </button>
              )}
            </div>
          </div>

          <div className="p-6 flex-1 flex flex-col items-center justify-center bg-slate-950/5">
            {cameras.length > 1 && (
              <div className="w-full max-w-md mb-4">
                <select
                  value={selectedCameraId}
                  onChange={async (e) => {
                    const next = e.target.value;
                    setSelectedCameraId(next);
                    if (cameraActive) {
                      await stopCamera();
                    }
                  }}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700"
                >
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="w-full max-w-lg min-h-[340px] bg-[#061226] rounded-xl overflow-hidden flex items-center justify-center relative border border-slate-300">
              <div id="qr-reader-viewport" className="w-full" />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-slate-300">
                  <Camera className="w-12 h-12 text-slate-400 mb-3" />
                  <p className="text-sm font-medium text-white">Camera Scanner Standby</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs">
                    Tap &ldquo;Start Camera&rdquo; to scan participant QR passes in real time, or upload a QR ticket image below.
                  </p>
                </div>
              )}
            </div>

            <div id="qr-file-temp" className="hidden" />

            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleScanImageFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg transition-colors"
              >
                <ImageUp className="w-4 h-4" />
                <span>Scan QR from Image File</span>
              </button>
              {processing && (
                <span className="text-xs font-medium text-[#1E40AF]">Verifying check-in...</span>
              )}
            </div>
          </div>
        </div>

        {/* Authorized Manual Entry */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#0B1D3A]">
              Authorized Manual Entry
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              For participants without a readable QR code. Every manual check-in is logged with your staff credentials.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleManualCheckIn(manualIdInput);
            }}
            className="space-y-2"
          >
            <label className="block text-xs font-semibold text-slate-700">
              Direct Check-In by Participant ID
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualIdInput}
                onChange={(e) => setManualIdInput(e.target.value)}
                placeholder="EVT-A9K2M4"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
              />
              <button
                type="submit"
                disabled={processing || !manualIdInput.trim()}
                className="px-4 py-2 bg-[#1E40AF] hover:bg-[#1B3B6F] text-white text-sm font-medium rounded-lg disabled:opacity-50 whitespace-nowrap"
              >
                Check In
              </button>
            </div>
          </form>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <label className="block text-xs font-semibold text-slate-700">
              Search Registered Roster
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                placeholder="Search by name, email, company, or ID..."
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
              />
            </div>

            {manualQuery.trim() && (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {filteredMatches.length === 0 ? (
                  <p className="p-4 text-xs text-slate-500 text-center">
                    No matching participant found in {event.title}.
                  </p>
                ) : (
                  filteredMatches.map((p) => {
                    const alreadyIn = p.attendanceStatus === 'present' || p.attendanceStatus === 'late';
                    return (
                      <div key={p.id} className="p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{p.fullName}</p>
                          <p className="text-xs text-slate-500 truncate">
                            <span className="font-mono">{p.id}</span> · {p.company}
                          </p>
                        </div>
                        {alreadyIn ? (
                          <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap shrink-0">
                            Checked In ({p.attendanceStatus})
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() => handleManualCheckIn(p.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-medium rounded-lg shrink-0"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>Check In</span>
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
