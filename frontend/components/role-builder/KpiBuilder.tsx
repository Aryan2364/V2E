'use client';
import { Plus, Trash2 } from 'lucide-react';

export interface KpiItem {
  title: string;
  metric: string;
  target: string;
  unit: string;
}

interface Props {
  items: KpiItem[];
  onChange: (items: KpiItem[]) => void;
  readOnly?: boolean;
}

export default function KpiBuilder({ items, onChange, readOnly }: Props) {
  const add = () => onChange([...items, { title: '', metric: '', target: '', unit: '' }]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof KpiItem, value: string) => {
    const next = [...items];
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[#0F172A]">Key Performance Indicators (KPI)</h4>
        {!readOnly && (
          <button type="button" onClick={add} className="flex items-center gap-1 text-xs text-[#2563EB] hover:underline font-medium">
            <Plus size={14} /> Add KPI
          </button>
        )}
      </div>
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[#475569] border-b border-[#E2E8F0]">
                <th className="text-left py-2 font-medium">Title</th>
                <th className="text-left py-2 font-medium">Metric</th>
                <th className="text-left py-2 font-medium">Target</th>
                <th className="text-left py-2 font-medium">Unit</th>
                {!readOnly && <th className="w-8" />}
              </tr>
            </thead>
            <tbody className="space-y-1">
              {items.map((item, i) => (
                <tr key={i} className="border-b border-[#F1F5F9]">
                  {(['title', 'metric', 'target', 'unit'] as const).map((field) => (
                    <td key={field} className="py-1 pr-2">
                      <input
                        className="w-full border border-[#CBD5E1] rounded-xs px-2 py-1 text-xs text-[#0F172A] focus:outline-hidden focus:border-[#2563EB]"
                        placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                        value={item[field]}
                        onChange={(e) => update(i, field, e.target.value)}
                        readOnly={readOnly}
                      />
                    </td>
                  ))}
                  {!readOnly && (
                    <td className="py-1">
                      <button type="button" onClick={() => remove(i)} className="text-[#DC2626] hover:text-[#B91C1C]">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items.length === 0 && <p className="text-xs text-[#94A3B8]">No KPIs added yet.</p>}
    </div>
  );
}
