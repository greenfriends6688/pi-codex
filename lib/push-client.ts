/**
 * Client-side Web Push subscription. Called once when the Notification
 * permission is granted; silently no-ops on unsupported browsers (e.g. iOS
 * Safari < 16.4 or non-PWA contexts) so the existing in-page notification
 * path keeps working as a fallback.
 */

import { isDesktopShell } from "./desktop-shell";

let activeSubscriptionPromise: Promise<boolean> | null = null;

// Standard base64url → Uint8Array conversion for applicationServerKey.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

export async function setupPushSubscription(locale: string): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== "granted") return false;
  // fork:desktop-shell — the packaged app notifies through the native bridge
  // (lib/browser-notifications.ts), so a web-push subscription would only add a
  // second, browser-branded notification for the same event: Chrome's icon, the
  // `127.0.0.1:<port>` origin and a "设置" button, which is exactly what users
  // reported seeing instead of the app's own notification. Skip the subscription
  // entirely there; the server prunes the endpoint when it is gone.
  if (isDesktopShell()) return false;
  if (activeSubscriptionPromise) return activeSubscriptionPromise;

  const attempt = (async () => {
    try {
      const configResponse = await fetch("/api/push/config");
      if (!configResponse.ok) return false;
      const { publicKey } = await configResponse.json() as { publicKey?: string };
      if (!publicKey) return false;

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON(), locale }),
      });
      return response.ok;
    } catch {
      // Retry on the next trigger (e.g. the next permission grant) rather
      // than caching a transient failure forever.
      activeSubscriptionPromise = null;
      return false;
    }
  })();

  activeSubscriptionPromise = attempt;
  void attempt.then((ok) => {
    if (!ok && activeSubscriptionPromise === attempt) activeSubscriptionPromise = null;
  });
  return attempt;
}
