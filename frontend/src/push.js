export const PUSH_STATES = Object.freeze({
  UNSUPPORTED: "unsupported",
  DENIED: "denied",
  IDLE: "idle",
  SUBSCRIBING: "subscribing",
  SUBSCRIBED: "subscribed",
  UNSUBSCRIBING: "unsubscribing",
  ERROR: "error",
});

function isSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function createPushController({ api, onStateChange = () => {} }) {
  let state;

  function transition(status, details = {}) {
    state = Object.freeze({ status, ...details });
    onStateChange(state);
    return state;
  }

  async function refresh() {
    if (!isSupported()) {
      return transition(PUSH_STATES.UNSUPPORTED, {
        message: "Este navegador no soporta notificaciones push.",
      });
    }
    if (Notification.permission === "denied") {
      return transition(PUSH_STATES.DENIED, {
        message: "Bloqueaste las notificaciones para este sitio en el navegador.",
      });
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        return transition(PUSH_STATES.SUBSCRIBED, {
          message: "Las notificaciones push están activas.",
          endpoint: existing.endpoint,
        });
      }
    } catch {
      // Sin service worker listo todavía; se trata como IDLE.
    }
    return transition(PUSH_STATES.IDLE, {
      message: "Puedes activar las notificaciones push.",
    });
  }

  async function subscribe() {
    if (!isSupported()) {
      return transition(PUSH_STATES.UNSUPPORTED, {
        message: "Este navegador no soporta notificaciones push.",
      });
    }

    transition(PUSH_STATES.SUBSCRIBING, { message: "Solicitando permiso…" });

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        return transition(PUSH_STATES.DENIED, {
          message: "No se concedió el permiso de notificaciones.",
        });
      }

      const { public_key: vapidPublicKey } = await api.push.vapidKey();
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const p256dhKey = subscription.getKey("p256dh");
      const authKey = subscription.getKey("auth");

      await api.push.subscribe({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64Url(p256dhKey),
          auth: arrayBufferToBase64Url(authKey),
        },
      });

      return transition(PUSH_STATES.SUBSCRIBED, {
        message: "Notificaciones push activadas.",
        endpoint: subscription.endpoint,
      });
    } catch (error) {
      return transition(PUSH_STATES.ERROR, {
        message: `No fue posible activar las notificaciones: ${error.message}`,
      });
    }
  }

  async function unsubscribe() {
    transition(PUSH_STATES.UNSUBSCRIBING, { message: "Desactivando…" });
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const { endpoint } = subscription;
        await subscription.unsubscribe();
        await api.push.unsubscribe(endpoint);
      }
      return transition(PUSH_STATES.IDLE, {
        message: "Notificaciones push desactivadas.",
      });
    } catch (error) {
      return transition(PUSH_STATES.ERROR, {
        message: `No fue posible desactivar las notificaciones: ${error.message}`,
      });
    }
  }

  refresh();

  return Object.freeze({
    get state() {
      return state;
    },
    refresh,
    subscribe,
    unsubscribe,
  });
}