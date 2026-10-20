'use client';
import Tooltip from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
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
        <h4 className="text-body font-medium text-text-primary">Key performance indicators (KPI)</h4>
        {!readOnly && (
          <Button type="button" onClick={add} variant="secondary" size="sm">
            <Plus size={14} /> Add KPI
          </Button>
        )}
      </div>
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="text-meta text-text-secondary border-b border-border-light">
                <th className="text-left py-2 font-medium">Title</th>
                <th className="text-left py-2 font-medium">Metric</th>
                <th className="text-left py-2 font-medium">Target</th>
                <th className="text-left py-2 font-medium">Unit</th>
                {!readOnly && <th className="w-8" />}
              </tr>
            </thead>
            <tbody className="space-y-1">
              {items.map((item, i) => (
                <tr key={i} className="border-b border-border-light">
                  {(['title', 'metric', 'target', 'unit'] as const).map((field) => (
                    <td key={field} className="py-1 pr-2">
                      <input
                        className="w-full border border-border rounded-xs px-2 py-1 text-meta text-text-primary focus:outline-hidden focus:border-primary"
                        placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                        value={item[field]}
                        onChange={(e) => update(i, field, e.target.value)}
                        readOnly={readOnly}
                      />
                    </td>
                  ))}
                  {!readOnly && (
                    <td className="py-1">
                      <Tooltip label="Remove KPI">
                        <Button
                          type="button"
                          onClick={() => remove(i)}
                          variant="ghost"
                          size="icon"
                          aria-label="Remove KPI"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </Tooltip>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items.length === 0 && <p className="text-meta text-text-muted">No KPIs added yet.</p>}
    </div>
  );
}
