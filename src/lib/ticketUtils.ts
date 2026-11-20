import QRCode from 'qrcode';
import type { EventRecord, ParticipantRecord } from '../types';
import { encodeParticipantQrPayload } from './validation';

export type QrDesignTheme = 'jezka80_rewind' | 'corporate_navy';

export function buildParticipantTicketUrl(eventId: string, participantId: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('ticket', participantId);
  url.searchParams.set('event', eventId);
  return url.toString();
}

export function buildSharedEventQrUrl(eventId: string, token: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('mode', 'self-checkin');
  url.searchParams.set('eventId', eventId);
  url.searchParams.set('token', token);
  return url.toString();
}

export function buildOnlineRegistrationUrl(eventId?: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('mode', 'register');
  if (eventId) url.searchParams.set('eventId', eventId);
  return url.toString();
}

export function openTicketEmailDraft(participant: ParticipantRecord, event: EventRecord): void {
  const ticketUrl = buildParticipantTicketUrl(event.id, participant.id);
  const subject = encodeURIComponent(`Event QR Pass: ${event.title} [${participant.id}]`);
  const body = encodeURIComponent(
    [
      `Hello ${participant.fullName},`,
      ``,
      `Your registration for ${event.title} is confirmed.`,
      ``,
      `PARTICIPANT PASS DETAILS`,
      `Participant ID: ${participant.id}`,
      ...(participant.employeeId ? [`Employee ID No.: ${participant.employeeId}`] : []),
      `Name: ${participant.fullName}`,
      `Company: ${participant.company} (${participant.position})`,
      `Event Date: ${event.eventDate}`,
      `Time: ${event.startTime} - ${event.endTime}`,
      `Venue: ${event.venue}`,
      ``,
      `ACCESS YOUR INDIVIDUAL QR TICKET:`,
      `${ticketUrl}`,
      ``,
      `Please present your Individual QR Ticket at the check-in desk upon arrival.`,
      ``,
      `Regards,`,
      `Event Attendance System`,
    ].join('\n')
  );
  window.location.href = `mailto:${encodeURIComponent(participant.email)}?subject=${subject}&body=${body}`;
}

function drawRewindHeaderArtwork(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  // Deep Navy gradient base
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#061226');
  grad.addColorStop(0.6, '#0B1D3A');
  grad.addColorStop(1, '#172554');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle retro perspective horizon grid in background
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.lineWidth = 1.5;
  const step = 42;
  for (let y = height - 110; y < height; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  const centerX = width * 0.78;
  for (let x = -width; x <= width * 2; x += step * 2) {
    ctx.beginPath();
    ctx.moveTo(centerX, 20);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Retro sunburst circle silhouette on right
  const sunGrad = ctx.createLinearGradient(width - 220, 30, width - 220, 210);
  sunGrad.addColorStop(0, 'rgba(245, 158, 11, 0.35)');
  sunGrad.addColorStop(1, 'rgba(225, 29, 72, 0.28)');
  ctx.fillStyle = sunGrad;
  ctx.beginPath();
  ctx.arc(width - 140, 125, 82, 0, Math.PI * 2);
  ctx.fill();

  // Cutout retro scanlines across sunburst
  ctx.fillStyle = '#0B1D3A';
  for (let sy = 128; sy < 210; sy += 16) {
    ctx.fillRect(width - 230, sy, 180, 5);
  }
  ctx.restore();

  // Triple Retro 80s Ribbon Stripes at bottom of header
  ctx.fillStyle = '#F59E0B'; // Retro Amber Gold
  ctx.fillRect(0, height - 18, width, 6);
  ctx.fillStyle = '#E11D48'; // Retro Coral Crimson
  ctx.fillRect(0, height - 12, width, 6);
  ctx.fillStyle = '#38BDF8'; // Retro Electric Sky
  ctx.fillRect(0, height - 6, width, 6);
}

function drawQrCornerBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  accentColor: string
) {
  const len = 28;
  ctx.save();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 5;
  ctx.lineCap = 'square';

  // Top-left
  ctx.beginPath();
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(x + size - len, y);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x + size, y + len);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(x, y + size - len);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x + len, y + size);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(x + size - len, y + size);
  ctx.lineTo(x + size, y + size);
  ctx.lineTo(x + size, y + size - len);
  ctx.stroke();
  ctx.restore();
}

export async function downloadParticipantTicketPng(
  participant: ParticipantRecord,
  event: EventRecord,
  theme: QrDesignTheme = 'jezka80_rewind'
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1260;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const isRewind = theme === 'jezka80_rewind';

  // Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Header
  const headerHeight = 270;
  if (isRewind) {
    drawRewindHeaderArtwork(ctx, canvas.width, headerHeight);
  } else {
    ctx.fillStyle = '#0B1D3A';
    ctx.fillRect(0, 0, canvas.width, headerHeight);
  }

  ctx.fillStyle = isRewind ? '#FCD34D' : '#94A3B8';
  ctx.font = '700 20px "DM Sans", sans-serif';
  ctx.fillText(
    isRewind
      ? '<< JEZKA80 REWIND  ·  OFFICIAL QR ENTRY PASS'
      : 'EVENT ATTENDANCE SYSTEM · OFFICIAL ENTRY PASS',
    64,
    68
  );

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 42px "Plus Jakarta Sans", sans-serif';
  wrapText(ctx, event.title, 64, 128, isRewind ? 600 : 772, 48);

  ctx.fillStyle = '#CBD5E1';
  ctx.font = '500 22px "DM Sans", sans-serif';
  ctx.fillText(
    `${event.eventDate}  ·  ${event.startTime} – ${event.endTime}  ·  ${event.venue}`,
    64,
    224
  );

  // QR Code Canvas
  const qrPayload = encodeParticipantQrPayload({
    t: 'EAS_TICKET',
    e: event.id,
    p: participant.id,
    k: participant.qrSecret,
  });

  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, qrPayload, {
    width: 440,
    margin: 2,
    color: { dark: '#0B1D3A', light: '#FFFFFF' },
    errorCorrectionLevel: 'H',
  });

  // QR Frame + Corner Viewfinder Brackets
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.strokeRect(210, 316, 480, 480);
  ctx.drawImage(qrCanvas, 230, 336, 440, 440);
  if (isRewind) {
    drawQrCornerBrackets(ctx, 206, 312, 488, '#E11D48');
  }

  // Perforated Ticket Stub Divider
  ctx.save();
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(32, 832);
  ctx.lineTo(canvas.width - 32, 832);
  ctx.stroke();
  ctx.restore();

  // Semicircular ticket notches
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.arc(0, 832, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(canvas.width, 832, 20, 0, Math.PI * 2);
  ctx.fill();

  // Participant ID Banner
  ctx.fillStyle = isRewind ? '#0B1D3A' : '#F1F5F9';
  ctx.fillRect(64, 862, 772, 88);
  ctx.fillStyle = isRewind ? '#FCD34D' : '#475569';
  ctx.font = '600 17px "DM Sans", sans-serif';
  ctx.fillText('UNIQUE PARTICIPANT ID', 96, 896);
  ctx.fillStyle = isRewind ? '#FFFFFF' : '#0B1D3A';
  ctx.font = '700 32px "JetBrains Mono", monospace';
  ctx.fillText(participant.id, 96, 934);
  if (participant.employeeId) {
    ctx.fillStyle = isRewind ? '#CBD5E1' : '#475569';
    ctx.font = '600 17px "DM Sans", sans-serif';
    ctx.fillText('EMPLOYEE ID NO.', 520, 896);
    ctx.fillStyle = isRewind ? '#FCD34D' : '#0B1D3A';
    ctx.font = '700 28px "JetBrains Mono", monospace';
    ctx.fillText(participant.employeeId, 520, 934);
  }

  // Participant Metadata Rows
  const details = [
    ['PARTICIPANT NAME', participant.fullName],
    ['COMPANY / DEPARTMENT', `${participant.company} — ${participant.position}`],
    ['EMAIL ADDRESS', participant.email || '—'],
    ['MOBILE NUMBER', participant.mobile || '—'],
  ];

  let y = 1002;
  for (const [label, value] of details) {
    ctx.fillStyle = '#64748B';
    ctx.font = '600 16px "DM Sans", sans-serif';
    ctx.fillText(label, 64, y);
    ctx.fillStyle = '#0F172A';
    ctx.font = '600 23px "DM Sans", sans-serif';
    ctx.fillText(value.slice(0, 56), 64, y + 30);
    y += 62;
  }

  const link = document.createElement('a');
  link.download = `QR-Pass-${participant.id}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export async function downloadSharedQrPosterPng(
  event: EventRecord,
  token: string,
  theme: QrDesignTheme = 'jezka80_rewind'
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1360;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const isRewind = theme === 'jezka80_rewind';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const headerHeight = 320;
  if (isRewind) {
    drawRewindHeaderArtwork(ctx, canvas.width, headerHeight);
  } else {
    ctx.fillStyle = '#0B1D3A';
    ctx.fillRect(0, 0, canvas.width, headerHeight);
  }

  ctx.fillStyle = isRewind ? '#FCD34D' : '#93C5FD';
  ctx.font = '700 22px "DM Sans", sans-serif';
  ctx.fillText(
    isRewind
      ? '<< JEZKA80 REWIND  ·  MOBILE SELF-CHECK-IN STATION'
      : 'SELF-CHECK-IN STATION · SCAN WITH MOBILE CAMERA',
    72,
    82
  );

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 48px "Plus Jakarta Sans", sans-serif';
  wrapText(ctx, event.title, 72, 152, isRewind ? 670 : 856, 56);

  ctx.fillStyle = '#CBD5E1';
  ctx.font = '500 24px "DM Sans", sans-serif';
  ctx.fillText(
    `${event.eventDate}  ·  ${event.startTime} – ${event.endTime}  ·  ${event.venue}`,
    72,
    272
  );

  const qrUrl = buildSharedEventQrUrl(event.id, token);
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, qrUrl, {
    width: 600,
    margin: 2,
    color: { dark: '#0B1D3A', light: '#FFFFFF' },
    errorCorrectionLevel: 'H',
  });

  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 3;
  ctx.strokeRect(180, 380, 640, 640);
  ctx.drawImage(qrCanvas, 200, 400, 600, 600);
  if (isRewind) {
    drawQrCornerBrackets(ctx, 174, 374, 652, '#E11D48');
  }

  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 32px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('How to Check In', 72, 1110);

  ctx.fillStyle = '#334155';
  ctx.font = '500 24px "DM Sans", sans-serif';
  ctx.fillText('1. Scan this Shared Event QR code with your smartphone camera.', 72, 1162);
  ctx.fillText('2. Verify your identity and confirm your Participant ID or Mobile.', 72, 1206);
  ctx.fillText('3. Receive instant single-use check-in confirmation.', 72, 1250);

  if (isRewind) {
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(0, canvas.height - 12, canvas.width, 4);
    ctx.fillStyle = '#E11D48';
    ctx.fillRect(0, canvas.height - 8, canvas.width, 4);
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(0, canvas.height - 4, canvas.width, 4);
  }

  const link = document.createElement('a');
  link.download = `Event-CheckIn-Poster-${event.id}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, currentY);
}
