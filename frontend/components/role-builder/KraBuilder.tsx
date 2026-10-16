'use client';
import { Plus, Trash2 } from 'lucide-react';

export interface KraItem {
  title: string;
  description: string;
}

interface Props {
  items: KraItem[];
  onChange: (items: KraItem[]) => void;
  readOnly?: boolean;
}

export default function KraBuilder({ items, onChange, readOnly }: Props) {
  const add = () => onChange([...items, { title: '', description: '' }]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof KraItem, value: string) => {
    const next = [...items];
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-body font-medium text-text-primary">Key Result Areas (KRA)</h4>
        {!readOnly && (
          <button type="button" onClick={add} className="flex items-center gap-1 text-meta text-primary-text hover:underline font-medium">
            <Plus size={14} /> Add KRA
          </button>
        )}
      </div>
      {items.map((item, i) => (
        <div key={i} className="bg-surface-sunken border border-border-light rounded-lg p-3 space-y-2">
          <div className="flex items-start gap-2">
            <span className="text-meta font-medium text-primary-text mt-2 w-5 shrink-0">{i + 1}.</span>
            <div className="flex-1 space-y-2">
              <input
                className="w-full border border-border rounded-lg px-3 py-2 text-body text-text-primary focus:outline-hidden focus:border-2 focus:border-primary"
                placeholder="KRA Title"
                value={item.title}
                onChange={(e) => update(i, 'title', e.target.value)}
                readOnly={readOnly}
              />
              <textarea
                className="w-full border border-border rounded-lg px-3 py-2 text-body text-text-primary focus:outline-hidden focus:border-2 focus:border-primary resize-none"
                placeholder="Description"
                rows={2}
                value={item.description}
                onChange={(e) => update(i, 'description', e.target.value)}
                readOnly={readOnly}
              />
            </div>
            {!readOnly && (
              <button type="button" onClick={() => remove(i)} className="text-danger hover:text-danger mt-2">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="text-meta text-text-muted">No KRAs added yet.</p>}
    </div>
  );
}
