import QRCode from 'qrcode';
import type { EventRecord, ParticipantRecord } from '../types';
import { encodeParticipantQrPayload } from './validation';

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

export async function downloadParticipantTicketPng(
  participant: ParticipantRecord,
  event: EventRecord
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1220;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Top Navy Header
  ctx.fillStyle = '#0B1D3A';
  ctx.fillRect(0, 0, canvas.width, 250);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 20px "DM Sans", sans-serif';
  ctx.fillText('EVENT ATTENDANCE SYSTEM · OFFICIAL ENTRY PASS', 64, 72);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 40px "Plus Jakarta Sans", sans-serif';
  wrapText(ctx, event.title, 64, 134, 772, 48);

  ctx.fillStyle = '#CBD5E1';
  ctx.font = '500 22px "DM Sans", sans-serif';
  ctx.fillText(`${event.eventDate}  ·  ${event.startTime} – ${event.endTime}  ·  ${event.venue}`, 64, 218);

  // QR Code Data URL
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

  // Draw QR Frame
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.strokeRect(210, 300, 480, 480);
  ctx.drawImage(qrCanvas, 230, 320, 440, 440);

  // Participant ID Banner
  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(64, 820, 772, 86);
  ctx.fillStyle = '#475569';
  ctx.font = '600 18px "DM Sans", sans-serif';
  ctx.fillText('UNIQUE PARTICIPANT ID', 96, 854);
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 32px "JetBrains Mono", monospace';
  ctx.fillText(participant.id, 96, 892);

  // Participant Metadata Rows
  const details = [
    ['PARTICIPANT NAME', participant.fullName],
    ['COMPANY / DEPARTMENT', `${participant.company} — ${participant.position}`],
    ['EMAIL ADDRESS', participant.email],
    ['MOBILE NUMBER', participant.mobile],
  ];

  let y = 960;
  for (const [label, value] of details) {
    ctx.fillStyle = '#64748B';
    ctx.font = '600 16px "DM Sans", sans-serif';
    ctx.fillText(label, 64, y);
    ctx.fillStyle = '#0F172A';
    ctx.font = '600 24px "DM Sans", sans-serif';
    ctx.fillText(value.slice(0, 56), 64, y + 32);
    y += 66;
  }

  // Trigger download
  const link = document.createElement('a');
  link.download = `QR-Pass-${participant.id}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export async function downloadSharedQrPosterPng(event: EventRecord, token: string): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1320;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#0B1D3A';
  ctx.fillRect(0, 0, canvas.width, 300);

  ctx.fillStyle = '#93C5FD';
  ctx.font = '600 22px "DM Sans", sans-serif';
  ctx.fillText('SELF-CHECK-IN STATION · SCAN WITH MOBILE CAMERA', 72, 82);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 46px "Plus Jakarta Sans", sans-serif';
  wrapText(ctx, event.title, 72, 152, 856, 54);

  ctx.fillStyle = '#CBD5E1';
  ctx.font = '500 24px "DM Sans", sans-serif';
  ctx.fillText(`${event.eventDate}  ·  ${event.startTime} – ${event.endTime}  ·  ${event.venue}`, 72, 260);

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
  ctx.strokeRect(180, 360, 640, 640);
  ctx.drawImage(qrCanvas, 200, 380, 600, 600);

  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 32px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('How to Check In', 72, 1085);

  ctx.fillStyle = '#334155';
  ctx.font = '500 24px "DM Sans", sans-serif';
  ctx.fillText('1. Scan this Shared Event QR code with your smartphone camera.', 72, 1135);
  ctx.fillText('2. Verify your identity and confirm your Participant ID or Mobile.', 72, 1178);
  ctx.fillText('3. Receive instant single-use check-in confirmation.', 72, 1221);

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
