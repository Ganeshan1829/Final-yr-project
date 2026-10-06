import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  EngineState,
  SplitSectionItem,
  SolverRunSummary,
  TimetableSlotItem,
  CalendarSessionItem,
  HoursSummaryItem,
  SuggestedMakeupItem,
  getExcelExportUrl,
} from '../lib/api.js';
import { Card, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { SizeBar, SizeBarLegend } from '../components/common/SizeBar.js';
import { Drawer } from '../components/common/Drawer.js';
import { toast } from 'sonner';
import {
  Cpu,
  Split,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  Info,
  RefreshCw,
  Search,
  ArrowRight,
  ArrowLeft,
  Check,
  X,
  FileSpreadsheet,
} from 'lucide-react';

const RULE_LABELS: Record<string, string> = {
  student_choice: 'Kept students who chose this teacher',
  demand_fill: 'Filled to the teacher preferred size / ML target, then up to the limit',
  extra_batch: 'Extra section opened because other teachers were full',
};

export const GeneratePage: React.FC = () => {
  const navigate = useNavigate();

  // Engine state & meta
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [pythonStatus, setPythonStatus] = useState<{ ready: boolean; version?: string; error?: string }>({ ready: false });
  const [validationPassed, setValidationPassed] = useState<boolean>(true);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true);
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState<boolean>(false);

  // Step 1: Sections
  const [sections, setSections] = useState<SplitSectionItem[]>([]);
  const [isSplitting, setIsSplitting] = useState<boolean>(false);
  const [sectionFilter, setSectionFilter] = useState<string>('');
  const [editingSection, setEditingSection] = useState<SplitSectionItem | null>(null);
  const [editNewSize, setEditNewSize] = useState<number>(30);
  const [editPreview, setEditPreview] = useState<any>(null);
  const [isEditSubmitting, setIsEditSubmitting] = useState<boolean>(false);

  // Step 2: Solver & Timetable
  const [solverSummary, setSolverSummary] = useState<SolverRunSummary | null>(null);
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlotItem[]>([]);
  const [isSolving, setIsSolving] = useState<boolean>(false);
  const [timeLimit, setTimeLimit] = useState<number>(30);
  const [timetableTab, setTimetableTab] = useState<'master' | 'staff' | 'room' | 'section'>('master');
  const [selectedStaffFilter, setSelectedStaffFilter] = useState<string>('');
  const [selectedRoomFilter, setSelectedRoomFilter] = useState<string>('');
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<string>('');
  const [selectedSlotDetail, setSelectedSlotDetail] = useState<TimetableSlotItem | null>(null);

  // Step 3: Calendar
  const [isGeneratingCalendar, setIsGeneratingCalendar] = useState<boolean>(false);
  const [calendarSessions, setCalendarSessions] = useState<CalendarSessionItem[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  // Step 4: Hours & Makeups
  const [hoursSummary, setHoursSummary] = useState<HoursSummaryItem[]>([]);
  const [makeups, setMakeups] = useState<SuggestedMakeupItem[]>([]);
  const [makeupActionId, setMakeupActionId] = useState<number | null>(null);

  // Initial Data Load
  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await api.getEngineStatus();
      setEngineState(res.state);
      setPythonStatus(res.python);
      setValidationPassed(res.validation_passed);
      setSolverSummary(res.latest_run);

      // Restore active step based on state
      if (res.state.calendar_status === 'completed') {
        setActiveStep(3);
      } else if (res.state.solve_status === 'completed') {
        setActiveStep(2);
      } else if (res.state.split_status === 'completed') {
        setActiveStep(1);
      }
    } catch (e: any) {
      toast.error('Failed to load engine status: ' + e.message);
    } finally {
      setLoadingStatus(false);
    }
  };

  const loadSections = async () => {
    try {
      const res = await api.getSections();
      setSections(res.sections);
    } catch {
      // ignore if empty
    }
  };

  const loadTimetable = async () => {
    try {
      const res = await api.getTimetableSlots();
      setTimetableSlots(res.slots);
      if (res.latest_run) setSolverSummary(res.latest_run);
    } catch {
      // ignore
    }
  };

  const loadCalendar = async () => {
    try {
      const res = await api.getCalendarSessions();
      setCalendarSessions(res.sessions);
    } catch {
      // ignore
    }
  };

  const loadHoursAndMakeups = async () => {
    try {
      const [hRes, mRes] = await Promise.all([api.getHoursSummary(), api.getMakeups()]);
      setHoursSummary(hRes.summary);
      setMakeups(mRes.makeups);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchStatus();
    loadSections();
    loadTimetable();
    loadCalendar();
    loadHoursAndMakeups();
  }, []);

  // STEP 1 ACTIONS
  const handleSplitSections = async () => {
    setIsSplitting(true);
    try {
      const res = await api.splitSections();
      if (res.success) {
        toast.success(`Successfully split students into ${res.total_sections} sections!`);
      } else if (res.warnings.length > 0) {
        toast.warning(`Sections split with ${res.warnings.length} warning(s).`);
      }
      setSections(res.sections);
      await fetchStatus();
    } catch (e: any) {
      toast.error('Section split failed: ' + e.message);
    } finally {
      setIsSplitting(false);
    }
  };

  const handleOpenEditModal = (sec: SplitSectionItem) => {
    setEditingSection(sec);
    setEditNewSize(sec.size);
    setEditPreview(null);
  };

  const handlePreviewEdit = async () => {
    if (!editingSection) return;
    try {
      const res = await api.editSectionSize(editingSection.section_id, editNewSize, false);
      setEditPreview(res);
    } catch (e: any) {
      toast.error('Preview error: ' + e.message);
    }
  };

  const handleConfirmEdit = async () => {
    if (!editingSection) return;
    setIsEditSubmitting(true);
    try {
      await api.editSectionSize(editingSection.section_id, editNewSize, true);
      toast.success(`Section ${editingSection.section_label} size updated to ${editNewSize}. Downstream timetable marked stale.`);
      setEditingSection(null);
      await loadSections();
      await fetchStatus();
    } catch (e: any) {
      toast.error('Update failed: ' + e.message);
    } finally {
      setIsEditSubmitting(false);
    }
  };

  // STEP 2 ACTIONS
  const handleSolveTimetable = async () => {
    setIsSolving(true);
    try {
      const res = await api.runWeeklySolver(timeLimit);
      setSolverSummary(res);
      if (res.status === 'optimal' || res.status === 'feasible') {
        toast.success(`Timetable solved (${res.status}) with ${res.clash_count} clashes in ${res.wall_time}s!`);
        await loadTimetable();
      } else if (res.status === 'infeasible') {
        toast.error(`Schedule is infeasible: ${res.diagnosis || res.message}`);
      } else {
        toast.warning(`Solver ended with status: ${res.status}`);
      }
      await fetchStatus();
    } catch (e: any) {
      toast.error('Solver failed: ' + e.message);
    } finally {
      setIsSolving(false);
    }
  };

  // STEP 3 ACTIONS
  const handleGenerateCalendar = async () => {
    setIsGeneratingCalendar(true);
    try {
      const res = await api.generateSemesterCalendar();
      toast.success(
        `Calendar generated: ${res.scheduled_count} scheduled, ${res.holiday_skipped_count} holidays skipped, ${res.makeups_suggested_count} make-ups suggested.`
      );
      await loadCalendar();
      await loadHoursAndMakeups();
      await fetchStatus();
    } catch (e: any) {
      toast.error('Calendar generation failed: ' + e.message);
    } finally {
      setIsGeneratingCalendar(false);
    }
  };

  // STEP 4 ACTIONS
  const handleApproveMakeup = async (id: number) => {
    setMakeupActionId(id);
    try {
      await api.approveMakeup(id);
      toast.success('Make-up class approved and added to semester calendar!');
      await loadHoursAndMakeups();
      await loadCalendar();
    } catch (e: any) {
      toast.error('Failed to approve make-up: ' + e.message);
    } finally {
      setMakeupActionId(null);
    }
  };

  const handleRejectMakeup = async (id: number) => {
    setMakeupActionId(id);
    try {
      await api.rejectMakeup(id);
      toast.info('Make-up class rejected.');
      await loadHoursAndMakeups();
    } catch (e: any) {
      toast.error('Failed to reject make-up: ' + e.message);
    } finally {
      setMakeupActionId(null);
    }
  };

  // Derived Filter Lists
  const filteredSections = useMemo(() => {
    if (!sectionFilter) return sections;
    const q = sectionFilter.toLowerCase();
    return sections.filter(
      (s) =>
        s.section_label.toLowerCase().includes(q) ||
        s.subject_code.toLowerCase().includes(q) ||
        s.subject_name.toLowerCase().includes(q) ||
        s.staff_name.toLowerCase().includes(q)
    );
  }, [sections, sectionFilter]);

  const uniqueStaff = useMemo(() => {
    const map = new Map<string, string>();
    timetableSlots.forEach((s) => map.set(s.staff_id, s.staff_name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [timetableSlots]);

  const uniqueRooms = useMemo(() => {
    const map = new Map<string, string>();
    timetableSlots.forEach((s) => map.set(s.room_id, s.room_name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [timetableSlots]);

  const uniqueSectionLabels = useMemo(() => {
    return Array.from(new Set(timetableSlots.map((s) => s.section_label))).sort();
  }, [timetableSlots]);

  const filteredSlots = useMemo(() => {
    if (timetableTab === 'staff' && selectedStaffFilter) {
      return timetableSlots.filter((s) => s.staff_id === selectedStaffFilter);
    }
    if (timetableTab === 'room' && selectedRoomFilter) {
      return timetableSlots.filter((s) => s.room_id === selectedRoomFilter);
    }
    if (timetableTab === 'section' && selectedSectionFilter) {
      return timetableSlots.filter((s) => s.section_label === selectedSectionFilter);
    }
    return timetableSlots;
  }, [timetableSlots, timetableTab, selectedStaffFilter, selectedRoomFilter, selectedSectionFilter]);

  const monthsAvailable = useMemo(() => {
    const set = new Set<string>();
    calendarSessions.forEach((s) => {
      if (s.session_date) set.add(s.session_date.substring(0, 7));
    });
    return Array.from(set).sort();
  }, [calendarSessions]);

  const filteredCalendarSessions = useMemo(() => {
    if (selectedMonth === 'all') return calendarSessions;
    return calendarSessions.filter((s) => s.session_date.startsWith(selectedMonth));
  }, [calendarSessions, selectedMonth]);

  const totalShortfall = useMemo(() => {
    return hoursSummary.reduce((acc, h) => acc + (h.shortfall_hours || 0), 0);
  }, [hoursSummary]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">Timetable Generation Engine</h1>
            <Badge variant="accent" className="font-semibold">Module 3</Badge>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Section splitting, OR-Tools CP-SAT solver, semester expansion, and hours delivery check.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Python Environment Badge */}
          {pythonStatus.ready ? (
            <Badge variant="success" dot className="px-2.5 py-1 text-xs">
              Python 3.11 + OR-Tools Ready
            </Badge>
          ) : (
            <Badge variant="error" dot className="px-2.5 py-1 text-xs">
              Python / OR-Tools Missing
            </Badge>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsHowItWorksOpen(true)}
            icon={<Info className="w-4 h-4" />}
          >
            How it works
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              window.location.href = getExcelExportUrl();
              toast.success('Excel workbook download started');
            }}
            icon={<FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
          >
            Download Excel
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchStatus}
            disabled={loadingStatus}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Validation Gate Alert */}
      {!validationPassed && (
        <div className="p-4 bg-status-warning-bg border border-status-warning-border rounded-lg flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-status-warning shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-status-warning">Validation Gate Locked</h4>
              <p className="text-xs text-text-muted mt-0.5">
                Input datasets have not passed rule-based ETL validation or are stale. Generation actions are locked until validation succeeds.
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/validation')}>
            Go to Validation
          </Button>
        </div>
      )}

      {/* Stale Warning Banner */}
      {engineState && engineState.stale === 1 && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <RefreshCw className="w-4 h-4 text-amber-700 shrink-0" />
            <span className="text-xs font-medium text-amber-900">
              Downstream schedule is stale due to recent input edits. Please re-run the steps in sequence.
            </span>
          </div>
        </div>
      )}

      {/* 4-Step Stepper Navigation */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        {/* Step 1 */}
        <button
          type="button"
          onClick={() => setActiveStep(1)}
          className={`p-3.5 rounded-lg border text-left transition-all ${
            activeStep === 1
              ? 'bg-accent-subtle/50 border-accent shadow-sm'
              : 'bg-white border-border hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted">STEP 1</span>
            {sections.length > 0 ? (
              <Badge variant="success" className="text-[10px] px-1.5 py-0">
                {sections.length} Sections
              </Badge>
            ) : (
              <Badge variant="neutral" className="text-[10px] px-1.5 py-0">Not Run</Badge>
            )}
          </div>
          <div className="font-semibold text-sm text-text-primary flex items-center gap-1.5">
            <Split className="w-4 h-4 text-accent" />
            Split Sections
          </div>
        </button>

        {/* Step 2 */}
        <button
          type="button"
          onClick={() => setActiveStep(2)}
          className={`p-3.5 rounded-lg border text-left transition-all ${
            activeStep === 2
              ? 'bg-accent-subtle/50 border-accent shadow-sm'
              : 'bg-white border-border hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted">STEP 2</span>
            {solverSummary?.status === 'optimal' || solverSummary?.status === 'feasible' ? (
              <Badge variant="success" className="text-[10px] px-1.5 py-0">0 Clashes</Badge>
            ) : solverSummary?.status === 'infeasible' ? (
              <Badge variant="error" className="text-[10px] px-1.5 py-0">Infeasible</Badge>
            ) : (
              <Badge variant="neutral" className="text-[10px] px-1.5 py-0">Not Run</Badge>
            )}
          </div>
          <div className="font-semibold text-sm text-text-primary flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-navy" />
            Weekly Timetable
          </div>
        </button>

        {/* Step 3 */}
        <button
          type="button"
          onClick={() => setActiveStep(3)}
          className={`p-3.5 rounded-lg border text-left transition-all ${
            activeStep === 3
              ? 'bg-accent-subtle/50 border-accent shadow-sm'
              : 'bg-white border-border hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted">STEP 3</span>
            {calendarSessions.length > 0 ? (
              <Badge variant="success" className="text-[10px] px-1.5 py-0">
                {calendarSessions.length} Sessions
              </Badge>
            ) : (
              <Badge variant="neutral" className="text-[10px] px-1.5 py-0">Not Run</Badge>
            )}
          </div>
          <div className="font-semibold text-sm text-text-primary flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-emerald-600" />
            Semester Calendar
          </div>
        </button>

        {/* Step 4 */}
        <button
          type="button"
          onClick={() => setActiveStep(4)}
          className={`p-3.5 rounded-lg border text-left transition-all ${
            activeStep === 4
              ? 'bg-accent-subtle/50 border-accent shadow-sm'
              : 'bg-white border-border hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted">STEP 4</span>
            {totalShortfall > 0 ? (
              <Badge variant="error" className="text-[10px] px-1.5 py-0">
                {totalShortfall}h Shortfall
              </Badge>
            ) : hoursSummary.length > 0 ? (
              <Badge variant="success" className="text-[10px] px-1.5 py-0">100% Delivered</Badge>
            ) : (
              <Badge variant="neutral" className="text-[10px] px-1.5 py-0">Not Run</Badge>
            )}
          </div>
          <div className="font-semibold text-sm text-text-primary flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-purple-600" />
            Hours & Make-ups
          </div>
        </button>
      </div>

      {/* ======================================================== */}
      {/* STEP 1: SPLIT SECTIONS                                   */}
      {/* ======================================================== */}
      {activeStep === 1 && (
        <div className="space-y-6">
          <Card className="border-border">
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-base font-semibold text-text-primary">Section Allocation & Sizing</h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Deterministic partitioning of student choices into sections respecting min/max rules and lab room limits.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    variant="primary"
                    onClick={handleSplitSections}
                    disabled={isSplitting || !validationPassed}
                    icon={<Split className={`w-4 h-4 ${isSplitting ? 'animate-spin' : ''}`} />}
                  >
                    {isSplitting ? 'Splitting Cohorts...' : 'Run Section Splitter'}
                  </Button>
                </div>
              </div>

              {/* Summary Stats */}
              {sections.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  <div className="p-3.5 bg-slate-50 border border-border rounded-lg">
                    <div className="text-xs text-text-muted font-medium">Total Sections</div>
                    <div className="text-xl font-bold text-text-primary mt-1">{sections.length}</div>
                  </div>
                  <div className="p-3.5 bg-slate-50 border border-border rounded-lg">
                    <div className="text-xs text-text-muted font-medium">Students Enrolled</div>
                    <div className="text-xl font-bold text-text-primary mt-1">
                      {sections.reduce((acc, s) => acc + s.size, 0)}
                    </div>
                  </div>
                  <div className="p-3.5 bg-slate-50 border border-border rounded-lg">
                    <div className="text-xs text-text-muted font-medium">Lab Sections</div>
                    <div className="text-xl font-bold text-accent mt-1">
                      {sections.filter((s) => s.is_lab === 1).length}
                    </div>
                  </div>
                  <div className="p-3.5 bg-slate-50 border border-border rounded-lg">
                    <div className="text-xs text-text-muted font-medium">Size Warnings</div>
                    <div className="text-xl font-bold text-amber-600 mt-1">
                      {sections.filter((s) => s.warning_message).length}
                    </div>
                  </div>
                </div>
              )}

              {/* Search & Filter */}
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="relative w-full max-w-sm">
                  <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by code, subject, or faculty..."
                    value={sectionFilter}
                    onChange={(e) => setSectionFilter(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              {/* Sections Table */}
              <div className="mb-2"><SizeBarLegend /></div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-border text-text-muted font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Section</th>
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3">Faculty</th>
                      <th className="py-2.5 px-3">Room Required</th>
                      <th className="py-2.5 px-3" title="Class size against the teacher's preferred size, hard limit and ML recommendation">Size vs teacher limits</th>
                      <th className="py-2.5 px-3">Hours/Wk</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredSections.map((s) => (
                      <tr key={s.section_id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-text-primary">{s.section_label}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-text-primary">{s.subject_code}</div>
                          <div className="text-[11px] text-text-muted">{s.subject_name}</div>
                        </td>
                        <td className="py-2.5 px-3 text-text-primary font-medium">{s.staff_name}</td>
                        <td className="py-2.5 px-3">
                          <span className="capitalize text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                            {s.required_room_type.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {s.allocation_basis ? (
                            <div
                              title={`${RULE_LABELS[s.allocation_basis.rule] || s.allocation_basis.rule}. Demand ${s.allocation_basis.demand_total}, ${s.allocation_basis.chosen} chose this teacher, ${s.allocation_basis.moved_in} moved in, ${s.allocation_basis.moved_out} moved out.`}
                            >
                              <SizeBar
                                size={s.size}
                                preferred={s.allocation_basis.preferred}
                                hardCap={s.allocation_basis.hard_cap}
                                ml={s.allocation_basis.ml_expected}
                              />
                            </div>
                          ) : (
                            <span className="font-semibold">{s.size}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">{s.hours_per_week}h</td>
                        <td className="py-2.5 px-3">
                          {s.is_lab === 1 ? (
                            <Badge variant="accent">Lab</Badge>
                          ) : (
                            <Badge variant="neutral">Theory</Badge>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {s.warning_message ? (
                            <Badge variant="warning" title={s.warning_message}>Warning</Badge>
                          ) : (
                            <Badge variant="success">OK</Badge>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleOpenEditModal(s)}
                            className="text-[11px] h-7 px-2"
                          >
                            Edit Size
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {filteredSections.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-text-muted">
                          No sections found. Click &quot;Run Section Splitter&quot; to generate sections.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Next Step Banner */}
              {sections.length > 0 && (
                <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-text-muted">
                    {sections.length} sections ready for CP-SAT weekly timetable generation.
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setActiveStep(2)}
                    icon={<ArrowRight className="w-3.5 h-3.5" />}
                  >
                    Proceed to Weekly Timetable
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ======================================================== */}
      {/* STEP 2: WEEKLY TIMETABLE                                 */}
      {/* ======================================================== */}
      {activeStep === 2 && (
        <div className="space-y-6">
          <Card className="border-border">
            <CardContent className="p-6">
              {/* Header & Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-base font-semibold text-text-primary">OR-Tools Weekly Timetable Solver</h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Finds an optimal weekly clash-free schedule satisfying faculty exclusivity, room availability, and lab blocks.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-text-muted">
                    <span>Time Limit:</span>
                    <select
                      value={timeLimit}
                      onChange={(e) => setTimeLimit(Number(e.target.value))}
                      className="px-2 py-1 text-xs rounded border border-border bg-white focus:outline-none"
                    >
                      <option value={15}>15 seconds</option>
                      <option value={30}>30 seconds</option>
                      <option value={60}>60 seconds</option>
                    </select>
                  </div>

                  <Button
                    variant="primary"
                    onClick={handleSolveTimetable}
                    disabled={isSolving || sections.length === 0 || !validationPassed}
                    icon={<Cpu className={`w-4 h-4 ${isSolving ? 'animate-spin' : ''}`} />}
                  >
                    {isSolving ? 'Solving Timetable...' : 'Solve Weekly Timetable'}
                  </Button>

                  {timetableSlots.length > 0 && (
                    <a
                      href={api.exportTimetableCsvUrl()}
                      download="weekly_timetable.csv"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-white text-text-primary hover:bg-slate-50 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export CSV
                    </a>
                  )}
                </div>
              </div>

              {/* Solver Run Summary Card */}
              {solverSummary && (
                <div className="p-4 mb-6 rounded-lg border border-border bg-slate-50/70 grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div>
                    <span className="text-[11px] text-text-muted uppercase font-semibold">Status</span>
                    <div className="mt-1">
                      {solverSummary.status === 'optimal' || solverSummary.status === 'feasible' ? (
                        <Badge variant="success" className="font-semibold">{solverSummary.status.toUpperCase()}</Badge>
                      ) : (
                        <Badge variant="error" className="font-semibold">{solverSummary.status.toUpperCase()}</Badge>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] text-text-muted uppercase font-semibold">Clash Verification</span>
                    <div className="mt-1 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span className="text-xs font-bold text-emerald-700">{solverSummary.clash_count} Clashes</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] text-text-muted uppercase font-semibold">Slots Scheduled</span>
                    <div className="mt-1 text-xs font-bold text-text-primary">{solverSummary.slots_count} slots</div>
                  </div>
                  <div>
                    <span className="text-[11px] text-text-muted uppercase font-semibold">Wasted Seats</span>
                    <div className="mt-1 text-xs font-medium text-text-muted">{solverSummary.wasted_seats} seats</div>
                  </div>
                  <div>
                    <span className="text-[11px] text-text-muted uppercase font-semibold">Wall Time</span>
                    <div className="mt-1 text-xs font-mono font-medium text-text-primary">{solverSummary.wall_time}s</div>
                  </div>
                </div>
              )}

              {/* Infeasible Diagnosis Banner */}
              {solverSummary?.status === 'infeasible' && (
                <div className="p-4 mb-6 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                  <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-red-900">Infeasible Schedule Bottleneck</h4>
                    <p className="text-xs text-red-700 mt-1 leading-relaxed">
                      {solverSummary.diagnosis || solverSummary.message}
                    </p>
                  </div>
                </div>
              )}

              {/* Timetable Tabs & Filters */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTimetableTab('master')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      timetableTab === 'master' ? 'bg-navy text-white' : 'bg-slate-100 text-text-muted hover:bg-slate-200'
                    }`}
                  >
                    Master Timetable
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimetableTab('staff')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      timetableTab === 'staff' ? 'bg-navy text-white' : 'bg-slate-100 text-text-muted hover:bg-slate-200'
                    }`}
                  >
                    By Faculty
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimetableTab('room')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      timetableTab === 'room' ? 'bg-navy text-white' : 'bg-slate-100 text-text-muted hover:bg-slate-200'
                    }`}
                  >
                    By Room
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimetableTab('section')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      timetableTab === 'section' ? 'bg-navy text-white' : 'bg-slate-100 text-text-muted hover:bg-slate-200'
                    }`}
                  >
                    By Section
                  </button>
                </div>

                {/* Sub-filters */}
                {timetableTab === 'staff' && (
                  <select
                    value={selectedStaffFilter}
                    onChange={(e) => setSelectedStaffFilter(e.target.value)}
                    className="px-2.5 py-1 text-xs rounded border border-border bg-white"
                  >
                    <option value="">All Faculty ({uniqueStaff.length})</option>
                    {uniqueStaff.map((st) => (
                      <option key={st.id} value={st.id}>{st.name} ({st.id})</option>
                    ))}
                  </select>
                )}

                {timetableTab === 'room' && (
                  <select
                    value={selectedRoomFilter}
                    onChange={(e) => setSelectedRoomFilter(e.target.value)}
                    className="px-2.5 py-1 text-xs rounded border border-border bg-white"
                  >
                    <option value="">All Rooms ({uniqueRooms.length})</option>
                    {uniqueRooms.map((rm) => (
                      <option key={rm.id} value={rm.id}>{rm.name} ({rm.id})</option>
                    ))}
                  </select>
                )}

                {timetableTab === 'section' && (
                  <select
                    value={selectedSectionFilter}
                    onChange={(e) => setSelectedSectionFilter(e.target.value)}
                    className="px-2.5 py-1 text-xs rounded border border-border bg-white"
                  >
                    <option value="">All Sections ({uniqueSectionLabels.length})</option>
                    {uniqueSectionLabels.map((lbl) => (
                      <option key={lbl} value={lbl}>{lbl}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Timetable Weekly Grid */}
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-center border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-border text-xs font-semibold text-text-muted">
                      <th className="py-2.5 px-2 border-r border-border w-24">Period</th>
                      <th className="py-2.5 px-2 border-r border-border">Monday</th>
                      <th className="py-2.5 px-2 border-r border-border">Tuesday</th>
                      <th className="py-2.5 px-2 border-r border-border">Wednesday</th>
                      <th className="py-2.5 px-2 border-r border-border">Thursday</th>
                      <th className="py-2.5 px-2">Friday</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-xs">
                    {[1, 2, 3, 4, 5, 6, 7].map((period) => (
                      <tr key={period} className="divide-x divide-border">
                        <td className="py-3 px-2 bg-slate-50 font-medium text-text-primary text-xs">
                          <div>Period {period}</div>
                          <div className="text-[10px] text-text-muted mt-0.5">
                            {period <= 4 ? `0${7 + period}:30` : `${7 + period}:15`}
                          </div>
                        </td>
                        {[1, 2, 3, 4, 5].map((day) => {
                          const slotsInCell = filteredSlots.filter(
                            (s) => s.day_of_week === day && s.period === period
                          );

                          return (
                            <td key={day} className="py-2 px-1.5 align-top min-w-[150px] bg-white">
                              {slotsInCell.map((slot) => (
                                <div
                                  key={slot.slot_id}
                                  onClick={() => setSelectedSlotDetail(slot)}
                                  className={`p-2 mb-1.5 rounded border text-left cursor-pointer transition-all hover:shadow-md ${
                                    slot.is_lab_block === 1
                                      ? 'bg-blue-50/90 border-blue-200 text-blue-950'
                                      : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-bold text-xs">{slot.subject_code}</span>
                                    <span className="text-[10px] px-1 bg-white/80 rounded border font-semibold">
                                      {slot.section_label}
                                    </span>
                                  </div>
                                  <div className="text-[11px] truncate mt-0.5 text-text-muted font-medium">
                                    {slot.staff_name}
                                  </div>
                                  <div className="flex items-center justify-between gap-1 mt-1 text-[10px]">
                                    <span className="text-slate-600 font-semibold">{slot.room_id}</span>
                                    {slot.is_lab_block === 1 && (
                                      <span className="px-1 py-0.2 bg-blue-200 text-blue-800 rounded text-[9px] font-bold">
                                        LAB BLOCK
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {slotsInCell.length === 0 && (
                                <div className="h-12 flex items-center justify-center text-[10px] text-slate-300">
                                  —
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Next Step Banner */}
              {timetableSlots.length > 0 && (
                <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setActiveStep(1)}
                    icon={<ArrowLeft className="w-3.5 h-3.5" />}
                  >
                    Back to Section Splitter
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setActiveStep(3)}
                    icon={<ArrowRight className="w-3.5 h-3.5" />}
                  >
                    Proceed to Semester Calendar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ======================================================== */}
      {/* STEP 3: SEMESTER CALENDAR                                */}
      {/* ======================================================== */}
      {activeStep === 3 && (
        <div className="space-y-6">
          <Card className="border-border">
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-base font-semibold text-text-primary">Full Semester Academic Calendar</h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Expands the weekly master timetable across all teaching weeks, automatically skipping holidays and university events.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    variant="primary"
                    onClick={handleGenerateCalendar}
                    disabled={isGeneratingCalendar || timetableSlots.length === 0 || !validationPassed}
                    icon={<Calendar className={`w-4 h-4 ${isGeneratingCalendar ? 'animate-spin' : ''}`} />}
                  >
                    {isGeneratingCalendar ? 'Expanding Calendar...' : 'Generate Semester Calendar'}
                  </Button>
                </div>
              </div>

              {/* Calendar Metrics */}
              {calendarSessions.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
                  <div className="p-3 bg-slate-50 border border-border rounded-lg">
                    <span className="text-[11px] text-text-muted font-medium">Total Sessions</span>
                    <div className="text-lg font-bold text-text-primary mt-0.5">{calendarSessions.length}</div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-border rounded-lg">
                    <span className="text-[11px] text-text-muted font-medium">Scheduled</span>
                    <div className="text-lg font-bold text-emerald-600 mt-0.5">
                      {calendarSessions.filter((s) => s.status === 'scheduled').length}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-border rounded-lg">
                    <span className="text-[11px] text-text-muted font-medium">Holidays Skipped</span>
                    <div className="text-lg font-bold text-amber-600 mt-0.5">
                      {calendarSessions.filter((s) => s.status === 'skipped_holiday').length}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-border rounded-lg">
                    <span className="text-[11px] text-text-muted font-medium">Leaves Skipped</span>
                    <div className="text-lg font-bold text-blue-600 mt-0.5">
                      {calendarSessions.filter((s) => s.status === 'skipped_leave').length}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-border rounded-lg">
                    <span className="text-[11px] text-text-muted font-medium">Make-ups Added</span>
                    <div className="text-lg font-bold text-purple-600 mt-0.5">
                      {calendarSessions.filter((s) => s.status === 'makeup').length}
                    </div>
                  </div>
                </div>
              )}

              {/* Filter by Month */}
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-muted">Filter Month:</span>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="px-2.5 py-1 text-xs rounded border border-border bg-white"
                  >
                    <option value="all">All Months</option>
                    {monthsAvailable.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                {/* Legend */}
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Scheduled
                  </span>
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Holiday
                  </span>
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Leave
                  </span>
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-500" /> Make-up
                  </span>
                </div>
              </div>

              {/* Calendar Sessions Table */}
              <div className="overflow-x-auto rounded-lg border border-border max-h-[500px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-border text-text-muted font-semibold sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Period</th>
                      <th className="py-2.5 px-3">Section</th>
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3">Faculty</th>
                      <th className="py-2.5 px-3">Room</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredCalendarSessions.slice(0, 150).map((s) => (
                      <tr key={s.session_id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-2 px-3 font-mono font-medium text-text-primary">{s.session_date}</td>
                        <td className="py-2 px-3">P{s.period}</td>
                        <td className="py-2 px-3 font-semibold">{s.section_label}</td>
                        <td className="py-2 px-3">{s.subject_code}</td>
                        <td className="py-2 px-3 text-text-primary">{s.staff_name}</td>
                        <td className="py-2 px-3 text-slate-600">{s.room_id}</td>
                        <td className="py-2 px-3">
                          {s.status === 'scheduled' && <Badge variant="success">Scheduled</Badge>}
                          {s.status === 'skipped_holiday' && <Badge variant="warning">Holiday</Badge>}
                          {s.status === 'skipped_leave' && <Badge variant="accent">Leave</Badge>}
                          {s.status === 'skipped_event' && <Badge variant="neutral">Event</Badge>}
                          {s.status === 'makeup' && <Badge variant="accent" className="bg-purple-100 text-purple-800 border-purple-200">Make-up</Badge>}
                        </td>
                        <td className="py-2 px-3 text-text-muted italic truncate max-w-xs">{s.notes || '—'}</td>
                      </tr>
                    ))}
                    {filteredCalendarSessions.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-text-muted">
                          No calendar sessions found. Click &quot;Generate Semester Calendar&quot;.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Next Step Banner */}
              {calendarSessions.length > 0 && (
                <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setActiveStep(2)}
                    icon={<ArrowLeft className="w-3.5 h-3.5" />}
                  >
                    Back to Weekly Timetable
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setActiveStep(4)}
                    icon={<ArrowRight className="w-3.5 h-3.5" />}
                  >
                    Proceed to Hours & Make-ups
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ======================================================== */}
      {/* STEP 4: HOURS CHECK & MAKE-UPS                           */}
      {/* ======================================================== */}
      {activeStep === 4 && (
        <div className="space-y-6">
          <Card className="border-border">
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-base font-semibold text-text-primary">Curricular Hours Delivery & Make-up Proposals</h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Compare required contact hours against scheduled delivery. Approve or reject make-up classes to resolve shortfalls.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {hoursSummary.length > 0 && (
                    <a
                      href={api.exportHoursCsvUrl()}
                      download="hours_summary.csv"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-white text-text-primary hover:bg-slate-50 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export Hours CSV
                    </a>
                  )}
                </div>
              </div>

              {/* Shortfall Alert */}
              {totalShortfall > 0 ? (
                <div className="p-4 mb-6 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-red-900">Total Shortfall: {totalShortfall} Hours</h4>
                      <p className="text-xs text-red-700 mt-0.5">
                        Due to public holidays and faculty leave, sections fall below accredited minimum hours. Review suggested make-up classes below.
                      </p>
                    </div>
                  </div>
                </div>
              ) : hoursSummary.length > 0 ? (
                <div className="p-4 mb-6 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-emerald-900">100% Curricular Delivery Satisfied</h4>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      All sections meet or exceed statutory required contact hours for the academic term.
                    </p>
                  </div>
                </div>
              ) : null}

              {/* Hours Summary Table */}
              <div className="overflow-x-auto rounded-lg border border-border mb-8">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-border text-text-muted font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Section</th>
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3">Faculty</th>
                      <th className="py-2.5 px-3">Required</th>
                      <th className="py-2.5 px-3">Delivered</th>
                      <th className="py-2.5 px-3">Shortfall</th>
                      <th className="py-2.5 px-3">Make-ups Approved</th>
                      <th className="py-2.5 px-3 text-right">Completion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {hoursSummary.map((h) => {
                      const pct = Math.min(100, Math.round((h.delivered_hours / h.required_hours) * 100));
                      return (
                        <tr key={h.section_id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-2.5 px-3 font-semibold text-text-primary">{h.section_label}</td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-text-primary">{h.subject_code}</div>
                            <div className="text-[11px] text-text-muted">{h.subject_name}</div>
                          </td>
                          <td className="py-2.5 px-3 font-medium text-text-primary">{h.staff_name}</td>
                          <td className="py-2.5 px-3 font-semibold">{h.required_hours}h</td>
                          <td className="py-2.5 px-3">{h.delivered_hours}h</td>
                          <td className="py-2.5 px-3">
                            {h.shortfall_hours > 0 ? (
                              <Badge variant="error" className="font-bold">-{h.shortfall_hours}h</Badge>
                            ) : (
                              <Badge variant="success">0h</Badge>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-purple-700 font-semibold">{h.makeup_approved_hours}h</td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span className="font-bold text-xs">{pct}%</span>
                              <div className="w-16 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Suggested Make-up Classes Section */}
              <div className="border-t border-border pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">Suggested Make-up Sessions</h4>
                    <p className="text-xs text-text-muted mt-0.5">
                      Deterministic slot suggestions to recover shortfall hours. Approving a session adds it directly into the semester calendar.
                    </p>
                  </div>
                  <Badge variant="neutral">{makeups.length} Proposed</Badge>
                </div>

                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-border text-text-muted font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Section</th>
                        <th className="py-2.5 px-3">Subject</th>
                        <th className="py-2.5 px-3">Faculty</th>
                        <th className="py-2.5 px-3">Proposed Date</th>
                        <th className="py-2.5 px-3">Period</th>
                        <th className="py-2.5 px-3">Room</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {makeups.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-2 px-3 font-semibold text-text-primary">{m.section_label}</td>
                          <td className="py-2 px-3 font-medium text-text-primary">{m.subject_code}</td>
                          <td className="py-2 px-3">{m.staff_name}</td>
                          <td className="py-2 px-3 font-mono font-medium">{m.makeup_date}</td>
                          <td className="py-2 px-3">Period {m.period}</td>
                          <td className="py-2 px-3 text-slate-700">{m.room_id}</td>
                          <td className="py-2 px-3">
                            {m.status === 'suggested' && <Badge variant="warning">Suggested</Badge>}
                            {m.status === 'approved' && <Badge variant="success">Approved</Badge>}
                            {m.status === 'rejected' && <Badge variant="neutral">Rejected</Badge>}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {m.status === 'suggested' ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="primary"
                                  size="sm"
                                  disabled={makeupActionId === m.id}
                                  onClick={() => handleApproveMakeup(m.id)}
                                  className="h-7 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-700"
                                  icon={<Check className="w-3 h-3" />}
                                >
                                  Approve
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={makeupActionId === m.id}
                                  onClick={() => handleRejectMakeup(m.id)}
                                  className="h-7 px-2 text-[11px] text-red-600 hover:bg-red-50"
                                  icon={<X className="w-3 h-3" />}
                                >
                                  Reject
                                </Button>
                              </div>
                            ) : (
                              <span className="text-text-muted text-[11px] italic capitalize">{m.status}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {makeups.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-text-muted">
                            No make-up sessions suggested. Either all curricular hours are delivered or the calendar has not been generated.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ======================================================== */}
      {/* SECTION SIZE EDIT MODAL (Week 10 intake changes)         */}
      {/* ======================================================== */}
      {editingSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity"
            onClick={() => !isEditSubmitting && setEditingSection(null)}
          />

          <div className="relative w-full max-w-md bg-white rounded-lg shadow-xl border border-border p-6 z-10 animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-text-primary">
                  Edit Section Size: {editingSection.section_label}
                </h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Adjust student cohort size for {editingSection.subject_code} ({editingSection.subject_name}).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSection(null)}
                className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 py-2">
              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">Current Size</label>
                <input
                  type="text"
                  disabled
                  value={editingSection.size}
                  className="w-full px-3 py-1.5 text-xs rounded border border-border bg-slate-100 text-text-muted"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">New Section Size</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={editNewSize}
                  onChange={(e) => setEditNewSize(Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-xs rounded border border-border focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {editPreview && (
                <div className="p-3 bg-slate-50 border border-border rounded-lg space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted font-medium">Room Capacity Check:</span>
                    {editPreview.room_capacity_ok ? (
                      <Badge variant="success">OK (Fits Room)</Badge>
                    ) : (
                      <Badge variant="error">Room Over Capacity</Badge>
                    )}
                  </div>
                  {editPreview.warnings?.map((w: string, i: number) => (
                    <p key={i} className="text-status-warning text-[11px] font-medium">
                      ⚠️ {w}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button variant="secondary" size="sm" onClick={() => setEditingSection(null)}>
                Cancel
              </Button>
              <Button variant="outline" size="sm" onClick={handlePreviewEdit}>
                Preview Validation
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={isEditSubmitting}
                onClick={handleConfirmEdit}
              >
                {isEditSubmitting ? 'Saving...' : 'Confirm & Save'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* SLOT DETAIL DRAWER                                       */}
      {/* ======================================================== */}
      <Drawer
        isOpen={selectedSlotDetail !== null}
        onClose={() => setSelectedSlotDetail(null)}
        title={selectedSlotDetail ? `${selectedSlotDetail.subject_code} — ${selectedSlotDetail.section_label}` : 'Slot Details'}
        subtitle={selectedSlotDetail ? `Day ${selectedSlotDetail.day_of_week}, Period ${selectedSlotDetail.period}` : ''}
      >
        {selectedSlotDetail && (
          <div className="space-y-5 text-xs">
            <div className="p-3 bg-slate-50 rounded-lg border border-border space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Subject Code:</span>
                <span className="font-semibold text-text-primary">{selectedSlotDetail.subject_code}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Subject Name:</span>
                <span className="font-medium text-text-primary">{selectedSlotDetail.subject_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Section:</span>
                <span className="font-semibold text-accent">{selectedSlotDetail.section_label}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Faculty Assigned:</span>
                <span className="font-medium text-text-primary">{selectedSlotDetail.staff_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Room Assigned:</span>
                <span className="font-medium text-text-primary">{selectedSlotDetail.room_name} ({selectedSlotDetail.room_id})</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Session Type:</span>
                {selectedSlotDetail.is_lab_block === 1 ? (
                  <Badge variant="accent">Consecutive Lab Block</Badge>
                ) : (
                  <Badge variant="neutral">Theory Lecture</Badge>
                )}
              </div>
            </div>

            <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-lg space-y-1">
              <div className="font-semibold text-blue-900">Constraint Solver Audit</div>
              <p className="text-[11px] text-blue-800 leading-relaxed">
                Slot guaranteed clash-free across 160 students, faculty schedule limits, and room exclusivity.
              </p>
            </div>
          </div>
        )}
      </Drawer>

      {/* ======================================================== */}
      {/* "HOW THIS WORKS" SLIDE-OVER DRAWER                       */}
      {/* ======================================================== */}
      <Drawer
        isOpen={isHowItWorksOpen}
        onClose={() => setIsHowItWorksOpen(false)}
        title="Module 3: Timetable Engine Architecture"
        subtitle="Deterministic rules, OR-Tools CP-SAT constraint programming, and calendar projection"
      >
        <div className="space-y-6 text-xs text-text-primary leading-relaxed">
          <div className="space-y-2">
            <h4 className="font-bold text-sm text-text-primary flex items-center gap-1.5">
              <Split className="w-4 h-4 text-accent" />
              Part 1: Section Splitter
            </h4>
            <p className="text-text-muted">
              Divides student enrollments across qualified teaching staff. If students made specific faculty selections during selection day, choices are respected. If cohort sizes exceed the capacity of available rooms (e.g. computer lab limits of 40–45 students), the engine automatically creates multiple batches.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-sm text-text-primary flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-navy" />
              Part 2: Google OR-Tools CP-SAT Solver
            </h4>
            <p className="text-text-muted">
              Formulates weekly scheduling as an exact boolean satisfiability constraint program:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-text-muted">
              <li><strong>Hard constraints:</strong> Staff exclusivity, room exclusivity, student group non-overlap, room capacity &ge; section size, and consecutive lab blocks.</li>
              <li><strong>Soft objectives:</strong> Minimizes wasted room seats, prevents excessive late-day clustering, and avoids back-to-back same-day theory repeats.</li>
              <li><strong>Determinism:</strong> Fixed random seed (42) and single-worker search guarantee identical output on repeated runs.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-sm text-text-primary flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-emerald-600" />
              Part 3: Semester Calendar &amp; Holidays
            </h4>
            <p className="text-text-muted">
              Projects the weekly master schedule across all semester dates (July to November). Dates matching official public holidays or approved faculty leaves are skipped, preserving historical notes.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-sm text-text-primary flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-purple-600" />
              Part 4: Hours Check &amp; Make-up Proposals
            </h4>
            <p className="text-text-muted">
              Calculates delivered contact hours vs accredited requirements. When holidays cause shortfalls, the engine proposes clash-free make-up sessions. Approving a proposal directly embeds it into the calendar and decreases the shortfall.
            </p>
          </div>
        </div>
      </Drawer>
    </div>
  );
};
