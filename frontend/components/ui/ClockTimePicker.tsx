"use client";

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface Props {
  value:    string;               // "HH:MM" 24-h
  label?:   string;
  onChange: (v: string) => void;
  onClose:  () => void;
}

type ClockMode = "hour" | "minute";

const SIZE  = 252;
const CX    = SIZE / 2;
const CY    = SIZE / 2;
const R_OUT = 96;
const R_IN  = 62;
const R_MID = (R_OUT + R_IN) / 2;

// Brand palette — kept in sync with DatePicker (#2563EB).
const BLUE      = "var(--primary-text)";
const BLUE_DARK = "var(--primary-text)";

// Outer ring  : 12,  1,  2, …, 11
const OUTER = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
// Inner ring  : 0, 13, 14, …, 23
const INNER = [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
// Minute labels
const MIN_LBL = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function clockPos(idx: number, total: number, r: number): [number, number] {
  const a = (idx / total) * 2 * Math.PI;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}

function degFromCenter(px: number, py: number): number {
  return (((Math.atan2(px - CX, -(py - CY)) * 180) / Math.PI) + 360) % 360;
}

function distFromCenter(px: number, py: number): number {
  return Math.hypot(px - CX, py - CY);
}

export default function ClockTimePicker({ value, label, onChange, onClose }: Props) {
  const [hh, mm]   = value.split(":").map(Number);
  const [selH, setSelH] = useState(isNaN(hh) ? 9  : hh);
  const [selM, setSelM] = useState(isNaN(mm) ? 0  : mm);
  const [mode, setMode] = useState<ClockMode>("hour");
  const svgRef  = useRef<SVGSVGElement>(null);
  const isDrag  = useRef(false);

  // ── Hand geometry ──────────────────────────────────────────────────────────
  const innerHour = selH === 0 || selH >= 13;
  const handR  = mode === "hour" ? (innerHour ? R_IN : R_OUT) : R_OUT;
  const handAng = mode === "hour"
    ? ((selH === 0 ? 0 : selH > 12 ? selH - 12 : selH) / 12) * 2 * Math.PI
    : (selM / 60) * 2 * Math.PI;
  const hx = CX + handR * Math.sin(handAng);
  const hy = CY - handR * Math.cos(handAng);

  // ── Pointer helpers ────────────────────────────────────────────────────────
  function svgXY(e: React.PointerEvent | PointerEvent): [number, number] {
    const rect = svgRef.current!.getBoundingClientRect();
    return [
      (e.clientX - rect.left) * (SIZE / rect.width),
      (e.clientY - rect.top)  * (SIZE / rect.height),
    ];
  }

  function applyPoint(px: number, py: number, commit: boolean) {
    const deg  = degFromCenter(px, py);
    const dist = distFromCenter(px, py);

    if (mode === "hour") {
      const idx = Math.round(deg / 30) % 12;
      const h   = dist < R_MID ? INNER[idx] : OUTER[idx];
      setSelH(h);
      if (commit) setTimeout(() => setMode("minute"), 120);
    } else {
      setSelM(Math.round(deg / 6) % 60);
    }
  }

  function onDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrag.current = true;
    const [px, py] = svgXY(e);
    applyPoint(px, py, false);
  }
  function onMove(e: React.PointerEvent) {
    if (!isDrag.current) return;
    const [px, py] = svgXY(e);
    applyPoint(px, py, false);
  }
  function onUp(e: React.PointerEvent) {
    if (!isDrag.current) return;
    isDrag.current = false;
    const [px, py] = svgXY(e);
    applyPoint(px, py, true);
  }

  // ── Number click (tap without drag) ───────────────────────────────────────
  function tapHour(h: number) {
    setSelH(h);
    setTimeout(() => setMode("minute"), 130);
  }
  function tapMinute(m: number) {
    setSelM(m);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  function handleOK() {
    onChange(`${String(selH).padStart(2, "0")}:${String(selM).padStart(2, "0")}`);
    onClose();
  }

  const dh = String(selH).padStart(2, "0");
  const dm = String(selM).padStart(2, "0");

  // ── Minute tick marks (dots for non-labelled minutes) ─────────────────────
  const tickAngles = Array.from({ length: 60 }, (_, i) => i);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 210,
          backgroundColor: "rgba(0,0,0,0.40)",
        }}
      />

      {/* Card */}
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%,-50%)",
        zIndex: 211,
        backgroundColor: "var(--surface)",
        border: "1px solid #E2E8F0",
        borderRadius: "16px",
        padding: "24px 24px 20px",
        boxShadow: "0 24px 80px rgba(0,0,0,0.22)",
        width: SIZE + 48,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}>

        {/* Close (top-right) */}
        <button
          onClick={onClose}
          aria-label="Close"
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-control)"; e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
          style={{
            position: "absolute", top: "14px", right: "14px",
            width: "28px", height: "28px",
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: "8px", border: "none", background: "transparent",
            color: "var(--text-muted)", cursor: "pointer",
          }}
        >
          <X size={16} />
        </button>

        {/* Label */}
        <p style={{
          fontSize: "10px", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.1em", color: "var(--text-muted)", margin: "0 0 12px",
        }}>
          {label ?? "Select time"}
        </p>

        {/* HH : MM display */}
        <div style={{
          display: "flex", alignItems: "center",
          gap: "2px", marginBottom: "20px",
        }}>
          <button
            onClick={() => setMode("hour")}
            style={{
              fontSize: "52px", fontWeight: 800, lineHeight: 1,
              padding: "6px 14px", borderRadius: "14px", border: "none",
              backgroundColor: mode === "hour" ? "var(--primary-subtle)" : "var(--surface-control)",
              color: mode === "hour" ? BLUE : "var(--text-primary)",
              cursor: "pointer", minWidth: "84px", textAlign: "center",
              outline: mode === "hour" ? `2px solid ${BLUE}` : "2px solid transparent",
              transition: "all 0.15s",
            }}
          >
            {dh}
          </button>

          <span style={{
            fontSize: "52px", fontWeight: 800, color: "var(--text-muted)",
            lineHeight: 1, padding: "0 2px",
          }}>
            :
          </span>

          <button
            onClick={() => setMode("minute")}
            style={{
              fontSize: "52px", fontWeight: 800, lineHeight: 1,
              padding: "6px 14px", borderRadius: "14px", border: "none",
              backgroundColor: mode === "minute" ? "var(--primary-subtle)" : "var(--surface-control)",
              color: mode === "minute" ? BLUE : "var(--text-primary)",
              cursor: "pointer", minWidth: "84px", textAlign: "center",
              outline: mode === "minute" ? `2px solid ${BLUE}` : "2px solid transparent",
              transition: "all 0.15s",
            }}
          >
            {dm}
          </button>
        </div>

        {/* Mode hint */}
        <p style={{
          fontSize: "10px", color: "var(--text-muted)", margin: "0 0 14px",
          fontStyle: "italic",
        }}>
          {mode === "hour" ? "Tap or drag to pick hour" : "Tap or drag to pick minute"}
        </p>

        {/* Clock face */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
          <svg
            ref={svgRef}
            width={SIZE} height={SIZE}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            style={{ cursor: "pointer", touchAction: "none", display: "block" }}
          >
            {/* Background circle */}
            <circle cx={CX} cy={CY} r={CX - 1} fill="var(--surface-control)" />

            {/* Minute tick marks (background dots) */}
            {mode === "minute" && tickAngles.map((i) => {
              const a   = (i / 60) * 2 * Math.PI;
              const r   = R_OUT;
              const tx  = CX + r * Math.sin(a);
              const ty  = CY - r * Math.cos(a);
              const is5 = i % 5 === 0;
              return !is5 ? (
                <circle key={i} cx={tx} cy={ty} r={1.5} fill="var(--surface-control-pressed)" />
              ) : null;
            })}

            {/* Hand */}
            <line
              x1={CX} y1={CY} x2={hx} y2={hy}
              stroke={BLUE} strokeWidth="2" strokeLinecap="round"
            />
            {/* Center dot */}
            <circle cx={CX} cy={CY} r={4} fill={BLUE} />
            {/* Hand tip */}
            <circle cx={hx} cy={hy} r={18} fill={BLUE} />

            {/* ── Hour numbers ── */}
            {mode === "hour" && OUTER.map((h, i) => {
              const [x, y] = clockPos(i, 12, R_OUT);
              const sel    = selH === h;
              return (
                <g
                  key={`o${h}`}
                  transform={`translate(${x},${y})`}
                  onClick={() => tapHour(h)}
                  style={{ cursor: "pointer" }}
                >
                  {sel && <circle r={19} fill={BLUE} />}
                  <text
                    textAnchor="middle" dominantBaseline="central"
                    fontSize="13" fontWeight={sel ? "700" : "500"}
                    fill={sel ? "var(--surface)" : "var(--text-primary)"}
                    style={{ pointerEvents: "none" }}
                  >
                    {h}
                  </text>
                </g>
              );
            })}
            {mode === "hour" && INNER.map((h, i) => {
              const [x, y] = clockPos(i, 12, R_IN);
              const sel    = selH === h;
              return (
                <g
                  key={`n${h}`}
                  transform={`translate(${x},${y})`}
                  onClick={() => tapHour(h)}
                  style={{ cursor: "pointer" }}
                >
                  {sel && <circle r={17} fill={BLUE} />}
                  <text
                    textAnchor="middle" dominantBaseline="central"
                    fontSize="11" fontWeight={sel ? "700" : "400"}
                    fill={sel ? "var(--surface)" : "var(--text-secondary)"}
                    style={{ pointerEvents: "none" }}
                  >
                    {h === 0 ? "00" : h}
                  </text>
                </g>
              );
            })}

            {/* ── Minute numbers ── */}
            {mode === "minute" && MIN_LBL.map((m, i) => {
              const [x, y] = clockPos(i, 12, R_OUT);
              const sel    = selM === m;
              return (
                <g
                  key={`m${m}`}
                  transform={`translate(${x},${y})`}
                  onClick={() => tapMinute(m)}
                  style={{ cursor: "pointer" }}
                >
                  {sel && <circle r={19} fill={BLUE} />}
                  <text
                    textAnchor="middle" dominantBaseline="central"
                    fontSize="13" fontWeight={sel ? "700" : "500"}
                    fill={sel ? "var(--surface)" : "var(--text-primary)"}
                    style={{ pointerEvents: "none" }}
                  >
                    {String(m).padStart(2, "0")}
                  </text>
                </g>
              );
            })}

            {/* Selected minute indicator when not on a labelled position */}
            {mode === "minute" && !MIN_LBL.includes(selM) && (
              <circle cx={hx} cy={hy} r={5} fill="var(--surface)" />
            )}
          </svg>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 22px", borderRadius: "10px",
              border: "1px solid #E2E8F0", backgroundColor: "var(--surface)",
              fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleOK}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = BLUE_DARK)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = BLUE)}
            style={{
              padding: "8px 28px", borderRadius: "10px", border: "none",
              backgroundColor: BLUE,
              fontSize: "13px", fontWeight: 700, color: "var(--surface)",
              cursor: "pointer",
              boxShadow: "0 2px 10px rgba(37,99,235,0.4)",
            }}
          >
            OK
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
