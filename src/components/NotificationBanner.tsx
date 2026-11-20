import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export interface NotificationState {
  id: number;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
}

interface Props {
  notification: NotificationState | null;
  onDismiss: () => void;
}

export const NotificationBanner: React.FC<Props> = ({ notification, onDismiss }) => {
  if (!notification) return null;

  const styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    error: 'bg-red-50 border-red-200 text-red-900',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    info: 'bg-slate-100 border-slate-300 text-slate-900',
  }[notification.type];

  const Icon =
    notification.type === 'success'
      ? CheckCircle2
      : notification.type === 'info'
        ? Info
        : AlertCircle;

  const iconColor = {
    success: 'text-emerald-700',
    error: 'text-red-700',
    warning: 'text-amber-700',
    info: 'text-[#0B1D3A]',
  }[notification.type];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`border rounded-lg px-4 py-3 flex items-start justify-between gap-3 mb-6 no-print ${styles}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />
        <div>
          <p className="text-sm font-semibold">{notification.title}</p>
          {notification.message && <p className="text-sm opacity-90 mt-0.5">{notification.message}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="p-1 rounded hover:bg-black/5 transition-colors shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
