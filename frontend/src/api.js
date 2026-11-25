export class ApiError extends Error {
  constructor(message, { kind, status = null, payload = null, cause = null }) {
    super(message, cause ? { cause } : undefined);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.payload = payload;
  }
}

const SERVER_ERROR_MESSAGES = new Map([
  ["invalid credentials", "El correo o la contraseña no son válidos."],
  ["authentication service unavailable", "El servicio de autenticación no está disponible. Inténtalo más tarde."],
  ["email already registered", "Este correo electrónico ya está registrado."],
  ["handle already taken", "Este nombre de usuario ya está en uso."],
  ["resource not found", "No encontramos el contenido solicitado."],
  ["user not found", "No encontramos esa cuenta."],
  ["restaurant not found", "No encontramos ese restaurante."],
  ["restaurant service unavailable", "El servicio de restaurantes no está disponible. Inténtalo más tarde."],
  ["evaluation service unavailable", "El servicio de evaluaciones no está disponible. Inténtalo más tarde."],
  ["photo service unavailable", "El servicio de fotos no está disponible. Inténtalo más tarde."],
  ["comment service unavailable", "El servicio de comentarios no está disponible. Inténtalo más tarde."],
  ["visit service unavailable", "El servicio de visitas no está disponible. Inténtalo más tarde."],
  ["review service unavailable", "El servicio de reseñas no está disponible. Inténtalo más tarde."],
  ["feed service unavailable", "El feed no está disponible. Inténtalo más tarde."],
  ["user service unavailable", "El servicio de usuarios no está disponible. Inténtalo más tarde."],
  ["push notifications are not configured on this deployment", "Las notificaciones push no están configuradas en este despliegue."],
  ["push subscription service unavailable", "El servicio de notificaciones no está disponible. Inténtalo más tarde."],
  ["media service unavailable", "El servicio de archivos multimedia no está disponible. Inténtalo más tarde."],
  ["invalid cursor", "No se pudo continuar la lista. Actualiza la página e inténtalo de nuevo."],
  ["untrusted request origin", "La solicitud no proviene de un sitio autorizado. Recarga la aplicación e inténtalo de nuevo."],
  ["not authenticated", "Tu sesión no está activa. Inicia sesión para continuar."],
  ["a restaurant with the same name and address already exists", "Ya existe un restaurante con ese nombre y dirección."],
  ["you already evaluated this restaurant", "Ya evaluaste este restaurante."],
  ["this photograph already carries a review", "Esta foto ya tiene una reseña."],
  ["photo exceeds the configured upload limit", "La foto supera el tamaño máximo permitido."],
  ["photo must be a valid jpeg, png, or webp image", "El archivo debe ser una imagen JPEG, PNG o WebP válida."],
  ["occurred_at must carry a time zone", "La fecha y hora de la visita deben incluir una zona horaria."],
  ["occurred_at must not be in the future", "La fecha del check-in no puede estar en el futuro."],
  ["rating must be a whole number", "La calificación debe ser un número entero."],
  ["a review cannot be empty", "Escribe el texto de la reseña."],
  ["a review is written by whoever took the photograph", "Solo quien subió la foto puede reseñarla."],
  ["only a photograph of a dish can be reviewed", "Solo se puede reseñar una foto de un plato."],
  ["a review cannot be more visible than its photograph", "La reseña no puede ser más visible que la foto asociada."],
  ["visibility must be public or private", "Selecciona si la actividad será pública o privada."],
  ["comment text cannot be blank", "Escribe un comentario antes de publicarlo."],
  ["a private photograph has no conversation", "No se puede comentar una foto privada."],
  ["nobody follows themself", "No puedes seguirte a ti misma."],
]);

const HTTP_ERROR_MESSAGES = {
  400: "La solicitud no es válida. Revisa los datos e inténtalo de nuevo.",
  401: "Tu sesión no es válida o ha caducado. Inicia sesión de nuevo.",
  403: "No tienes permiso para realizar esta acción.",
  404: "No encontramos el contenido solicitado.",
  409: "No se pudo completar la acción porque entra en conflicto con información existente.",
  413: "El archivo supera el tamaño máximo permitido.",
  415: "El tipo de archivo no es compatible.",
  422: "Revisa los datos ingresados e inténtalo de nuevo.",
  429: "Se hicieron demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
};

function localizedFallback(fallback, status) {
  if (typeof status === "number") {
    if (HTTP_ERROR_MESSAGES[status]) return HTTP_ERROR_MESSAGES[status];
    if (status >= 500) return "El servidor no pudo completar la solicitud. Inténtalo más tarde.";
  }
  return fallback || "No se pudo completar la solicitud. Inténtalo de nuevo.";
}

function translateServerMessage(message, fallback) {
  if (typeof message !== "string" || !message.trim()) return null;
  const trimmed = message.trim();
  const translated = SERVER_ERROR_MESSAGES.get(trimmed.toLowerCase());
  if (translated) return translated;

  const searchLength = trimmed.match(/^Search term must be at least (\d+) characters long$/i);
  if (searchLength) return `La búsqueda debe tener al menos ${searchLength[1]} caracteres.`;
  if (/^Unknown cuisine styles:/i.test(trimmed)) {
    return "Uno o más estilos de comida ya no están disponibles. Actualiza la lista e inténtalo de nuevo.";
  }

  // Preserve backend messages already written in Spanish; hide unknown English
  // details behind a localized, status-aware message.
  if (/[áéíóúñ¿¡]/i.test(trimmed) || /^(no |la |el |tu |este |esta |hay |ya |debes |revisa |selecciona )/i.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

export function errorDetail(payload, fallback, status = null) {
  // Keep the two-argument helper behavior for callers that already own the
  // wording; HTTP requests below always pass a status and use Spanish copy.
  if (status === null) {
    const detail = payload?.detail ?? payload;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const messages = detail.map((item) => (typeof item?.msg === "string" ? item.msg : null)).filter(Boolean);
      if (messages.length) return messages.join(". ");
    }
    if (typeof detail?.message === "string" && detail.message.trim()) return detail.message;
    return fallback;
  }

  const localizedDefault = localizedFallback(fallback, status);
  const detail = payload?.detail ?? payload;
  if (typeof detail === "string" && detail.trim()) {
    return translateServerMessage(detail, localizedDefault);
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => translateServerMessage(item?.msg, null))
      .filter(Boolean);
    if (messages.length === detail.length && messages.length) {
      return messages.join(". ");
    }
    return localizedDefault;
  }
  if (typeof detail?.message === "string" && detail.message.trim()) {
    return translateServerMessage(detail.message, localizedDefault);
  }
  return localizedDefault;
}

async function responsePayload(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createApiClient(
  fetchImplementation = globalThis.fetch,
  { onUnauthorized = () => {} } = {},
) {
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("A Fetch API implementation is required");
  }

  async function request(path, options = {}) {
    const controller = options.signal ? null : new AbortController();
    const signal = options.signal ?? controller.signal;

    let response;
    try {
      response = await fetchImplementation(path, {
        ...options,
        credentials: "include",
        signal,
        headers: {
          Accept: "application/json",
          ...options.headers,
        },
      });
    } catch (cause) {
      if (signal.aborted || cause?.name === "AbortError") {
        throw cause;
      }
      throw new ApiError("No fue posible conectar con el backend.", {
        kind: "network",
        cause,
      });
    }

    if (response.status === 401) {
      try {
        onUnauthorized(response);
      } catch {
        // A UI callback must not replace the HTTP error from the server.
      }
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new ApiError(errorDetail(payload, null, response.status), {
        kind: "http",
        status: response.status,
        payload,
      });
    }
    return payload;
  }

  function uploadWithProgress(path, formData, { signal, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const abort = () => xhr.abort();

      if (signal?.aborted) {
        finish(reject, new DOMException("La carga fue cancelada.", "AbortError"));
        return;
      }

      xhr.open("POST", path);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Accept", "application/json");
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress?.({ loaded: event.loaded, total: event.total, percent: Math.round((event.loaded / event.total) * 100) });
        }
      });
      xhr.addEventListener("load", () => {
        let payload = null;
        if (xhr.getResponseHeader("content-type")?.includes("application/json")) {
          try { payload = JSON.parse(xhr.responseText); } catch { payload = null; }
        }
        if (xhr.status === 401) {
          try { onUnauthorized({ status: 401, payload }); } catch { /* Keep the HTTP error. */ }
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          finish(reject, new ApiError(errorDetail(payload, null, xhr.status), {
            kind: "http", status: xhr.status, payload,
          }));
          return;
        }
        finish(resolve, payload);
      });
      xhr.addEventListener("error", () => finish(reject, new ApiError("No fue posible conectar con el backend.", { kind: "network" })));
      xhr.addEventListener("abort", () => finish(reject, new DOMException("La carga fue cancelada.", "AbortError")));
      signal?.addEventListener("abort", abort, { once: true });
      xhr.send(formData);
    });
  }

  return Object.freeze({
    health: ({ signal } = {}) => request("/healthz", { signal }),
    session: ({ signal } = {}) => request("/api/v1/auth/session", { signal }),
    countries: ({ signal } = {}) => request("/api/v1/countries", { signal }),
    register: (payload, { signal } = {}) => request("/api/v1/auth/register", {
      method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }),
    // La colección responde { items, next_cursor } y se recorre por cursor
    // opaco: `offset` repite y salta filas mientras otras personas crean
    // restaurantes. `q` la acota a un término del nombre.
    restaurants: ({ limit = 20, cursor, q, signal } = {}) => {
      const parameters = new URLSearchParams({ limit: String(limit) });
      if (q) {
        parameters.set("q", q);
      }
      if (cursor) {
        parameters.set("cursor", cursor);
      }
      return request(`/api/v1/restaurants?${parameters}`, { signal });
    },
    restaurant: (id, { signal } = {}) => request(`/api/v1/restaurants/${encodeURIComponent(id)}`, { signal }),
    createRestaurant: (payload, { signal } = {}) => request("/api/v1/restaurants", {
      method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }),
    cuisineStyles: ({ signal } = {}) => request("/api/v1/cuisine-styles", { signal }),
    restaurantGallery: (id, { limit = 20, cursor, kind, signal } = {}) => {
      const parameters = new URLSearchParams({ limit: String(limit) });
      if (cursor) parameters.set("cursor", cursor);
      if (kind) parameters.set("kind", kind);
      return request(`/api/v1/restaurants/${encodeURIComponent(id)}/photos?${parameters}`, { signal });
    },
    restaurantEvaluations: (id, { limit = 20, cursor, signal } = {}) => {
      const parameters = new URLSearchParams({ limit: String(limit) });
      if (cursor) parameters.set("cursor", cursor);
      return request(`/api/v1/restaurants/${encodeURIComponent(id)}/evaluations?${parameters}`, { signal });
    },
    nearby: ({ latitude, longitude, radius, cuisineStyles = [], signal }) => {
      const parameters = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), radius: String(radius) });
      cuisineStyles.forEach((slug) => parameters.append("cuisine_style", slug));
      return request(`/api/v1/restaurants/nearby?${parameters}`, { signal });
    },
    mapRestaurants: ({ south, west, north, east, signal }) => {
      const parameters = new URLSearchParams({ south: String(south), west: String(west), north: String(north), east: String(east) });
      return request(`/api/v1/restaurants/map?${parameters}`, { signal });
    },
    followRestaurant: (id, { signal } = {}) => request(`/api/v1/restaurants/${encodeURIComponent(id)}/follow`, { method: "PUT", signal }),
    unfollowRestaurant: (id, { signal } = {}) => request(`/api/v1/restaurants/${encodeURIComponent(id)}/follow`, { method: "DELETE", signal }),
    login: (credentials, { signal } = {}) =>
      request("/api/v1/auth/login", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      }),
    logout: ({ signal } = {}) => request("/api/v1/auth/logout", { method: "POST", signal }),
    feed: ({ limit = 20, cursor, signal } = {}) => {
      const parameters = new URLSearchParams({ limit: String(limit) });
      if (cursor) parameters.set("cursor", cursor);
      return request(`/api/v1/feed?${parameters}`, { signal });
    },
    review: (reviewId, { signal } = {}) =>
      request(`/api/v1/reviews/${encodeURIComponent(reviewId)}`, { signal }),
    visit: (visitId, { signal } = {}) =>
      request(`/api/v1/visits/${encodeURIComponent(visitId)}`, { signal }),
    createVisit: (payload, { signal } = {}) => request("/api/v1/visits", {
      method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }),
    evaluation: (evaluationId, { signal } = {}) =>
      request(`/api/v1/evaluations/${encodeURIComponent(evaluationId)}`, { signal }),
    photo: (photoId, { signal } = {}) =>
      request(`/api/v1/photos/${encodeURIComponent(photoId)}`, { signal }),
    uploadPhoto: (formData, options = {}) => uploadWithProgress("/api/v1/photos", formData, options),
    createReview: (payload, { signal } = {}) => request("/api/v1/reviews", {
      method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }),
    createEvaluation: (payload, { signal } = {}) => request("/api/v1/evaluations", {
      method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }),
    evaluationCriteria: ({ signal } = {}) => request("/api/v1/rating-criteria", { signal }),
    users: ({ q, limit = 20, cursor, signal }) => {
      const parameters = new URLSearchParams({ q, limit: String(limit) });
      if (cursor) parameters.set("cursor", cursor);
      return request(`/api/v1/users?${parameters}`, { signal });
    },
    profile: (handle, { signal } = {}) => request(`/api/v1/users/${encodeURIComponent(handle)}`, { signal }),
    userActivity: (handle, { limit = 20, cursor, signal } = {}) => {
      const parameters = new URLSearchParams({ limit: String(limit) });
      if (cursor) parameters.set("cursor", cursor);
      return request(`/api/v1/users/${encodeURIComponent(handle)}/activity?${parameters}`, { signal });
    },
    followUser: (handle, { signal } = {}) => request(`/api/v1/users/${encodeURIComponent(handle)}/follow`, { method: "PUT", signal }),
    unfollowUser: (handle, { signal } = {}) => request(`/api/v1/users/${encodeURIComponent(handle)}/follow`, { method: "DELETE", signal }),
    comments: (photoId, { limit = 20, cursor, signal } = {}) => {
      const parameters = new URLSearchParams({ limit: String(limit) });
      if (cursor) parameters.set("cursor", cursor);
      return request(`/api/v1/photos/${encodeURIComponent(photoId)}/comments?${parameters}`, { signal });
    },
    commentReplies: (commentId, { limit = 20, cursor, signal } = {}) => {
      const parameters = new URLSearchParams({ limit: String(limit) });
      if (cursor) parameters.set("cursor", cursor);
      return request(`/api/v1/comments/${encodeURIComponent(commentId)}/replies?${parameters}`, { signal });
    },
    createComment: (photoId, payload, { signal } = {}) => request(`/api/v1/photos/${encodeURIComponent(photoId)}/comments`, {
      method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }),
    push: {
      vapidKey: ({ signal } = {}) => request("/api/v1/push/vapid-key", { signal }),
      subscribe: (subscription, { signal } = {}) =>
        request("/api/v1/push/subscriptions", {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription),
        }),
      unsubscribe: (endpoint, { signal } = {}) =>
        request(`/api/v1/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`, {
          method: "DELETE",
          signal,
        }),
    },
  });
}
