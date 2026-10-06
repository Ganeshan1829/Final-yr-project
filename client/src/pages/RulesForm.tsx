import React, { useEffect, useRef } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, RulesData } from '../lib/api.js';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { FormField, Input } from '../components/common/FormField.js';
import { Skeleton } from '../components/common/Skeleton.js';
import { RulesFormSchema, isMonday, computeCalendarWeeks } from '../schemas/rules.js';
import { toast } from 'sonner';
import {
  Save,
  Upload,
  Download,
  Calendar,
  Clock,
  Users,
  Check,
  AlertTriangle,
  Info,
} from 'lucide-react';

const WEEK_DAYS = [
  { id: 'MON', label: 'Monday' },
  { id: 'TUE', label: 'Tuesday' },
  { id: 'WED', label: 'Wednesday' },
  { id: 'THU', label: 'Thursday' },
  { id: 'FRI', label: 'Friday' },
];

const DEFAULT_RULES: RulesData = {
  semester_name: 'Fall 2026',
  academic_year: '2026-2027',
  department: 'Computer Science & Engineering',
  semester_start: '2026-07-06',
  semester_end: '2026-11-27',
  working_days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  saturday_makeup_allowed: false,
  periods_per_day: 7,
  periods: [
    { period: 1, start: '08:30', end: '09:20' },
    { period: 2, start: '09:25', end: '10:15' },
    { period: 3, start: '10:30', end: '11:20' },
    { period: 4, start: '11:25', end: '12:15' },
    { period: 5, start: '13:15', end: '14:05' },
    { period: 6, start: '14:10', end: '15:00' },
    { period: 7, start: '15:05', end: '15:55' },
  ],
  teaching_weeks_planned: 16,
  default_section_size: 60,
  min_section_size: 30,
  max_section_size: 70,
  max_consecutive_theory_periods: 2,
  max_staff_periods_per_day: 4,
  timezone: 'Asia/Kolkata',
};

export const RulesFormPage: React.FC = () => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: rulesResponse, isLoading } = useQuery({
    queryKey: ['rules'],
    queryFn: api.getRules,
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<RulesData>({
    resolver: zodResolver(RulesFormSchema),
    defaultValues: DEFAULT_RULES,
  });

  const { fields, replace } = useFieldArray({
    control,
    name: 'periods',
  });

  // Populate form when data arrives
  useEffect(() => {
    if (rulesResponse?.rules) {
      reset(rulesResponse.rules);
    }
  }, [rulesResponse, reset]);

  // Unsaved changes browser guard
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const watchedStartDate = watch('semester_start');
  const watchedEndDate = watch('semester_end');
  const watchedPeriodsPerDay = watch('periods_per_day');
  const watchedWorkingDays = watch('working_days') || [];

  // Update periods array when periods_per_day changes
  const handlePeriodsCountChange = (newCount: number) => {
    if (newCount < 1 || newCount > 10) return;
    setValue('periods_per_day', newCount, { shouldDirty: true, shouldValidate: true });

    const currentPeriods = watch('periods') || [];
    const updated = [];

    for (let i = 1; i <= newCount; i++) {
      if (currentPeriods[i - 1]) {
        updated.push({ ...currentPeriods[i - 1], period: i });
      } else {
        const startH = 8 + i;
        const endH = startH;
        updated.push({
          period: i,
          start: `${String(startH).padStart(2, '0')}:30`,
          end: `${String(endH).padStart(2, '0')}:20`,
        });
      }
    }
    replace(updated);
  };

  const saveMutation = useMutation({
    mutationFn: (data: RulesData) => api.saveRules(data),
    onSuccess: (res) => {
      reset(res.rules);
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      queryClient.invalidateQueries({ queryKey: ['readiness'] });
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      toast.success('Rules saved successfully');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save rules');
    },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => api.importRulesCsv(file),
    onSuccess: (res) => {
      reset(res.rules);
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      queryClient.invalidateQueries({ queryKey: ['readiness'] });
      toast.success('Rules imported successfully from CSV');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to import rules CSV');
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      importMutation.mutate(file);
    }
    if (e.target) e.target.value = '';
  };

  const onSubmit = (data: RulesData) => {
    saveMutation.mutate(data);
  };

  const computedWeeks = computeCalendarWeeks(watchedStartDate, watchedEndDate);
  const isStartMonday = isMonday(watchedStartDate);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Header Bar */}
      <div className="bg-white border border-border rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-text-primary">Academic &amp; Planning Rules</h2>
            {isDirty && (
              <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                Unsaved Changes
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Configure institutional operating boundaries, cohort sizes, instructional timings, and calendar span.
          </p>
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

          <a
            href={api.exportRulesUrl()}
            download="rules.csv"
            className="inline-flex items-center justify-center font-medium rounded border border-border bg-white text-text-primary hover:bg-slate-50 text-xs px-2.5 py-1.5 gap-1.5 min-h-[30px] transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </a>

          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={isSubmitting || saveMutation.isPending}
            icon={<Save className="w-3.5 h-3.5" />}
          >
            Save Rules
          </Button>
        </div>
      </div>

      {/* Section 1: Semester Info */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-navy" />
            <CardTitle className="text-sm">1. Semester &amp; Department Identity</CardTitle>
          </div>
          <span className="text-xs text-text-muted">Core Academic Period</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="Semester Name" required error={errors.semester_name?.message}>
              <Input
                {...register('semester_name')}
                placeholder="e.g. Fall 2026"
                hasError={!!errors.semester_name}
              />
            </FormField>

            <FormField label="Academic Year" required error={errors.academic_year?.message}>
              <Input
                {...register('academic_year')}
                placeholder="e.g. 2026-2027"
                hasError={!!errors.academic_year}
              />
            </FormField>

            <FormField label="Department" required error={errors.department?.message}>
              <Input
                {...register('department')}
                placeholder="e.g. Computer Science & Engineering"
                hasError={!!errors.department}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <FormField
              label="Semester Start Date"
              required
              error={errors.semester_start?.message}
              helperText={
                !isStartMonday && watchedStartDate ? (
                  <span className="text-status-warning flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-3 h-3" /> Start date is not a Monday
                  </span>
                ) : undefined
              }
            >
              <Input
                type="date"
                {...register('semester_start')}
                hasError={!!errors.semester_start}
              />
            </FormField>

            <FormField label="Semester End Date" required error={errors.semester_end?.message}>
              <Input
                type="date"
                {...register('semester_end')}
                hasError={!!errors.semester_end}
              />
            </FormField>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-primary">Calendar Span</label>
              <div className="h-[34px] px-3 bg-slate-50 border border-border rounded flex items-center justify-between text-xs">
                <span className="text-text-muted">Computed Weeks:</span>
                <span className="font-semibold text-text-primary tabular-nums">
                  {computedWeeks > 0 ? `${computedWeeks} Weeks` : '—'}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Working Days & Make-up */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-navy" />
            <CardTitle className="text-sm">2. Working Days &amp; Make-up Policy</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-text-primary block mb-2">
              Standard Instructional Days <span className="text-status-error">*</span>
            </label>
            <div className="flex flex-wrap gap-2.5">
              {WEEK_DAYS.map((d) => {
                const isSelected = watchedWorkingDays.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      const updated = isSelected
                        ? watchedWorkingDays.filter((x) => x !== d.id)
                        : [...watchedWorkingDays, d.id];
                      setValue('working_days', updated, { shouldDirty: true, shouldValidate: true });
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-navy text-white border-navy font-semibold'
                        : 'bg-white text-text-muted border-border hover:bg-slate-50'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                    {d.label}
                  </button>
                );
              })}
            </div>
            {errors.working_days && (
              <p className="text-[11px] text-status-error font-medium mt-1">
                {errors.working_days.message}
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-border flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-text-primary block">
                Saturday Make-up Classes Allowed
              </span>
              <p className="text-[11px] text-text-muted">
                Permit timetable optimization engine to allocate compensatory periods on Saturdays.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                {...register('saturday_makeup_allowed')}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-navy"></div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Periods Schedule Table */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-navy" />
            <CardTitle className="text-sm">3. Period Slots &amp; Timings</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted">Periods Per Day:</span>
            <select
              value={watchedPeriodsPerDay}
              onChange={(e) => handlePeriodsCountChange(Number(e.target.value))}
              className="text-xs font-semibold bg-white border border-border rounded px-2.5 py-1 text-text-primary"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n} Periods
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 border-b border-border text-[11px] font-semibold text-text-muted uppercase">
                <tr>
                  <th className="py-2 px-4 w-28">Slot #</th>
                  <th className="py-2 px-4">Start Time (HH:MM)</th>
                  <th className="py-2 px-4">End Time (HH:MM)</th>
                  <th className="py-2 px-4">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {fields.map((field, index) => {
                  const startTime = watch(`periods.${index}.start`);
                  const endTime = watch(`periods.${index}.end`);
                  let durationMin = 0;
                  if (startTime && endTime) {
                    const [sh, sm] = startTime.split(':').map(Number);
                    const [eh, em] = endTime.split(':').map(Number);
                    durationMin = eh * 60 + em - (sh * 60 + sm);
                  }

                  const periodError = errors.periods?.[index];

                  return (
                    <tr key={field.id} className="hover:bg-slate-50/50">
                      <td className="py-2 px-4 font-semibold text-navy">Period {index + 1}</td>
                      <td className="py-2 px-4">
                        <Input
                          type="time"
                          {...register(`periods.${index}.start` as const)}
                          hasError={!!periodError?.start}
                          className="max-w-[140px]"
                        />
                        {periodError?.start && (
                          <p className="text-[10px] text-status-error font-medium mt-0.5">
                            {periodError.start.message}
                          </p>
                        )}
                      </td>
                      <td className="py-2 px-4">
                        <Input
                          type="time"
                          {...register(`periods.${index}.end` as const)}
                          hasError={!!periodError?.end}
                          className="max-w-[140px]"
                        />
                        {periodError?.end && (
                          <p className="text-[10px] text-status-error font-medium mt-0.5">
                            {periodError.end.message}
                          </p>
                        )}
                      </td>
                      <td className="py-2 px-4 text-text-muted tabular-nums">
                        {durationMin > 0 ? `${durationMin} mins` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {errors.periods && typeof errors.periods.message === 'string' && (
            <p className="text-xs text-status-error font-medium">{errors.periods.message}</p>
          )}
        </CardContent>
      </Card>

      {/* Section 4: Section Limits & Planning Constraints */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Section Cohort Limits */}
        <Card className="border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-navy" />
              <CardTitle className="text-sm">4. Section Cohort Limits</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField
              label="Minimum Section Size"
              required
              error={errors.min_section_size?.message}
              helperText="Lowest allowed cohort headcount"
            >
              <Input
                type="number"
                {...register('min_section_size', { valueAsNumber: true })}
                hasError={!!errors.min_section_size}
              />
            </FormField>

            <FormField
              label="Default Target Section Size"
              required
              error={errors.default_section_size?.message}
              helperText="Optimal class size for standard theory cohorts"
            >
              <Input
                type="number"
                {...register('default_section_size', { valueAsNumber: true })}
                hasError={!!errors.default_section_size}
              />
            </FormField>

            <FormField
              label="Maximum Section Size"
              required
              error={errors.max_section_size?.message}
              helperText="Hard ceiling before requiring section split"
            >
              <Input
                type="number"
                {...register('max_section_size', { valueAsNumber: true })}
                hasError={!!errors.max_section_size}
              />
            </FormField>
          </CardContent>
        </Card>

        {/* Planning & Staff Load Limits */}
        <Card className="border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-navy" />
              <CardTitle className="text-sm">5. Teaching Load &amp; Planning Limits</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField
              label="Teaching Weeks Planned"
              required
              error={errors.teaching_weeks_planned?.message}
              helperText="Target instructional weeks for syllabus completion"
            >
              <Input
                type="number"
                {...register('teaching_weeks_planned', { valueAsNumber: true })}
                hasError={!!errors.teaching_weeks_planned}
              />
            </FormField>

            <FormField
              label="Max Consecutive Theory Periods"
              required
              error={errors.max_consecutive_theory_periods?.message}
              helperText="Maximum back-to-back hours for any theory subject"
            >
              <Input
                type="number"
                {...register('max_consecutive_theory_periods', { valueAsNumber: true })}
                hasError={!!errors.max_consecutive_theory_periods}
              />
            </FormField>

            <FormField
              label="Max Staff Periods Per Day"
              required
              error={errors.max_staff_periods_per_day?.message}
              helperText="Faculty daily teaching hour ceiling"
            >
              <Input
                type="number"
                {...register('max_staff_periods_per_day', { valueAsNumber: true })}
                hasError={!!errors.max_staff_periods_per_day}
              />
            </FormField>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Save Bar */}
      <div className="bg-white border border-border rounded-lg p-4 flex items-center justify-between shadow-sm">
        <span className="text-xs text-text-muted">
          All changes are verified against institutional scheduling policies.
        </span>
        <Button
          type="submit"
          variant="primary"
          size="md"
          isLoading={isSubmitting || saveMutation.isPending}
          icon={<Save className="w-4 h-4" />}
        >
          Save All Rules
        </Button>
      </div>
    </form>
  );
};
