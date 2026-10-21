/*
 * The service worker.
 *
 * It does two things: receive a push and show it, and open the app when
 * the notification is tapped. It deliberately does NOT intercept fetch
 * requests — the app is a single page served by the Worker, and a
 * caching service worker in front of it would only add ways to serve a
 * stale build.
 *
 * One rule from Apple's web push documentation shapes this file: Safari
 * does not support invisible push. If the worker receives a push and
 * does not show a notification right away, Safari revokes the site's
 * notification permission. So the push handler always shows something.
 */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "TaskMaster Pro", body: event.data ? event.data.text() : "" };
  }

  const options = {
    body: payload.body || "",
    icon: payload.icon || "/assets/icon-192.png",
    badge: payload.badge || "/assets/favicon-32.png",
    tag: payload.tag || "taskmaster",
    renotify: true,
    data: payload.data || {},
    requireInteraction: !!payload.requireInteraction,
  };

  // Always show it. See the note at the top of this file.
  event.waitUntil(
    self.registration
      .showNotification(payload.title || "TaskMaster Pro", options)
      .catch(() => {})
      // Tell any open tab that a push arrived. The page uses this to
      // show the notification in the app as well, and it is how the
      // end-to-end test knows a push really landed.
      .then(() =>
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
          for (const client of list) {
            client.postMessage({
              type: "taskmaster-push",
              title: payload.title || "TaskMaster Pro",
              body: payload.body || "",
              at: Date.now(),
            });
          }
        })
      )
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
