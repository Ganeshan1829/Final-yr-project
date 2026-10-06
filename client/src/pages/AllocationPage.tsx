import React, { useEffect, useMemo, useState } from 'react';
import { Brain, Database, MessageSquare, RefreshCw, SlidersHorizontal, Users } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/common/PageHeader.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { SizeBar, SizeBarLegend } from '../components/common/SizeBar.js';
import {
  allocationApi,
  ClassSizeReport,
  DistributionSuggestion,
  TeacherFeedbackItem,
  TeacherPreference,
  getStoredUserRole,
} from '../lib/api';

type Tab = 'distribution' | 'profiles' | 'feedback' | 'model';

const TABS: Array<{ key: Tab; label: string; icon: React.ElementType }> = [
  { key: 'distribution', label: 'Suggested distribution', icon: Users },
  { key: 'profiles', label: 'Teacher profiles', icon: SlidersHorizontal },
  { key: 'feedback', label: 'Teacher feedback', icon: MessageSquare },
  { key: 'model', label: 'ML recommendations', icon: Brain },
];

const inputCls = 'w-full px-2.5 py-1.5 bg-white border border-border rounded text-sm text-text-primary';
const labelCls = 'block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1';

const SourceBadge: React.FC<{ source: string }> = ({ source }) =>
  source === 'synthetic' ? <Badge variant="warning">synthetic</Badge> : source === 'admin' ? <Badge variant="accent">admin</Badge> : <Badge variant="success">feedback</Badge>;

export const AllocationPage: React.FC = () => {
  const role = getStoredUserRole();
  const [tab, setTab] = useState<Tab>('distribution');
  const [staff, setStaff] = useState<Array<{ staff_id: string; staff_name: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ subject_code: string; subject_name: string }>>([]);

  useEffect(() => {
    fetch('/api/clean/staff').then((r) => r.json()).then((d) => setStaff(d.rows || [])).catch(() => {});
    fetch('/api/clean/subjects').then((r) => r.json()).then((d) => setSubjects(d.rows || [])).catch(() => {});
  }, []);

  const staffName = (id: string) => staff.find((s) => s.staff_id === id)?.staff_name || id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teacher-Aware Allocation"
        description="Class sizes are decided per teacher from preferences, feedback, history and ML recommendations - then checked against hard limits. ML advises; the allocation engine decides."
      />

      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-3 pb-2.5 pt-1 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === key ? 'border-navy text-navy' : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'distribution' && <DistributionTab subjects={subjects} />}
      {tab === 'profiles' && <ProfilesTab role={role} staff={staff} staffName={staffName} />}
      {tab === 'feedback' && <FeedbackTab staff={staff} subjects={subjects} staffName={staffName} />}
      {tab === 'model' && <ModelTab />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------
const DistributionTab: React.FC<{ subjects: Array<{ subject_code: string; subject_name: string }> }> = ({ subjects }) => {
  const [subject, setSubject] = useState('');
  const [total, setTotal] = useState('');
  const [useMl, setUseMl] = useState(true);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [result, setResult] = useState<DistributionSuggestion | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (nextExcluded = excluded) => {
    if (!subject) return toast.error('Choose a subject first.');
    setLoading(true);
    try {
      setResult(await allocationApi.distribution(subject, { total: total ? Number(total) : undefined, exclude: nextExcluded, ml: useMl }));
    } catch (err: any) {
      setResult(null);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleExcluded = (id: string) => {
    const next = excluded.includes(id) ? excluded.filter((x) => x !== id) : [...excluded, id];
    setExcluded(next);
    run(next);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <Card className="lg:col-span-4 self-start">
        <CardHeader>
          <div>
            <CardTitle>Plan a subject</CardTitle>
            <CardDescription>Read-only. Nothing is saved or changed.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className={labelCls}>Subject</label>
            <select className={inputCls} value={subject} onChange={(e) => { setSubject(e.target.value); setExcluded([]); setResult(null); }}>
              <option value="">Select a subject</option>
              {subjects.map((s) => (
                <option key={s.subject_code} value={s.subject_code}>
                  {s.subject_code} - {s.subject_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Total students (optional override)</label>
            <input className={inputCls} type="number" min={1} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Uses current demand" />
          </div>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input type="checkbox" checked={useMl} onChange={(e) => setUseMl(e.target.checked)} />
            Use ML recommendation (advisory)
          </label>
          <Button className="w-full" onClick={() => run()} isLoading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Suggest distribution
          </Button>
        </CardContent>
      </Card>

      <div className="lg:col-span-8 space-y-4">
        {!result ? (
          <EmptyState
            icon={<Users className="w-5 h-5" />}
            title="No distribution yet"
            description="Pick a subject to see how its students would be shared between qualified teachers, compared with an equal split."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Students', result.total_students],
                ['Teachers used', result.teachers.length],
                ['Room capacity', result.room_capacity],
                ['Not placed', result.unallocated],
              ].map(([label, value]) => (
                <Card key={label as string}>
                  <CardContent className="p-3 text-center">
                    <div className="text-[11px] text-text-muted">{label}</div>
                    <div className={`text-xl font-bold ${label === 'Not placed' && Number(value) > 0 ? 'text-status-error' : 'text-text-primary'}`}>{value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {(result.ml_note || result.warnings.length > 0 || result.unallocated > 0) && (
              <div className="p-3 rounded border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-1">
                {result.ml_note && <div>{result.ml_note}</div>}
                {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
                {result.unallocated > 0 && <div>{result.unallocated} student(s) cannot be placed within teacher/room limits - more teachers, a larger room or an approved higher maximum is needed.</div>}
              </div>
            )}

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>
                    {result.subject_code} - {result.subject_name}
                  </CardTitle>
                  <CardDescription>
                    {result.ml_used ? 'ML recommendation used as a soft target.' : 'ML not used.'} Click a teacher to mark them unavailable and recompute.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-text-muted border-b border-border">
                    <tr>
                      <th className="text-left py-2.5 px-4 font-semibold">Teacher</th>
                      <th className="text-left py-2.5 px-3 font-semibold w-64">Suggested class size</th>
                      <th className="text-left py-2.5 px-3 font-semibold">vs equal split</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Why</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.teachers.map((t) => {
                      const biggest = Math.max(...t.batch_sizes);
                      const diff = t.students - t.equal_split_would_be;
                      return (
                        <tr key={t.staff_id}>
                          <td className="py-2.5 px-4">
                            <button onClick={() => toggleExcluded(t.staff_id)} className="text-left hover:underline" title="Mark unavailable and recompute">
                              <div className="font-medium text-text-primary">{t.staff_name || t.staff_id}</div>
                              <div className="text-[11px] text-text-muted">{t.staff_id}</div>
                            </button>
                          </td>
                          <td className="py-2.5 px-3">
                            <SizeBar size={biggest} preferred={t.preferred} hardCap={Math.min(t.max, result.room_capacity)} ml={t.ml_expected} />
                            {t.batch_sizes.length > 1 && <div className="text-[10px] text-text-muted mt-0.5">{t.batch_sizes.length} sections: {t.batch_sizes.join(' + ')} = {t.students}</div>}
                          </td>
                          <td className="py-2.5 px-3 font-mono">
                            {t.equal_split_would_be} → <strong>{t.students}</strong>{' '}
                            <span className={diff === 0 ? 'text-text-muted' : diff > 0 ? 'text-blue-600' : 'text-emerald-600'}>
                              ({diff > 0 ? '+' : ''}{diff})
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-text-muted">
                            preferred {t.preferred} <span className="opacity-70">({t.preferred_source.replace('_', ' ')})</span>, max {t.max}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-4 py-3 border-t border-border"><SizeBarLegend /></div>
              </CardContent>
            </Card>

            {excluded.length > 0 && (
              <div className="text-xs text-text-muted flex items-center gap-2 flex-wrap">
                Excluded:
                {excluded.map((id) => (
                  <button key={id} onClick={() => toggleExcluded(id)} className="px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                    {id} ✕
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Teacher profiles (preferences)
// ---------------------------------------------------------------------------
const ProfilesTab: React.FC<{ role: string; staff: Array<{ staff_id: string; staff_name: string }>; staffName: (id: string) => string }> = ({ role, staffName }) => {
  const [rows, setRows] = useState<TeacherPreference[]>([]);
  const [edits, setEdits] = useState<Record<string, { preferred?: string; max?: string; override?: string }>>({});
  const [seeding, setSeeding] = useState(false);

  const load = () => allocationApi.preferences().then((d) => setRows(d.preferences)).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const key = (r: TeacherPreference) => `${r.staff_id}|${r.subject_code}`;
  const save = async (r: TeacherPreference) => {
    const e = edits[key(r)] || {};
    try {
      await allocationApi.savePreference({
        staff_id: r.staff_id,
        subject_code: r.subject_code,
        preferred_class_size: e.preferred !== undefined ? Number(e.preferred) : (r.preferred_class_size ?? undefined),
        max_class_size: e.max !== undefined ? Number(e.max) : (r.max_class_size ?? undefined),
        ...(role === 'hod' && e.override !== undefined ? { admin_override_max: e.override === '' ? null : Number(e.override) } : {}),
      });
      toast.success(`Saved preferences for ${staffName(r.staff_id)}.`);
      setEdits((x) => { const n = { ...x }; delete n[key(r)]; return n; });
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const seed = async () => {
    setSeeding(true);
    try {
      const out = await allocationApi.seedSynthetic();
      toast.success(`Generated SYNTHETIC history: ${out.historical_allocations} past allocations, ${out.feedback} feedback rows for ${out.teachers} teachers.`);
      load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Preferred and maximum class size</CardTitle>
          <CardDescription>Preferred size is a soft target. Maximum is a hard limit; only the HOD can approve an override above it.</CardDescription>
        </div>
        {role === 'hod' && (
          <Button variant="secondary" size="sm" onClick={seed} isLoading={seeding} icon={<Database className="w-4 h-4" />}>
            Generate synthetic demo history
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState title="No teacher profiles yet" description="Teachers fall back to the rules' default class size. Add preferences through teacher feedback, or generate clearly-labelled synthetic history for a demo." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-text-muted border-b border-border">
                <tr>
                  <th className="text-left py-2.5 px-4 font-semibold">Teacher</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Subject</th>
                  <th className="text-left py-2.5 px-3 font-semibold w-24">Preferred</th>
                  <th className="text-left py-2.5 px-3 font-semibold w-24">Max</th>
                  {role === 'hod' && <th className="text-left py-2.5 px-3 font-semibold w-28">HOD override</th>}
                  <th className="text-left py-2.5 px-3 font-semibold">Source</th>
                  <th className="py-2.5 px-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const e = edits[key(r)];
                  const set = (patch: object) => setEdits((x) => ({ ...x, [key(r)]: { ...x[key(r)], ...patch } }));
                  return (
                    <tr key={key(r)}>
                      <td className="py-2 px-4"><div className="font-medium text-text-primary">{staffName(r.staff_id)}</div><div className="text-[11px] text-text-muted">{r.staff_id}</div></td>
                      <td className="py-2 px-3">{r.subject_code === '*' ? <span className="text-text-muted">all subjects</span> : r.subject_code}</td>
                      <td className="py-2 px-3"><input className={inputCls} type="number" min={1} value={e?.preferred ?? r.preferred_class_size ?? ''} onChange={(ev) => set({ preferred: ev.target.value })} /></td>
                      <td className="py-2 px-3"><input className={inputCls} type="number" min={1} value={e?.max ?? r.max_class_size ?? ''} onChange={(ev) => set({ max: ev.target.value })} /></td>
                      {role === 'hod' && (
                        <td className="py-2 px-3"><input className={inputCls} type="number" min={1} placeholder="none" value={e?.override ?? r.admin_override_max ?? ''} onChange={(ev) => set({ override: ev.target.value })} /></td>
                      )}
                      <td className="py-2 px-3"><SourceBadge source={r.source} /></td>
                      <td className="py-2 px-3 text-right">{e && <Button size="sm" onClick={() => save(r)}>Save</Button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------
const FeedbackTab: React.FC<{
  staff: Array<{ staff_id: string; staff_name: string }>;
  subjects: Array<{ subject_code: string; subject_name: string }>;
  staffName: (id: string) => string;
}> = ({ staff, subjects, staffName }) => {
  const [items, setItems] = useState<TeacherFeedbackItem[]>([]);
  const [form, setForm] = useState({ staff_id: '', subject_code: '', academic_year: '2025-26', class_size: '', overcrowded: false, interaction_quality: '', allocation_success: '', comment: '' });
  const [saving, setSaving] = useState(false);

  const load = () => allocationApi.feedback().then((d) => setItems(d.feedback)).catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await allocationApi.submitFeedback({
        staff_id: form.staff_id,
        subject_code: form.subject_code,
        academic_year: form.academic_year,
        class_size: Number(form.class_size),
        overcrowded: form.overcrowded,
        interaction_quality: form.interaction_quality ? Number(form.interaction_quality) : undefined,
        allocation_success: form.allocation_success ? Number(form.allocation_success) : undefined,
        comment: form.comment || undefined,
      });
      toast.success('Feedback saved. It will inform future allocations.');
      setForm((f) => ({ ...f, class_size: '', overcrowded: false, interaction_quality: '', allocation_success: '', comment: '' }));
      load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const rating = (key: 'interaction_quality' | 'allocation_success') => (
    <select className={inputCls} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
      <option value="">-</option>
      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <Card className="lg:col-span-5 self-start">
        <CardHeader>
          <div>
            <CardTitle>Record class feedback</CardTitle>
            <CardDescription>How a class actually went. Used as history for preferred size and the ML model.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className={labelCls}>Teacher</label>
              <select required className={inputCls} value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: e.target.value })}>
                <option value="">Select teacher</option>
                {staff.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.staff_name} ({s.staff_id})</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Subject</label>
              <select required className={inputCls} value={form.subject_code} onChange={(e) => setForm({ ...form, subject_code: e.target.value })}>
                <option value="">Select subject</option>
                {subjects.map((s) => <option key={s.subject_code} value={s.subject_code}>{s.subject_code} - {s.subject_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Academic year</label><input required className={inputCls} value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} /></div>
              <div><label className={labelCls}>Class size</label><input required type="number" min={1} className={inputCls} value={form.class_size} onChange={(e) => setForm({ ...form, class_size: e.target.value })} /></div>
              <div><label className={labelCls}>Interaction quality (1-5)</label>{rating('interaction_quality')}</div>
              <div><label className={labelCls}>Allocation success (1-5)</label>{rating('allocation_success')}</div>
            </div>
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" checked={form.overcrowded} onChange={(e) => setForm({ ...form, overcrowded: e.target.checked })} />
              The class felt overcrowded
            </label>
            <div><label className={labelCls}>Comment</label><textarea className={inputCls} rows={2} maxLength={500} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></div>
            <Button type="submit" className="w-full" isLoading={saving}>Save feedback</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-7">
        <CardHeader><CardTitle>Recent feedback</CardTitle></CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-6"><EmptyState title="No feedback recorded" description="Feedback you save here becomes input for future allocations." /></div>
          ) : (
            <div className="overflow-x-auto max-h-[480px]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-text-muted border-b border-border sticky top-0">
                  <tr><th className="text-left py-2.5 px-4 font-semibold">Teacher</th><th className="text-left py-2.5 px-3 font-semibold">Subject</th><th className="text-left py-2.5 px-3 font-semibold">Year</th><th className="text-left py-2.5 px-3 font-semibold">Size</th><th className="text-left py-2.5 px-3 font-semibold">Crowded</th><th className="text-left py-2.5 px-3 font-semibold">Source</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 px-4">{staffName(i.staff_id)}</td>
                      <td className="py-2 px-3">{i.subject_code}</td>
                      <td className="py-2 px-3">{i.academic_year}</td>
                      <td className="py-2 px-3 font-mono">{i.class_size}</td>
                      <td className="py-2 px-3">{i.overcrowded ? <Badge variant="warning">yes</Badge> : <span className="text-text-muted">no</span>}</td>
                      <td className="py-2 px-3"><SourceBadge source={i.source} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ML model
// ---------------------------------------------------------------------------
const MODEL_LABELS: Record<string, string> = {
  equal_distribution: 'Equal distribution (baseline)',
  preferred_proportional: 'Preferred-size proportional (baseline)',
  random_forest: 'Random Forest',
  xgboost: 'XGBoost',
};

const ModelTab: React.FC = () => {
  const [report, setReport] = useState<ClassSizeReport | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stored, setStored] = useState<number | null>(null);

  useEffect(() => {
    allocationApi.modelReport().then(setReport).catch(() => setOffline(true));
    allocationApi.predictions().then((d) => setStored(d.predictions.length)).catch(() => {});
  }, []);

  const worstMae = useMemo(() => Math.max(...Object.values(report?.metrics || {}).map((m) => m.mae), 1), [report]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const out = await allocationApi.refreshPredictions();
      toast.success(`Stored ${out.stored} recommendations (${out.model}). They only steer soft targets.`);
      setStored(out.stored);
    } catch (err: any) {
      toast.error(err.message || 'ML service unavailable - allocation continues with teacher preferences.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Class-size recommendations</CardTitle>
            <CardDescription>
              The backend asks the ML service for expected class sizes and stores them. The allocation engine uses them only as soft targets - teacher maximum, room capacity and workload still win.
            </CardDescription>
          </div>
          <Button onClick={refresh} isLoading={refreshing} icon={<RefreshCw className="w-4 h-4" />}>Refresh recommendations</Button>
        </CardHeader>
        <CardContent className="text-sm text-text-muted">
          {stored === null ? 'Checking stored recommendations...' : `${stored} teacher/subject recommendation(s) currently stored.`}
        </CardContent>
      </Card>

      {offline && (
        <EmptyState icon={<Brain className="w-5 h-5" />} title="ML service offline" description="Start it with start.bat --ml (or npm run dev:ml). Everything else, including allocation, keeps working from teacher preferences and history." />
      )}

      {report?.metrics && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Held-out evaluation {report.data_origin && <Badge variant="warning" className="ml-2">{report.data_origin.split(' - ')[0].toLowerCase()}</Badge>}</CardTitle>
              <CardDescription>
                {report.split} · {report.rows_train} train / {report.rows_test} test rows. Lower MAE / RMSE and higher R² are better.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-text-muted border-b border-border">
                <tr><th className="text-left py-2.5 px-4 font-semibold">Approach</th><th className="text-left py-2.5 px-3 font-semibold w-56">MAE (students)</th><th className="text-left py-2.5 px-3 font-semibold">RMSE</th><th className="text-left py-2.5 px-3 font-semibold">R²</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(report.metrics).map(([name, m]) => (
                  <tr key={name} className={name === report.best_ml_model ? 'bg-emerald-50/50' : ''}>
                    <td className="py-2.5 px-4 font-medium text-text-primary">
                      {MODEL_LABELS[name] || name} {name === report.best_ml_model && <Badge variant="success" className="ml-1">active</Badge>}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-full bg-slate-100 flex-1"><div className={`h-2 rounded-full ${name.includes('baseline') || name.endsWith('distribution') || name.endsWith('proportional') ? 'bg-slate-400' : 'bg-emerald-500'}`} style={{ width: `${(m.mae / worstMae) * 100}%` }} /></div>
                        <span className="font-mono w-10 text-right">{m.mae.toFixed(2)}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono">{m.rmse.toFixed(2)}</td>
                    <td className="py-2.5 px-3 font-mono">{m.r2.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-border text-[11px] text-text-muted space-y-1">
              <div>The training data is generated, and its generator contains the relationships the model learns - these scores show the pipeline works, not how well it will predict real demand. Retrain on real historical allocations when available.</div>
              {report.note && <div>{report.note}</div>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AllocationPage;
