/**
 * ImagePicker — a searchable dropdown of a hackathon's pictures.
 *
 * Why it exists: removing a picture used to mean typing its whole filename.
 * That is a slide-deck level of friction for a delete button. This is a
 * one-field list: type to filter, click or press Enter to pick, Esc to
 * close. The same control serves the "remove picture" flow on the card and
 * the pictures section inside the hackathon settings box.
 */
import { useMemo, useRef, useState } from "react";

export function ImagePicker({ items = [], onPick = () => {}, emptyText = "This hackathon has no pictures yet.", placeholder = "Type to filter pictures…" }) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(true);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => String(it.filename || "").toLowerCase().includes(q));
  }, [items, query]);

  const pick = (item) => {
    if (!item) return;
    onPick(item);
    setQuery("");
    setHighlight(0);
  };

  return (
    <div className="relative w-64" role="combobox" aria-expanded={open}>
      <input
        ref={inputRef}
        value={query}
        placeholder={placeholder}
        onChange={(e) => { setQuery(e.target.value); setHighlight(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(filtered[highlight]); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
        className="w-full h-9 px-3 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#0B1220] text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111827] shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-neutral-400">{emptyText}</p>
          ) : (
            filtered.map((it, i) => (
              <button
                key={it.id}
                type="button"
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(it)}
                className={`w-full text-left px-3 py-1.5 text-xs truncate flex items-center gap-2 ${
                  i === highlight
                    ? "bg-brand-50 dark:bg-brand-950/60 text-brand-700 dark:text-brand-300"
                    : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                }`}
              >
                <img src={`./api/attachments/${it.id}`} alt="" className="w-5 h-5 rounded object-cover border border-neutral-200 dark:border-neutral-700 shrink-0" />
                <span className="truncate">{it.filename}</span>
                <span className="ml-auto text-neutral-400 shrink-0">{Math.round((it.size || 0) / 1024)} KB</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
