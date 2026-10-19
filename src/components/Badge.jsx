/**
 * Badge â€” reusable badge component.
 *
 * Variants: success, warning, danger, info, neutral, brand
 * Sizes: sm, md
 */
export function Badge({
  variant = "neutral",
  size = "sm",
  children,
  className = "",
  ...props
}) {
  const variants = {
    success: "bg-green-50 dark:bg-green-950/50 text-green-600 dark:text-green-400",
    warning: "bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400",
    danger: "bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400",
    info: "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400",
    neutral: "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400",
    brand: "bg-brand-50 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400",
  };

  const sizes = {
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-xs px-2 py-1",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 font-medium uppercase tracking-wider rounded ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
