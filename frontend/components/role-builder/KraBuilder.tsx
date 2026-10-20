'use client';
import Tooltip from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
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
        <h4 className="text-body font-medium text-text-primary">Key result areas (KRA)</h4>
        {!readOnly && (
          <Button type="button" onClick={add} variant="secondary" size="sm">
            <Plus size={14} /> Add KRA
          </Button>
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
              <Tooltip label="Remove KRA">
                <Button
                  type="button"
                  onClick={() => remove(i)}
                  variant="ghost"
                  size="icon"
                  aria-label="Remove KRA"
                >
                  <Trash2 size={14} />
                </Button>
              </Tooltip>
            )}
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="text-meta text-text-muted">No KRAs added yet.</p>}
    </div>
  );
}
