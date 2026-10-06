import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Users,
  Building,
  UserCheck,
  Sparkles,
  Info,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ChangeType,
  ChangeRecord,
  ChangePreviewResponse,
  previewManagementChange,
  confirmManagementChange,
  discardManagementChange,
  revertManagementChange,
  fetchManagementChanges,
  fetchManagementAlerts,
  ManagementAlertsResponse,
  getStoredUserRole,
  getStoredLanguage,
} from '../lib/api';
import { I18N_STRINGS } from '../lib/i18n';

export const ChangesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'leave' | 'event' | 'intake' | 'history'>('leave');
  const [lang, setLang] = useState<'en' | 'ta'>(getStoredLanguage());
  const role = getStoredUserRole();
  const t = I18N_STRINGS[lang];

  // Options from clean database
  const [staffList, setStaffList] = useState<any[]>([]);
  const [roomList, setRoomList] = useState<any[]>([]);
  const [sectionList, setSectionList] = useState<any[]>([]);

  // Alerts state
  const [alerts, setAlerts] = useState<ManagementAlertsResponse | null>(null);

  // Forms state
  const [leaveForm, setLeaveForm] = useState({
    staff_id: '',
    start_date: '2026-08-10',
    end_date: '2026-08-14',
    reason: 'Academic Conference',
  });

  const [eventForm, setEventForm] = useState({
    name: 'Department Symposium',
    date: '2026-08-18',
    start_period: 2,
    end_period: 4,
    venue_room_id: '',
    staff_involved: '',
    sections_involved: '',
  });

  const [intakeForm, setIntakeForm] = useState({
    section_id: '',
    new_size: 40,
  });

  // Preview & Loading state
  const [preview, setPreview] = useState<ChangePreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // History state
  const [history, setHistory] = useState<ChangeRecord[]>([]);

  // Load initial dropdowns and alerts
  useEffect(() => {
    loadDropdownData();
    loadAlerts();
    loadHistory();
  }, []);

  const loadDropdownData = async () => {
    try {
      const [resStaff, resRooms, resSections] = await Promise.all([
        fetch('http://localhost:4000/api/clean/staff').then((r) => r.json()).catch(() => ({ rows: [] })),
        fetch('http://localhost:4000/api/clean/rooms').then((r) => r.json()).catch(() => ({ rows: [] })),
        fetch('http://localhost:4000/api/engine/sections').then((r) => r.json()).catch(() => ({ sections: [] })),
      ]);

      const staff = resStaff.rows || [];
      const rooms = resRooms.rows || [];
      const sections = resSections.sections || [];

      setStaffList(staff);
      setRoomList(rooms);
      setSectionList(sections);

      if (staff.length > 0) setLeaveForm((f) => ({ ...f, staff_id: staff[0].staff_id }));
      if (rooms.length > 0) setEventForm((f) => ({ ...f, venue_room_id: rooms[0].room_id }));
      if (sections.length > 0) setIntakeForm((f) => ({ ...f, section_id: String(sections[0].id || sections[0].section_id) }));
    } catch (err) {
      console.error('Failed to load form options:', err);
    }
  };

  const loadAlerts = async () => {
    try {
      const data = await fetchManagementAlerts();
      setAlerts(data);
    } catch {}
  };

  const loadHistory = async () => {
    try {
      const list = await fetchManagementChanges();
      setHistory(list);
    } catch {}
  };

  // Preview handler
  const handlePreview = async (type: ChangeType) => {
    setLoading(true);
    setPreview(null);
    try {
      let payload: any;
      if (type === 'leave') {
        payload = { ...leaveForm };
      } else if (type === 'event') {
        payload = {
          ...eventForm,
          start_period: Number(eventForm.start_period),
          end_period: Number(eventForm.end_period),
          staff_involved: eventForm.staff_involved ? eventForm.staff_involved.split(';').map((s) => s.trim()) : undefined,
          sections_involved: eventForm.sections_involved ? eventForm.sections_involved.split(',').map((s) => s.trim()) : undefined,
        };
      } else {
        payload = {
          section_id: intakeForm.section_id,
          new_size: Number(intakeForm.new_size),
        };
      }

      const res = await previewManagementChange(type, payload);
      setPreview(res);
      toast.success('Preview calculated successfully. Review changes below.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate preview');
    } finally {
      setLoading(false);
    }
  };

  // Confirm handler
  const handleConfirm = async () => {
    if (!preview?.change_id) return;
    setActionLoading(true);
    try {
      await confirmManagementChange(preview.change_id);
      toast.success('Change successfully committed and timetable updated!');
      setPreview(null);
      loadAlerts();
      loadHistory();
    } catch (err: any) {
      if (err.message?.includes('Stale preview') || err.message?.includes('stale')) {
        toast.error('Preview is stale! The timetable was modified. Please re-run Preview.');
      } else {
        toast.error(err.message || 'Confirmation failed');
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Discard handler
  const handleDiscard = async () => {
    if (!preview?.change_id) {
      setPreview(null);
      return;
    }
    setActionLoading(true);
    try {
      await discardManagementChange(preview.change_id);
      toast.info('Preview discarded.');
      setPreview(null);
    } catch (err: any) {
      toast.error(err.message || 'Discard failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Revert handler
  const handleRevert = async (changeId: number) => {
    if (!confirm('Are you sure you want to revert this change back to its prior state?')) return;
    setActionLoading(true);
    try {
      await revertManagementChange(changeId);
      toast.success('Change reverted successfully!');
      loadAlerts();
      loadHistory();
    } catch (err: any) {
      toast.error(err.message || 'Revert failed');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header & Role/Lang Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-6 border-b border-gray-200 dark:border-gray-800 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t.managementChanges}
            </h1>
            <span className="text-xs bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 px-2 py-0.5 rounded-full font-medium">
              Phase 3
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Incremental re-solve for faculty leave, room bookings, and intake resizing with guaranteed zero clashes.
          </p>
        </div>

        {/* Role & Language Indicators */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs">
            <span className="text-gray-500">{t.roleSwitcher}:</span>
            <span className="font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              {role}
            </span>
          </div>
          <button
            onClick={() => {
              const next = lang === 'en' ? 'ta' : 'en';
              setLang(next);
              localStorage.setItem('app_language', next);
            }}
            className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:hover:bg-indigo-900 dark:text-indigo-300 text-xs font-medium border border-indigo-200 dark:border-indigo-800 transition-colors"
          >
            {t.languageToggle}
          </button>
        </div>
      </div>

      {/* Machine translation note if Tamil */}
      {lang === 'ta' && (
        <div className="mt-4 p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
          <Info className="w-4 h-4 shrink-0" />
          <span>{t.machineAssistedNotice}</span>
        </div>
      )}

      {/* Management Alerts Banner */}
      {alerts && (alerts.unresolved_count > 0 || alerts.shortfall_count > 0) && (
        <div className="mt-6 p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl flex items-start justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">
                Action Required: Timetable Alerts Detected
              </h3>
              <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                {alerts.unresolved_count > 0 && `${alerts.unresolved_count} displaced classes need manual room/slot decisions. `}
                {alerts.shortfall_count > 0 && `${alerts.shortfall_count} subjects have hours shortfall.`}
              </p>
            </div>
          </div>
          <button
            onClick={loadAlerts}
            className="text-xs font-medium text-red-700 hover:text-red-800 dark:text-red-300 underline"
          >
            Refresh Alerts
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mt-8 space-x-6">
        {[
          { key: 'leave', label: t.tabLeave, icon: Users },
          { key: 'event', label: t.tabEvents, icon: Building },
          { key: 'intake', label: t.tabIntake, icon: RefreshCw },
          { key: 'history', label: t.tabHistory, icon: RotateCcw },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key as any);
                setPreview(null);
              }}
              className={`flex items-center gap-2 pb-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Input Form (lg:col-span-5) */}
        {activeTab !== 'history' && (
          <div className="lg:col-span-5 bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
            {/* Faculty Leave Tab */}
            {activeTab === 'leave' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handlePreview('leave');
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                    {t.staffMember}
                  </label>
                  <select
                    value={leaveForm.staff_id}
                    onChange={(e) => setLeaveForm({ ...leaveForm, staff_id: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                    required
                  >
                    {staffList.map((s) => (
                      <option key={s.staff_id} value={s.staff_id}>
                        {s.staff_name} ({s.staff_id}) - {s.designation || 'Faculty'}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                      {t.startDate}
                    </label>
                    <input
                      type="date"
                      value={leaveForm.start_date}
                      onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                      {t.endDate}
                    </label>
                    <input
                      type="date"
                      value={leaveForm.end_date}
                      onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                    {t.reason}
                  </label>
                  <input
                    type="text"
                    value={leaveForm.reason}
                    onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                    placeholder="Medical, Conference, Duty Leave..."
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm transition-colors shadow-sm disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {loading ? t.submitting : t.previewImpact}
                </button>
              </form>
            )}

            {/* Events Tab */}
            {activeTab === 'event' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handlePreview('event');
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                    {t.eventName}
                  </label>
                  <input
                    type="text"
                    value={eventForm.name}
                    onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                    placeholder="Hackathon, Seminar, Workshop..."
                    required
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                      {t.date}
                    </label>
                    <input
                      type="date"
                      value={eventForm.date}
                      onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                      {t.startPeriod}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={7}
                      value={eventForm.start_period}
                      onChange={(e) => setEventForm({ ...eventForm, start_period: parseInt(e.target.value, 10) })}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                      {t.endPeriod}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={7}
                      value={eventForm.end_period}
                      onChange={(e) => setEventForm({ ...eventForm, end_period: parseInt(e.target.value, 10) })}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                    {t.venueRoom}
                  </label>
                  <select
                    value={eventForm.venue_room_id}
                    onChange={(e) => setEventForm({ ...eventForm, venue_room_id: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                    required
                  >
                    {roomList.map((r) => (
                      <option key={r.room_id} value={r.room_id}>
                        {r.room_name} ({r.room_id}) - Cap: {r.capacity}, Type: {r.room_type}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                    Involved Staff IDs (optional, semicolon-separated)
                  </label>
                  <input
                    type="text"
                    value={eventForm.staff_involved}
                    onChange={(e) => setEventForm({ ...eventForm, staff_involved: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                    placeholder="e.g. STF001; STF002"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm transition-colors shadow-sm disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {loading ? t.submitting : t.previewImpact}
                </button>
              </form>
            )}

            {/* Intake Tab */}
            {activeTab === 'intake' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handlePreview('intake');
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                    {t.targetSection}
                  </label>
                  <select
                    value={intakeForm.section_id}
                    onChange={(e) => setIntakeForm({ ...intakeForm, section_id: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                    required
                  >
                    {sectionList.map((sec) => (
                      <option key={sec.id || sec.section_id} value={String(sec.id || sec.section_id)}>
                        {sec.section_label || `Section ${sec.id || sec.section_id}`} (Subject: {sec.subject_code}, Current Size: {sec.size || sec.student_count})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                    {t.newIntakeSize}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={intakeForm.new_size}
                    onChange={(e) => setIntakeForm({ ...intakeForm, new_size: parseInt(e.target.value, 10) })}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                    required
                  />
                  <span className="text-xs text-gray-500 mt-1 block">
                    If size exceeds room capacity, the engine will move the section to a larger room.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm transition-colors shadow-sm disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {loading ? t.submitting : t.previewImpact}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Right Column: Preview Impact Cards & Diff (lg:col-span-7) */}
        {activeTab !== 'history' && (
          <div className="lg:col-span-7">
            {preview ? (
              <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
                {/* Header with status and confirm */}
                <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-gray-800">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      Impact Preview Summary
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Decision Order applied deterministically. Review fixes before committing.
                    </p>
                  </div>
                  <span className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 font-semibold px-2.5 py-1 rounded-full uppercase">
                    {preview.status}
                  </span>
                </div>

                {/* Summary Metrics Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl text-center">
                    <span className="text-xs text-gray-500">{t.affectedSessions}</span>
                    <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">
                      {preview.impact_summary.sessions_affected_count}
                    </div>
                  </div>
                  <div className="p-3 bg-green-50 dark:bg-green-950/40 rounded-xl text-center">
                    <span className="text-xs text-green-700 dark:text-green-300">{t.clashesCount}</span>
                    <div className="text-xl font-bold text-green-700 dark:text-green-400 mt-1">
                      {preview.impact_summary.new_clashes}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl text-center">
                    <span className="text-xs text-gray-500">{t.shortfallBefore}</span>
                    <div className="text-xl font-bold text-gray-700 dark:text-gray-300 mt-1">
                      {preview.impact_summary.shortfall_before}h
                    </div>
                  </div>
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl text-center">
                    <span className="text-xs text-indigo-700 dark:text-indigo-300">{t.shortfallAfter}</span>
                    <div className="text-xl font-bold text-indigo-700 dark:text-indigo-400 mt-1">
                      {preview.impact_summary.shortfall_after}h
                    </div>
                  </div>
                </div>

                {/* Substitute Teacher Recommendations (if any) */}
                {preview.impact_summary.proposed_fixes.some((f) => f.action === 'substitute') && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                      <UserCheck className="w-4 h-4 text-indigo-600" />
                      {t.substituteSuggestions}
                    </h3>
                    <div className="space-y-2">
                      {preview.impact_summary.proposed_fixes
                        .filter((f) => f.action === 'substitute')
                        .map((f, idx) => (
                          <div
                            key={idx}
                            className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900 rounded-xl flex items-center justify-between text-xs"
                          >
                            <div>
                              <span className="font-semibold text-indigo-900 dark:text-indigo-200">
                                {f.subject_code} ({f.section_label})
                              </span>
                              <span className="text-gray-500 ml-2">
                                {f.original_date} Period {f.original_period}
                              </span>
                              <div className="text-indigo-700 dark:text-indigo-300 mt-0.5">
                                Recommended Substitute: <strong>{f.substitute_staff_name}</strong> ({f.substitute_staff_id})
                              </div>
                            </div>
                            <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded font-medium">
                              Qualified & Free
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Side-by-Side Diff Table */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    {t.diffSummary}
                  </h3>
                  <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
                        <tr>
                          <th className="p-2.5 font-semibold text-gray-600 dark:text-gray-300">Action</th>
                          <th className="p-2.5 font-semibold text-gray-600 dark:text-gray-300">Before</th>
                          <th className="p-2.5 font-semibold text-gray-600 dark:text-gray-300">After</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {preview.impact_summary.diff.map((d, idx) => (
                          <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <td className="p-2.5 font-medium text-gray-900 dark:text-white">{d.description}</td>
                            <td className="p-2.5 text-red-600 dark:text-red-400 bg-red-50/30 dark:bg-red-950/10 font-mono">{d.before}</td>
                            <td className="p-2.5 text-green-600 dark:text-green-400 bg-green-50/30 dark:bg-green-950/10 font-mono">{d.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Action Buttons: Confirm and Discard */}
                <div className="pt-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-3">
                  <button
                    onClick={handleDiscard}
                    disabled={actionLoading}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors"
                  >
                    {t.discardChange}
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={actionLoading}
                    className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {actionLoading ? t.submitting : t.confirmChange}
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[300px] border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-2xl flex flex-col items-center justify-center p-8 text-center text-gray-400 dark:text-gray-600">
                <Sparkles className="w-10 h-10 mb-2 stroke-[1.5]" />
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Ready to Preview Impact
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-sm">
                  Fill in the change details on the left and click "Preview Impact". The engine will re-solve displaced classes with zero clashes.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Change History Tab (Full width lg:col-span-12) */}
        {activeTab === 'history' && (
          <div className="lg:col-span-12 bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  {t.historyLog}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Audit log of all management changes. Any applied change can be reverted to its exact prior state.
                </p>
              </div>
              <button
                onClick={loadHistory}
                className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            {history.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">{t.noHistory}</p>
            ) : (
              <div className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
                {history.map((item) => (
                  <div key={item.id} className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-900 dark:text-white uppercase">
                          {item.type} Change #{item.id}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            item.status === 'applied'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-300'
                              : item.status === 'reverted'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'
                              : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Created by <strong>{item.created_by}</strong> on {new Date(item.created_at).toLocaleString()}
                        {item.applied_at && ` • Applied on ${new Date(item.applied_at).toLocaleString()}`}
                      </p>
                      {item.impact_summary && (
                        <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">
                          {item.impact_summary.sessions_affected_count} sessions affected • Shortfall: {item.impact_summary.shortfall_before}h → {item.impact_summary.shortfall_after}h
                        </p>
                      )}
                    </div>

                    {item.status === 'applied' && role === 'hod' && (
                      <button
                        onClick={() => handleRevert(item.id)}
                        disabled={actionLoading}
                        className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950 dark:hover:bg-amber-900 dark:text-amber-300 text-xs font-medium rounded-lg border border-amber-200 dark:border-amber-800 flex items-center gap-1.5 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        {t.revertChange}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
export default ChangesPage;
