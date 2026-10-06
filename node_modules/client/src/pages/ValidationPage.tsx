import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';
import {
  api,
  EtlIssueItem,
  EtlRunRecord,
  EtlRunSummary,
} from '../lib/api.js';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { Drawer } from '../components/common/Drawer.js';
import { Skeleton } from '../components/common/Skeleton.js';
import { formatDateTime, cn } from '../lib/utils.js';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Download,
  ArrowRight,
  Search,
  HelpCircle,
  UploadCloud,
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
} from 'lucide-react';

const VALIDATION_STEPS = [
  'Rules',
  'Subjects',
  'Rooms',
  'Staff',
  'Holidays',
  'Students',
  'Cross-checks',
];

const CLEAN_DATASET_TABS = [
  { id: 'students_choices', label: 'Students Choices' },
  { id: 'subjects', label: 'Subjects' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'staff', label: 'Staff' },
  { id: 'holidays', label: 'Holidays' },
];

export const ValidationPage: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Selected run state (null means latest)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  // Issues filters
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [datasetFilter, setDatasetFilter] = useState<string>('');
  const [ruleFilter, setRuleFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Rule catalog drawer state
  const [isCatalogOpen, setIsCatalogOpen] = useState<boolean>(false);
  const [highlightedRule, setHighlightedRule] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const ruleRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Clean data tabs state
  const [activeCleanTab, setActiveCleanTab] = useState<string>('students_choices');

  // Step indicator state during run
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(0);

  // Fetch latest run
  const { data: latestData, isLoading: isLatestLoading } = useQuery({
    queryKey: ['etl-latest'],
    queryFn: api.getLatestEtlRun,
  });

  const activeRunId = selectedRunId ?? latestData?.run?.id;

  // Fetch active run details if not latest or if we need summary
  const { data: activeRunData } = useQuery({
    queryKey: ['etl-run', activeRunId],
    queryFn: () => (activeRunId ? api.getEtlRun(activeRunId) : Promise.resolve(null)),
    enabled: !!activeRunId,
  });

  // Fetch issues for active run
  const { data: issuesData, isLoading: isIssuesLoading } = useQuery({
    queryKey: [
      'etl-issues',
      activeRunId,
      severityFilter,
      datasetFilter,
      ruleFilter,
      searchQuery,
      page,
      pageSize,
    ],
    queryFn: () =>
      activeRunId
        ? api.getEtlIssues(activeRunId, {
            severity: severityFilter || undefined,
            dataset: datasetFilter || undefined,
            rule: ruleFilter || undefined,
            q: searchQuery || undefined,
            page,
            pageSize,
          })
        : Promise.resolve({ runId: 0, issues: [], total: 0, page: 1, pageSize: 25 }),
    enabled: !!activeRunId,
  });

  // Fetch rule catalog
  const { data: rulesCatalogData } = useQuery({
    queryKey: ['etl-rules'],
    queryFn: api.getEtlRules,
  });

  // Fetch clean data preview when passed
  const isPassed = activeRunData?.run?.status === 'passed';
  const { data: cleanPreviewData, isLoading: isCleanLoading } = useQuery({
    queryKey: ['clean-dataset', activeCleanTab],
    queryFn: () => (isPassed ? api.getCleanDataset(activeCleanTab, 1, 50) : Promise.resolve(null)),
    enabled: isPassed,
  });

  // Run ETL mutation
  const runMutation = useMutation({
    mutationFn: api.runEtl,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['etl-latest'] });
      queryClient.invalidateQueries({ queryKey: ['etl-runs'] });
      queryClient.invalidateQueries({ queryKey: ['etl-run', res.runId] });
      queryClient.invalidateQueries({ queryKey: ['etl-issues'] });
      queryClient.invalidateQueries({ queryKey: ['clean-summary'] });
      queryClient.invalidateQueries({ queryKey: ['clean-dataset'] });
      setSelectedRunId(res.runId);
      setPage(1);

      if (res.status === 'passed') {
        toast.success(`Validation passed with 0 errors (${res.summary.warnings} warnings)`);
      } else {
        toast.error(`Validation failed with ${res.summary.errors} error(s)`);
      }
    },
    onError: (err: any) => {
      if (err.code === 'DATASETS_MISSING') {
        toast.error(`Cannot run validation: missing datasets (${err.details?.missing?.join(', ')})`);
      } else {
        toast.error(err.message || 'Validation failed to run');
      }
    },
  });

  // Cycle through step indicator while mutation is running
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (runMutation.isPending) {
      setCurrentStepIdx(0);
      interval = setInterval(() => {
        setCurrentStepIdx((prev) => (prev + 1) % VALIDATION_STEPS.length);
      }, 350);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [runMutation.isPending]);

  // Handle clicking a rule code in table
  const handleOpenRuleInCatalog = (code: string) => {
    setHighlightedRule(code);
    setIsCatalogOpen(true);
    setTimeout(() => {
      const el = ruleRefs.current[code];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  };

  const runRecord: EtlRunRecord | undefined = activeRunData?.run || latestData?.run || undefined;
  const summary: EtlRunSummary | undefined =
    activeRunData?.summary || latestData?.summary || (runMutation.data?.summary as EtlRunSummary | undefined);

  const isStale = (latestData?.run?.stale === 1 || latestData?.run?.isStale) && !runMutation.isPending;

  // TanStack Table columns for issues
  const columns = useMemo<ColumnDef<EtlIssueItem>[]>(
    () => [
      {
        accessorKey: 'severity',
        header: 'Severity',
        cell: (info) => {
          const val = info.getValue() as 'error' | 'warning';
          return (
            <Badge variant={val === 'error' ? 'error' : 'warning'} dot>
              {val === 'error' ? 'Error' : 'Warning'}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'rule_code',
        header: 'Rule',
        cell: (info) => {
          const code = info.getValue() as string;
          return (
            <button
              type="button"
              onClick={() => handleOpenRuleInCatalog(code)}
              className="font-mono text-xs font-semibold text-accent hover:text-navy hover:underline inline-flex items-center gap-1 group"
              title="Click to view rule details"
            >
              <span>{code}</span>
              <HelpCircle className="w-3 h-3 text-slate-400 group-hover:text-accent" />
            </button>
          );
        },
      },
      {
        accessorKey: 'dataset',
        header: 'Dataset',
        cell: (info) => (
          <span className="font-mono text-[11px] text-text-muted bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
            {String(info.getValue())}
          </span>
        ),
      },
      {
        accessorKey: 'row_number',
        header: 'Row',
        cell: (info) => {
          const row = info.getValue() as number;
          return row > 0 ? (
            <span className="font-mono text-xs tabular-nums text-text-primary">#{row}</span>
          ) : (
            <span className="text-text-muted">—</span>
          );
        },
      },
      {
        accessorKey: 'column_name',
        header: 'Column / Key',
        cell: (info) => {
          const col = info.getValue() as string | null;
          return col ? (
            <span className="font-mono text-xs text-text-primary">{col}</span>
          ) : (
            <span className="text-text-muted">—</span>
          );
        },
      },
      {
        accessorKey: 'message',
        header: 'Message',
        cell: (info) => (
          <span className="text-xs text-text-primary leading-snug line-clamp-2 max-w-md">
            {String(info.getValue())}
          </span>
        ),
      },
      {
        accessorKey: 'original_value',
        header: 'Original Value',
        cell: (info) => {
          const val = info.getValue() as string | null;
          return val !== null && val !== undefined && val !== '' ? (
            <span className="font-mono text-[11px] text-text-muted bg-slate-50 px-1 py-0.5 rounded border border-border max-w-[120px] truncate block">
              {val}
            </span>
          ) : (
            <span className="text-text-muted">—</span>
          );
        },
      },
      {
        accessorKey: 'new_value',
        header: 'New Value',
        cell: (info) => {
          const val = info.getValue() as string | null;
          return val !== null && val !== undefined && val !== '' ? (
            <span className="font-mono text-[11px] text-status-success bg-status-success-bg/40 px-1 py-0.5 rounded border border-status-success-border max-w-[120px] truncate block">
              {val}
            </span>
          ) : (
            <span className="text-text-muted">—</span>
          );
        },
      },
      {
        accessorKey: 'action_taken',
        header: 'Action',
        cell: (info) => {
          const action = info.getValue() as string | null;
          if (!action) return <span className="text-text-muted">—</span>;
          const isFix = ['fixed', 'filled', 'removed', 'dropped'].includes(action);
          return (
            <span
              className={cn(
                'text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded border',
                isFix
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              )}
            >
              {action}
            </span>
          );
        },
      },
    ],
    []
  );

  const tableData = issuesData?.issues || [];
  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const totalIssues = issuesData?.total || 0;
  const totalPages = Math.ceil(totalIssues / pageSize) || 1;

  // Filtered rules in catalog
  const filteredCatalogRules = useMemo(() => {
    if (!rulesCatalogData?.rules) return [];
    if (!catalogSearch) return rulesCatalogData.rules;
    const q = catalogSearch.toLowerCase();
    return rulesCatalogData.rules.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.dataset.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
    );
  }, [rulesCatalogData, catalogSearch]);

  if (isLatestLoading && !latestData) {
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
            <h1 className="text-lg font-bold text-text-primary tracking-tight">Validation</h1>
            {runRecord && (
              <span className="text-xs font-mono px-2 py-0.5 bg-slate-100 text-text-muted rounded border border-border">
                Run #{runRecord.id}
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-1">
            {runRecord?.started_at ? (
              <>
                Last executed:{' '}
                <span className="font-medium text-text-primary">
                  {formatDateTime(runRecord.started_at)}
                </span>
                {runRecord.finished_at && ` (Finished in ${((new Date(runRecord.finished_at).getTime() - new Date(runRecord.started_at).getTime()) / 1000).toFixed(1)}s)`}
              </>
            ) : (
              'No validation runs recorded yet. Click "Run validation" to execute deterministic checks.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsCatalogOpen(true)}
            icon={<HelpCircle className="w-3.5 h-3.5 text-accent" />}
          >
            How this check works
          </Button>

          <Button
            variant="primary"
            size="md"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            icon={
              <RefreshCw
                className={cn('w-4 h-4', runMutation.isPending && 'animate-spin')}
              />
            }
          >
            {runMutation.isPending ? (
              <span>Checking {VALIDATION_STEPS[currentStepIdx]}...</span>
            ) : (
              'Run validation'
            )}
          </Button>
        </div>
      </div>

      {/* Stale notice banner */}
      {isStale && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-900">
                Data changed since the last run. Run validation again.
              </p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                New raw dataset files or rule changes have been uploaded. Clean database tables may be out of date.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="shrink-0 bg-white border-amber-300 text-amber-800 hover:bg-amber-100"
          >
            Re-run Validation
          </Button>
        </div>
      )}

      {/* Result banner (Passed / Failed) */}
      {runRecord && (
        <div>
          {runRecord.status === 'passed' ? (
            <div className="bg-status-success-bg border border-status-success-border rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-status-success shrink-0" />
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-status-success">
                    Validation Passed
                  </h3>
                  <p className="text-xs text-text-primary mt-0.5">
                    Zero blocking errors found. All clean normalized tables have been updated in an atomic transaction.
                    {runRecord.warning_count > 0 && (
                      <span className="text-text-muted ml-1">
                        ({runRecord.warning_count} non-blocking warning{runRecord.warning_count === 1 ? '' : 's'}{' '}
                        logged below).
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="hidden sm:block">
                <Badge variant="success" dot>
                  Clean Sync OK
                </Badge>
              </div>
            </div>
          ) : (
            <div className="bg-status-error-bg border border-status-error-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <XCircle className="w-5 h-5 text-status-error shrink-0" />
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-status-error">
                    Validation Failed: {runRecord.error_count} error{runRecord.error_count === 1 ? '' : 's'} must be fixed
                  </h3>
                  <p className="text-xs text-text-primary mt-0.5">
                    The clean database tables were NOT modified. Fix the files in Upload Center and run again.
                  </p>
                </div>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => navigate('/uploads')}
                icon={<UploadCloud className="w-3.5 h-3.5" />}
                className="shrink-0"
              >
                Fix in Upload Center
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Summary Cards (6 stats) */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="bg-white border border-border rounded-lg p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Rows In</p>
            <p className="text-xl font-bold text-text-primary mt-1 tabular-nums">
              {summary.rowsIn.toLocaleString()}
            </p>
          </div>
          <div className="bg-white border border-border rounded-lg p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Rows Out</p>
            <p className="text-xl font-bold text-text-primary mt-1 tabular-nums">
              {summary.rowsOut.toLocaleString()}
            </p>
          </div>
          <div className="bg-white border border-border rounded-lg p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Duplicates Removed</p>
            <p className="text-xl font-bold text-text-primary mt-1 tabular-nums">
              {summary.duplicatesRemoved.toLocaleString()}
            </p>
          </div>
          <div className="bg-white border border-border rounded-lg p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Auto-Fixes</p>
            <p className="text-xl font-bold text-accent mt-1 tabular-nums">
              {summary.autoFixes.toLocaleString()}
            </p>
          </div>
          <div className="bg-white border border-border rounded-lg p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Warnings</p>
            <p className="text-xl font-bold text-status-warning mt-1 tabular-nums">
              {summary.warnings.toLocaleString()}
            </p>
          </div>
          <div className="bg-white border border-border rounded-lg p-3.5 shadow-sm">
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Errors</p>
            <p className="text-xl font-bold text-status-error mt-1 tabular-nums">
              {summary.errors.toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {/* Per Dataset Table */}
      {summary?.byDataset && (
        <Card className="border-border">
          <CardHeader className="py-3 px-4 bg-slate-50/70 border-b border-border">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider">Per Dataset Ingestion Status</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/70 border-b border-border text-[11px] font-semibold text-text-primary uppercase tracking-wider">
                  <th className="py-2.5 px-4">Dataset</th>
                  <th className="py-2.5 px-4 text-right">Rows In</th>
                  <th className="py-2.5 px-4 text-right">Rows Out</th>
                  <th className="py-2.5 px-4 text-right">Errors</th>
                  <th className="py-2.5 px-4 text-right">Warnings</th>
                  <th className="py-2.5 px-4 text-center">Status</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {Object.entries(summary.byDataset).map(([ds, stats]) => {
                  const hasErrors = stats.errors > 0;
                  return (
                    <tr key={ds} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-semibold text-text-primary">
                        {ds}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-text-muted">
                        {stats.rowsIn > 0 ? stats.rowsIn.toLocaleString() : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-medium text-text-primary">
                        {stats.rowsOut > 0 ? stats.rowsOut.toLocaleString() : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums">
                        {stats.errors > 0 ? (
                          <span className="text-status-error font-bold">{stats.errors}</span>
                        ) : (
                          <span className="text-text-muted">0</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums">
                        {stats.warnings > 0 ? (
                          <span className="text-status-warning font-semibold">{stats.warnings}</span>
                        ) : (
                          <span className="text-text-muted">0</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <Badge variant={hasErrors ? 'error' : 'success'} dot>
                          {hasErrors ? 'Failed' : 'Clean'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {hasErrors ? (
                          <Link
                            to={`/uploads?focus=${ds}`}
                            className="inline-flex items-center gap-1 text-status-error hover:underline font-semibold text-xs"
                          >
                            Fix in Upload Center
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        ) : (
                          <span className="text-text-muted text-[11px]">Valid</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Issues Table (TanStack Table) */}
      <Card className="border-border">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border">
          <div>
            <CardTitle>Ingestion &amp; Transformation Issues</CardTitle>
            <CardDescription>
              Detailed audit trail of all deterministic rule violations, duplicate drops, and automated cell corrections.
            </CardDescription>
          </div>

          {runRecord && (
            <div className="flex items-center gap-2">
              <a
                href={api.issuesCsvUrl(runRecord.id)}
                download={`etl_issues_run_${runRecord.id}.csv`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-white text-text-primary border border-border hover:bg-slate-50 transition-colors shadow-sm"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                Download issues CSV
              </a>
            </div>
          )}
        </CardHeader>

        {/* Filters */}
        <div className="p-4 border-b border-border/80 bg-slate-50/50 flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative min-w-[200px] flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search column, message, value..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-border bg-white text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Severity filter */}
          <select
            value={severityFilter}
            onChange={(e) => {
              setSeverityFilter(e.target.value);
              setPage(1);
            }}
            className="text-xs py-1.5 px-2.5 rounded border border-border bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All Severities</option>
            <option value="error">Errors only</option>
            <option value="warning">Warnings only</option>
          </select>

          {/* Dataset filter */}
          <select
            value={datasetFilter}
            onChange={(e) => {
              setDatasetFilter(e.target.value);
              setPage(1);
            }}
            className="text-xs py-1.5 px-2.5 rounded border border-border bg-white text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All Datasets</option>
            <option value="rules">rules</option>
            <option value="subjects">subjects</option>
            <option value="rooms">rooms</option>
            <option value="staff">staff</option>
            <option value="holidays">holidays</option>
            <option value="students_choices">students_choices</option>
          </select>

          {/* Rule Code Filter */}
          <input
            type="text"
            placeholder="Filter rule (e.g. STF-011)"
            value={ruleFilter}
            onChange={(e) => {
              setRuleFilter(e.target.value);
              setPage(1);
            }}
            className="w-44 py-1.5 px-2.5 text-xs rounded border border-border bg-white text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />

          {(severityFilter || datasetFilter || ruleFilter || searchQuery) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSeverityFilter('');
                setDatasetFilter('');
                setRuleFilter('');
                setSearchQuery('');
                setPage(1);
              }}
              className="text-xs"
            >
              Clear filters
            </Button>
          )}
        </div>

        {/* Issues TanStack Table */}
        <div className="overflow-x-auto min-h-[220px]">
          {isIssuesLoading ? (
            <div className="p-8 text-center text-xs text-text-muted">Loading issues...</div>
          ) : table.getRowModel().rows.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle2 className="w-8 h-8 text-status-success mx-auto mb-2 opacity-80" />
              <p className="text-xs font-semibold text-text-primary">No issues match the selected filters</p>
              <p className="text-[11px] text-text-muted mt-1">
                {runRecord?.error_count === 0 && runRecord.warning_count === 0
                  ? 'All records passed deterministic ETL validation with zero warnings or errors.'
                  : 'Try loosening the severity or text filters above.'}
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
                      <th key={header.id} className="py-2 px-3 whitespace-nowrap">
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
                      <td key={cell.id} className="py-2 px-3 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination bar */}
        {totalIssues > 0 && (
          <div className="p-3 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-text-muted bg-slate-50/50">
            <div>
              Showing <span className="font-semibold text-text-primary">{(page - 1) * pageSize + 1}</span> to{' '}
              <span className="font-semibold text-text-primary">
                {Math.min(page * pageSize, totalIssues)}
              </span>{' '}
              of <span className="font-semibold text-text-primary">{totalIssues}</span> issues
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span>Page size:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="py-1 px-2 border border-border rounded bg-white text-xs text-text-primary"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  icon={<ChevronLeft className="w-3 h-3" />}
                >
                  Prev
                </Button>
                <span className="px-2 font-mono text-[11px]">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  icon={<ChevronRight className="w-3 h-3" />}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Clean Data Tabs (Only shown after a passed run) */}
      {isPassed && (
        <Card className="border-border">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border">
            <div>
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-status-success" />
                <CardTitle>Clean Normalized Database Tables</CardTitle>
              </div>
              <CardDescription>
                Preview the verified, normalized database tables that will be used by the Timetable Engine.
              </CardDescription>
            </div>

            <a
              href={api.cleanDatasetCsvUrl(activeCleanTab)}
              download={`clean_${activeCleanTab}.csv`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-white text-text-primary border border-border hover:bg-slate-50 transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              Download Clean {activeCleanTab} CSV
            </a>
          </CardHeader>

          {/* Clean dataset tabs */}
          <div className="border-b border-border px-4 flex items-center gap-2 bg-slate-50/50 overflow-x-auto">
            {CLEAN_DATASET_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveCleanTab(tab.id)}
                className={cn(
                  'px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap',
                  activeCleanTab === tab.id
                    ? 'border-navy text-navy bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]'
                    : 'border-transparent text-text-muted hover:text-text-primary'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Clean rows table */}
          <div className="overflow-x-auto max-h-[380px]">
            {isCleanLoading ? (
              <div className="p-8 text-center text-xs text-text-muted">Loading clean rows...</div>
            ) : !cleanPreviewData?.rows || cleanPreviewData.rows.length === 0 ? (
              <div className="p-8 text-center text-xs text-text-muted">No clean rows found in this table.</div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-100 z-10">
                  <tr className="border-b border-border text-[11px] font-semibold text-text-primary uppercase tracking-wider">
                    {Object.keys(cleanPreviewData.rows[0] || {}).map((col) => (
                      <th key={col} className="py-2 px-3 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {cleanPreviewData.rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      {Object.entries(row).map(([k, val]) => (
                        <td key={k} className="py-1.5 px-3 whitespace-nowrap font-mono text-[11px] text-text-primary">
                          {val !== null && val !== undefined ? String(val) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="p-2.5 border-t border-border bg-slate-50 text-[11px] text-text-muted text-right">
            Showing first {cleanPreviewData?.rows?.length || 0} rows (total: {cleanPreviewData?.total || 0})
          </div>
        </Card>
      )}

      {/* Primary Action at Bottom: Proceed to Generate */}
      <div className="bg-white border border-border rounded-lg p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
        <div>
          <h4 className="text-sm font-bold text-text-primary">Ready for Timetable Generation?</h4>
          <p className="text-xs text-text-muted mt-0.5">
            {isPassed && !isStale
              ? 'All datasets are clean and synchronized. You can now proceed to Module 3 (Timetable Engine).'
              : runRecord?.status === 'failed'
              ? 'All blocking errors must be resolved in Upload Center before proceeding.'
              : isStale
              ? 'Data has changed since the last run. Please re-run validation.'
              : 'Validation must pass with 0 errors before timetable generation can be launched.'}
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          disabled={!isPassed || isStale}
          onClick={() => navigate('/generate')}
          icon={<ArrowRight className="w-4 h-4" />}
          className="shrink-0"
        >
          Proceed to Generate
        </Button>
      </div>

      {/* Rule Catalog Drawer: "How this check works" */}
      <Drawer
        isOpen={isCatalogOpen}
        onClose={() => {
          setIsCatalogOpen(false);
          setHighlightedRule(null);
        }}
        title="Rule Catalog &amp; Validation Specification"
        subtitle="Deterministic rules executed during the ETL pipeline"
        width="max-w-2xl"
      >
        <div className="p-6 space-y-4">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search rule code, dataset or description..."
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-border bg-white text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="space-y-2">
            {filteredCatalogRules.map((rule) => {
              const isTarget = highlightedRule === rule.code;
              return (
                <div
                  key={rule.code}
                  ref={(el) => {
                    ruleRefs.current[rule.code] = el;
                  }}
                  className={cn(
                    'p-3 rounded-lg border text-xs transition-all',
                    isTarget
                      ? 'bg-blue-50/70 border-accent ring-2 ring-accent/30 shadow-sm'
                      : 'bg-white border-border hover:border-slate-300'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-navy">{rule.code}</span>
                      <span className="font-mono text-[10px] text-text-muted bg-slate-100 px-1.5 py-0.5 rounded border border-border">
                        {rule.dataset}
                      </span>
                    </div>
                    <Badge variant={rule.severity === 'error' ? 'error' : 'warning'} dot>
                      {rule.severity === 'error' ? 'Blocking Error' : 'Warning'}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-text-primary leading-relaxed">{rule.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </Drawer>
    </div>
  );
};
