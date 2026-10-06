import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  RefreshCw,
  Building,
  Users,
  Layers,
  Table as TableIcon,
  Loader2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { toast } from 'sonner';
import {
  fetchDashboardSummary,
  fetchDashboardRoomUse,
  fetchDashboardClashes,
  fetchDashboardHours,
  fetchDashboardWorkload,
  fetchDashboardChanges,
  fetchExportStatus,
  getExcelExportUrl,
  getPdfExportUrl,
  SummaryKPIs,
  RoomUseResponse,
  ClashesAnalysis,
  HoursAnalysisResponse,
  WorkloadAnalysisResponse,
  ManagementChangesSummary,
  DashboardFilters,
} from '../lib/api';

export const DashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'rooms' | 'clashes' | 'hours' | 'changes' | 'export'>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters state
  const [filters, setFilters] = useState<DashboardFilters>({
    department: '',
    subject: '',
    staff: '',
  });

  // Data states
  const [summary, setSummary] = useState<SummaryKPIs | null>(null);
  const [roomUse, setRoomUse] = useState<RoomUseResponse | null>(null);
  const [clashes, setClashes] = useState<ClashesAnalysis | null>(null);
  const [hours, setHours] = useState<HoursAnalysisResponse | null>(null);
  const [workload, setWorkload] = useState<WorkloadAnalysisResponse | null>(null);
  const [changes, setChanges] = useState<ManagementChangesSummary | null>(null);
  const [exportStatus, setExportStatus] = useState<{ excel_ready: boolean; pdf_ready: boolean; message: string } | null>(null);

  // UI view toggles
  const [showDeptChartAsTable, setShowDeptChartAsTable] = useState(false);
  const [underusedThreshold] = useState(30);
  const [overloadedThreshold] = useState(85);

  // Export options
  const [pdfScope, setPdfScope] = useState<'whole_college' | 'department' | 'section' | 'staff' | 'room'>('whole_college');
  const [pdfScopeValue, setPdfScopeValue] = useState('');
  const [pdfMonth, setPdfMonth] = useState('all');
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const loadData = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);

      const [sumRes, roomRes, clashRes, hourRes, workRes, chgRes, expRes] = await Promise.all([
        fetchDashboardSummary(filters),
        fetchDashboardRoomUse(filters, underusedThreshold, overloadedThreshold),
        fetchDashboardClashes(),
        fetchDashboardHours(filters),
        fetchDashboardWorkload(filters),
        fetchDashboardChanges(),
        fetchExportStatus(),
      ]);

      setSummary(sumRes);
      setRoomUse(roomRes);
      setClashes(clashRes);
      setHours(hourRes);
      setWorkload(workRes);
      setChanges(chgRes);
      setExportStatus(expRes);

      if (isManualRefresh) toast.success('Dashboard metrics refreshed');
    } catch (err: any) {
      toast.error(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filters.department, filters.staff, underusedThreshold, overloadedThreshold]);

  // CSV download helper
  const downloadCsv = (data: Record<string, any>[], filename: string) => {
    if (!data.length) {
      toast.error('No data to export');
      return;
    }
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map((row) =>
        headers
          .map((h) => {
            const val = row[h] === null || row[h] === undefined ? '' : String(row[h]);
            return `"${val.replace(/"/g, '""')}"`;
          })
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportExcel = async () => {
    try {
      setIsExportingExcel(true);
      window.location.href = getExcelExportUrl();
      toast.success('Excel workbook download started');
    } catch {
      toast.error('Failed to initiate Excel export');
    } finally {
      setTimeout(() => setIsExportingExcel(false), 2000);
    }
  };

  const handleExportPdf = async () => {
    try {
      setIsExportingPdf(true);
      const url = getPdfExportUrl({
        scope: pdfScope,
        scope_value: pdfScopeValue || undefined,
        month: pdfMonth !== 'all' ? pdfMonth : undefined,
      });
      window.location.href = url;
      toast.success('PDF calendar export started');
    } catch {
      toast.error('Failed to initiate PDF export');
    } finally {
      setTimeout(() => setIsExportingPdf(false), 3000);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-24 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mb-3" />
        <p className="text-xs">Computing live dashboard analytics & audits...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            <BarChart3 className="w-4 h-4" /> Output & Analytics Layer
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
            Academic Performance Dashboard & Exports
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Deterministic metrics, utilization heatmaps, clash audits, and official Excel/PDF workbooks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleExportExcel}
            disabled={isExportingExcel || summary?.timetable_status === 'not_generated'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Download Excel
          </button>
          <button
            onClick={() => setActiveTab('export')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition"
          >
            <Download className="w-3.5 h-3.5" />
            Export Center
          </button>
        </div>
      </div>

      {/* Stale Timetable Banner */}
      {summary?.is_stale && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl p-3.5 flex items-center justify-between text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="text-xs">
              <span className="font-bold">Dashboard Data is Stale — </span>
              {summary.stale_reason || 'Underlying rules, datasets, or inputs changed since the last timetable run.'}
              Please re-run the solver in Timetable Generation.
            </div>
          </div>
          <a
            href="/generate"
            className="text-xs font-bold text-amber-700 dark:text-amber-300 underline hover:text-amber-800 shrink-0"
          >
            Go to Generate &rarr;
          </a>
        </div>
      )}

      {/* KPI Header Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {/* Status */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Status</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                summary?.timetable_status === 'generated'
                  ? 'bg-emerald-500'
                  : summary?.timetable_status === 'stale'
                  ? 'bg-amber-500'
                  : 'bg-slate-400'
              }`}
            />
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100 capitalize">
              {summary?.timetable_status || 'Checking...'}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 truncate">
            {summary?.semester_dates?.semester_name || 'Academic Term'}
          </div>
        </div>

        {/* Total Sections */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Sections</div>
          <div className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">
            {summary?.total_sections ?? '—'}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Enrolled student cohorts</div>
        </div>

        {/* Weekly Periods */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Weekly Periods</div>
          <div className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">
            {summary?.total_weekly_periods ?? '—'}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Scheduled slots/week</div>
        </div>

        {/* Total Clashes */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Clashes Check</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={`text-lg font-extrabold ${
                summary?.total_clashes === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
              }`}
            >
              {summary?.total_clashes ?? '—'}
            </span>
            {summary?.total_clashes === 0 && (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
            )}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Hard constraints verified</div>
        </div>

        {/* Shortfall Hours */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Hours Shortfall</div>
          <div
            className={`text-lg font-bold mt-1 ${
              (summary?.total_hours_shortfall || 0) > 0 ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100'
            }`}
          >
            {summary?.total_hours_shortfall ?? 0} hrs
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Syllabus delivery gap</div>
        </div>

        {/* Changes Applied */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Changes Applied</div>
          <div className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1">
            {summary?.changes_applied_count ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Leave, event, intake</div>
        </div>

        {/* Solver Freshness */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Solver Run</div>
          <div className="text-xs font-bold text-slate-800 dark:text-slate-100 mt-1.5 truncate">
            {summary?.solver_run_id ? `#${summary.solver_run_id}` : 'None'}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 truncate">
            {summary?.last_solver_run_time ? new Date(summary.last_solver_run_time).toLocaleDateString() : '—'}
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6 text-xs font-semibold">
        {[
          { id: 'overview', label: 'Overview & Room Use', icon: Building },
          { id: 'rooms', label: 'Room Heatmap & Mismatches', icon: Layers },
          { id: 'clashes', label: 'Clash Audit (0 Clashes)', icon: CheckCircle2 },
          { id: 'hours', label: 'Hours & Faculty Workload', icon: Users },
          { id: 'changes', label: 'Applied Changes', icon: Clock },
          { id: 'export', label: 'Export Center (Excel & PDF)', icon: Download },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-1.5 pb-2.5 transition border-b-2 ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filter Toolbar (for relevant tabs) */}
      {activeTab !== 'export' && activeTab !== 'clashes' && (
        <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1 text-slate-500 font-semibold">
            <Filter className="w-3.5 h-3.5" /> Filters:
          </div>

          <input
            type="text"
            placeholder="Search Subject..."
            value={filters.subject || ''}
            onChange={(e) => setFilters({ ...filters, subject: e.target.value })}
            className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 w-44"
          />

          <input
            type="text"
            placeholder="Filter Department..."
            value={filters.department || ''}
            onChange={(e) => setFilters({ ...filters, department: e.target.value })}
            className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 w-40"
          />

          <input
            type="text"
            placeholder="Filter Faculty..."
            value={filters.staff || ''}
            onChange={(e) => setFilters({ ...filters, staff: e.target.value })}
            className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 w-40"
          />

          {(filters.subject || filters.department || filters.staff) && (
            <button
              onClick={() => setFilters({ department: '', subject: '', staff: '' })}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* TAB 1: Overview & Room Use */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Room Type Utilization Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500">Classrooms / Theory Utilization</div>
              <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                {roomUse?.utilization_by_type.theory_avg_pct ?? 0}%
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Average classroom schedule density</div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500">Computer Labs Utilization</div>
              <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                {roomUse?.utilization_by_type.lab_avg_pct ?? 0}%
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Average laboratory block occupancy</div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500">Campus-Wide Room Efficiency</div>
              <div className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
                {roomUse?.utilization_by_type.overall_avg_pct ?? 0}%
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {roomUse?.underused_count ?? 0} underused (&lt;30%), {roomUse?.overloaded_count ?? 0} heavy (&gt;85%)
              </div>
            </div>
          </div>

          {/* Room Utilization Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">Room Utilization Directory</h3>
                <p className="text-xs text-slate-500">Weekly assigned periods against total operational capacity</p>
              </div>
              <button
                onClick={() => downloadCsv(roomUse?.rooms || [], 'room_utilization')}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold sticky top-0 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">Room ID</th>
                    <th className="py-2.5 px-4">Name</th>
                    <th className="py-2.5 px-4">Type</th>
                    <th className="py-2.5 px-4 text-right">Capacity</th>
                    <th className="py-2.5 px-4 text-right">Used / Avail</th>
                    <th className="py-2.5 px-4 text-right">Utilization %</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {roomUse?.rooms.map((r) => (
                    <tr key={r.room_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-4 font-bold text-slate-800 dark:text-slate-200">{r.room_id}</td>
                      <td className="py-2 px-4 text-slate-600 dark:text-slate-400">{r.room_name}</td>
                      <td className="py-2 px-4 uppercase text-[10px] text-slate-500 font-semibold">
                        {r.room_type}
                      </td>
                      <td className="py-2 px-4 text-right font-medium">{r.capacity}</td>
                      <td className="py-2 px-4 text-right text-slate-500">
                        {r.used_periods} / {r.available_periods}
                      </td>
                      <td className="py-2 px-4 text-right font-bold">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                r.utilization_pct > 85
                                  ? 'bg-amber-500'
                                  : r.utilization_pct < 30
                                  ? 'bg-rose-400'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${Math.min(100, r.utilization_pct)}%` }}
                            />
                          </div>
                          <span>{r.utilization_pct}%</span>
                        </div>
                      </td>
                      <td className="py-2 px-4 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                            r.status === 'underused'
                              ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                              : r.status === 'overloaded'
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Room Heatmap & Wasted Seats Mismatches */}
      {activeTab === 'rooms' && (
        <div className="space-y-6">
          {/* Visual Heatmap Grid */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm overflow-x-auto">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Weekly Room Occupancy Heatmap
                </h3>
                <p className="text-xs text-slate-500">Rooms (rows) &times; Weekday-Period matrix</p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-400 rounded" />
                  Occupied
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded" />
                  Available
                </span>
              </div>
            </div>

            <div className="min-w-[700px]">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-slate-600">
                    <th className="p-1.5 border border-slate-200 dark:border-slate-700 text-left w-32">Room</th>
                    {roomUse?.heatmap.days.map((day) =>
                      Array.from({ length: roomUse.heatmap.periods_per_day }).map((_, pIdx) => (
                        <th
                          key={`${day}_${pIdx}`}
                          className="p-1 border border-slate-200 dark:border-slate-700 text-center"
                        >
                          {day} P{pIdx + 1}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {roomUse?.heatmap.rooms.map((rm) => (
                    <tr key={rm.room_id}>
                      <td className="p-1.5 border border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-200 truncate">
                        {rm.room_name} ({rm.room_id})
                      </td>
                      {roomUse?.heatmap.days.map((_, dIdx) =>
                        Array.from({ length: roomUse.heatmap.periods_per_day }).map((_, pIdx) => {
                          const slot = rm.slots[`${dIdx + 1}_${pIdx + 1}`];
                          return (
                            <td
                              key={`${dIdx}_${pIdx}`}
                              className={`p-1 border border-slate-200 dark:border-slate-700 text-center transition ${
                                slot?.occupied
                                  ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-200 font-bold'
                                  : 'bg-white dark:bg-slate-900 text-slate-300'
                              }`}
                              title={
                                slot?.occupied
                                  ? `${slot.subject_code} - ${slot.section_label || ''} (${slot.staff_name || ''})`
                                  : 'Available'
                              }
                            >
                              {slot?.occupied ? (slot.is_lab_block ? 'LAB' : '●') : '—'}
                            </td>
                          );
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Wasted Seats Analysis */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 gap-2">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Wasted Seats & Capacity Mismatches
                </h3>
                <p className="text-xs text-slate-500">
                  Total Seat-Periods Wasted:{' '}
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {roomUse?.wasted_seats.total_seat_periods_wasted.toLocaleString() ?? 0}
                  </span>{' '}
                  | Average Wasted Seats:{' '}
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {roomUse?.wasted_seats.average_wasted_seats ?? 0} seats/period
                  </span>
                </p>
              </div>
              <button
                onClick={() => downloadCsv(roomUse?.wasted_seats.worst_10_mismatches || [], 'worst_10_mismatches')}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 self-start"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2 px-3">Slot Time</th>
                    <th className="py-2 px-3">Room</th>
                    <th className="py-2 px-3 text-right">Room Cap</th>
                    <th className="py-2 px-3">Section</th>
                    <th className="py-2 px-3">Subject</th>
                    <th className="py-2 px-3 text-right">Class Size</th>
                    <th className="py-2 px-3 text-right">Wasted Seats</th>
                    <th className="py-2 px-3 text-right">% Wasted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {roomUse?.wasted_seats.worst_10_mismatches.map((m, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-semibold text-slate-600">
                        Day {m.day_of_week} P{m.period}
                      </td>
                      <td className="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">
                        {m.room_name} ({m.room_id})
                      </td>
                      <td className="py-2 px-3 text-right">{m.room_capacity}</td>
                      <td className="py-2 px-3">{m.section_label || `SEC-${m.section_id}`}</td>
                      <td className="py-2 px-3 text-slate-600">{m.subject_code}</td>
                      <td className="py-2 px-3 text-right font-medium">{m.section_size}</td>
                      <td className="py-2 px-3 text-right font-bold text-rose-600 dark:text-rose-400">
                        +{m.wasted_seats}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                        {m.wasted_pct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Clashes Check */}
      {activeTab === 'clashes' && (
        <div className="space-y-6">
          {/* Big Status Banner */}
          {clashes?.total_clashes === 0 ? (
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl p-5 flex items-center gap-4 text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <h3 className="text-base font-bold">0 Clashes Verified — Clean Academic Solution</h3>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                  The independent database validator confirmed zero staff collisions, zero room overlaps, zero section double-bookings, and 100% capacity and room-type compliance across all weekly slots and calendar sessions.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-xl p-5 flex items-center gap-4 text-rose-900 dark:text-rose-200">
              <AlertTriangle className="w-10 h-10 text-rose-600 shrink-0" />
              <div>
                <h3 className="text-base font-bold">
                  {clashes?.total_clashes} Clashes Detected in Database
                </h3>
                <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">
                  Constraint violations were discovered. Review the categorized breakdown and offending items below.
                </p>
              </div>
            </div>
          )}

          {/* Categorized Clash Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Staff Clashes', count: clashes?.timetable_clashes.staff_clashes ?? 0 },
              { label: 'Room Clashes', count: clashes?.timetable_clashes.room_clashes ?? 0 },
              { label: 'Section Clashes', count: clashes?.timetable_clashes.section_clashes ?? 0 },
              { label: 'Student Clashes', count: clashes?.timetable_clashes.student_clashes ?? 0 },
              { label: 'Capacity Violations', count: clashes?.timetable_clashes.capacity_violations ?? 0 },
              { label: 'Room Type Mismatches', count: clashes?.timetable_clashes.room_type_violations ?? 0 },
              { label: 'Hour Mismatches', count: clashes?.timetable_clashes.hour_mismatches ?? 0 },
              { label: 'Broken Lab Blocks', count: clashes?.timetable_clashes.lab_block_violations ?? 0 },
            ].map((c, i) => (
              <div
                key={i}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm"
              >
                <div className="text-[11px] font-semibold text-slate-500">{c.label}</div>
                <div
                  className={`text-xl font-bold mt-1 ${
                    c.count === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                  }`}
                >
                  {c.count}
                </div>
              </div>
            ))}
          </div>

          {/* Offending Error Rows */}
          {clashes && clashes.timetable_clashes.errors.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 rounded-xl p-4 shadow-sm">
              <h4 className="font-bold text-xs text-rose-700 dark:text-rose-400 uppercase tracking-wider mb-2">
                Offending Violations Log
              </h4>
              <ul className="divide-y divide-rose-100 dark:divide-rose-950 text-xs">
                {clashes.timetable_clashes.errors.map((err, idx) => (
                  <li key={idx} className="py-2 text-rose-800 dark:text-rose-300 font-mono">
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Hours & Workload */}
      {activeTab === 'hours' && (
        <div className="space-y-6">
          {/* Department Shortfall Bar Chart & Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Syllabus Delivery & Shortfall by Department
                </h3>
                <p className="text-xs text-slate-500">Required vs Delivered Teaching Hours</p>
              </div>
              <button
                onClick={() => setShowDeptChartAsTable(!showDeptChartAsTable)}
                className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {showDeptChartAsTable ? <BarChart3 className="w-3.5 h-3.5" /> : <TableIcon className="w-3.5 h-3.5" />}
                {showDeptChartAsTable ? 'View as Chart' : 'View as Table'}
              </button>
            </div>

            {showDeptChartAsTable ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Department</th>
                      <th className="py-2 px-3 text-right">Required (Hrs)</th>
                      <th className="py-2 px-3 text-right">Delivered (Hrs)</th>
                      <th className="py-2 px-3 text-right">Shortfall (Hrs)</th>
                      <th className="py-2 px-3 text-right">Final Shortfall</th>
                      <th className="py-2 px-3 text-center">Completion %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {hours?.departments.map((d, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-bold">{d.department}</td>
                        <td className="py-2 px-3 text-right">{d.required_hours}</td>
                        <td className="py-2 px-3 text-right">{d.delivered_hours}</td>
                        <td className="py-2 px-3 text-right font-bold text-rose-600">{d.shortfall_hours}</td>
                        <td className="py-2 px-3 text-right font-bold">{d.final_shortfall}</td>
                        <td className="py-2 px-3 text-center">{d.completion_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hours?.departments || []} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="department" tick={{ fontSize: 10 }} interval={0} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="delivered_hours" name="Delivered Hours" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="shortfall_hours" name="Shortfall Hours" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Course-wise Shortfall Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">Course Syllabus Delivery Directory</h3>
                <p className="text-xs text-slate-500">Track required syllabus hours vs delivered calendar sessions</p>
              </div>
              <button
                onClick={() => downloadCsv(hours?.subjects || [], 'hours_summary')}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold sticky top-0 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2 px-3">Course Code</th>
                    <th className="py-2 px-3">Course Name</th>
                    <th className="py-2 px-3">Faculty</th>
                    <th className="py-2 px-3 text-right">Required</th>
                    <th className="py-2 px-3 text-right">Delivered</th>
                    <th className="py-2 px-3 text-right">Shortfall</th>
                    <th className="py-2 px-3 text-right">Makeup Approved</th>
                    <th className="py-2 px-3 text-center">Progress %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {hours?.subjects.map((sub, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">{sub.subject_code}</td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{sub.subject_name}</td>
                      <td className="py-2 px-3 text-slate-500">{sub.staff_name}</td>
                      <td className="py-2 px-3 text-right font-medium">{sub.required_hours}</td>
                      <td className="py-2 px-3 text-right font-medium">{sub.delivered_hours}</td>
                      <td className="py-2 px-3 text-right font-bold text-rose-600 dark:text-rose-400">
                        {sub.shortfall_hours > 0 ? `-${sub.shortfall_hours}` : '0'}
                      </td>
                      <td className="py-2 px-3 text-right text-emerald-600 dark:text-emerald-400 font-medium">
                        +{sub.makeup_approved_hours}
                      </td>
                      <td className="py-2 px-3 text-center font-bold">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="w-12 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-600 rounded-full"
                              style={{ width: `${Math.min(100, sub.progress_pct)}%` }}
                            />
                          </div>
                          <span>{sub.progress_pct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Staff Workload Directory */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">Faculty Workload & Limits</h3>
                <p className="text-xs text-slate-500">Weekly teaching load against maximum contractual limits</p>
              </div>
              <button
                onClick={() => downloadCsv(workload?.staff || [], 'staff_workload')}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>

            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold sticky top-0 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2 px-4">Faculty Name</th>
                    <th className="py-2 px-4">Department</th>
                    <th className="py-2 px-4 text-right">Weekly Scheduled</th>
                    <th className="py-2 px-4 text-right">Max Limit</th>
                    <th className="py-2 px-4 text-right">Load %</th>
                    <th className="py-2 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {workload?.staff.map((stf) => (
                    <tr key={stf.staff_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-4 font-bold text-slate-800 dark:text-slate-200">
                        {stf.staff_name} ({stf.staff_id})
                      </td>
                      <td className="py-2 px-4 text-slate-500">{stf.department}</td>
                      <td className="py-2 px-4 text-right font-medium">{stf.weekly_hours_scheduled} hrs</td>
                      <td className="py-2 px-4 text-right text-slate-500">{stf.max_hours_per_week} hrs</td>
                      <td className="py-2 px-4 text-right font-bold">{stf.utilization_pct}%</td>
                      <td className="py-2 px-4 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                            stf.is_overloaded
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                          }`}
                        >
                          {stf.is_overloaded ? 'OVERLOADED' : 'NORMAL'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: Applied Changes */}
      {activeTab === 'changes' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500">Staff Leave Adjustments</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                {changes?.leave_count ?? 0}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500">Campus Events & Blocks</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                {changes?.event_count ?? 0}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500">Intake / Section Splits</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                {changes?.intake_count ?? 0}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold text-slate-500">Total Committed Changes</div>
              <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                {changes?.total_applied ?? 0}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-3">Recent Management Change Log</h3>
            {changes?.recent_log.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">No management changes recorded yet.</div>
            ) : (
              <div className="space-y-3">
                {changes?.recent_log.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-xs flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-200">
                        [{log.type.toUpperCase()}] {log.summary}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Applied at {new Date(log.created_at).toLocaleString()} by {log.created_by}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 uppercase">
                      {log.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: Export Center (Excel & PDF) */}
      {activeTab === 'export' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Excel Export Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Official Excel Workbook (.xlsx)
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Complete institutional spreadsheet with 8 dedicated formatted worksheets:
              </p>

              <ul className="mt-4 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span><b>Master Timetable</b> (weekly grid, lab block merges)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span><b>Staff-wise</b> (faculty workloads & schedules)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span><b>Room-wise</b> (capacities, types & utilization %)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span><b>Section-wise</b> (student cohorts weekly matrices)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span><b>Change Log</b> (formal audit trail of re-solves)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span><b>Hours Summary</b> (required, delivered, red shortfalls)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span><b>Calendar</b> (complete dated sessions list)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span><b>Summary</b> (KPI totals, clash counts & config)</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={handleExportExcel}
                disabled={isExportingExcel || summary?.timetable_status === 'not_generated'}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {isExportingExcel ? 'Generating Workbook...' : 'Download Excel Workbook (.xlsx)'}
              </button>
              <div className="text-[10px] text-slate-400 text-center mt-2">
                Auto-generated with conditional formatting, Excel formulas, and frozen headers.
              </div>
            </div>
          </div>

          {/* PDF Calendar Export Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-4">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Publication-Grade PDF Calendar
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                A4 Landscape multi-page calendar with cover, monthly views, weekly master grids, and notice board notices.
              </p>

              {/* Status Notice */}
              <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                <span className="font-bold">PDF Engine: </span>
                {exportStatus?.message || 'Detecting Chromium environment...'}
              </div>

              {/* Options */}
              <div className="mt-4 space-y-3 text-xs">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Export Scope</label>
                  <select
                    value={pdfScope}
                    onChange={(e) => setPdfScope(e.target.value as any)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                  >
                    <option value="whole_college">Whole College (Institutional)</option>
                    <option value="department">By Department</option>
                    <option value="section">By Specific Section</option>
                    <option value="staff">By Faculty Member</option>
                    <option value="room">By Room</option>
                  </select>
                </div>

                {pdfScope !== 'whole_college' && (
                  <div>
                    <label className="block text-slate-500 font-semibold mb-1">Scope Filter Value</label>
                    <input
                      type="text"
                      placeholder={`Enter ${pdfScope} identifier (e.g. CS, STF001, A101)`}
                      value={pdfScopeValue}
                      onChange={(e) => setPdfScopeValue(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Month Range</label>
                  <select
                    value={pdfMonth}
                    onChange={(e) => setPdfMonth(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                  >
                    <option value="all">Full Semester (All Months)</option>
                    <option value="2026-07">July 2026</option>
                    <option value="2026-08">August 2026</option>
                    <option value="2026-09">September 2026</option>
                    <option value="2026-10">October 2026</option>
                    <option value="2026-11">November 2026</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={handleExportPdf}
                disabled={isExportingPdf || summary?.timetable_status === 'not_generated' || !exportStatus?.pdf_ready}
                className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {isExportingPdf ? 'Rendering PDF...' : 'Download PDF Calendar (A4 Landscape)'}
              </button>
              <div className="text-[10px] text-slate-400 text-center mt-2">
                Includes month view calendar grids, legends, and notice board change notices.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
