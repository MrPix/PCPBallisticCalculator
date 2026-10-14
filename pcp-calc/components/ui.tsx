"use client";

import { useId, useState, type ReactNode } from "react";

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-line bg-panel p-4 shadow-sm shadow-black/20 ${className}`}
    >
      {(title || actions) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide text-fg">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const BUTTON_VARIANTS = {
  primary: "bg-accent text-accent-fg hover:opacity-90 border-transparent",
  default: "bg-panel-strong text-fg hover:bg-line border-line",
  ghost: "bg-transparent text-muted hover:text-fg border-line",
  danger: "bg-transparent text-bad hover:bg-bad/10 border-bad/40",
} as const;

export function Button({
  variant = "default",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
}) {
  return (
    <button
      {...props}
      className={`min-h-11 rounded-xl border px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  big?: boolean;
  disabled?: boolean;
}

/**
 * Numeric input that never fights the user mid-typing: it keeps the raw text,
 * commits only valid numbers, and shows an inline error otherwise.
 */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  min = -Infinity,
  max = Infinity,
  step = 1,
  hint,
  big = false,
  disabled = false,
}: NumberFieldProps) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  // Text buffer keyed by the numeric value it was produced from: keeps what the
  // user is typing ("12.") while still following values that change from
  // outside the field (import, unit switch, reset).
  const [buffer, setBuffer] = useState({ base: value, text: String(value) });
  let text = buffer.text;
  if (buffer.base !== value) {
    setBuffer({ base: value, text: String(value) });
    text = String(value);
  }

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setError("Enter a number");
      setBuffer({ base: value, text: raw });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setError("Enter a number");
      setBuffer({ base: value, text: raw });
      return;
    }
    if (parsed < min || parsed > max) {
      setError(`Must be between ${min} and ${max}`);
      setBuffer({ base: value, text: raw });
      return;
    }
    setError(null);
    setBuffer({ base: parsed, text: raw });
    onChange(parsed);
  };

  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted">{label}</span>
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </span>
      <input
        id={id}
        className={`nums no-spin w-full rounded-xl border bg-bg-elevated px-3 text-fg placeholder:text-muted/60 ${
          big ? "h-14 text-2xl font-semibold" : "h-11 text-base"
        } ${error ? "border-bad" : "border-line"}`}
        inputMode="decimal"
        type="number"
        step={step}
        min={min === -Infinity ? undefined : min}
        max={max === Infinity ? undefined : max}
        value={text}
        disabled={disabled}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => {
          if (error) {
            setError(null);
            setBuffer({ base: value, text: String(value) });
          }
        }}
      />
      {error ? (
        <span className="mt-1 block text-xs text-bad">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-muted">{hint}</span>
      )}
    </label>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      {label && <span className="mb-1 block text-xs font-medium tracking-wide text-muted">{label}</span>}
      <div className="inline-flex w-full rounded-xl border border-line bg-bg-elevated p-1" role="group">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`min-h-9 flex-1 rounded-lg px-3 text-sm font-medium transition-colors ${
                active ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  locked = false,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
  locked?: boolean;
  hint?: string;
}) {
  return (
    <label className={`flex min-h-11 items-center gap-3 ${locked ? "cursor-default" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="h-5 w-5 accent-[var(--accent)]"
      />
      <span>
        <span className="block text-sm text-fg">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg-elevated px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="nums mt-0.5 text-lg font-semibold text-fg">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  const tones = {
    info: "border-line bg-bg-elevated text-muted",
    warn: "border-warn/40 bg-warn/10 text-warn",
    error: "border-bad/40 bg-bad/10 text-bad",
  } as const;
  return (
    <p className={`rounded-xl border px-3 py-2 text-sm ${tones[tone]}`}>{children}</p>
  );
}
