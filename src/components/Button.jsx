/**
 * Button â€” reusable button component.
 *
 * Variants: primary, secondary, ghost, danger
 * Sizes: sm, md, lg
 * States: default, hover, active, disabled, loading
 */
export function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  onClick,
  children,
  className = "",
  ...props
}) {
  const base = "inline-flex items-center justify-center gap-1.5 font-medium transition-colors rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/40";

  const variants = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-neutral-300 disabled:text-neutral-500",
    secondary: "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 active:bg-neutral-300 disabled:opacity-50",
    ghost: "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:text-neutral-900 dark:hover:text-neutral-100",
    danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-300 disabled:text-red-100",
  };

  const sizes = {
    sm: "h-7 px-2.5 text-xs",
    md: "h-9 px-3 text-sm",
    lg: "h-11 px-4 text-base",
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      onClick={onClick}
      {...props}
    >
      {loading && (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
