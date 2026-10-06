import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { api, ReadinessItem } from '../lib/api.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { Skeleton } from '../components/common/Skeleton.js';
import { formatDateTime } from '../lib/utils.js';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  Database,
  Sparkles,
  ExternalLink,
  Info,
  TrendingUp,
} from 'lucide-react';

export const OverviewPage: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: readiness, isLoading, isError } = useQuery({
    queryKey: ['readiness'],
    queryFn: api.getReadiness,
    refetchInterval: 5000,
  });

  const { data: latestEtl } = useQuery({
    queryKey: ['etl-latest'],
    queryFn: api.getLatestEtlRun,
    refetchInterval: 5000,
  });

  const { data: forecastStatus } = useQuery({
    queryKey: ['forecast-status'],
    queryFn: api.getForecastStatus,
    retry: false,
    refetchInterval: 5000,
  });

  const loadSampleMutation = useMutation({
    mutationFn: api.loadSampleData,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['readiness'] });
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      toast.success(res.message || 'Sample datasets loaded successfully');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to load sample dataset');
    },
  });

  const getStatusBadge = (item: ReadinessItem) => {
    switch (item.status) {
      case 'Uploaded':
      case 'Configured':
        return (
          <Badge variant="success" dot>
            {item.status}
          </Badge>
        );
      case 'Has issues':
        return (
          <Badge variant="error" dot>
            Has issues
          </Badge>
        );
      case 'Not configured':
      case 'Not uploaded':
      default:
        return (
          <Badge variant={item.isRequired ? 'warning' : 'neutral'} dot>
            {item.status}
          </Badge>
        );
    }
  };

  const getNavigationLink = (item: ReadinessItem) => {
    if (item.id === 'rules') return '/rules';
    if (item.id === 'holidays') return '/holidays';
    return `/uploads?focus=${item.id}`;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError || !readiness) {
    return (
      <Card className="p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-status-error mx-auto mb-2" />
        <p className="text-sm font-semibold text-text-primary">Unable to load readiness status</p>
        <p className="text-xs text-text-muted mt-1">Please ensure the backend server is running on port 4000.</p>
        <Button size="sm" variant="secondary" className="mt-4" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </Card>
    );
  }

  const { completedRequiredCount, totalRequiredCount, percentage, isReadyForValidation, items } = readiness;

  const latestRun = latestEtl?.run;
  const isValidationPassed = latestRun?.status === 'passed';
  const isValidationStale = latestRun?.stale === 1 || Boolean(latestRun?.isStale);
  const canProceedToGenerate = isValidationPassed && !isValidationStale;

  return (
    <div className="space-y-6">
      {/* Top Banner & Readiness Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Progress Card */}
        <Card className="md:col-span-2 border-border shadow-sm">
          <CardHeader className="border-b border-border/60">
            <div>
              <CardTitle>System Ingestion &amp; Validation Readiness</CardTitle>
              <CardDescription>
                Track prerequisite datasets, academic rules, and deterministic ETL validation status.
              </CardDescription>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 text-text-primary border border-border">
              {canProceedToGenerate ? 'Phase 2 Completed' : 'Phase 1 & 2'}
            </span>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Required Inputs Completed
                </span>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums text-text-primary">
                    {completedRequiredCount}
                  </span>
                  <span className="text-sm text-text-muted font-medium">of {totalRequiredCount} completed</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold tabular-nums text-navy">{percentage}%</span>
                <p className="text-[11px] text-text-muted">
                  {!isReadyForValidation
                    ? 'Pending required inputs'
                    : isValidationPassed && !isValidationStale
                    ? 'Clean tables synchronized'
                    : latestRun?.status === 'failed'
                    ? 'Validation errors require attention'
                    : isValidationStale
                    ? 'Validation stale (re-run required)'
                    : 'Ready for validation'}
                </p>
              </div>
            </div>

            {/* Visual Progress Bar */}
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-border/80">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  canProceedToGenerate
                    ? 'bg-status-success'
                    : isReadyForValidation
                    ? 'bg-blue-600'
                    : 'bg-navy'
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>

            {/* Action Bar */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border/60">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Info className="w-4 h-4 shrink-0 text-text-muted" />
                <span>
                  {canProceedToGenerate
                    ? 'Validation passed with 0 errors. Clean normalized database tables are ready.'
                    : 'Validation requires all 5 inputs and 0 blocking errors before timetable generation.'}
                </span>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                {latestRun && (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => navigate('/validation')}
                    className="w-full sm:w-auto"
                  >
                    View Validation
                  </Button>
                )}

                {canProceedToGenerate ? (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => navigate('/generate')}
                    icon={<ArrowRight className="w-4 h-4" />}
                    className="w-full sm:w-auto shrink-0 bg-status-success hover:bg-emerald-700 text-white"
                  >
                    Proceed to Generate
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="md"
                    disabled={!isReadyForValidation}
                    onClick={() => navigate('/validation')}
                    icon={<ArrowRight className="w-4 h-4" />}
                    className="w-full sm:w-auto shrink-0"
                  >
                    Proceed to validation
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Development Helper Card */}
        <Card className="flex flex-col justify-between border-border bg-gradient-to-b from-white to-slate-50/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-accent" />
              <CardTitle className="text-sm font-semibold">Development Tools</CardTitle>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-accent font-semibold border border-blue-200">
              DEV MODE
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-text-muted leading-relaxed">
              Quickly populate the database with pre-configured university benchmark data from{' '}
              <code className="px-1 py-0.5 bg-slate-100 rounded text-[11px] border border-border">/sample-data</code>.
            </p>
            <div className="text-[11px] text-text-muted space-y-1 bg-slate-50 p-2.5 rounded border border-border">
              <div>• 960 student choices</div>
              <div>• 8 subjects &amp; 17 campus rooms</div>
              <div>• 14 faculty members &amp; academic rules</div>
            </div>
          </CardContent>
          <div className="p-4 pt-0">
            <Button
              variant="secondary"
              size="sm"
              className="w-full text-xs"
              onClick={() => loadSampleMutation.mutate()}
              isLoading={loadSampleMutation.isPending}
              icon={<Sparkles className="w-3.5 h-3.5 text-accent" />}
            >
              Load sample dataset
            </Button>
          </div>
        </Card>
      </div>

      {/* Phase 2: Demand Forecast (Optional Planning Card) */}
      <Card className="border-border bg-gradient-to-r from-blue-50/30 via-white to-slate-50/40 shadow-sm">
        <CardContent className="p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-text-primary text-sm">
                <TrendingUp className="w-4 h-4 text-accent" />
                <span>Student Demand Forecast</span>
              </div>
              <Badge variant="neutral" dot>
                Phase 2: Optional
              </Badge>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                Synthetic Seed Data
              </span>
              {forecastStatus?.is_stale && (
                <Badge variant="warning" dot>
                  Stale (Re-train needed)
                </Badge>
              )}
            </div>

            <p className="text-xs text-text-muted leading-relaxed">
              Machine learning advisory module using expanding-window XGBoost to forecast next-term course enrollment
              and recommended sections before student selection day.
            </p>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-text-muted pt-1">
              <div>
                <span className="font-semibold text-text-primary">
                  {forecastStatus?.history_count ? forecastStatus.history_count.toLocaleString() : '0'}
                </span>{' '}
                history records ({forecastStatus?.available_years?.length || 0} years)
              </div>
              <span className="text-border">•</span>
              <div>
                Champion Model:{' '}
                {forecastStatus?.champion_model ? (
                  <span className="font-medium text-text-primary">
                    v{forecastStatus.champion_model.version} (Val MAE: {forecastStatus.champion_model.val_mae?.toFixed(1)})
                  </span>
                ) : (
                  <span className="text-text-muted">Not trained</span>
                )}
              </div>
              <span className="text-border">•</span>
              <div>
                Predictions:{' '}
                {forecastStatus?.predictions_summary?.count ? (
                  <span className="font-medium text-text-primary">
                    {forecastStatus.predictions_summary.count} courses ({forecastStatus.predictions_summary.target_year})
                  </span>
                ) : (
                  <span className="text-text-muted">None generated</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
            <Button
              variant="secondary"
              size="md"
              onClick={() => navigate('/forecast')}
              icon={<ArrowRight className="w-4 h-4" />}
            >
              Open Demand Forecast
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Checklist Table */}
      <Card className="border-border">
        <CardHeader>
          <div>
            <CardTitle>Inputs Readiness Checklist</CardTitle>
            <CardDescription>
              Review the integrity status of all input files and system rules before passing them to Module 2.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate('/uploads')}>
              Go to Upload Center
            </Button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border text-[11px] font-semibold text-text-primary uppercase tracking-wider">
                <th className="py-2.5 px-4">Dataset / Component</th>
                <th className="py-2.5 px-4">Requirement</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">File / Source</th>
                <th className="py-2.5 px-4 text-right">Rows / Entries</th>
                <th className="py-2.5 px-4">Last Updated</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {items.map((item) => {
                const targetLink = getNavigationLink(item);
                return (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-text-primary">{item.name}</div>
                      <div className="text-[11px] text-text-muted font-mono">{item.id}</div>
                    </td>
                    <td className="py-3 px-4">
                      {item.isRequired ? (
                        <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          Required
                        </span>
                      ) : (
                        <span className="text-[11px] text-text-muted bg-slate-50 px-2 py-0.5 rounded border border-border">
                          Optional
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">{getStatusBadge(item)}</td>
                    <td className="py-3 px-4 text-text-muted font-mono text-[11px]">
                      {item.fileName || '—'}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums font-medium text-text-primary">
                      {item.rowCount > 0 ? item.rowCount.toLocaleString() : '—'}
                    </td>
                    <td className="py-3 px-4 text-text-muted text-[11px]">
                      {formatDateTime(item.updatedAt)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        to={targetLink}
                        className="inline-flex items-center gap-1 text-accent hover:text-accent-hover font-semibold text-xs transition-colors"
                      >
                        {item.status === 'Uploaded' || item.status === 'Configured' ? 'Review' : 'Configure'}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {/* ETL Validation Pipeline Checklist Row */}
              <tr className="hover:bg-slate-50/80 transition-colors bg-slate-50/40">
                <td className="py-3 px-4">
                  <div className="font-semibold text-text-primary flex items-center gap-1.5">
                    <span>ETL Validation &amp; Clean DB</span>
                  </div>
                  <div className="text-[11px] text-text-muted font-mono">module_2_etl</div>
                </td>
                <td className="py-3 px-4">
                  <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                    Required
                  </span>
                </td>
                <td className="py-3 px-4">
                  {!latestRun ? (
                    <Badge variant="neutral" dot>
                      Not run
                    </Badge>
                  ) : isValidationStale ? (
                    <Badge variant="warning" dot>
                      Stale (Re-run needed)
                    </Badge>
                  ) : latestRun.status === 'passed' ? (
                    <Badge variant="success" dot>
                      Passed ({latestRun.warning_count} warnings)
                    </Badge>
                  ) : (
                    <Badge variant="error" dot>
                      Failed ({latestRun.error_count} errors)
                    </Badge>
                  )}
                </td>
                <td className="py-3 px-4 text-text-muted font-mono text-[11px]">
                  {latestRun ? `Run #${latestRun.id}` : '—'}
                </td>
                <td className="py-3 px-4 text-right tabular-nums font-medium text-text-primary">
                  {latestRun
                    ? `${latestRun.error_count} err, ${latestRun.warning_count} warn`
                    : '—'}
                </td>
                <td className="py-3 px-4 text-text-muted text-[11px]">
                  {latestRun?.started_at ? formatDateTime(latestRun.started_at) : '—'}
                </td>
                <td className="py-3 px-4 text-right">
                  <Link
                    to="/validation"
                    className="inline-flex items-center gap-1 text-accent hover:text-accent-hover font-semibold text-xs transition-colors"
                  >
                    {latestRun ? 'Review' : 'Run'}
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
