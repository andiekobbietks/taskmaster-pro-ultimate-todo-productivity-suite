/**
 * CalendarWizard — put the competitions on a calendar.
 *
 * Four steps, in the order the decision actually happens:
 *
 *   1. Where?      the calendar the events go into
 *   2. Sign in     only for the methods that need it
 *   3. Which?      tick the competitions
 *   4. Check       read it back before anything is written
 *
 * The method list comes from the server (/api/calendar/methods), so the
 * screen cannot offer something the app cannot do. Methods marked
 * experimental carry the (i) badge: they are new, and they can change.
 *
 * The wizard is the shape of the paid tier: the free paths need no
 * account and no token, and they work by giving the user a URL.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, describeError } from "../lib/api.js";
import { Modal } from "./Modal.jsx";

/** The (i) badge: experimental, may change, not covered by the SLA. */
export function ExperimentalBadge({ className = "" }) {
  return (
    <span
      title="Experimental. New, and it can change or be removed."
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full border border-amber-400 text-amber-600 dark:text-amber-400 text-[10px] font-bold leading-none shrink-0 ${className}`}
    >
      i
    </span>
  );
}

const STEPS = [
  { id: 1, label: "Where" },
  { id: 2, label: "Sign in" },
  { id: 3, label: "Which" },
  { id: 4, label: "Check" },
];

export function CalendarWizard({ isOpen = false, onClose = () => {} }) {
  const [step, setStep] = useState(1);
  const [methods, setMethods] = useState([]);
  const [method, setMethod] = useState(null);
  const [hackathons, setHackathons] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [credentials, setCredentials] = useState({
    server: "",
    username: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [m, h] = await Promise.all([
        api("./api/calendar/methods"),
        api("./api/hackathons/simple"),
      ]);
      setMethods(m.methods || []);
      setHackathons(Array.isArray(h) ? h : []);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setMethod(null);
    setPicked(new Set());
    setResult(null);
    setError("");
    load();
  }, [isOpen, load]);

  const chosen = useMemo(
    () => methods.find((m) => m.id === method) || null,
    [methods, method]
  );

  const selected = useMemo(
    () => hackathons.filter((h) => picked.has(h.id)),
    [hackathons, picked]
  );

  const toggle = (id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setPicked((prev) =>
      prev.size === hackathons.length ? new Set() : new Set(hackathons.map((h) => h.id))
    );
  };

  const feedUrl = (path = "/api/calendar.ics") =>
    typeof window !== "undefined"
      ? window.location.origin + path
      : path;

  const push = async () => {
    setBusy(true);
    setError("");

    // subscribe and download do not need a server push; the calendar client
    // fetches the feed URL itself. Skip the POST and show the URL instead.
    if (!chosen?.needs_auth) {
      setResult({
        ok: true,
        noPush: true,
        method: chosen.id,
        url: feedUrl(chosen.url),
        count: selected.length,
      });
      setBusy(false);
      return;
    }

    try {
      const body = await api("./api/calendar/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          ids: Array.from(picked),
          credentials,
        }),
      });
      setResult(body);
    } catch (err) {
      // The server answers 501 for the push paths that are not wired up
      // yet. That is a real answer, not a crash: show it as one.
      setResult({ ok: false, experimental: true, error: describeError(err) });
    } finally {
      setBusy(false);
    }
  };

  const canContinue =
    (step === 1 && !!method) ||
    (step === 2 && (!chosen?.needs_auth || credentials.username)) ||
    (step === 3 && selected.length > 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Put the competitions on a calendar" size="lg">
      {/* The steps */}
      <ol className="flex items-center gap-2 mb-5">
        {STEPS.map((s) => {
          const active = s.id === step;
          const done = s.id < step;
          return (
            <li key={s.id} className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                  active
                    ? "bg-brand-600 text-white"
                    : done
                    ? "bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                    : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                }`}
              >
                {s.id}
              </span>
              <span
                className={`text-xs ${
                  active ? "text-neutral-900 dark:text-neutral-100 font-medium" : "text-neutral-500"
                }`}
              >
                {s.label}
              </span>
              {s.id < STEPS.length && <span className="w-4 h-px bg-neutral-200 dark:bg-neutral-800" />}
            </li>
          );
        })}
      </ol>

      {error && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Step 1 — where */}
      {step === 1 && (
        <div className="space-y-2">
          {methods.map((m) => (
            <button
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                method === m.id
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-950/40"
                  : "border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{m.name}</span>
                {!m.stable && <ExperimentalBadge />}
              </div>
              <p className="text-xs text-neutral-500 mt-1">{m.how}</p>
            </button>
          ))}
          {methods.length === 0 && (
            <p className="text-sm text-neutral-500">Loading the ways to subscribe…</p>
          )}
        </div>
      )}

      {/* Step 2 — sign in */}
      {step === 2 && (
        <div className="space-y-3">
          {chosen && !chosen.needs_auth && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              This one needs no account. Copy the link below and paste it into your
              calendar app.
            </p>
          )}
          {chosen?.needs_auth && (
            <>
              <p className="text-xs text-neutral-500">
                {chosen.id === "graph"
                  ? "Sign in with a Microsoft account that can write to your calendar."
                  : "The server URL and a username that can write to the calendar."}
              </p>
              {chosen.id === "caldav" && (
                <>
                  <input
                    className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                    placeholder="https://caldav.example.com"
                    value={credentials.server}
                    onChange={(e) => setCredentials({ ...credentials, server: e.target.value })}
                  />
                  <input
                    className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                    placeholder="username"
                    value={credentials.username}
                    onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                  />
                  <input
                    type="password"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                    placeholder="password"
                    value={credentials.password}
                    onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                  />
                </>
              )}
              {chosen.id === "graph" && (
                <button
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                  onClick={() => setCredentials({ ...credentials, username: "signed in" })}
                >
                  Sign in with Microsoft
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Step 3 — which */}
      {step === 3 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {selected.length} of {hackathons.length} selected
            </p>
            <button
              onClick={toggleAll}
              className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
            >
              {picked.size === hackathons.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {hackathons.map((h) => (
              <label
                key={h.id}
                className="flex items-start gap-3 p-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-900 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={picked.has(h.id)}
                  onChange={() => toggle(h.id)}
                  className="mt-0.5 accent-brand-600"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{h.title}</span>
                  <span className="block text-xs text-neutral-500">
                    {[h.start, h.prize ? `prize ${h.prize}` : "", h.eligibility]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Step 4 — check */}
      {step === 4 && (
        <div className="space-y-3">
          {result ? (
            <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800">
              <p className="text-sm font-medium">
                {result.ok ? "Done." : "Not yet."}
              </p>
              {result.would_push !== undefined && (
                <p className="text-xs text-neutral-500 mt-1">
                  {result.would_push} events ready to write to {result.method}.
                </p>
              )}
              {result.missing && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                  {result.missing}
                </p>
              )}
              {result.error && (
                <p className="text-xs text-neutral-500 mt-2">{result.error}</p>
              )}
              {result.noPush && result.url && (
                <div className="mt-2 p-2 rounded bg-neutral-50 dark:bg-neutral-900">
                  <p className="text-xs font-medium mb-1">Your feed URL</p>
                  <code className="block text-xs break-all text-neutral-600 dark:text-neutral-400">
                    {result.url}
                  </code>
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {selected.length} competitions will go to{" "}
                <strong>{chosen?.name || "your calendar"}</strong>.
              </p>
              <ul className="max-h-48 overflow-y-auto text-xs text-neutral-500 space-y-1">
                {selected.map((h) => (
                  <li key={h.id} className="truncate">
                    {h.title} — {h.start || "no date"}
                    {h.prize ? ` — ${h.prize}` : ""}
                  </li>
                ))}
              </ul>
              {(chosen?.id === "subscribe" || chosen?.id === "download") && (
                <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                  <p className="text-xs font-medium mb-1">
                    {chosen.id === "download"
                      ? "Download this calendar file"
                      : "Paste this into your calendar"}
                  </p>
                  <code className="block text-xs break-all text-neutral-600 dark:text-neutral-400">
                    {feedUrl(chosen.url)}
                  </code>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* The buttons */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800">
        <button
          onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
          className="px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          {step === 1 ? "Cancel" : "Back"}
        </button>
        {step < 4 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canContinue}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 disabled:hover:bg-brand-600"
          >
            Next
          </button>
        ) : (
          <button
            onClick={result ? onClose : push}
            disabled={busy || (selected.length === 0 && !result)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {busy
              ? "Working…"
              : result
              ? "Close"
              : chosen?.needs_auth
              ? "Put them on the calendar"
              : "Done"}
          </button>
        )}
      </div>
    </Modal>
  );
}

export default CalendarWizard;
