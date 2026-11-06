import { useId, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./primitives";

export interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  error?: string | null;
  suffix?: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  maxLength?: number;
  inputMode?: "text" | "decimal" | "numeric";
  disabled?: boolean;
  autoFocus?: boolean;
}

/** Input from UI_REFERENCE section 4: 40 tall, error state under the field. */
export function TextField({ label, value, onChange, error, suffix, hint, placeholder, maxLength, inputMode, disabled, autoFocus }: TextFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-13 text-mute">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={cx(
            "h-10 min-w-0 flex-1 rounded-input border bg-ink2 px-3 text-14 text-text",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:opacity-50",
            error ? "border-no" : "border-rule",
          )}
        />
        {suffix ? <span className="shrink-0 text-13 text-mute">{suffix}</span> : null}
      </div>
      {error ? (
        <span id={`${id}-error`} className="text-12 text-no">
          {error}
        </span>
      ) : hint ? (
        <span className="text-12 text-mute">{hint}</span>
      ) : null}
    </div>
  );
}

export interface SegmentedProps<T extends string> {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange(value: T): void;
  disabled?: boolean;
}

/** 2 to 4 options; arrow keys move the selection (UI_REFERENCE section 6). */
export function Segmented<T extends string>({ label, options, value, onChange, disabled }: SegmentedProps<T>) {
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const next = options[(index + step + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={move} className="flex rounded-button border border-rule bg-ink2 p-0.5">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-8 flex-1 cursor-pointer rounded-input px-2 text-13 font-semibold transition-colors duration-fast",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-50",
              selected ? "bg-ink3 text-amber" : "bg-transparent text-mute",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface TabsProps<T extends string> {
  tabs: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange(value: T): void;
}

/** Active tab has a 2px amber underline. */
export function Tabs<T extends string>({ tabs, value, onChange }: TabsProps<T>) {
  return (
    <div role="tablist" className="flex gap-4 border-b border-rule px-4">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cx(
            "-mb-px h-10 cursor-pointer border-b-2 bg-transparent text-14 font-semibold",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber",
            t.value === value ? "border-amber text-text" : "border-transparent text-mute",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
