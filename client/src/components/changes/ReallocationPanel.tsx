import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, Brain, ShieldCheck } from 'lucide-react';
import { ReallocationPlan } from '../../lib/api';
import { SizeBar, SizeBarLegend } from '../common/SizeBar';

interface Props {
  plan: ReallocationPlan;
  /** what-if previews are not confirmable */
  isWhatIf?: boolean;
  /** switch to the substitute-teacher flow for the first unavailable teacher */
  onUseSubstitute?: () => void;
}

const CAUSE_LABEL: Record<string, string> = {
  schedule_clash: 'Clash with the student\'s other classes',
  capacity: 'Other sections are full',
  no_section: 'No other teacher for this subject',
};

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'default' | 'good' | 'bad' }> = ({ label, value, tone = 'default' }) => (
  <div
    className={`p-3 rounded-xl text-center ${
      tone === 'good' ? 'bg-green-50 dark:bg-green-950/40' : tone === 'bad' ? 'bg-red-50 dark:bg-red-950/40' : 'bg-gray-50 dark:bg-gray-800'
    }`}
  >
    <span className="text-xs text-gray-500">{label}</span>
    <div
      className={`text-xl font-bold mt-1 ${
        tone === 'good' ? 'text-green-700 dark:text-green-400' : tone === 'bad' ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-white'
      }`}
    >
      {value}
    </div>
  </div>
);

export const ReallocationPanel: React.FC<Props> = ({ plan, isWhatIf, onUseSubstitute }) => {
  const [showMoves, setShowMoves] = useState(false);
  const displaced = plan.subjects.reduce((a, s) => a + s.displaced, 0);
  const placed = plan.subjects.reduce((a, s) => a + s.placed, 0);
  const unresolved = plan.unresolved.length;
  const causeCounts = plan.unresolved.reduce<Record<string, number>>((acc, u) => ({ ...acc, [u.cause]: (acc[u.cause] || 0) + 1 }), {});

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Students affected" value={displaced} />
        <Stat label="Can be moved" value={placed} tone={placed > 0 ? 'good' : 'default'} />
        <Stat label="Cannot be placed" value={unresolved} tone={unresolved > 0 ? 'bad' : 'good'} />
        <Stat label="Room / teacher clashes" value={0} tone="good" />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-green-600" />
          Hard limits enforced: teacher maximum, room capacity, student schedule clashes.
        </span>
        <span className="flex items-center gap-1.5">
          <Brain className="w-4 h-4 text-violet-600" />
          {plan.ml_used ? 'ML recommendations used as soft targets (advisory).' : 'No ML recommendations stored - using teacher preferences and history.'}
        </span>
      </div>

      {plan.warnings.length > 0 && (
        <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
          {plan.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {plan.subjects.length === 0 && (
        <p className="text-sm text-gray-500 py-4 text-center">The selected teacher(s) have no sections to redistribute.</p>
      )}

      {plan.subjects.map((subj) => (
        <div key={subj.subject_code} className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              {subj.subject_code} <span className="font-normal text-gray-500">{subj.subject_name}</span>
            </div>
            <div className="text-xs text-gray-500">
              {subj.placed}/{subj.displaced} students placed
              {subj.unresolved > 0 && <span className="text-red-600 dark:text-red-400 font-semibold"> · {subj.unresolved} unplaced</span>}
            </div>
          </div>
          <table className="w-full text-xs">
            <thead className="text-gray-500 border-b border-gray-100 dark:border-gray-800">
              <tr>
                <th className="text-left p-2.5 font-semibold">Teacher / section</th>
                <th className="text-left p-2.5 font-semibold w-24">Change</th>
                <th className="text-left p-2.5 font-semibold w-56">Class size after</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {subj.sections.map((o) => (
                <tr key={o.section_id} className={o.role === 'source' ? 'bg-red-50/40 dark:bg-red-950/10' : ''}>
                  <td className="p-2.5">
                    <div className="font-medium text-gray-900 dark:text-white">{o.staff_name || o.staff_id}</div>
                    <div className="text-[11px] text-gray-500">
                      {o.section_label || `Section ${o.section_id}`} ·{' '}
                      {o.role === 'source' ? <span className="text-red-600 dark:text-red-400">unavailable</span> : 'receiving'}
                    </div>
                  </td>
                  <td className="p-2.5 font-mono whitespace-nowrap">
                    {o.before}
                    <ArrowRight className="inline w-3 h-3 mx-1 text-gray-400" />
                    <strong>{o.after}</strong>
                    {o.after !== o.before && (
                      <span className={o.after > o.before ? 'text-green-600 ml-1' : 'text-red-600 ml-1'}>
                        ({o.after > o.before ? '+' : ''}
                        {o.after - o.before})
                      </span>
                    )}
                  </td>
                  <td className="p-2.5">
                    <SizeBar size={o.after} preferred={o.preferred} hardCap={o.hard_cap} ml={o.ml_expected} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {plan.subjects.length > 0 && <SizeBarLegend />}

      {unresolved > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {Object.entries(causeCounts).map(([cause, n]) => (
            <span key={cause} className="px-2 py-1 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900">
              {n} × {CAUSE_LABEL[cause] || cause}
            </span>
          ))}
          {onUseSubstitute && causeCounts.schedule_clash > 0 && (
            <button
              type="button"
              onClick={onUseSubstitute}
              className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
            >
              Plan a substitute teacher instead
            </button>
          )}
        </div>
      )}

      {unresolved > 0 && (
        <details className="border border-red-200 dark:border-red-900 rounded-xl p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-red-700 dark:text-red-400">
            {unresolved} student(s) cannot be placed without breaking a limit
          </summary>
          <ul className="mt-2 space-y-0.5 text-gray-600 dark:text-gray-400 max-h-40 overflow-auto">
            {plan.unresolved.slice(0, 100).map((u, i) => (
              <li key={i}>
                <span className="font-mono">{u.student_id}</span> ({u.subject_code}) - {u.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {plan.moves.length > 0 && (
        <div className="text-xs">
          <button type="button" onClick={() => setShowMoves((v) => !v)} className="text-indigo-600 dark:text-indigo-400 font-medium underline">
            {showMoves ? 'Hide' : 'Show'} the {plan.moves.length} individual student moves
          </button>
          {showMoves && (
            <div className="mt-2 max-h-48 overflow-auto border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
              {plan.moves.map((m, i) => (
                <div key={i} className="px-3 py-1.5 flex items-center gap-2 font-mono">
                  <span>{m.student_id}</span>
                  <span className="text-gray-400">{m.subject_code}</span>
                  <span className="text-gray-500">sec {m.from_section_id}</span>
                  <ArrowRight className="w-3 h-3 text-gray-400" />
                  <span className="text-green-700 dark:text-green-400">sec {m.to_section_id}</span>
                  <span className="text-gray-400">({m.to_staff_id})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isWhatIf && <p className="text-xs text-gray-500">This is a hypothetical simulation. Nothing was staged or changed.</p>}
    </div>
  );
};
