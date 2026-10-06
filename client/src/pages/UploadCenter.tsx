import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { api, DatasetItem } from '../lib/api.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { Drawer } from '../components/common/Drawer.js';
import { Dialog } from '../components/common/Dialog.js';
import { Skeleton } from '../components/common/Skeleton.js';
import { formatDateTime } from '../lib/utils.js';
import { toast } from 'sonner';
import {
  UploadCloud,
  FileSpreadsheet,
  Download,
  Trash2,
  Eye,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  FileText,
} from 'lucide-react';

interface DatasetCardProps {
  dataset: DatasetItem;
  onPreview: (datasetId: string) => void;
  onDeleteRequest: (dataset: DatasetItem) => void;
}

const DatasetCard: React.FC<DatasetCardProps> = ({ dataset, onPreview, onDeleteRequest }) => {
  const queryClient = useQueryClient();
  const [showColumns, setShowColumns] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: ({ name, file }: { name: string; file: File }) => api.uploadDataset(name, file),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      queryClient.invalidateQueries({ queryKey: ['readiness'] });
      if (data.status === 'Uploaded') {
        toast.success(`Successfully uploaded ${dataset.name} (${data.rowCount} rows)`);
      } else {
        toast.error(`Uploaded ${dataset.name} with issues: Missing column(s) detected`);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || 'Upload failed');
    },
  });

  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];

    // Client-side checks
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'xls') {
      toast.error('Invalid file type. Only CSV and XLSX formats are allowed.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size exceeds the 10 MB limit.');
      return;
    }

    if (file.size === 0) {
      toast.error('The selected file is empty.');
      return;
    }

    uploadMutation.mutate({ name: dataset.id, file });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
  });

  const getStatusBadge = () => {
    switch (dataset.status) {
      case 'Uploaded':
        return (
          <Badge variant="success" dot>
            Uploaded
          </Badge>
        );
      case 'Has issues':
        return (
          <Badge variant="error" dot>
            Has issues
          </Badge>
        );
      case 'Not uploaded':
      default:
        return (
          <Badge variant={dataset.isRequired ? 'warning' : 'neutral'} dot>
            Not uploaded
          </Badge>
        );
    }
  };

  return (
    <Card className="flex flex-col justify-between border-border hover:border-slate-300 transition-all">
      <div>
        <CardHeader className="bg-slate-50/60 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-white border border-border flex items-center justify-center text-text-muted shrink-0">
              <FileSpreadsheet className="w-4 h-4 text-navy" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-semibold">{dataset.name}</CardTitle>
                {dataset.isRequired ? (
                  <Badge variant="neutral" className="text-[10px] px-1.5 py-0">
                    Required
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-text-muted">
                    Optional
                  </Badge>
                )}
              </div>
              <CardDescription className="line-clamp-1">{dataset.description}</CardDescription>
            </div>
          </div>
          <div>{getStatusBadge()}</div>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          {/* Metadata bar if uploaded */}
          {dataset.isUploaded && (
            <div className="bg-slate-50 p-2.5 rounded border border-border text-xs space-y-1">
              <div className="flex items-center justify-between text-text-primary">
                <span className="font-mono text-[11px] font-medium truncate max-w-[200px]" title={dataset.fileName || ''}>
                  {dataset.fileName}
                </span>
                <span className="tabular-nums font-semibold text-text-primary">
                  {dataset.rowCount.toLocaleString()} rows
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-text-muted">
                <span>Uploaded: {formatDateTime(dataset.uploadedAt)}</span>
                {dataset.report && dataset.report.missingColumns.length > 0 && (
                  <span className="text-status-error font-medium">
                    {dataset.report.missingColumns.length} missing col(s)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Expected Columns Collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setShowColumns(!showColumns)}
              className="flex items-center justify-between w-full text-[11px] font-semibold text-text-muted hover:text-text-primary py-1"
            >
              <span>Expected Columns ({dataset.expectedColumns.length})</span>
              {showColumns ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showColumns && (
              <div className="mt-2 flex flex-wrap gap-1 max-h-32 overflow-y-auto p-1.5 bg-slate-50 rounded border border-border">
                {dataset.expectedColumns.map((col) => {
                  const isKey = dataset.keyColumns.includes(col);
                  const isMissing = dataset.report?.missingColumns.includes(col);
                  return (
                    <span
                      key={col}
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        isMissing
                          ? 'bg-status-error-bg text-status-error border-status-error-border font-semibold'
                          : isKey
                          ? 'bg-blue-50 text-navy font-semibold border-blue-200'
                          : 'bg-white text-text-muted border-border'
                      }`}
                      title={isKey ? 'Key Column' : isMissing ? 'Missing Column' : 'Column'}
                    >
                      {col}
                      {isKey && ' *'}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-accent bg-accent-subtle/40'
                : 'border-border/80 hover:border-slate-400 bg-slate-50/40 hover:bg-slate-50'
            }`}
          >
            <input {...getInputProps()} />
            <UploadCloud className="w-6 h-6 mx-auto mb-1.5 text-text-muted" />
            <p className="text-xs font-semibold text-text-primary">
              {uploadMutation.isPending ? 'Processing file...' : 'Drop CSV or XLSX file here'}
            </p>
            <p className="text-[11px] text-text-muted mt-0.5">or click to browse from device (up to 10 MB)</p>
          </div>
        </CardContent>
      </div>

      {/* Card Actions */}
      <CardFooter className="pt-3 pb-3">
        <div className="flex items-center gap-2">
          <a
            href={api.downloadTemplateUrl(dataset.id)}
            download
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary font-medium hover:underline p-1"
          >
            <Download className="w-3.5 h-3.5" />
            Template
          </a>
        </div>

        <div className="flex items-center gap-2">
          {dataset.isUploaded && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPreview(dataset.id)}
                icon={<Eye className="w-3.5 h-3.5" />}
              >
                Preview
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-text-muted hover:text-status-error hover:bg-red-50"
                onClick={() => onDeleteRequest(dataset)}
                aria-label="Remove dataset"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  );
};

export const UploadCenterPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [previewDatasetId, setPreviewDatasetId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatasetItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['datasets'],
    queryFn: api.getDatasets,
  });

  const { data: previewData, isLoading: isPreviewLoading } = useQuery({
    queryKey: ['dataset-preview', previewDatasetId],
    queryFn: () => (previewDatasetId ? api.getDatasetPreview(previewDatasetId) : null),
    enabled: !!previewDatasetId,
  });

  const deleteMutation = useMutation({
    mutationFn: (datasetId: string) => api.deleteDataset(datasetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      queryClient.invalidateQueries({ queryKey: ['readiness'] });
      toast.success('Dataset removed successfully');
      setDeleteTarget(null);
      if (previewDatasetId === deleteTarget?.id) {
        setPreviewDatasetId(null);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to remove dataset');
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[1, 2, 3, 4, 5].map((n) => (
          <Skeleton key={n} className="h-72 w-full" />
        ))}
      </div>
    );
  }

  const datasets = data?.datasets || [];

  return (
    <div className="space-y-6">
      {/* Intro info bar */}
      <div className="bg-white border border-border rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Dataset Intake &amp; Header Verification</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Upload institutional CSV or Excel files. Module 1 verifies structural column conformity without modifying your data.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['datasets'] })}
          icon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Refresh Status
        </Button>
      </div>

      {/* Grid of Dataset Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {datasets.map((dataset) => (
          <DatasetCard
            key={dataset.id}
            dataset={dataset}
            onPreview={(id) => setPreviewDatasetId(id)}
            onDeleteRequest={(item) => setDeleteTarget(item)}
          />
        ))}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title={`Remove ${deleteTarget?.name}?`}
        description={`This will delete the uploaded ${deleteTarget?.fileName} and remove all associated rows from the database. This action cannot be undone.`}
        confirmText="Remove Dataset"
        isDestructive
        isLoading={deleteMutation.isPending}
      />

      {/* Preview Drawer */}
      <Drawer
        isOpen={!!previewDatasetId}
        onClose={() => setPreviewDatasetId(null)}
        title={previewData ? `${previewData.dataset}: Raw Data Preview` : 'Loading Preview...'}
        subtitle={previewData ? `Showing first ${previewData.previewRows.length} of ${previewData.totalRows.toLocaleString()} rows from ${previewData.original_filename}` : ''}
        width="max-w-4xl"
      >
        {isPreviewLoading || !previewData ? (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Validation Report Summary Box */}
            <div className="bg-slate-50 border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-primary">
                  Structural Validation Report
                </span>
                <Badge
                  variant={previewData.status === 'Uploaded' ? 'success' : 'error'}
                  dot
                >
                  {previewData.status}
                </Badge>
              </div>

              {/* Errors List */}
              {previewData.report && previewData.report.errors.length > 0 && (
                <div className="p-3 bg-status-error-bg border border-status-error-border rounded text-xs space-y-1">
                  <div className="font-semibold text-status-error flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Blocking Structural Errors ({previewData.report.errors.length})</span>
                  </div>
                  <ul className="list-disc list-inside text-status-error pl-1 space-y-0.5">
                    {previewData.report.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings List */}
              {previewData.report && previewData.report.warnings.length > 0 && (
                <div className="p-3 bg-status-warning-bg border border-status-warning-border rounded text-xs space-y-1">
                  <div className="font-semibold text-status-warning flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Value-Level Warnings ({previewData.report.warnings.length})</span>
                  </div>
                  <ul className="list-disc list-inside text-status-warning pl-1 space-y-0.5 max-h-36 overflow-y-auto">
                    {previewData.report.warnings.map((warn, i) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-text-muted mt-1 italic">
                    Note: Value-level warnings are logged for Module 2 ETL and do not block progress.
                  </p>
                </div>
              )}

              {/* Clean Bill */}
              {previewData.report && previewData.report.errors.length === 0 && previewData.report.warnings.length === 0 && (
                <div className="text-xs text-status-success flex items-center gap-2 p-2 bg-status-success-bg rounded border border-status-success-border font-medium">
                  <FileText className="w-3.5 h-3.5" />
                  All required columns verified with zero empty cells.
                </div>
              )}
            </div>

            {/* Sticky Header Dense Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-text-primary">First 25 Raw Rows</span>
                <span className="text-[11px] text-text-muted">Unmodified source data</span>
              </div>

              {previewData.previewRows.length === 0 ? (
                <p className="text-xs text-text-muted py-6 text-center">No rows available to display.</p>
              ) : (
                <div className="border border-border rounded-lg overflow-x-auto max-h-[460px] relative">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-100 border-b border-border shadow-sm">
                      <tr>
                        <th className="py-2 px-3 text-[11px] font-semibold text-text-muted uppercase tracking-wider w-10 text-center">
                          #
                        </th>
                        {Object.keys(previewData.previewRows[0] || {}).map((header) => (
                          <th
                            key={header}
                            className="py-2 px-3 text-[11px] font-semibold text-text-primary uppercase tracking-wider whitespace-nowrap"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {previewData.previewRows.map((row, idx) => (
                        <tr key={idx} className="even:bg-slate-50/50 hover:bg-slate-100/70">
                          <td className="py-1.5 px-3 text-text-muted text-[11px] text-center font-mono tabular-nums">
                            {idx + 1}
                          </td>
                          {Object.keys(row).map((header, cIdx) => (
                            <td key={cIdx} className="py-1.5 px-3 text-text-primary whitespace-nowrap text-xs">
                              {row[header] !== undefined && row[header] !== '' ? (
                                String(row[header])
                              ) : (
                                <span className="text-slate-300 italic text-[11px]">empty</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
};
