import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, HolidayRecord } from '../lib/api.js';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { Dialog } from '../components/common/Dialog.js';
import { Input, Select } from '../components/common/FormField.js';
import { Skeleton } from '../components/common/Skeleton.js';
import { formatDate } from '../lib/utils.js';
import { toast } from 'sonner';
import {
  Calendar,
  Plus,
  Upload,
  Trash2,
  Edit2,
  Check,
  X,
  AlertCircle,
  Info,
} from 'lucide-react';

export const HolidaysPage: React.FC = () => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<HolidayRecord | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  // New holiday inline form state
  const [newName, setNewName] = useState('');
  const [newDateFrom, setNewDateFrom] = useState('');
  const [newDateTo, setNewDateTo] = useState('');
  const [newType, setNewType] = useState<'public_holiday' | 'institution_holiday' | 'internal_exam'>('public_holiday');
  const [newAppliesTo, setNewAppliesTo] = useState('ALL');
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDateFrom, setEditDateFrom] = useState('');
  const [editDateTo, setEditDateTo] = useState('');
  const [editType, setEditType] = useState<'public_holiday' | 'institution_holiday' | 'internal_exam'>('public_holiday');
  const [editAppliesTo, setEditAppliesTo] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['holidays'],
    queryFn: api.getHolidays,
  });

  const createMutation = useMutation({
    mutationFn: api.createHoliday,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      queryClient.invalidateQueries({ queryKey: ['readiness'] });
      toast.success('Holiday added successfully');
      setNewName('');
      setNewDateFrom('');
      setNewDateTo('');
      setNewType('public_holiday');
      setNewAppliesTo('ALL');
      setInlineError(null);
    },
    onError: (err: any) => {
      setInlineError(err.message || 'Failed to add holiday');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<HolidayRecord> }) =>
      api.updateHoliday(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      toast.success('Holiday updated successfully');
      setEditingId(null);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update holiday');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteHoliday(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      queryClient.invalidateQueries({ queryKey: ['readiness'] });
      toast.success('Holiday deleted successfully');
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to delete holiday');
    },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => api.importHolidaysCsv(file),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      queryClient.invalidateQueries({ queryKey: ['readiness'] });
      toast.success(`Successfully imported ${res.count} holidays`);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to import holidays CSV');
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      importMutation.mutate(file);
    }
    if (e.target) e.target.value = '';
  };

  const holidays = data?.holidays || [];
  const semesterRules = data?.semesterRules;

  // Validation function
  const validateDates = (dateFrom: string, dateTo: string): string | null => {
    if (!dateFrom || !dateTo) return 'Both start and end dates are required';
    if (dateTo < dateFrom) return 'Date To cannot be earlier than Date From';

    if (semesterRules?.semester_start && semesterRules?.semester_end) {
      if (dateFrom < semesterRules.semester_start || dateTo > semesterRules.semester_end) {
        return `Holiday dates must fall inside the active semester period (${semesterRules.semester_start} to ${semesterRules.semester_end})`;
      }
    }
    return null;
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);

    if (!newName.trim()) {
      setInlineError('Holiday name is required');
      return;
    }

    const err = validateDates(newDateFrom, newDateTo);
    if (err) {
      setInlineError(err);
      return;
    }

    createMutation.mutate({
      holiday_id: `HOL_${Date.now()}`,
      name: newName.trim(),
      date_from: newDateFrom,
      date_to: newDateTo,
      type: newType,
      applies_to: newAppliesTo.trim() || 'ALL',
    });
  };

  const startEdit = (h: HolidayRecord) => {
    setEditingId(h.id);
    setEditName(h.name);
    setEditDateFrom(h.date_from);
    setEditDateTo(h.date_to);
    setEditType(h.type);
    setEditAppliesTo(h.applies_to);
  };

  const saveEdit = (id: number) => {
    const err = validateDates(editDateFrom, editDateTo);
    if (err) {
      toast.error(err);
      return;
    }

    updateMutation.mutate({
      id,
      data: {
        name: editName.trim(),
        date_from: editDateFrom,
        date_to: editDateTo,
        type: editType,
        applies_to: editAppliesTo.trim() || 'ALL',
      },
    });
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'public_holiday':
        return <Badge variant="neutral">Public Holiday</Badge>;
      case 'institution_holiday':
        return <Badge variant="accent">Institution Break</Badge>;
      case 'internal_exam':
        return <Badge variant="warning">Exam Blackout</Badge>;
      default:
        return <Badge variant="neutral">{type}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Notice Banner if Semester Rules are missing */}
      {!semesterRules ? (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3 text-xs text-amber-900">
          <Info className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Semester rules not yet configured:</span> Date boundaries are currently unrestricted. Once you configure semester start/end dates in the Rules form, holiday dates will be strictly validated against them.
          </div>
        </div>
      ) : (
        <div className="p-3 bg-slate-50 border border-border rounded-lg flex items-center justify-between text-xs text-text-muted">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-navy" />
            <span>
              Active Semester Bounds: <strong className="text-text-primary">{semesterRules.semester_name}</strong> ({semesterRules.semester_start} to {semesterRules.semester_end})
            </span>
          </div>
          <span className="text-[11px] text-text-muted">Dates strictly checked against active semester</span>
        </div>
      )}

      {/* Main Table Card */}
      <Card className="border-border">
        <CardHeader>
          <div>
            <CardTitle>Academic Calendar Blackout &amp; Holidays</CardTitle>
            <CardDescription>
              Specify institutional non-instructional days. Timetable generators will avoid scheduling classes on these dates.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2.5">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".csv"
              className="hidden"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              isLoading={importMutation.isPending}
              icon={<Upload className="w-3.5 h-3.5" />}
            >
              Import CSV
            </Button>
          </div>
        </CardHeader>

        {/* Inline Add Row Form */}
        <div className="p-4 bg-slate-50/70 border-b border-border">
          <form onSubmit={handleAddSubmit} className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
              <Plus className="w-3.5 h-3.5 text-navy" />
              <span>Add Holiday or Blackout Window</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
              <div className="md:col-span-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Holiday Name (e.g. Independence Day)"
                  hasError={!!inlineError}
                />
              </div>

              <div>
                <Input
                  type="date"
                  value={newDateFrom}
                  onChange={(e) => setNewDateFrom(e.target.value)}
                  placeholder="Date From"
                  hasError={!!inlineError}
                />
              </div>

              <div>
                <Input
                  type="date"
                  value={newDateTo}
                  onChange={(e) => setNewDateTo(e.target.value)}
                  placeholder="Date To"
                  hasError={!!inlineError}
                />
              </div>

              <div>
                <Select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as any)}
                >
                  <option value="public_holiday">Public Holiday</option>
                  <option value="institution_holiday">Institution Break</option>
                  <option value="internal_exam">Internal Exam</option>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  value={newAppliesTo}
                  onChange={(e) => setNewAppliesTo(e.target.value)}
                  placeholder="Applies to (ALL)"
                  className="w-28"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={createMutation.isPending}
                  className="shrink-0"
                >
                  Add
                </Button>
              </div>
            </div>

            {inlineError && (
              <div className="flex items-center gap-1.5 text-status-error text-xs font-medium pt-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{inlineError}</span>
              </div>
            )}
          </form>
        </div>

        {/* Holidays Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-border text-[11px] font-semibold text-text-primary uppercase tracking-wider">
                <th className="py-2.5 px-4">Holiday ID</th>
                <th className="py-2.5 px-4">Event Name</th>
                <th className="py-2.5 px-4">Date From</th>
                <th className="py-2.5 px-4">Date To</th>
                <th className="py-2.5 px-4">Type</th>
                <th className="py-2.5 px-4">Applies To</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {holidays.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-text-muted">
                    No holidays or blackout dates configured yet. Use the form above or import from CSV.
                  </td>
                </tr>
              ) : (
                holidays.map((h) => {
                  const isEditing = editingId === h.id;

                  if (isEditing) {
                    return (
                      <tr key={h.id} className="bg-blue-50/40">
                        <td className="py-2 px-4 font-mono text-[11px] text-text-muted">
                          {h.holiday_id}
                        </td>
                        <td className="py-2 px-4">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-7 text-xs"
                          />
                        </td>
                        <td className="py-2 px-4">
                          <Input
                            type="date"
                            value={editDateFrom}
                            onChange={(e) => setEditDateFrom(e.target.value)}
                            className="h-7 text-xs"
                          />
                        </td>
                        <td className="py-2 px-4">
                          <Input
                            type="date"
                            value={editDateTo}
                            onChange={(e) => setEditDateTo(e.target.value)}
                            className="h-7 text-xs"
                          />
                        </td>
                        <td className="py-2 px-4">
                          <Select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value as any)}
                            className="h-7 text-xs"
                          >
                            <option value="public_holiday">Public Holiday</option>
                            <option value="institution_holiday">Institution Break</option>
                            <option value="internal_exam">Internal Exam</option>
                          </Select>
                        </td>
                        <td className="py-2 px-4">
                          <Input
                            value={editAppliesTo}
                            onChange={(e) => setEditAppliesTo(e.target.value)}
                            className="h-7 text-xs max-w-[100px]"
                          />
                        </td>
                        <td className="py-2 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => saveEdit(h.id)}
                              className="p-1 text-status-success hover:bg-green-100 rounded"
                              title="Save"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="p-1 text-text-muted hover:bg-slate-200 rounded"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={h.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-[11px] text-text-muted">{h.holiday_id}</td>
                      <td className="py-2.5 px-4 font-semibold text-text-primary">{h.name}</td>
                      <td className="py-2.5 px-4 text-text-primary tabular-nums">{formatDate(h.date_from)}</td>
                      <td className="py-2.5 px-4 text-text-primary tabular-nums">{formatDate(h.date_to)}</td>
                      <td className="py-2.5 px-4">{getTypeBadge(h.type)}</td>
                      <td className="py-2.5 px-4 text-text-muted font-mono text-[11px]">{h.applies_to}</td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(h)}
                            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-slate-100 transition-colors"
                            aria-label={`Edit ${h.name}`}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(h)}
                            className="text-text-muted hover:text-status-error p-1 rounded hover:bg-red-50 transition-colors"
                            aria-label={`Delete ${h.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Delete Holiday?"
        description={`Are you sure you want to remove "${deleteTarget?.name}" (${deleteTarget?.date_from}) from the institutional calendar?`}
        confirmText="Delete Holiday"
        isDestructive
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
};
