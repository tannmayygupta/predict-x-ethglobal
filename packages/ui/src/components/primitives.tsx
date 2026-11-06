/** Small building blocks from UI_REFERENCE section 4. Styling is Tailwind classes backed by the token preset. */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

type ButtonVariant = "primary" | "secondary" | "ghost" | "yes" | "no";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-amber text-amber-ink border border-amber",
  secondary: "bg-ink2 text-text border border-rule hover:bg-ink3",
  ghost: "bg-transparent text-mute border border-transparent hover:text-text",
  yes: "bg-transparent text-yes border border-yes",
  no: "bg-transparent text-no border border-no",
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  /** Shows a spinner and disables the button until the result returns (RULES 5.5). */
  loading?: boolean;
  /** Filled version of the yes/no variants, for the chosen side. */
  selected?: boolean;
}

export function Button({ variant = "primary", size = "md", loading = false, selected = false, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-button font-body font-semibold text-14 cursor-pointer transition-colors duration-fast",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        size === "md" ? "h-10 px-4" : "h-8 px-3",
        VARIANT[variant],
        selected && variant === "yes" && "bg-yes text-amber-ink",
        selected && variant === "no" && "bg-no text-amber-ink",
      )}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin motion-reduce:animate-none"
    />
  );
}

type NoticeKind = "info" | "warn" | "error";
const NOTICE: Record<NoticeKind, string> = { info: "text-mute border-rule", warn: "text-amber border-amber", error: "text-no border-no" };

export function Notice({ kind = "info", children, action }: { kind?: NoticeKind; children: ReactNode; action?: ReactNode }) {
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cx("flex items-start justify-between gap-3 rounded-input border bg-ink2 p-3 text-13", NOTICE[kind])}>
      <span>{children}</span>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("rounded-input bg-ink2", className)} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "yes" | "no" | "amber"; children: ReactNode }) {
  const tones = { neutral: "text-mute border-rule", yes: "text-yes border-yes", no: "text-no border-no", amber: "text-amber border-amber" };
  return <span className={cx("inline-flex h-[22px] items-center rounded-input border px-2 text-12 font-semibold", tones[tone])}>{children}</span>;
}
