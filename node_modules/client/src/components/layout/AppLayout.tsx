import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  UploadCloud,
  Sliders,
  Calendar,
  CheckCircle2,
  Layers,
  TrendingUp,
  Bot,
  BarChart3,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';

interface NavItem {
  name: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const CORE_NAV_ITEMS: NavItem[] = [
  { name: 'Overview', to: '/', icon: LayoutDashboard },
  { name: 'Upload Center', to: '/uploads', icon: UploadCloud },
  { name: 'Rules', to: '/rules', icon: Sliders },
  { name: 'Holidays', to: '/holidays', icon: Calendar },
  { name: 'Validation', to: '/validation', icon: CheckCircle2 },
];

const PHASE2_NAV_ITEMS: NavItem[] = [
  { name: 'Demand Forecast', to: '/forecast', icon: TrendingUp, badge: 'Optional' },
];

export const AppLayout: React.FC = () => {
  const location = useLocation();

  const getActiveStep = () => {
    if (location.pathname.startsWith('/generate')) return 3;
    if (location.pathname.startsWith('/validation')) return 2;
    return 1;
  };

  const activeStep = getActiveStep();

  const workflowSteps = [
    { step: 1, label: 'Inputs & Upload', active: activeStep === 1 },
    { step: 2, label: 'Validate (ETL)', active: activeStep === 2 },
    { step: 3, label: 'Generate', active: activeStep === 3 },
    { step: 4, label: 'Review', active: false },
  ];

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/': return 'Readiness Overview';
      case '/uploads': return 'Upload Center';
      case '/rules': return 'Academic & Scheduling Rules';
      case '/holidays': return 'Holidays & Academic Breaks';
      case '/validation': return 'Dataset Validation & Clean ETL';
      case '/forecast': return 'Course Demand Forecast (Phase 2, optional)';
      case '/generate': return 'Timetable Engine (Module 3)';
      case '/dashboard': return 'Academic Performance Dashboard & Exports';
      case '/changes': return 'Management Changes & Re-solve (Phase 3)';
      case '/assistant': return 'Smart Timetable Assistant (Phase 3)';
      default: return 'Timetable Planning System';
    }
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center justify-between px-3 py-2 text-xs font-medium rounded transition-colors',
      isActive
        ? 'bg-navy-light text-white font-semibold shadow-sm'
        : 'text-slate-300 hover:text-white hover:bg-navy-light/50'
    );

  return (
    <div className="min-h-screen flex bg-bg-page text-text-primary">
      {/* Fixed Left Sidebar */}
      <aside className="w-64 bg-navy text-white flex flex-col fixed inset-y-0 left-0 z-30 select-none">
        {/* Brand */}
        <div className="h-16 px-5 border-b border-navy-light flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs font-semibold tracking-wide uppercase text-slate-300 block leading-tight">
              Resource Planner
            </span>
            <span className="text-sm font-bold text-white tracking-tight">Smart Timetable</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          {/* Core Workflow */}
          <div className="space-y-1">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Workflow Module
            </div>
            {CORE_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass}>
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0 text-slate-300" />
                    <span>{item.name}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[10px] px-1.5 py-0.2 bg-navy-dark text-slate-400 rounded border border-navy-light font-normal">
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>

          {/* Module 3 */}
          <div className="space-y-1 pt-2 border-t border-navy-light/50">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Module 3
            </div>
            <NavLink to="/generate" className={navLinkClass}>
              <div className="flex items-center gap-2.5">
                <Calendar className="w-4 h-4 shrink-0 text-slate-300" />
                <span>Generate Timetable</span>
              </div>
            </NavLink>
          </div>

          {/* Phase 2 */}
          <div className="space-y-1 pt-2 border-t border-navy-light/50">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Phase 2 (optional)
            </div>
            {PHASE2_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.to} to={item.to} className={navLinkClass}>
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0 text-accent" />
                    <span>{item.name}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[10px] px-1.5 py-0.2 bg-blue-900/50 text-blue-200 rounded border border-blue-700/50 font-medium">
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>

          {/* Phase 3 */}
          <div className="space-y-1 pt-2 border-t border-navy-light/50">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <span>Phase 3</span>
              <span className="px-1 py-0.5 bg-indigo-500/30 text-indigo-200 rounded text-[9px] font-semibold">NEW</span>
            </div>
            <NavLink to="/changes" className={navLinkClass}>
              <div className="flex items-center gap-2.5">
                <Sliders className="w-4 h-4 shrink-0 text-indigo-300" />
                <span>Manage Changes</span>
              </div>
            </NavLink>
            <NavLink to="/assistant" className={navLinkClass}>
              <div className="flex items-center gap-2.5">
                <Bot className="w-4 h-4 shrink-0 text-indigo-300" />
                <span>AI Assistant</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 bg-indigo-700/70 text-indigo-100 rounded border border-indigo-600/50 font-medium">
                β
              </span>
            </NavLink>
          </div>

          {/* Output Layer */}
          <div className="space-y-1 pt-2 border-t border-navy-light/50">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <span>Outputs & Analytics</span>
              <span className="px-1 py-0.5 bg-emerald-500/30 text-emerald-200 rounded text-[9px] font-semibold">OUTPUT</span>
            </div>
            <NavLink to="/dashboard" className={navLinkClass}>
              <div className="flex items-center gap-2.5">
                <BarChart3 className="w-4 h-4 shrink-0 text-emerald-300" />
                <span>Dashboard & Exports</span>
              </div>
            </NavLink>
          </div>
        </nav>

        {/* Sidebar Footer — Role Switcher + Language Toggle */}
        <div className="p-3 border-t border-navy-light/80 text-[11px] text-slate-400 bg-navy-dark/40 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 shrink-0">Role:</span>
            <select
              defaultValue={localStorage.getItem('app_user_role') || 'hod'}
              onChange={(e) => {
                localStorage.setItem('app_user_role', e.target.value);
                window.dispatchEvent(new Event('storage'));
              }}
              className="flex-1 bg-navy-light/60 border border-navy-light text-slate-200 text-[11px] rounded px-1.5 py-0.5 focus:outline-none"
            >
              <option value="hod">HOD (Full Access)</option>
              <option value="staff">Staff (Limited)</option>
              <option value="student">Student (Read-only)</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Language:</span>
            <button
              onClick={() => {
                const current = localStorage.getItem('app_language') || 'en';
                const next = current === 'en' ? 'ta' : 'en';
                localStorage.setItem('app_language', next);
                window.dispatchEvent(new Event('storage'));
              }}
              className="px-2 py-0.5 bg-navy-light/50 hover:bg-navy-light text-slate-300 hover:text-white rounded border border-navy-light text-[10px] font-medium transition-colors"
            >
              {localStorage.getItem('app_language') === 'ta' ? 'English' : 'தமிழ்'}
            </button>
          </div>
          <div className="flex items-center justify-between font-mono pt-1 border-t border-navy-light/30">
            <span>Version 3.0.0</span>
            <span className="px-1.5 py-0.5 rounded bg-indigo-800/60 text-indigo-200 text-[10px]">Phase 3</span>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">Modules 1, 2, 3 · Phase 3 Active</div>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 ml-64 flex flex-col min-w-[760px]">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-border sticky top-0 z-20 px-8 flex items-center justify-between shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-semibold text-text-primary">{getPageTitle()}</h2>
          </div>

          {/* 4-Step Indicator */}
          <div className="hidden lg:flex items-center gap-3">
            {workflowSteps.map((s, idx) => (
              <React.Fragment key={s.step}>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold tabular-nums',
                      s.active
                        ? 'bg-navy text-white ring-2 ring-navy/20'
                        : 'bg-slate-100 text-text-muted border border-border'
                    )}
                  >
                    {s.step}
                  </span>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      s.active ? 'text-text-primary font-semibold' : 'text-text-muted'
                    )}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < workflowSteps.length - 1 && (
                  <div className="w-6 h-px bg-border shrink-0" />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded bg-slate-100 text-text-muted border border-border">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
              API: Online (Port 4000)
            </span>
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 p-8 overflow-x-hidden">
          <div className="max-w-6xl mx-auto space-y-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
