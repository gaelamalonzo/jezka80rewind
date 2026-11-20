import React, { useState } from 'react';
import {
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  ScanLine,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type { AppView, EffectiveRole, EventRecord } from '../types';

interface Props {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  role: EffectiveRole;
  userEmail: string;
  userName: string;
  events: EventRecord[];
  selectedEventId: string;
  onSelectEvent: (eventId: string) => void;
  onSignOut: () => void;
  children: React.ReactNode;
}

interface NavItem {
  id: AppView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'scanner', label: 'QR Scanner', icon: ScanLine },
  { id: 'registration', label: 'Registration', icon: UserPlus },
  { id: 'shared-qr', label: 'Shared Event QR', icon: QrCode },
  { id: 'attendance', label: 'Attendance & Audit', icon: ClipboardList },
  { id: 'reports', label: 'Reports & Export', icon: FileSpreadsheet },
  { id: 'access', label: 'Access & Setup', icon: ShieldCheck, adminOnly: true },
];

export const SidebarLayout: React.FC<Props> = ({
  activeView,
  onSelectView,
  role,
  userEmail,
  userName,
  events,
  selectedEventId,
  onSelectEvent,
  onSignOut,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const visibleNav = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');
  const activeItem = visibleNav.find((i) => i.id === activeView) || visibleNav[0];
  const activeEvent = events.find((e) => e.id === selectedEventId);

  const roleLabel = role === 'admin' ? 'Administrator' : role === 'staff' ? 'Check-In Staff' : 'Participant';

  const handleNavClick = (view: AppView) => {
    onSelectView(view);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Corporate Navy Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0B1D3A] text-white no-print">
        <div className="h-16 flex items-center px-6 border-b border-white/10">
          <span className="font-display text-base font-semibold tracking-tight whitespace-nowrap">
            Event Attendance
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Primary Sidebar">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors text-left whitespace-nowrap ${
                  isActive
                    ? 'bg-[#1E40AF] text-white'
                    : 'text-slate-300 hover:bg-[#132B52] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 text-xs text-slate-300 space-y-2">
          <div className="truncate font-medium text-white">{userName || userEmail}</div>
          <div className="flex items-center gap-1.5 text-slate-400 truncate">
            <span>{roleLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{userEmail}</span>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full mt-2 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Slide-over Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] bg-[#0B1D3A] text-white flex flex-col z-10">
            <div className="h-16 flex items-center justify-between px-5 border-b border-white/10">
              <span className="font-display text-base font-semibold tracking-tight">
                Event Attendance
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 rounded-lg text-slate-300 hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-lg text-sm font-medium transition-colors text-left ${
                      isActive
                        ? 'bg-[#1E40AF] text-white'
                        : 'text-slate-300 hover:bg-[#132B52] hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-white/10 text-xs text-slate-300 space-y-2">
              <div className="font-medium text-white truncate">{userName || userEmail}</div>
              <div className="text-slate-400 truncate">
                {roleLabel} · {userEmail}
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Clean 3-zone Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="font-display font-semibold text-[#0B1D3A] whitespace-nowrap">
                {activeItem?.label}
              </span>
              {activeEvent && (
                <>
                  <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                    /
                  </span>
                  <span className="text-slate-500 truncate hidden sm:inline max-w-[260px]">
                    {activeEvent.title}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {events.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span className="hidden md:inline whitespace-nowrap">Active Event:</span>
                <select
                  value={selectedEventId}
                  onChange={(e) => onSelectEvent(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E40AF] max-w-[220px] sm:max-w-[280px]"
                >
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title} ({ev.eventDate})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
