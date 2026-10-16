"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import ClockTimePicker from "./ClockTimePicker";

interface Props {
  value: string;                 // "HH:MM" 24-h, "" = empty
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  label?: string;                // dialog heading, e.g. "Deadline time"
  compact?: boolean;             // tighter vertical padding for dense inline rows
}

/**
 * Trigger field for the analog ClockTimePicker — mirrors DatePicker's trigger so
 * a date + time pair lines up. Clicking opens the centered clock dialog.
 */
export default function TimeField({
  value,
  onChange,
  disabled,
  placeholder = "Select time",
  label,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);

  const vpad = compact ? "py-1.5" : "py-2.5";
  const fsize = compact ? "text-[13px]" : "text-[15px]";
  const triggerCls = `w-full flex items-center gap-0 rounded-[8px] border bg-surface-sunken text-left ${fsize} transition-colors ${
    disabled
      ? "border-border-light cursor-not-allowed opacity-70"
      : "border-border cursor-pointer hover:bg-white hover:border-border-strong"
  } ${open ? "bg-white! border-primary! ring-1 ring-primary" : ""}`;

  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className={triggerCls}>
        <span className={`flex items-center px-2.5 ${vpad} border-r border-border-light rounded-l-[8px] text-text-muted`}>
          <Clock size={15} />
        </span>
        <span className={`flex-1 px-3 ${vpad} truncate ${value ? "text-text-primary" : "text-text-muted"}`}>
          {value || placeholder}
        </span>
      </button>

      {open && (
        <ClockTimePicker
          value={value || "09:00"}
          label={label}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
