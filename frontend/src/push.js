export const PUSH_STATES = Object.freeze({
  UNSUPPORTED: "unsupported",
  DENIED: "denied",
  IDLE: "idle",
  SUBSCRIBING: "subscribing",
  SUBSCRIBED: "subscribed",
  PENDING: "pending_registration",
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

function pushFailureMessage(action, error) {
  const actionText = action === "activar" ? "activar" : "desactivar";
  const browserErrors = {
    NotAllowedError: "El navegador bloqueó la solicitud. Revisa los permisos de notificaciones del sitio.",
    InvalidStateError: "El service worker todavía no está listo. Recarga la página e inténtalo de nuevo.",
    AbortError: "La operación de notificaciones fue cancelada.",
  };
  const detail = browserErrors[error?.name]
    // ApiError messages are translated by the shared HTTP client.
    || (error?.kind ? error.message : "Revisa la conexión y los permisos del navegador.");
  return `No fue posible ${actionText} las notificaciones: ${detail}`;
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
        return transition(PUSH_STATES.PENDING, {
          message: "Hay una suscripción en este dispositivo. Confirma su registro para esta cuenta.",
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

    transition(PUSH_STATES.SUBSCRIBING, { message: "Activando notificaciones…" });

    try {
      const permission = Notification.permission === "granted"
        ? "granted"
        : Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
      if (permission !== "granted") {
        return transition(PUSH_STATES.DENIED, {
          message: "No se concedió el permiso de notificaciones.",
        });
      }

      const { public_key: vapidPublicKey } = await api.push.vapidKey();
      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      let subscription = await registration.pushManager.getSubscription();
      const existingKey = subscription?.options?.applicationServerKey;
      if (subscription && existingKey && arrayBufferToBase64Url(existingKey) !== vapidPublicKey) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });

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
        message: pushFailureMessage("activar", error),
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
        await api.push.unsubscribe(endpoint);
        await subscription.unsubscribe();
      }
      return transition(PUSH_STATES.IDLE, {
        message: "Notificaciones push desactivadas.",
      });
    } catch (error) {
      return transition(PUSH_STATES.ERROR, {
        message: pushFailureMessage("desactivar", error),
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
