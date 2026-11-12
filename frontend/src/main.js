import "./style.css";
import { PUSH_STATES, createPushController } from "./push.js";
import { createApiClient } from "./api.js";
import { AUTH_STATES, createAuthController } from "./auth.js";
import {
  RESTAURANT_STATES,
  createRestaurantsController,
} from "./restaurants.js";
import {
  saveFeedSnapshot,
  getFeedSnapshot,
  clearOtherUsers,
  cacheFeedPhotos,
  buildOfflinePhotoUrlMap,
} from "./offline-feed.js";
import { cargarVistaResenaEspecifica } from "./review-detail.js";

// --- Referencias DOM del Sistema Base (Autenticación y Restaurantes) ---
const apiStatus = document.querySelector("#api-status");
const checkApiButton = document.querySelector("#check-api");
const authCard = document.querySelector("#auth-card");
const authStatus = document.querySelector("#auth-status");
const authPanels = {
  [AUTH_STATES.LOADING]: document.querySelector("#auth-loading"),
  [AUTH_STATES.ANONYMOUS]: document.querySelector("#auth-anonymous"),
  [AUTH_STATES.AUTHENTICATED]: document.querySelector("#auth-authenticated"),
  [AUTH_STATES.UNAVAILABLE]: document.querySelector("#auth-unavailable"),
};
const loginForm = document.querySelector("#login-form");
const loginButton = loginForm?.querySelector('button[type="submit"]');
const passwordInput = document.querySelector("#password");
const logoutButton = document.querySelector("#logout");
const retrySessionButton = document.querySelector("#retry-session");
const sessionName = document.querySelector("#session-name");
const sessionHandle = document.querySelector("#session-handle");
const sessionEmail = document.querySelector("#session-email");
const sessionExpiration = document.querySelector("#session-expiration");

const restaurantsCard = document.querySelector("#restaurants-card");
const restaurantsStatus = document.querySelector("#restaurants-status");
const restaurantsList = document.querySelector("#restaurants-list");
const retryRestaurantsButton = document.querySelector("#retry-restaurants");
const restaurantPanels = {
  [RESTAURANT_STATES.LOADING]: document.querySelector("#restaurants-loading"),
  [RESTAURANT_STATES.READY]: document.querySelector("#restaurants-ready"),
  [RESTAURANT_STATES.EMPTY]: document.querySelector("#restaurants-empty"),
  [RESTAURANT_STATES.ERROR]: document.querySelector("#restaurants-error"),
};

const pushSubscribeButton = document.querySelector("#push-subscribe");
const pushUnsubscribeButton = document.querySelector("#push-unsubscribe");
const pushStatus = document.querySelector("#push-status");

// --- Referencias DOM para Feed de Reseñas y Formulario ---
const feedCard = document.querySelector("#feed-card");
const feedStatus = document.querySelector("#feed-status");
const feedList = document.querySelector("#feed-list");
const retryFeedButton = document.querySelector("#retry-feed");
const reviewForm = document.querySelector("#review-form");

const reviewDetailCard = document.querySelector("#review-detail-card");
const reviewDetailContainer = document.querySelector("#review-detail-container");

const currentOrigin = document.querySelector("#current-origin");

const api = createApiClient();

if (currentOrigin) {
  currentOrigin.textContent = window.location.origin;
}

// Verificación segura de conexión (funciona en Navegador y Node.js para npm test)
const isOffline = () => typeof window !== "undefined" && navigator.onLine === false;

// --- Helpers Visuales ---
function showStatus(element, message, kind = "neutral") {
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
}

function formatExpiration(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Fecha de caducación no disponible";
  }
  return `${new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date)} (hora local)`;
}

// --- Renderizado de Restaurantes (Código base estricto para pruebas) ---
function createRestaurantItem(restaurant) {
  const item = document.createElement("li");
  item.className = "restaurant-item";

  const article = document.createElement("article");
  const name = document.createElement("h3");
  name.textContent = restaurant.name; // <--- Satisface estrictamente markup.test.js
  const address = document.createElement("address");
  address.textContent = restaurant.address;
  const styles = document.createElement("ul");
  styles.className = "cuisine-list";
  styles.setAttribute("aria-label", "Estilos de comida");

  for (const cuisine of restaurant.cuisine_styles || []) {
    const style = document.createElement("li");
    style.textContent = cuisine.name;
    styles.append(style);
  }

  article.append(name, address, styles);
  item.append(article);
  return item;
}

function renderRestaurants(state) {
  if (restaurantsCard) {
    restaurantsCard.dataset.state = state.status;
    restaurantsCard.setAttribute(
      "aria-busy",
      String(state.status === RESTAURANT_STATES.LOADING),
    );
  }
  for (const [name, panel] of Object.entries(restaurantPanels)) {
    if (panel) panel.hidden = name !== state.status;
  }

  showStatus(restaurantsStatus, state.message, state.kind);
  if (retryRestaurantsButton) {
    retryRestaurantsButton.disabled = state.status === RESTAURANT_STATES.LOADING;
  }
  if (restaurantsList) {
    restaurantsList.replaceChildren();
    if (state.status === RESTAURANT_STATES.READY) {
      restaurantsList.append(...state.items.map(createRestaurantItem));
    }
  }
}

// --- Renderizado de Items del Feed de Reseñas ---
// `photoMap`: Map opcional de `photo.content_url -> object URL` con blobs
// persistidos en IndexedDB, usado únicamente al renderizar en modo offline
// (ver offline-feed.js: buildOfflinePhotoUrlMap). Online, la imagen se pide
// directamente a su URL relativa (misma cookie de sesión).
function createFeedCardItem(item, { offline = false, photoMap = null } = {}) {
  const li = document.createElement("li");
  li.className = "feed-item";

  const rev = item.review || item;
  const restaurant = rev.restaurant || {};
  const author = rev.author || {};

  const article = document.createElement("article");
  article.className = "feed-card-content";
  if (rev.id) article.dataset.reviewId = rev.id;

  const header = document.createElement("header");
  const authorEl = document.createElement("strong");
  authorEl.textContent = author.name || (typeof author === "string" ? author : "Usuario");

  const connector = document.createTextNode(" en ");

  const restaurantEl = document.createElement("em");
  restaurantEl.textContent = restaurant.name || (typeof restaurant === "string" ? restaurant : "Restaurante");

  header.append(authorEl, connector, restaurantEl);

  const dishTitle = document.createElement("h3");
  dishTitle.textContent = rev.dish_name || rev.title || "Plato sin nombre";

  const bodyText = document.createElement("p");
  bodyText.textContent = rev.text || rev.description || "";

  article.append(header, dishTitle, bodyText);

  // Contrato real del backend (frontend/README.md): la foto vive en
  // `photo.content_url`, no en `photo_url`/`image_url`.
  const photoUrl = rev.photo?.content_url;
  if (photoUrl) {
    const offlineSrc = offline ? photoMap?.get(photoUrl) : null;
    if (!offline || offlineSrc) {
      const img = document.createElement("img");
      img.src = offline ? offlineSrc : photoUrl;
      img.alt = `Foto de ${rev.dish_name || "reseña"}`;
      img.className = "feed-card-image";
      article.append(img);
    }
  }

  if (rev.id) {
    const link = document.createElement("a");
    link.href = `#review/${encodeURIComponent(rev.id)}`;
    link.className = "feed-card-link";
    link.textContent = "Ver reseña completa";
    article.append(link);
  }

  li.append(article);
  return li;
}

function renderizarFeedEnDOM(items, esOffline = false, fechaActualizacion = null, photoMap = null) {
  if (!feedList) return;
  feedList.replaceChildren();

  if (esOffline) {
    const aviso = document.createElement("div");
    aviso.className = "offline-badge";
    aviso.textContent = `⚠️ Viendo contenido desactualizado (Copia local guardada el ${fechaActualizacion}).`;
    feedList.append(aviso);
  }

  if (!items || items.length === 0) {
    const vacio = document.createElement("p");
    vacio.textContent = "No hay reseñas públicas disponibles por el momento.";
    feedList.append(vacio);
    return;
  }

  feedList.append(
    ...items.map((item) => createFeedCardItem(item, { offline: esOffline, photoMap })),
  );
}

// Object URLs creados a partir de blobs de IndexedDB para mostrar fotos en
// modo offline. Se revocan antes de crear el siguiente lote para no filtrar
// memoria entre renders sucesivos del feed offline.
let currentOfflinePhotoUrls = [];

function revokeOfflinePhotoUrls() {
  for (const url of currentOfflinePhotoUrls) {
    URL.revokeObjectURL(url);
  }
  currentOfflinePhotoUrls = [];
}

// --- Carga del Feed Real (Online vs Snapshot Offline en IndexedDB) ---
async function cargarFeedReal(userId) {
  if (!feedList) return;

  if (retryFeedButton) retryFeedButton.disabled = true;
  if (feedStatus) showStatus(feedStatus, "Cargando el feed…", "neutral");

  // 1. Intento de carga Online
  if (!isOffline()) {
    try {
      const response = await fetch("/api/v1/feed", { credentials: "include" });

      if (response.status === 401) {
        auth.invalidateSession("Sesión caducada.");
        return;
      }

      if (!response.ok) throw new Error("No se pudo obtener el feed del servidor.");

      const data = await response.json();
      const items = data.items || [];

      // Guardar snapshot local y limpiar otros usuarios
      await saveFeedSnapshot(userId, items, data.next_cursor);
      await clearOtherUsers(userId);
      // Descarga best-effort de las fotos para que la copia offline del
      // feed no muestre imágenes rotas (ver offline-feed.js).
      cacheFeedPhotos(userId, items).catch(() => {});

      revokeOfflinePhotoUrls();
      renderizarFeedEnDOM(items, false);
      if (feedStatus) showStatus(feedStatus, `Feed actualizado con ${items.length} reseñas.`, "success");
      return;
    } catch (error) {
      console.warn("Fallo de red al obtener feed online. Intentando copia offline...", error);
    } finally {
      if (retryFeedButton) retryFeedButton.disabled = false;
    }
  }

  // 2. Fallback Offline desde IndexedDB
  try {
    const snapshot = await getFeedSnapshot(userId);
    if (snapshot && snapshot.items) {
      const fecha = snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString() : "desconocida";
      revokeOfflinePhotoUrls();
      const photoMap = await buildOfflinePhotoUrlMap(snapshot.items);
      currentOfflinePhotoUrls = [...photoMap.values()];
      renderizarFeedEnDOM(snapshot.items, true, fecha, photoMap);
      if (feedStatus) showStatus(feedStatus, "Modo offline: mostrando copia local.", "warning");
    } else {
      revokeOfflinePhotoUrls();
      feedList.replaceChildren();
      if (feedStatus) {
        showStatus(
          feedStatus,
          "No hay conexión a Internet ni copia local guardada para este usuario.",
          "error"
        );
      }
    }
  } catch (dbErr) {
    if (feedStatus) showStatus(feedStatus, "Error al recuperar datos offline.", "error");
  } finally {
    if (retryFeedButton) retryFeedButton.disabled = false;
  }
}

function renderPush(state) {
  if (pushStatus) showStatus(pushStatus, state.message ?? "", state.status === PUSH_STATES.ERROR ? "error" : "neutral");

  if (!pushSubscribeButton || !pushUnsubscribeButton) return;

  if (state.status === PUSH_STATES.UNSUPPORTED || state.status === PUSH_STATES.DENIED) {
    pushSubscribeButton.hidden = true;
    pushUnsubscribeButton.hidden = true;
    return;
  }

  const busy =
    state.status === PUSH_STATES.SUBSCRIBING || state.status === PUSH_STATES.UNSUBSCRIBING;
  const subscribed = state.status === PUSH_STATES.SUBSCRIBED;

  pushSubscribeButton.hidden = subscribed;
  pushUnsubscribeButton.hidden = !subscribed;
  pushSubscribeButton.disabled = busy;
  pushUnsubscribeButton.disabled = busy;
}

const push = createPushController({ api, onStateChange: renderPush });

pushSubscribeButton?.addEventListener("click", () => push.subscribe());
pushUnsubscribeButton?.addEventListener("click", () => push.unsubscribe());

// --- Renderizado del Estado de Autenticación ---
function renderAuth(state) {
  if (authCard) {
    authCard.dataset.state = state.status;
    authCard.setAttribute("aria-busy", String(state.status === AUTH_STATES.LOADING));
  }
  for (const [name, panel] of Object.entries(authPanels)) {
    if (panel) panel.hidden = name !== state.status;
  }

  showStatus(authStatus, state.message, state.kind);
  if (loginButton) loginButton.disabled = state.status === AUTH_STATES.LOADING;
  if (logoutButton) logoutButton.disabled = state.status === AUTH_STATES.LOADING;
  if (retrySessionButton) retrySessionButton.disabled = state.status === AUTH_STATES.LOADING;

  if (state.status === AUTH_STATES.AUTHENTICATED) {
    if (sessionName) sessionName.textContent = state.session.user.name;
    if (sessionHandle) sessionHandle.textContent = state.session.user.handle;
    if (sessionEmail) sessionEmail.textContent = state.session.user.email;
    if (sessionExpiration) {
      sessionExpiration.dateTime = state.session.expires_at;
      sessionExpiration.textContent = formatExpiration(state.session.expires_at);
    }

    if (restaurantsCard) restaurantsCard.hidden = false;
    if (feedCard) feedCard.hidden = false;

    restaurants.load();
    if (state.session?.user?.id) {
      cargarFeedReal(state.session.user.id);
      push.refresh();
    }
  } else {
    if (restaurantsCard) restaurantsCard.hidden = true;
    if (feedCard) feedCard.hidden = true;
    restaurants.reset();
    if (feedList) feedList.replaceChildren();
    if (pushSubscribeButton) pushSubscribeButton.hidden = true;
    if (pushUnsubscribeButton) pushUnsubscribeButton.hidden = true;
  }
}

let auth;
const restaurants = createRestaurantsController({
  api,
  onStateChange: renderRestaurants,
  onUnauthorized: () => auth.invalidateSession(),
});
auth = createAuthController({ api, onStateChange: renderAuth });

async function checkApi() {
  if (!checkApiButton) return;
  checkApiButton.disabled = true;
  showStatus(apiStatus, "Consultando /healthz…");

  try {
    const payload = await api.health();
    showStatus(apiStatus, `API disponible: ${payload.status}`, "success");
  } catch (error) {
    showStatus(apiStatus, `No fue posible conectar: ${error.message}`, "error");
  } finally {
    checkApiButton.disabled = false;
  }
}

// --- Event Listeners ---
loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  await auth.login(Object.fromEntries(formData.entries()));
  if (auth.state.status === AUTH_STATES.AUTHENTICATED) {
    if (passwordInput) passwordInput.value = "";
  } else if (auth.state.status === AUTH_STATES.ANONYMOUS) {
    passwordInput?.focus();
  }
});

logoutButton?.addEventListener("click", async () => {
  if (push.state?.status === PUSH_STATES.SUBSCRIBED) {
    await push.unsubscribe().catch(() => {});
  }
  await auth.logout();
});
retrySessionButton?.addEventListener("click", () => auth.restoreSession());
retryRestaurantsButton?.addEventListener("click", () => restaurants.load());
retryFeedButton?.addEventListener("click", () => {
  if (auth.state.status === AUTH_STATES.AUTHENTICATED) {
    cargarFeedReal(auth.state.session.user.id);
  }
});
checkApiButton?.addEventListener("click", checkApi);

// --- Formulario de Creación de Reseñas ---
if (reviewForm) {
  reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isOffline()) {
      alert("No hay conexión a Internet. No es posible crear reseñas en modo offline.");
      return;
    }

    const submitBtn = reviewForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const formData = new FormData(reviewForm);
      const response = await fetch("/api/v1/reviews", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (response.status === 401) {
        auth.invalidateSession("Sesión caducada.");
        return;
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || "Error al publicar la reseña.");
      }

      reviewForm.reset();
      alert("Reseña creada exitosamente.");
      if (auth.state.status === AUTH_STATES.AUTHENTICATED) {
        cargarFeedReal(auth.state.session.user.id);
      }
    } catch (err) {
      alert(err.message || "Error al conectar con el servidor.");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// --- Registro del Service Worker para acceso a la App Shell Offline ---
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("Service Worker registrado con éxito:", reg.scope))
      .catch((err) => console.error("Error al registrar el Service Worker:", err));
  });
}


// --- Detección de cambios de red en tiempo real ---
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    showStatus(apiStatus, "Conexión restablecida.", "success");
    checkApi();
  });

  window.addEventListener("offline", () => {
    showStatus(apiStatus, "Sin conexión a Internet (Modo offline)", "error");
  });
}// --- Control del marcador visual de red (#network-status) ---
const networkStatusEl = document.querySelector("#network-status");

function updateNetworkBadge() {
  if (!networkStatusEl) return;
  if (navigator.onLine) {
    networkStatusEl.textContent = "🟢 Online";
    networkStatusEl.classList.remove("offline");
  } else {
    networkStatusEl.textContent = "🔴 Offline";
    networkStatusEl.classList.add("offline");
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    updateNetworkBadge();
    checkApi();
  });

  window.addEventListener("offline", () => {
    updateNetworkBadge();
  });

  // Estado inicial al cargar
  updateNetworkBadge();
}

// --- Ruta hacia la vista de una reseña específica (#review/<id>) ---
// La usan tanto el enlace "Ver reseña completa" del feed como el evento
// `notificationclick` del service worker (ver public/sw.js), que navega a
// esta misma URL con hash para abrir la reseña asociada a la notificación.
function parseReviewIdFromHash() {
  const match = window.location.hash.match(/^#review\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function applyRoute() {
  const reviewId = parseReviewIdFromHash();
  if (!reviewDetailCard) return;

  if (reviewId) {
    reviewDetailCard.hidden = false;
    cargarVistaResenaEspecifica(reviewId, reviewDetailContainer, {
      onBack: () => {
        window.location.hash = "";
      },
      onUnauthorized: () => auth.invalidateSession(),
    });
  } else {
    reviewDetailCard.hidden = true;
  }
}

window.addEventListener("hashchange", applyRoute);

checkApi();
auth.restoreSession();
applyRoute();