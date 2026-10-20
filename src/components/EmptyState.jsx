/**
 * EmptyState — reusable empty state display.
 *
 * Features: icon, title, description, action button
 */
export function EmptyState({
  icon = null,
  title = "No items found",
  description = "Create a new item to get started.",
  actionLabel = "Create",
  onAction,
  className = "",
}) {
  return (
    <div className={`flex flex-col items-center justify-center py-20 px-6 text-center bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-xs ${className}`}>
      {icon && (
        <div className="w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-950/50 flex items-center justify-center text-brand-600 mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm text-neutral-500 mt-1 max-w-xs">{description}</p>
      {onAction && (
        <button
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
