/**
 * Modal — reusable modal overlay.
 *
 * Features: overlay, header, content, footer, close button, animation
 */
export function Modal({
  isOpen = false,
  onClose,
  title = "",
  size = "md",
  children,
  className = "",
}) {
  if (!isOpen) return null;

  const sizes = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className={`w-full ${sizes[size]} bg-white dark:bg-[#111827] rounded-xl shadow-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden animate-scaleIn ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between p-5 border-b border-neutral-200 dark:border-neutral-800">
            <h3 className="text-base font-semibold">{title}</h3>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
