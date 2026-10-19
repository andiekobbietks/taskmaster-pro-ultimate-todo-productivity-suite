/**
 * Banner â€” reusable alert banner.
 *
 * Variants: error, success, info, warning
 */
export function Banner({
  variant = "info",
  title = "",
  message = "",
  onDismiss,
  onRetry,
  className = "",
}) {
  const variants = {
    error: {
      bg: "bg-red-50 dark:bg-red-950/70",
      border: "border-red-300 dark:border-red-800",
      icon: "text-red-600 dark:text-red-400",
      title: "text-red-800 dark:text-red-300",
      message: "text-red-700 dark:text-red-400",
    },
    success: {
      bg: "bg-green-50 dark:bg-green-950/70",
      border: "border-green-300 dark:border-green-800",
      icon: "text-green-600 dark:text-green-400",
      title: "text-green-800 dark:text-green-300",
      message: "text-green-700 dark:text-green-400",
    },
    info: {
      bg: "bg-blue-50 dark:bg-blue-950/70",
      border: "border-blue-300 dark:border-blue-800",
      icon: "text-blue-600 dark:text-blue-400",
      title: "text-blue-800 dark:text-blue-300",
      message: "text-blue-700 dark:text-blue-400",
    },
    warning: {
      bg: "bg-amber-50 dark:bg-amber-950/70",
      border: "border-amber-300 dark:border-amber-800",
      icon: "text-amber-600 dark:text-amber-400",
      title: "text-amber-800 dark:text-amber-300",
      message: "text-amber-700 dark:text-amber-400",
    },
  };

  const v = variants[variant];

  return (
    <div
      role="alert"
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,32rem)] rounded-xl border ${v.border} ${v.bg} shadow-lg animate-scaleIn ${className}`}
    >
      <div className="flex items-start gap-3 p-4">
        <svg className={`w-5 h-5 ${v.icon} shrink-0 mt-0.5`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div className="flex-1 min-w-0">
          {title && (
            <p className={`text-sm font-semibold ${v.title}`}>{title}</p>
          )}
          <p className={`text-xs ${v.message} mt-0.5 break-words`}>{message}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onRetry && (
            <button
              onClick={onRetry}
              className="h-7 px-2.5 rounded-md text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
            >
              Retry
            </button>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              aria-label="Dismiss"
              className={`p-1 rounded ${v.icon} hover:opacity-80 transition-colors`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
