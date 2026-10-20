/**
 * Input — reusable input component.
 *
 * Types: text, number, email, password, url, time, date
 * Features: label, placeholder, error state, required
 */
export function Input({
  type = "text",
  label = "",
  value = "",
  onChange,
  placeholder = "",
  required = false,
  error = "",
  className = "",
  ...props
}) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className={`w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border ${
          error
            ? "border-red-300 dark:border-red-700 focus:ring-red-500/40"
            : "border-neutral-200 dark:border-neutral-700 focus:ring-brand-500/40"
        } text-neutral-700 dark:text-neutral-300 focus:outline-none focus:ring-2 transition-colors`}
        {...props}
      />
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>
      )}
    </div>
  );
}
