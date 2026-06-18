import type { ButtonHTMLAttributes, ReactNode } from "react";

// Small button primitive shared by the storage settings, the sync indicator,
// and the conflict / unlock surfaces. Ported from checklist's `Button`, pared
// to the three variants notes uses and styled through the CSS-variable token
// vocabulary so it follows the active theme.

type Variant = "primary" | "secondary" | "danger";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

const VARIANTS: Record<Variant, string> = {
  primary: "border-accent bg-accent/15 text-accent hover:bg-accent/25",
  secondary: "border-line bg-surface-2 text-fg hover:bg-surface-3",
  danger: "border-danger/50 bg-danger/10 text-danger hover:bg-danger/20",
};

export function Button({
  variant = "secondary",
  type = "button",
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`cursor-pointer rounded-[var(--radius)] border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        VARIANTS[variant]
      } ${className ?? ""}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
