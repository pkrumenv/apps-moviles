export class ApiError extends Error {
  constructor(message, { kind, status = null, payload = null, cause = null }) {
    super(message, cause ? { cause } : undefined);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.payload = payload;
  }
}

export function errorDetail(payload, fallback) {
  const detail = payload?.detail ?? payload;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (typeof item?.msg === "string" ? item.msg : null))
      .filter(Boolean);
    if (messages.length) {
      return messages.join(". ");
    }
  }
  if (typeof detail?.message === "string" && detail.message.trim()) {
    return detail.message;
  }
  return fallback;
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
      throw new ApiError(errorDetail(payload, `HTTP ${response.status}`), {
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
          finish(reject, new ApiError(errorDetail(payload, `HTTP ${xhr.status}`), {
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
