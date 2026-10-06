import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';
import {
  api,
  ForecastPredictionRecord,
  ForecastInputRecord,
} from '../lib/api.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { Drawer } from '../components/common/Drawer.js';
import { Skeleton } from '../components/common/Skeleton.js';
import { cn } from '../lib/utils.js';
import { toast } from 'sonner';
import {
  TrendingUp,
  Play,
  RotateCw,
  Download,
  UploadCloud,
  HelpCircle,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Search,
  Sparkles,
  Layers,
  Save,
  X,
} from 'lucide-react';

const STEPS = [
  { id: 'history', label: '1. History' },
  { id: 'train', label: '2. Train Model' },
  { id: 'assumptions', label: '3. Assumptions' },
  { id: 'predict', label: '4. Predict' },
  { id: 'section-plan', label: '5. Section Plan' },
  { id: 'accuracy', label: 'Accuracy & Backtest' },
];

export const ForecastPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState<string>('history');
  const [targetYear, setTargetYear] = useState<string>('2026-27');
  const [sectionSize, setSectionSize] = useState<number>(30);
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState<boolean>(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Filters for Predictions table
  const [deptFilter, setDeptFilter] = useState<string>('');
  const [termFilter, setTermFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Editable assumptions state
  const [editableInputs, setEditableInputs] = useState<ForecastInputRecord[]>([]);
  const [hasInputsChanged, setHasInputsChanged] = useState<boolean>(false);

  // Queries
  const { data: statusData, isLoading: isStatusLoading } = useQuery({
    queryKey: ['forecast-status'],
    queryFn: api.getForecastStatus,
    refetchInterval: 5000,
  });

  const { data: inputsData, isLoading: isInputsLoading } = useQuery({
    queryKey: ['forecast-inputs', targetYear],
    queryFn: () => api.getForecastInputs(targetYear),
  });

  // Keep local editable copy of assumptions
  React.useEffect(() => {
    if (inputsData?.inputs) {
      setEditableInputs(inputsData.inputs);
      setHasInputsChanged(false);
    }
  }, [inputsData]);

  const { data: predictionsData, isLoading: isPredictionsLoading } = useQuery({
    queryKey: ['forecast-predictions', targetYear],
    queryFn: () => api.getForecastPredictions(targetYear),
  });

  const { data: accuracyData, isLoading: isAccuracyLoading } = useQuery({
    queryKey: ['forecast-accuracy'],
    queryFn: api.getForecastAccuracy,
  });

  const { data: sectionPlanData, isLoading: isSectionPlanLoading } = useQuery({
    queryKey: ['forecast-section-plan'],
    queryFn: api.getForecastSectionPlan,
  });

  const { data: modelsData } = useQuery({
    queryKey: ['forecast-models'],
    queryFn: api.getForecastModels,
  });

  // Mutations
  const seedMutation = useMutation({
    mutationFn: api.seedForecastHistory,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['forecast-status'] });
      queryClient.invalidateQueries({ queryKey: ['forecast-inputs'] });
      queryClient.invalidateQueries({ queryKey: ['forecast-accuracy'] });
      toast.success(res.message);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to seed historical data');
    },
  });

  const uploadActualsMutation = useMutation({
    mutationFn: (file: File) => api.uploadFinishedYearActuals(file),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['forecast-status'] });
      queryClient.invalidateQueries({ queryKey: ['forecast-inputs'] });
      queryClient.invalidateQueries({ queryKey: ['forecast-accuracy'] });
      setIsUploadModalOpen(false);
      setSelectedFile(null);
      toast.success(res.message);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to upload actuals');
    },
  });

  const trainMutation = useMutation({
    mutationFn: (forcePromote: boolean = false) => api.trainForecastModel(targetYear, forcePromote),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['forecast-status'] });
      queryClient.invalidateQueries({ queryKey: ['forecast-accuracy'] });
      queryClient.invalidateQueries({ queryKey: ['forecast-models'] });
      const beatMsg = res.metrics.beats_baseline
        ? `Beats baseline by ${res.metrics.pct_improvement}%!`
        : `MAE: ${res.metrics.mae} (did not beat baseline).`;
      toast.success(`Model ${res.model_version} trained successfully. ${beatMsg}`);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to train model');
    },
  });

  const saveInputsMutation = useMutation({
    mutationFn: (inputs: ForecastInputRecord[]) => api.saveForecastInputs(inputs, targetYear),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['forecast-inputs', targetYear] });
      setHasInputsChanged(false);
      toast.success(res.message);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save assumptions');
    },
  });

  const predictMutation = useMutation({
    mutationFn: () => api.runForecastPredictions(targetYear, sectionSize),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['forecast-predictions', targetYear] });
      queryClient.invalidateQueries({ queryKey: ['forecast-section-plan'] });
      queryClient.invalidateQueries({ queryKey: ['forecast-status'] });
      toast.success(
        `Generated demand forecast for ${res.count} courses (${res.total_predicted_sections} sections total)`
      );
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to generate predictions');
    },
  });

  const promoteMutation = useMutation({
    mutationFn: (version: string) => api.promoteForecastModel(version),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['forecast-models'] });
      queryClient.invalidateQueries({ queryKey: ['forecast-status'] });
      toast.success(res.message);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to promote model');
    },
  });

  // Handle cell edit in assumptions table
  const handleAssumptionChange = (index: number, field: keyof ForecastInputRecord, value: any) => {
    setEditableInputs((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        [field]: value,
      };
      return copy;
    });
    setHasInputsChanged(true);
  };

  // Filtered Predictions for TanStack Table
  const filteredPredictions = useMemo(() => {
    if (!predictionsData?.predictions) return [];
    return predictionsData.predictions.filter((p) => {
      if (deptFilter && p.department !== deptFilter) return false;
      if (termFilter && p.term !== termFilter) return false;
      if (typeFilter && p.course_type !== typeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesCode = p.subject_code.toLowerCase().includes(q);
        const matchesName = p.subject_name.toLowerCase().includes(q);
        if (!matchesCode && !matchesName) return false;
      }
      return true;
    });
  }, [predictionsData, deptFilter, termFilter, typeFilter, searchQuery]);

  // TanStack Table columns for predictions
  const predictionColumns = useMemo<ColumnDef<ForecastPredictionRecord>[]>(
    () => [
      {
        accessorKey: 'subject_code',
        header: 'Course Code',
        cell: (info) => (
          <span className="font-mono font-semibold text-xs text-navy">{String(info.getValue())}</span>
        ),
      },
      {
        accessorKey: 'subject_name',
        header: 'Course Title',
        cell: (info) => (
          <span className="text-xs text-text-primary font-medium">{String(info.getValue())}</span>
        ),
      },
      {
        accessorKey: 'department',
        header: 'Dept',
        cell: (info) => (
          <span className="font-mono text-[11px] text-text-muted bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
            {String(info.getValue())}
          </span>
        ),
      },
      {
        accessorKey: 'term',
        header: 'Term / Sem',
        cell: ({ row }) => (
          <span className="text-xs text-text-muted">
            {row.original.term} (Sem {row.original.semester_no})
          </span>
        ),
      },
      {
        accessorKey: 'course_type',
        header: 'Type',
        cell: (info) => {
          const val = String(info.getValue());
          return (
            <Badge variant={val === 'core' ? 'neutral' : 'accent'}>
              {val}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'predicted_registered',
        header: 'Predicted Students [90% CI]',
        cell: ({ row }) => {
          const pred = row.original.predicted_registered;
          const low = row.original.low_interval;
          const high = row.original.high_interval;
          return (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-text-primary tabular-nums">{pred}</span>
              <span className="text-[11px] text-text-muted font-mono">[{low}–{high}]</span>
            </div>
          );
        },
      },
      {
        accessorKey: 'predicted_sections',
        header: 'Sections (Plan)',
        cell: ({ row }) => {
          const sections = row.original.predicted_sections;
          const staff = row.original.staff_available;
          const isShortfall = row.original.is_staff_shortfall;
          return (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tabular-nums text-text-primary">{sections}</span>
              {isShortfall === 1 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-status-error border border-rose-200">
                  Shortfall (avail {staff})
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'last_year_actual',
        header: 'Last Year',
        cell: (info) => {
          const val = info.getValue() as number | null;
          return val !== null && val !== undefined ? (
            <span className="text-xs tabular-nums text-text-muted">{val}</span>
          ) : (
            <span className="text-text-muted">—</span>
          );
        },
      },
      {
        accessorKey: 'change_pct',
        header: 'YoY %',
        cell: (info) => {
          const val = info.getValue() as number | null;
          if (val === null || val === undefined) return <span className="text-text-muted">—</span>;
          const isPositive = val > 0;
          return (
            <span
              className={cn(
                'text-xs font-semibold tabular-nums',
                isPositive ? 'text-status-success' : 'text-slate-600'
              )}
            >
              {isPositive ? `+${val}%` : `${val}%`}
            </span>
          );
        },
      },
    ],
    []
  );

  const table = useReactTable({
    data: filteredPredictions,
    columns: predictionColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const latestRun = statusData?.latest_run;
  const championModel = statusData?.champion_model;
  const isStale = statusData?.is_stale;

  if (isStatusLoading && !statusData) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-lg border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-text-primary tracking-tight">
              Course Demand Forecast
            </h1>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
              Phase 2 (Optional)
            </span>
            <Badge variant="warning" dot>
              Synthetic Data
            </Badge>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Machine learning model (XGBoost) predicts next term's registration and section requirements prior to student choice intake.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsHowItWorksOpen(true)}
            icon={<HelpCircle className="w-3.5 h-3.5 text-accent" />}
          >
            How this works
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsUploadModalOpen(true)}
            icon={<UploadCloud className="w-3.5 h-3.5 text-text-muted" />}
          >
            Upload Actuals
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => predictMutation.mutate()}
            disabled={predictMutation.isPending || !championModel}
            icon={<Play className={cn('w-3.5 h-3.5', predictMutation.isPending && 'animate-spin')} />}
          >
            {predictMutation.isPending ? 'Predicting...' : 'Run Forecast'}
          </Button>
        </div>
      </div>

      {/* Stale Warning Banner */}
      {isStale && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-900">
                New historical actuals uploaded since the current model was trained.
              </p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Retraining with the newly incorporated academic year will refresh expanding window lags.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => trainMutation.mutate(false)}
            disabled={trainMutation.isPending}
            className="shrink-0 bg-white border-amber-300 text-amber-800 hover:bg-amber-100"
          >
            Retrain Model
          </Button>
        </div>
      )}

      {/* Horizontal Workflow Stepper */}
      <div className="bg-white border border-border rounded-lg p-2 flex items-center gap-2 overflow-x-auto shadow-sm">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveStep(s.id)}
            className={cn(
              'px-4 py-2 text-xs font-semibold rounded transition-colors whitespace-nowrap',
              activeStep === s.id
                ? 'bg-navy text-white shadow-sm'
                : 'text-text-muted hover:text-text-primary hover:bg-slate-100'
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* STEP 1: HISTORY */}
      {activeStep === 'history' && (
        <div className="space-y-6">
          <Card className="border-border">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border">
              <div>
                <CardTitle>Historical Enrollment Baseline (2004–2026)</CardTitle>
                <CardDescription>
                  22 years of enrollment data across 8 departments. The expanding window uses past years to predict future terms.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => seedMutation.mutate()}
                  isLoading={seedMutation.isPending}
                  icon={<Sparkles className="w-3.5 h-3.5 text-accent" />}
                >
                  Load 22-Yr Sample History
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsUploadModalOpen(true)}
                  icon={<UploadCloud className="w-3.5 h-3.5" />}
                >
                  Upload Finished Year Actuals
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-5 pt-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-50 border border-border rounded-lg">
                  <span className="text-[11px] font-semibold text-text-muted uppercase">History Records</span>
                  <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">
                    {statusData?.history_count ? statusData.history_count.toLocaleString() : '0'}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5">Rows across all recorded academic years</p>
                </div>

                <div className="p-4 bg-slate-50 border border-border rounded-lg">
                  <span className="text-[11px] font-semibold text-text-muted uppercase">Academic Years</span>
                  <p className="text-2xl font-bold text-navy mt-1 tabular-nums">
                    {statusData?.available_years?.length || 0} Years
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    From {statusData?.available_years?.[0] || '—'} to {statusData?.available_years?.slice(-1)[0] || '—'}
                  </p>
                </div>

                <div className="p-4 bg-slate-50 border border-border rounded-lg">
                  <span className="text-[11px] font-semibold text-text-muted uppercase">Data Integrity</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    <CheckCircle2 className="w-5 h-5 text-status-success" />
                    <span className="text-sm font-bold text-text-primary">Lag Features Intact</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-0.5">Lags automatically rebuilt on each import</p>
                </div>
              </div>

              {/* Year Chips */}
              <div>
                <h4 className="text-xs font-semibold text-text-primary mb-2">Available Academic Years in Database</h4>
                <div className="flex flex-wrap gap-2">
                  {statusData?.available_years?.map((yr) => (
                    <span
                      key={yr}
                      className="px-2.5 py-1 rounded bg-white border border-border text-xs font-mono font-medium text-text-primary shadow-xs"
                    >
                      {yr}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 2: TRAIN MODEL */}
      {activeStep === 'train' && (
        <div className="space-y-6">
          <Card className="border-border">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border">
              <div>
                <CardTitle>Model Training &amp; Validation (Expanding Window)</CardTitle>
                <CardDescription>
                  Trains XGBoost strictly on completed years with early stopping on the latest validation year.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => trainMutation.mutate(false)}
                  disabled={trainMutation.isPending}
                  icon={<RotateCw className={cn('w-4 h-4', trainMutation.isPending && 'animate-spin')} />}
                >
                  {trainMutation.isPending ? 'Training Model...' : 'Retrain Model'}
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-6 pt-6">
              {latestRun ? (
                <>
                  {/* Performance metrics banner */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="p-4 bg-slate-50 border border-border rounded-lg">
                      <span className="text-[11px] font-semibold text-text-muted uppercase">Validation MAE</span>
                      <p className="text-2xl font-bold text-navy mt-1 tabular-nums">{latestRun.mae}</p>
                      <p className="text-[11px] text-text-muted mt-0.5">Average error in students per course</p>
                    </div>

                    <div className="p-4 bg-slate-50 border border-border rounded-lg">
                      <span className="text-[11px] font-semibold text-text-muted uppercase">RMSE</span>
                      <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">{latestRun.rmse}</p>
                      <p className="text-[11px] text-text-muted mt-0.5">Root Mean Square Error</p>
                    </div>

                    <div className="p-4 bg-slate-50 border border-border rounded-lg">
                      <span className="text-[11px] font-semibold text-text-muted uppercase">R² Fit Score</span>
                      <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">{latestRun.r2}</p>
                      <p className="text-[11px] text-text-muted mt-0.5">Variance explained</p>
                    </div>

                    <div className="p-4 bg-slate-50 border border-border rounded-lg">
                      <span className="text-[11px] font-semibold text-text-muted uppercase">Baseline MAE</span>
                      <p className="text-2xl font-bold text-slate-700 mt-1 tabular-nums">{latestRun.baseline_mae}</p>
                      <p className="text-[11px] text-text-muted mt-0.5">"Same as last year" baseline</p>
                    </div>
                  </div>

                  {/* Baseline comparison alert */}
                  <div
                    className={cn(
                      'p-4 rounded-lg border flex items-center justify-between',
                      latestRun.beats_baseline === 1
                        ? 'bg-status-success-bg border-status-success-border'
                        : 'bg-amber-50 border-amber-200'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {latestRun.beats_baseline === 1 ? (
                        <CheckCircle2 className="w-5 h-5 text-status-success shrink-0" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                      )}
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                          {latestRun.beats_baseline === 1
                            ? `Model beats simple baseline by ${latestRun.pct_improvement}%`
                            : 'Model did not beat simple last-year baseline'}
                        </h4>
                        <p className="text-xs text-text-muted mt-0.5">
                          Validation year: <span className="font-mono">{latestRun.val_year}</span>. Core course MAE:{' '}
                          <span className="font-semibold">{latestRun.core_mae ?? '—'}</span>, Elective MAE:{' '}
                          <span className="font-semibold">{latestRun.elective_mae ?? '—'}</span>.
                        </p>
                      </div>
                    </div>

                    <Badge variant={latestRun.beats_baseline === 1 ? 'success' : 'warning'} dot>
                      {latestRun.beats_baseline === 1 ? 'Superior' : 'Needs tuning'}
                    </Badge>
                  </div>
                </>
              ) : (
                <div className="p-8 text-center text-xs text-text-muted">
                  No model training run recorded yet. Click "Retrain Model" to train the first model.
                </div>
              )}

              {/* Model Registry List */}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-border flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                    Model Version Registry (Champion / Challenger)
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/70 border-b border-border text-[11px] font-semibold text-text-primary uppercase">
                        <th className="py-2.5 px-4">Version</th>
                        <th className="py-2.5 px-4">Trained On</th>
                        <th className="py-2.5 px-4">Val Year</th>
                        <th className="py-2.5 px-4 text-right">Val MAE</th>
                        <th className="py-2.5 px-4 text-right">Baseline MAE</th>
                        <th className="py-2.5 px-4 text-center">Status</th>
                        <th className="py-2.5 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {modelsData?.map((m) => (
                        <tr key={m.version} className="hover:bg-slate-50/80">
                          <td className="py-2.5 px-4 font-mono font-bold text-navy">{m.version}</td>
                          <td className="py-2.5 px-4 text-text-muted text-[11px]">
                            {JSON.parse(m.train_years_json || '[]').length} years
                          </td>
                          <td className="py-2.5 px-4 font-mono text-[11px] text-text-muted">{m.val_year}</td>
                          <td className="py-2.5 px-4 text-right font-bold tabular-nums text-text-primary">
                            {m.val_mae}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums text-text-muted">{m.baseline_mae}</td>
                          <td className="py-2.5 px-4 text-center">
                            {m.is_champion === 1 ? (
                              <Badge variant="success" dot>
                                Champion
                              </Badge>
                            ) : (
                              <Badge variant="neutral">Challenger</Badge>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            {m.is_champion !== 1 && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => promoteMutation.mutate(m.version)}
                                className="text-[11px]"
                              >
                                Promote to Champion
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 3: ASSUMPTIONS */}
      {activeStep === 'assumptions' && (
        <div className="space-y-6">
          <Card className="border-border">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border">
              <div>
                <CardTitle>Future Term Assumptions ({targetYear})</CardTitle>
                <CardDescription>
                  Assumed external parameters for future terms. Edit values directly and click "Save Assumptions".
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => saveInputsMutation.mutate(editableInputs)}
                  disabled={!hasInputsChanged || saveInputsMutation.isPending}
                  icon={<Save className="w-3.5 h-3.5" />}
                >
                  {saveInputsMutation.isPending ? 'Saving...' : 'Save Assumptions'}
                </Button>
              </div>
            </CardHeader>

            {isInputsLoading ? (
              <div className="p-8">
                <Skeleton className="h-64 w-full" />
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-100 z-10">
                  <tr className="border-b border-border text-[11px] font-semibold text-text-primary uppercase">
                    <th className="py-2 px-3">Code</th>
                    <th className="py-2 px-3">Subject Name</th>
                    <th className="py-2 px-3">Dept</th>
                    <th className="py-2 px-3">Term</th>
                    <th className="py-2 px-3">Cohort</th>
                    <th className="py-2 px-3">Industry Demand (Assumed)</th>
                    <th className="py-2 px-3">Topic Trend (Assumed)</th>
                    <th className="py-2 px-3">Staff Avail (Assumed)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {editableInputs.map((row, idx) => (
                    <tr key={`${row.subject_code}-${row.department}`} className="hover:bg-slate-50/80">
                      <td className="py-1.5 px-3 font-mono font-semibold text-navy text-xs">
                        {row.subject_code}
                      </td>
                      <td className="py-1.5 px-3 text-xs text-text-primary">{row.subject_name}</td>
                      <td className="py-1.5 px-3 font-mono text-[11px] text-text-muted">{row.department}</td>
                      <td className="py-1.5 px-3 text-xs text-text-muted">
                        {row.term} ({row.semester_no})
                      </td>
                      <td className="py-1.5 px-3 tabular-nums text-xs font-medium">{row.cohort_size}</td>

                      {/* Editable assumed fields */}
                      <td className="py-1 px-3">
                        <input
                          type="number"
                          step="0.1"
                          value={row.industry_demand_index ?? ''}
                          onChange={(e) =>
                            handleAssumptionChange(
                              idx,
                              'industry_demand_index',
                              e.target.value ? parseFloat(e.target.value) : null
                            )
                          }
                          className="w-24 px-2 py-1 text-xs font-mono rounded border border-border bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </td>

                      <td className="py-1 px-3">
                        <input
                          type="number"
                          step="0.1"
                          value={row.topic_trend_index ?? ''}
                          onChange={(e) =>
                            handleAssumptionChange(
                              idx,
                              'topic_trend_index',
                              e.target.value ? parseFloat(e.target.value) : null
                            )
                          }
                          className="w-24 px-2 py-1 text-xs font-mono rounded border border-border bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </td>

                      <td className="py-1 px-3">
                        <input
                          type="number"
                          value={row.staff_available ?? 5}
                          onChange={(e) =>
                            handleAssumptionChange(
                              idx,
                              'staff_available',
                              parseInt(e.target.value, 10) || 0
                            )
                          }
                          className="w-20 px-2 py-1 text-xs font-mono rounded border border-border bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        </div>
      )}

      {/* STEP 4: PREDICT & PREDICTIONS TABLE */}
      {activeStep === 'predict' && (
        <div className="space-y-6">
          <Card className="border-border">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border">
              <div>
                <CardTitle>Course Demand Forecast &amp; Section Sizing ({targetYear})</CardTitle>
                <CardDescription>
                  Predicted registrations clipped to [8, cohort_size], 90% confidence bounds, and planned sections.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => predictMutation.mutate()}
                  disabled={predictMutation.isPending || !championModel}
                  icon={<Play className={cn('w-3.5 h-3.5', predictMutation.isPending && 'animate-spin')} />}
                >
                  {predictMutation.isPending ? 'Generating...' : 'Re-run Forecast'}
                </Button>

                {latestRun && (
                  <a
                    href={api.forecastRunExportCsvUrl(latestRun.id)}
                    download={`forecast_${targetYear}_predictions.csv`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-white text-text-primary border border-border hover:bg-slate-50 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    Download CSV
                  </a>
                )}
              </div>
            </CardHeader>

            {/* Filter bar */}
            <div className="p-4 border-b border-border/80 bg-slate-50/50 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px] flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search course code or title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-border bg-white text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="text-xs py-1.5 px-2.5 rounded border border-border bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">All Departments</option>
                <option value="CSE">CSE</option>
                <option value="ECE">ECE</option>
                <option value="EEE">EEE</option>
                <option value="MECH">MECH</option>
                <option value="CIVIL">CIVIL</option>
              </select>

              <select
                value={termFilter}
                onChange={(e) => setTermFilter(e.target.value)}
                className="text-xs py-1.5 px-2.5 rounded border border-border bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">All Terms</option>
                <option value="Odd">Odd</option>
                <option value="Even">Even</option>
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="text-xs py-1.5 px-2.5 rounded border border-border bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">All Types</option>
                <option value="core">Core only</option>
                <option value="elective">Elective only</option>
              </select>

              <div className="flex items-center gap-1.5 pl-2 border-l border-border/80">
                <span className="text-[11px] font-medium text-text-muted">Target Year:</span>
                <select
                  value={targetYear}
                  onChange={(e) => setTargetYear(e.target.value)}
                  className="text-xs py-1 px-2 rounded border border-border bg-white text-text-primary font-medium focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="2026-27">2026-27</option>
                  <option value="2027-28">2027-28</option>
                  <option value="2028-29">2028-29</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-text-muted">Section Size:</span>
                <input
                  type="number"
                  min={10}
                  max={100}
                  value={sectionSize}
                  onChange={(e) => setSectionSize(parseInt(e.target.value, 10) || 30)}
                  className="w-16 text-xs py-1 px-2 rounded border border-border bg-white text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {(deptFilter || termFilter || typeFilter || searchQuery) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDeptFilter('');
                    setTermFilter('');
                    setTypeFilter('');
                    setSearchQuery('');
                  }}
                  className="text-xs"
                >
                  Clear
                </Button>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto min-h-[300px]">
              {isPredictionsLoading ? (
                <div className="p-8 text-center text-xs text-text-muted">Loading predictions...</div>
              ) : table.getRowModel().rows.length === 0 ? (
                <div className="p-12 text-center">
                  <TrendingUp className="w-8 h-8 text-navy mx-auto mb-2 opacity-60" />
                  <p className="text-xs font-semibold text-text-primary">No predictions available</p>
                  <p className="text-[11px] text-text-muted mt-1">
                    Click "Run Forecast" above to predict demand using the champion XGBoost model.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <tr
                        key={headerGroup.id}
                        className="bg-slate-100/80 border-b border-border text-[11px] font-semibold text-text-primary uppercase tracking-wider"
                      >
                        {headerGroup.headers.map((header) => (
                          <th key={header.id} className="py-2.5 px-3 whitespace-nowrap">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {table.getRowModel().rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="py-2 px-3 align-middle">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-2.5 border-t border-border bg-slate-50 text-[11px] text-text-muted text-right">
              Showing {filteredPredictions.length} courses (total planned sections: {filteredPredictions.reduce((acc, c) => acc + c.predicted_sections, 0)})
            </div>
          </Card>
        </div>
      )}

      {/* STEP 5: SECTION PLAN (MODULE 3 HAND-OFF) */}
      {activeStep === 'section-plan' && (
        <div className="space-y-6">
          <Card className="border-border">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border">
              <div>
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-navy" />
                  <CardTitle>Section Plan Hand-off (Module 3 Ready)</CardTitle>
                </div>
                <CardDescription>
                  Predicted section counts exported directly to Module 3 (Timetable Solver). Returns empty if forecast is disabled.
                </CardDescription>
              </div>

              <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 border border-border">
                GET /api/forecast/section-plan
              </span>
            </CardHeader>

            <div className="overflow-x-auto">
              {isSectionPlanLoading ? (
                <div className="p-8">
                  <Skeleton className="h-48 w-full" />
                </div>
              ) : !sectionPlanData || sectionPlanData.length === 0 ? (
                <div className="p-12 text-center">
                  <Layers className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-60" />
                  <p className="text-xs font-semibold text-text-primary">No section plan generated</p>
                  <p className="text-[11px] text-text-muted mt-1">
                    Complete the Predict step above to create course section requirements for the Timetable Engine.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100/70 border-b border-border text-[11px] font-semibold text-text-primary uppercase">
                      <th className="py-2.5 px-4">Subject Code</th>
                      <th className="py-2.5 px-4">Subject Name</th>
                      <th className="py-2.5 px-4">Dept</th>
                      <th className="py-2.5 px-4">Term</th>
                      <th className="py-2.5 px-4 text-right">Predicted Reg</th>
                      <th className="py-2.5 px-4 text-right">Sections Needed</th>
                      <th className="py-2.5 px-4 text-right">Staff Available</th>
                      <th className="py-2.5 px-4 text-center">Staff Capacity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {sectionPlanData.map((row) => (
                      <tr key={row.subject_code} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-4 font-mono font-semibold text-navy">{row.subject_code}</td>
                        <td className="py-2.5 px-4 text-text-primary">{row.subject_name}</td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-text-muted">{row.department}</td>
                        <td className="py-2.5 px-4 text-text-muted">{row.term}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-semibold">{row.predicted_registered}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-bold text-navy">{row.predicted_sections}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-text-muted">{row.staff_available}</td>
                        <td className="py-2.5 px-4 text-center">
                          {row.staff_shortfall === 1 ? (
                            <Badge variant="error" dot>
                              Shortfall
                            </Badge>
                          ) : (
                            <Badge variant="success" dot>
                              Adequate
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ACCURACY & BACKTEST */}
      {activeStep === 'accuracy' && (
        <div className="space-y-6">
          <Card className="border-border">
            <CardHeader className="border-b border-border">
              <CardTitle>Model Accuracy &amp; Rolling Backtest</CardTitle>
              <CardDescription>
                Expanding window backtest across the last 3 historical years comparing XGBoost against the last-year baseline.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6 pt-6">
              {isAccuracyLoading ? (
                <div className="p-8">
                  <Skeleton className="h-64 w-full" />
                </div>
              ) : (
                <>
                  {/* Backtest table */}
              <div>
                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-2">
                  3-Year Rolling Backtest (Simulated Annual Cycle)
                </h4>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/70 border-b border-border text-[11px] font-semibold text-text-primary uppercase">
                        <th className="py-2.5 px-4">Evaluation Year</th>
                        <th className="py-2.5 px-4 text-right">Model MAE</th>
                        <th className="py-2.5 px-4 text-right">Baseline MAE</th>
                        <th className="py-2.5 px-4 text-right">Improvement %</th>
                        <th className="py-2.5 px-4 text-center">Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {accuracyData?.rolling_backtest?.map((b) => (
                        <tr key={b.year} className="hover:bg-slate-50/80">
                          <td className="py-2.5 px-4 font-mono font-bold text-navy">{b.year}</td>
                          <td className="py-2.5 px-4 text-right font-bold tabular-nums text-text-primary">
                            {b.model_mae}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums text-text-muted">{b.baseline_mae}</td>
                          <td className="py-2.5 px-4 text-right font-semibold tabular-nums text-status-success">
                            +{b.improvement_pct}%
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <Badge variant={b.beats_baseline ? 'success' : 'warning'} dot>
                              {b.beats_baseline ? 'Beats Baseline' : 'Trailing'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top features importance */}
              <div>
                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-2">
                  Top Feature Importances
                </h4>
                <div className="space-y-2">
                  {accuracyData?.feature_importances?.slice(0, 8).map((f) => (
                    <div key={f.feature} className="flex items-center gap-3 text-xs">
                      <span className="font-mono text-text-muted w-44 truncate">{f.feature}</span>
                      <div className="flex-1 bg-slate-100 h-2.5 rounded-full overflow-hidden border border-border">
                        <div
                          className="bg-navy h-full rounded-full transition-all"
                          style={{ width: `${Math.min(100, f.importance * 180)}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] tabular-nums text-text-primary w-12 text-right">
                        {(f.importance * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
          </Card>
        </div>
      )}

      {/* Slide-over Drawer: "How this works" */}
      <Drawer
        isOpen={isHowItWorksOpen}
        onClose={() => setIsHowItWorksOpen(false)}
        title="Demand Forecast (XGBoost) Architecture"
        subtitle="Specification and operational rules for Phase 2"
        width="max-w-2xl"
      >
        <div className="p-6 space-y-4 text-xs text-text-primary leading-relaxed">
          <div className="p-3.5 bg-slate-50 border border-border rounded-lg space-y-2">
            <h4 className="font-bold text-navy text-sm">Expanding Window Cycle</h4>
            <p>
              Training strictly respects time causality. The target year being predicted is NEVER present in the training set.
            </p>
            <ul className="list-disc list-inside space-y-1 text-text-muted">
              <li><strong>Cycle 1:</strong> Train up to 2025-26, early stopping on 2025-26 validation, predict 2026-27.</li>
              <li><strong>Cycle 2:</strong> Add 2026-27 actuals, train up to 2026-27, predict 2027-28.</li>
              <li><strong>Cycle 3:</strong> Add 2027-28 actuals, train up to 2027-28, predict 2028-29.</li>
            </ul>
          </div>

          <div className="p-3.5 bg-slate-50 border border-border rounded-lg space-y-2">
            <h4 className="font-bold text-navy text-sm">Strict Leakage Guard</h4>
            <p>
              The following columns are derived downstream from student registration and are strictly forbidden from being inputs:
            </p>
            <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
              <span className="px-2 py-0.5 bg-rose-50 text-status-error border border-rose-200 rounded">sections_opened</span>
              <span className="px-2 py-0.5 bg-rose-50 text-status-error border border-rose-200 rounded">avg_section_size</span>
              <span className="px-2 py-0.5 bg-rose-50 text-status-error border border-rose-200 rounded">staff_shortfall</span>
              <span className="px-2 py-0.5 bg-rose-50 text-status-error border border-rose-200 rounded">split</span>
              <span className="px-2 py-0.5 bg-rose-50 text-status-error border border-rose-200 rounded">record_id</span>
              <span className="px-2 py-0.5 bg-rose-50 text-status-error border border-rose-200 rounded">is_synthetic</span>
            </div>
          </div>

          <div className="p-3.5 bg-slate-50 border border-border rounded-lg space-y-2">
            <h4 className="font-bold text-navy text-sm">Champion / Challenger Promotion</h4>
            <p>
              Every retrain creates a versioned model (<code className="font-mono">v1, v2, ...</code>). The new model is automatically promoted to Champion only if its validation MAE is lower than or equal to the current champion. The HOD can manually override promotion at any time.
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 border border-border rounded-lg space-y-2">
            <h4 className="font-bold text-navy text-sm">Module 3 Timetable Integration</h4>
            <p>
              Predictions are converted to planned sections (<code className="font-mono">ceil(predicted / section_size)</code>). This plan is returned by <code className="font-mono">GET /api/forecast/section-plan</code> to initialize section rooms and staff in the timetable engine.
            </p>
          </div>
        </div>
      </Drawer>

      {/* Modal: Upload Finished Year Actuals */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity"
            onClick={() => {
              if (!uploadActualsMutation.isPending) {
                setIsUploadModalOpen(false);
                setSelectedFile(null);
              }
            }}
          />
          <div className="relative w-full max-w-lg bg-white rounded-lg shadow-xl border border-border p-6 z-10 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-text-primary">Upload Finished Year Actuals</h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Ingest real enrollment actuals for a completed academic year (CSV or Excel)
                </p>
              </div>
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setSelectedFile(null);
                }}
                disabled={uploadActualsMutation.isPending}
                className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-border rounded-lg text-xs text-text-muted flex items-center justify-between">
              <span>Need the expected column format?</span>
              <a
                href={api.forecastHistoryTemplateUrl()}
                download="historical_enrollment_template.csv"
                className="inline-flex items-center gap-1 text-accent font-semibold hover:underline"
              >
                <Download className="w-3.5 h-3.5" />
                Download Template CSV
              </a>
            </div>

            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-accent transition-colors">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => {
                  if (e.target.files?.[0]) setSelectedFile(e.target.files[0]);
                }}
                className="hidden"
                id="actuals-file-input"
              />
              <label htmlFor="actuals-file-input" className="cursor-pointer block">
                <UploadCloud className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-xs font-semibold text-text-primary">
                  {selectedFile ? selectedFile.name : 'Click to select CSV or Excel file'}
                </p>
                <p className="text-[11px] text-text-muted mt-1">
                  Replaces any existing records for the specified academic year.
                </p>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setSelectedFile(null);
                }}
                disabled={uploadActualsMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!selectedFile || uploadActualsMutation.isPending}
                onClick={() => {
                  if (selectedFile) uploadActualsMutation.mutate(selectedFile);
                }}
                isLoading={uploadActualsMutation.isPending}
              >
                Import Actuals
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
