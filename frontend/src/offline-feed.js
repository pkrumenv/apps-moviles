// Persistencia offline del feed mediante IndexedDB.
//
// Responsabilidad de este módulo (según docs/entrega2.md, sección
// "Persistencia y operación offline"):
//   - Cache Storage (sw.js) guarda el app shell (HTML/CSS/JS/iconos).
//   - IndexedDB (este módulo) guarda el último feed estructurado obtenido
//     correctamente y los metadatos para asociarlo al usuario, además de
//     las fotografías de esas reseñas como blobs binarios.
//
// Reglas que este módulo debe cumplir:
//   1. Un solo snapshot de feed vive en IndexedDB a la vez: el del último
//      usuario cuya sesión fue verificada. Nunca se mezclan datos de dos
//      usuarios.
//   2. Un cierre de sesión exitoso, o la verificación de un usuario
//      distinto al persistido, elimina el contenido (feed + fotos) del
//      usuario anterior.
//   3. Este módulo NO valida si la sesión del servidor sigue vigente; eso
//      es responsabilidad de auth.js. Aquí solo se guarda/lee/borra.

const DB_NAME = "foodie-offline-db";
const DB_VERSION = 1;

const FEED_STORE = "feedSnapshots"; // keyPath: userId -> { userId, items, nextCursor, updatedAt }
const PHOTO_STORE = "feedPhotos"; // keyPath: photoId -> { photoId, userId, blob, contentType }

let dbPromise = null;

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(FEED_STORE)) {
        db.createObjectStore(FEED_STORE, { keyPath: "userId" });
      }

      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        const photoStore = db.createObjectStore(PHOTO_STORE, { keyPath: "photoId" });
        // Índice para poder borrar todas las fotos de un usuario sin
        // recorrer manualmente el store completo.
        photoStore.createIndex("byUser", "userId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("La base de datos offline está bloqueada por otra pestaña."));
  });

  return dbPromise;
}

// Envuelve un IDBRequest en una Promise.
function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Envuelve una IDBTransaction completa (útil cuando se hacen varias
// operaciones de escritura, como borrar N fotos, y se quiere esperar a
// que TODA la transacción se confirme, no solo la última request).
function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Transacción abortada"));
  });
}

/**
 * Guarda (o reemplaza) el snapshot del feed para un usuario.
 * @param {string} userId
 * @param {unknown[]} items - los `items` devueltos por GET /api/v1/feed
 * @param {string|null} nextCursor - cursor de paginación, o null si no hay más páginas
 */
export async function saveFeedSnapshot(userId, items, nextCursor = null) {
  if (!userId) throw new TypeError("saveFeedSnapshot requiere un userId");

  const db = await openDatabase();
  const tx = db.transaction(FEED_STORE, "readwrite");
  tx.objectStore(FEED_STORE).put({
    userId,
    items,
    nextCursor,
    updatedAt: new Date().toISOString(),
  });
  await transactionDone(tx);
}

/**
 * Recupera el snapshot persistido para un usuario específico.
 * Devuelve `null` si no existe (por ejemplo, primera vez que ese usuario
 * inicia sesión, o si el snapshot pertenece a otro usuario).
 * @param {string} userId
 * @returns {Promise<{userId: string, items: unknown[], nextCursor: string|null, updatedAt: string} | null>}
 */
export async function getFeedSnapshot(userId) {
  if (!userId) return null;
  const db = await openDatabase();
  const tx = db.transaction(FEED_STORE, "readonly");
  const result = await requestToPromise(tx.objectStore(FEED_STORE).get(userId));
  return result ?? null;
}

/**
 * Returns the latest saved feed for an offline, read-only session bootstrap.
 * The app keeps one user's snapshot at a time and clears it on logout.
 */
export async function getLatestFeedSnapshot() {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDatabase();
  const tx = db.transaction(FEED_STORE, "readonly");
  const snapshots = await requestToPromise(tx.objectStore(FEED_STORE).getAll());
  return snapshots.sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""))[0] ?? null;
}

/**
 * Guarda el blob de una foto de reseña, asociado al usuario cuyo feed la
 * referencia (para poder borrarla junto con ese usuario).
 * @param {string} photoId
 * @param {string} userId
 * @param {Blob} blob
 * @param {string} contentType
 */
export async function savePhotoBlob(photoId, userId, blob, contentType) {
  const db = await openDatabase();
  const tx = db.transaction(PHOTO_STORE, "readwrite");
  tx.objectStore(PHOTO_STORE).put({ photoId, userId, blob, contentType });
  await transactionDone(tx);
}

/**
 * Recupera el blob de una foto ya persistida. Devuelve `null` si no está
 * disponible offline (por ejemplo, si nunca se descargó).
 * @param {string} photoId
 * @returns {Promise<Blob | null>}
 */
export async function getPhotoBlob(photoId) {
  const db = await openDatabase();
  const tx = db.transaction(PHOTO_STORE, "readonly");
  const result = await requestToPromise(tx.objectStore(PHOTO_STORE).get(photoId));
  return result?.blob ?? null;
}

/**
 * Descarga la foto de una reseña y la persiste como blob en IndexedDB, para
 * que la copia offline del feed pueda mostrarla sin conexión.
 *
 * Usa la propia `content_url` de la foto como `photoId`: es relativa,
 * estable y única por reseña (ver frontend/README.md, "Contrato para crear
 * una reseña"). La foto requiere la misma cookie de sesión que el resto de
 * `/api/*`, por lo que se pide con `credentials: "include"`.
 *
 * Es best-effort: si la descarga falla (sin conexión, 401, etc.) no lanza,
 * simplemente esa foto no quedará disponible offline.
 *
 * @param {string} userId
 * @param {string} photoUrl - `photo.content_url` devuelto por el backend
 */
export async function cacheReviewPhoto(userId, photoUrl, onUnauthorized = () => {}) {
  if (!userId || !photoUrl) return;
  try {
    const response = await fetch(photoUrl, { credentials: "include" });
    if (response.status === 401) {
      onUnauthorized();
      return;
    }
    if (!response.ok) return;
    const blob = await response.blob();
    await savePhotoBlob(photoUrl, userId, blob, response.headers.get("content-type") || blob.type);
  } catch {
    // Descarga best-effort: si falla, el feed offline simplemente no
    // tendrá esta foto disponible y se omitirá al renderizar.
  }
}

function activityPhotoUrls(item) {
  const type = item?.type;
  const details = type ? item[type] : item?.review || item;
  if (!details) return [];
  const photos = type === "review" || (!type && details.photo)
    ? [details.photo]
    : details.photos || [];
  return photos.map((photo) => photo?.content_url).filter(Boolean);
}

/**
 * Descarga y persiste, en paralelo y de forma best-effort, las fotos de
 * todos los items de un feed recién obtenido online.
 * @param {string} userId
 * @param {unknown[]} items - los `items` devueltos por GET /api/v1/feed
 */
export async function cacheFeedPhotos(userId, items, onUnauthorized = () => {}) {
  if (!userId || !Array.isArray(items)) return;
  await Promise.all(
    items.map((item) => {
      return Promise.all(activityPhotoUrls(item).map((photoUrl) =>
        cacheReviewPhoto(userId, photoUrl, onUnauthorized),
      ));
    }),
  );
}

/**
 * Construye, para un conjunto de items del feed, un mapa
 * `photoId -> object URL` a partir de los blobs persistidos en IndexedDB.
 * Se usa al renderizar el feed en modo offline. Las URLs devueltas deben
 * revocarse (`URL.revokeObjectURL`) cuando ya no se necesiten, para evitar
 * fugas de memoria.
 * @param {unknown[]} items
 * @returns {Promise<Map<string, string>>}
 */
export async function buildOfflinePhotoUrlMap(items) {
  const map = new Map();
  if (!Array.isArray(items)) return map;

  await Promise.all(
    items.flatMap((item) => activityPhotoUrls(item)).map(async (photoId) => {
      if (map.has(photoId)) return;
      const blob = await getPhotoBlob(photoId);
      if (blob) map.set(photoId, URL.createObjectURL(blob));
    }),
  );

  return map;
}

/**
 * Elimina todo el contenido offline (feed + fotos) de un usuario.
 * Debe llamarse:
 *   - al completar un logout exitoso, y
 *   - al detectar que la sesión verificada corresponde a un usuario
 *     distinto al que tenía el snapshot persistido (ver clearOtherUsers).
 * @param {string} userId
 */
export async function clearUserData(userId) {
  if (typeof indexedDB === 'undefined') return;
  if (!userId) return;
  const db = await openDatabase();

  const feedTx = db.transaction(FEED_STORE, "readwrite");
  feedTx.objectStore(FEED_STORE).delete(userId);
  const feedDone = transactionDone(feedTx);

  const photoTx = db.transaction(PHOTO_STORE, "readwrite");
  const photoStore = photoTx.objectStore(PHOTO_STORE);
  const index = photoStore.index("byUser");
  const range = IDBKeyRange.only(userId);
  index.openCursor(range).onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  const photosDone = transactionDone(photoTx);

  await Promise.all([feedDone, photosDone]);
}

/**
 * Se llama justo después de verificar una sesión. Si en IndexedDB había
 * datos de un usuario DISTINTO al recién verificado, los borra, de modo
 * que nunca se mezclen ni queden expuestos datos de otra cuenta.
 * @param {string} currentUserId
 */
export async function clearOtherUsers(currentUserId) {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  const tx = db.transaction(FEED_STORE, "readonly");
  const allSnapshots = await requestToPromise(tx.objectStore(FEED_STORE).getAll());

  const staleUserIds = allSnapshots
    .map((snapshot) => snapshot.userId)
    .filter((userId) => userId !== currentUserId);

  for (const staleUserId of staleUserIds) {
    await clearUserData(staleUserId);
  }
}

/**
 * Borra absolutamente todo (ambos stores). Útil como limpieza defensiva,
 * por ejemplo si se detecta corrupción del snapshot.
 */
export async function clearAll() {
  const db = await openDatabase();
  const tx = db.transaction([FEED_STORE, PHOTO_STORE], "readwrite");
  tx.objectStore(FEED_STORE).clear();
  tx.objectStore(PHOTO_STORE).clear();
  await transactionDone(tx);
}
