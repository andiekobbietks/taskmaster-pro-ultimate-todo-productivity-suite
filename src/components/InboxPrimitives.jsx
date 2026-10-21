/**
 * Inbox primitives for TaskMaster Pro.
 *
 * The interaction patterns — split view, unread dot, row keyboard navigation,
 * sender avatar, skeleton placeholders — follow cloudflare/agentic-inbox
 * (Apache License 2.0, Copyright Cloudflare Inc). The visual implementation is
 * TaskMaster Pro's own design system: brand tokens from tailwind.config.cjs,
 * Inter, and the components in src/components.
 */
import { useState } from "react";
import {
  formatListDate, formatDetailDate, getSnippetText, senderInitial, senderName,
} from "../lib/email.js";

// ── Email list row ───────────────────────────────────────────────────

/**
 * One email in the inbox list.
 *
 * Follows the accessible pattern: a div with role="button" and tabIndex 0 that
 * responds to Enter and Space, so the row is reachable by keyboard. The
 * selection state drives the detail panel.
 *
 * @param {object} props
 * @param {object} props.email - The email
 * @param {boolean} props.isSelected - Whether this row is the open one
 * @param {boolean} props.panelOpen - Whether any row is open (tightens padding)
 * @param {function} props.onSelect - Called when the row is activated
 * @param {function} props.onToggleProcessed - Called by the processed toggle
 * @param {function} props.onDelete - Called by the delete button
 * @param {boolean} [props.isChecked] - Whether the row is ticked for bulk actions
 * @param {function} [props.onToggleCheck] - When given, a checkbox is shown and
 *   this is called with the email when it is ticked. The checkbox stops the
 *   click and keypress from reaching the row, so ticking never opens the panel.
 */
export function EmailListItem({
  email, isSelected, panelOpen, onSelect, onToggleProcessed, onDelete,
  isChecked, onToggleCheck,
}) {
  const snippet = getSnippetText(email.body_preview, 120);
  const linked = email.ticket_id;

  const activate = () => onSelect(email);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={handleKeyDown}
      aria-label={`Open email: ${email.subject || "(no subject)"}`}
      className={`group flex items-start gap-3 w-full text-left cursor-pointer transition-colors border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5 md:px-6 md:py-3 ${
        panelOpen ? "md:px-4 md:py-2.5" : ""
      } ${isSelected
        ? "bg-brand-50 dark:bg-brand-950/40"
        : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50"}`}
    >
      {/* Bulk-selection checkbox */}
      {onToggleCheck && (
        <div className="shrink-0 flex justify-center pt-1">
          <input
            type="checkbox"
            checked={!!isChecked}
            onChange={() => onToggleCheck(email)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={`Select email: ${email.subject || "(no subject)"}`}
            className="rounded border-neutral-300 dark:border-neutral-600 text-brand-600 focus:ring-brand-500/40 cursor-pointer"
          />
        </div>
      )}

      {/* Unread dot */}
      <div className="w-2.5 shrink-0 flex justify-center pt-1.5">
        {!email.read && (
          <div className="h-2 w-2 rounded-full bg-brand-600" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-sm ${email.read
              ? "font-medium text-neutral-600 dark:text-neutral-400"
              : "font-semibold text-neutral-900 dark:text-neutral-100"}`}
          >
            {senderName(email.sender)}
          </span>
          {email.is_platform && email.platform && (
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">
              {email.platform}
            </span>
          )}
          <span className="text-xs text-neutral-400 shrink-0 ml-auto">
            {formatListDate(email.received_at)}
          </span>
        </div>

        <div className="truncate text-sm mt-0.5">
          <span
            className={email.read
              ? "font-medium text-neutral-500 dark:text-neutral-400"
              : "font-semibold text-neutral-900 dark:text-neutral-100"}
          >
            {email.subject || "(no subject)"}
          </span>
          {snippet && (
            <span className="text-neutral-400 font-normal">
              {" "}— {snippet}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 mt-1.5 text-[11px]">
          {linked ? (
            <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-medium truncate">
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m3 3a4 4 0 010-5.656l-3-3a4 4 0 015.656 5.656l-1.5 1.5" />
              </svg>
              {linked}
            </span>
          ) : email.is_platform ? (
            <span className="text-amber-600 dark:text-amber-400">
              no match — several {email.platform} entries, not sure which
            </span>
          ) : null}
          {email.match_method === "content" && email.match_confidence > 0 && (
            <span className="text-neutral-300 dark:text-neutral-600 font-mono text-[10px]">
              {Math.round(email.match_confidence * 100)}% match
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleProcessed(email); }}
          title={email.processed ? "Mark unprocessed" : "Mark processed"}
          aria-label={email.processed ? "Mark unprocessed" : "Mark processed"}
          className={`p-1.5 rounded transition-colors ${email.processed
            ? "text-green-600 dark:text-green-400"
            : "text-neutral-300 dark:text-neutral-600 hover:text-neutral-500"}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(email); }}
          title="Delete"
          aria-label="Delete email"
          className="p-1.5 rounded text-neutral-300 dark:text-neutral-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116 19H8a2 2 0 01-1.973-1.858L5.133 7m1.106 0H4a2 2 0 01-1.851-1.878 1 1 0 01.99-1.136l2.682-4.682A1 1 0 018.327 0h7.346a1 1 0 01.657.189l2.681 4.682A1 1 0 0120.863 5.12H18.874M9 7v6m3-3v3" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────

/**
 * The detail panel for a selected email.
 *
 * The body is rendered as plain text, never as HTML, so there is no
 * sanitiser to get wrong. Attachments are listed with human-readable sizes.
 *
 * @param {object} props
 * @param {object} props.email - The selected email
 * @param {function} props.onClose - Called when the panel is dismissed
 */
export function EmailDetail({ email, onClose }) {
  const [showRaw, setShowRaw] = useState(false);

  if (!email) return null;

  const body = email.body_preview || "";

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#111827]">
      {/* Header */}
      <div className="px-4 py-4 border-b border-neutral-200 dark:border-neutral-800 md:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-950/50 text-xs font-bold text-brand-600 dark:text-brand-400">
              {senderInitial(email.sender)}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                {senderName(email.sender)}
              </div>
              <div className="text-xs text-neutral-400 truncate">{email.sender}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-neutral-400 hidden sm:block">
              {formatDetailDate(email.received_at)}
            </span>
            <button
              onClick={onClose}
              aria-label="Close email"
              className="p-1.5 rounded text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mt-3">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {email.subject || "(no subject)"}
          </h2>
          {email.ticket_id && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1 inline-flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m3 3a4 4 0 010-5.656l-3-3a4 4 0 015.656 5.656l-1.5 1.5" />
              </svg>
              Linked to a tracked hackathon
            </p>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 md:px-6">
        {body ? (
          <pre className="text-xs text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap font-sans leading-relaxed">
            {showRaw ? body : body.slice(0, 4000)}
          </pre>
        ) : (
          <p className="text-xs text-neutral-400 italic">No preview available.</p>
        )}
        {body.length > 4000 && (
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="mt-3 text-xs font-medium text-brand-600 hover:underline"
          >
            {showRaw ? "Show less" : `Show all ${body.length} characters`}
          </button>
        )}
      </div>

      {/* Attachments */}
      {email.has_attachments && email.attachment_names && email.attachment_names.length > 0 && (
        <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-800 shrink-0 md:px-6">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
            Attachments
          </p>
          <div className="flex flex-wrap gap-2">
            {email.attachment_names.map((name, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 002.828 2.828l6.586-6.586a4 4 0 00-5.656-5.656l-6.586 6.586a6 6 0 108.484 8.484" />
                </svg>
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Split view ───────────────────────────────────────────────────────

/**
 * List on the left, detail panel on the right.
 *
 * On small screens the panel takes the full width; from md up the list
 * narrows to 380px beside the panel.
 *
 * @param {object} props
 * @param {ReactNode} props.children - The list
 * @param {object} props.selected - The selected email, or null
 * @param {function} props.onClose - Called when the panel is dismissed
 */
export function InboxSplitView({ children, selected, onClose }) {
  const isPanelOpen = selected !== null;

  return (
    <div className="flex h-full">
      <div
        className={`flex flex-col min-w-0 shrink-0 ${
          isPanelOpen
            ? "hidden md:flex md:w-[380px] md:border-r md:border-neutral-200 dark:md:border-neutral-800"
            : "w-full"
        }`}
      >
        {children}
      </div>
      {isPanelOpen && (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full md:w-auto">
          <EmailDetail email={selected} onClose={onClose} />
        </div>
      )}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────

/**
 * Placeholder rows shown while the inbox loads.
 *
 * @param {number} [count=8] - How many placeholder rows
 */
export function EmailListSkeleton({ count = 8 }) {
  return (
    <div className="animate-pulse space-y-1 p-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <div className="w-2.5 h-2.5 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
              <div className="h-3 w-12 rounded bg-neutral-200 dark:bg-neutral-700" />
              <div className="h-3 flex-1 rounded bg-neutral-200 dark:bg-neutral-700" />
            </div>
            <div className="h-2.5 w-3/4 rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
        </div>
      ))}
    </div>
  );
}
