import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" } & Record<string, unknown>) {
  return (
    <As
      className={clsx("rounded-[22px] border border-line bg-surface shadow-card", className)}
      {...rest}
    >
      {children}
    </As>
  );
}

type Variant = "primary" | "secondary" | "ghost";
export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      className={clsx(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,color,box-shadow,transform,opacity] duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-10 px-4.5 text-sm",
        size === "lg" && "h-12 px-7 text-[15px]",
        variant === "primary" && "bg-accent text-accent-fg shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_6px_16px_-6px_var(--accent)] hover:bg-accent-hover",
        variant === "secondary" && "border border-line-strong bg-surface text-fg hover:bg-surface-2",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";
export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-5",
        tone === "neutral" && "bg-surface-2 text-muted",
        tone === "ok" && "bg-ok-soft text-ok",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "accent" && "bg-accent-soft text-accent",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "inline-block size-1.5 rounded-full",
        tone === "ok" && "bg-ok",
        tone === "warn" && "bg-warn",
        tone === "danger" && "bg-danger",
        tone === "neutral" && "bg-subtle",
        tone === "accent" && "bg-accent",
      )}
    />
  );
}
