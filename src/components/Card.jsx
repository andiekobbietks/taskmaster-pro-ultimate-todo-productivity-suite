/**
 * Card — reusable card container.
 *
 * Features: border, shadow, hover effect, dark mode
 */
export function Card({
  children,
  className = "",
  hover = false,
  ...props
}) {
  return (
    <div
      className={`bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-xs ${
        hover ? "hover:shadow-sm hover:border-neutral-300 dark:hover:border-neutral-700 transition-all" : ""
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
