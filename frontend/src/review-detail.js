// Vista de una reseña específica (feed item o notificación Web Push).
//
// Regla del enunciado (frontend/README.md, "Índice protegido de
// restaurantes"): los valores del backend se asignan con textContent /
// document.createElement, nunca mediante innerHTML.

function clear(container) {
  container.replaceChildren();
}

function renderMessage(container, message, kind = "error") {
  clear(container);
  const p = document.createElement("p");
  p.className = kind;
  p.textContent = message;
  container.append(p);
}

function renderReview(container, review, { onBack } = {}) {
  clear(container);

  const card = document.createElement("div");
  card.className = "review-detail-card";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.textContent = "\u2190 Volver al feed";
  backButton.addEventListener("click", () => {
    if (typeof onBack === "function") {
      onBack();
    } else {
      window.location.hash = "";
    }
  });

  const title = document.createElement("h2");
  title.textContent = review.dish_name || "Plato sin nombre";

  const restaurantLine = document.createElement("p");
  const restaurantLabel = document.createElement("strong");
  restaurantLabel.textContent = "Restaurante: ";
  restaurantLine.append(
    restaurantLabel,
    document.createTextNode(review.restaurant?.name || "Sin restaurante"),
  );

  const authorLine = document.createElement("p");
  const authorLabel = document.createElement("strong");
  authorLabel.textContent = "Por: ";
  authorLine.append(
    authorLabel,
    document.createTextNode(review.author?.name || "Usuario"),
  );

  const text = document.createElement("p");
  text.textContent = review.text || "";

  card.append(backButton, title, restaurantLine, authorLine, text);

  // Contrato del backend (ver frontend/README.md): la URL de foto vive en
  // `photo.content_url`, es relativa y requiere la misma sesión.
  const photoUrl = review.photo?.content_url;
  if (photoUrl) {
    const img = document.createElement("img");
    img.src = photoUrl;
    img.alt = `Foto de ${review.dish_name || "la reseña"}`;
    img.className = "review-detail-photo";
    card.append(img);
  }

  container.append(card);
}

/**
 * Carga y muestra la vista de una reseña específica dentro de `container`.
 * Usada tanto por la navegación normal del feed como por el evento
 * `notificationclick` del service worker (vía el hash de la URL).
 *
 * @param {string} reviewId
 * @param {HTMLElement} container
 * @param {{ onBack?: () => void, onUnauthorized?: () => void }} [handlers]
 */
export async function cargarVistaResenaEspecifica(reviewId, container, handlers = {}) {
  if (!container || !reviewId) return;

  renderMessage(container, "Cargando reseña\u2026", "status");

  try {
    const response = await fetch(`/api/v1/reviews/${encodeURIComponent(reviewId)}`, {
      credentials: "include",
    });

    if (response.status === 404) {
      renderMessage(container, "Esta reseña ya no está disponible.");
      return;
    }

    if (response.status === 401) {
      renderMessage(container, "Tu sesión caducó. Inicia sesión nuevamente para ver esta reseña.");
      handlers.onUnauthorized?.();
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const review = await response.json();
    renderReview(container, review, handlers);
  } catch (err) {
    renderMessage(container, "No se pudo cargar la reseña solicitada.");
  }
}
