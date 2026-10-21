/**
 * Push notifications, on the Settings screen.
 *
 * The browser part is standard: a service worker, a permission prompt, a
 * PushManager subscription, and the subscription posted to the app. The
 * app then sends the notification from the Worker.
 *
 * On iOS this only works from a Home Screen web app: Safari in a tab
 * has no push manager. The card says so rather than failing silently.
 *
 * Marked experimental until the daily digest has a time zone to send
 * at, and until the reminder content is settled.
 */
import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "../lib/api.js";
import { ExperimentalBadge } from "./CalendarWizard.jsx";

/** Register the service worker. Safe to call more than once. */
export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  return navigator.serviceWorker.register("/sw.js").catch(() => null);
}

export function PushSettings() {
  const [status, setStatus] = useState(null);
  const [state, setState] = useState("idle"); // idle | working | done | error
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setStatus(await api("./api/push/status"));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    registerServiceWorker();
    load();
  }, [load]);

  const supported = (() => {
    if (typeof window === "undefined") return false;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return { ok: false, why: "This browser has no push support." };
    }
    // iOS only has a push manager in a Home Screen web app.
    const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true;
    if (iOS && !standalone) {
      return {
        ok: false,
        why: "On iPhone, add TaskMaster to the Home Screen first — Safari in a tab cannot receive push.",
      };
    }
    return { ok: true, why: "" };
  })();

  const enable = async () => {
    setState("working");
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("error");
        setMessage("The browser did not grant permission.");
        return;
      }
      const key = await api("./api/push/key");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(
          atob(key.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
          (c) => c.charCodeAt(0)
        ),
      });
      const json = subscription.toJSON();
      await api("./api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      setState("done");
      setMessage("Push is on for this device.");
      load();
    } catch (err) {
      setState("error");
      setMessage(describeError(err));
    }
  };

  const sendTest = async () => {
    setState("working");
    setMessage("");
    try {
      const result = await api("./api/push/test", { method: "POST" });
      setState("done");
      setMessage(
        `Sent to ${result.sent} device(s). The push service answered ${
          (result.results || []).map((r) => r.status).join(", ") || "nothing"
        }.`
      );
    } catch (err) {
      setState("error");
      setMessage(describeError(err));
    }
  };

  const turnOff = async () => {
    setState("working");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api("./api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState("done");
      setMessage("Push is off for this device.");
      load();
    } catch (err) {
      setState("error");
      setMessage(describeError(err));
    }
  };

  return (
    <div className="p-4 bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold">Push notifications</h3>
        <ExperimentalBadge />
      </div>
      <p className="text-xs text-neutral-500 mb-3">
        A deadline on the competition, a morning summary, a conflict you
        cannot take. The browser asks first, and nothing is sent until you
        say yes.
      </p>

      {!supported.ok ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">{supported.why}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={enable}
              disabled={state === "working"}
              className="h-8 px-3 rounded-md text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {state === "working" ? "Working..." : "Turn push on"}
            </button>
            <button
              type="button"
              onClick={sendTest}
              disabled={state === "working" || !status?.count}
              className="h-8 px-3 rounded-md text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-50 transition-colors"
            >
              Send a test
            </button>
            {status?.count > 0 && (
              <button
                type="button"
                onClick={turnOff}
                disabled={state === "working"}
                className="h-8 px-3 rounded-md text-xs font-medium text-neutral-500 hover:text-red-600 transition-colors"
              >
                Turn off on this device
              </button>
            )}
          </div>

          <p className="text-xs text-neutral-400 mt-2">
            {status?.count
              ? `${status.count} device(s) subscribed.`
              : "No devices subscribed yet."}
            {status && !status.keys_configured && (
              <span className="text-amber-600 dark:text-amber-400">
                {" "}No push keys are set on the server yet.
              </span>
            )}
          </p>
        </>
      )}

      {message && (
        <p
          className={`text-xs mt-2 ${
            state === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-neutral-600 dark:text-neutral-300"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}

export default PushSettings;
