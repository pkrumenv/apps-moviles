# Entrega 2: PWA con Web Push Notifications - Foodie

## 1. Información General

### Nombre de la Aplicación
**Foodie** - Aplicación web progresiva (PWA) para descubrir, reseñar y seguir restaurantes con notificaciones push en tiempo real.

### Integrantes del Grupo
- **Francisco Correa**
- **Pablo Krumenaker**

*Grupo 19 - ICC4203*

---

## 2. Entorno de Evaluación

### Plataforma
- **Tipo**: Progressive Web App (PWA) moderna
- **Arquitectura**: Frontend/Backend separados

### Dispositivo y Sistema Operativo
- **Dispositivo**: Computadora de escritorio / Laptop
- **Sistema Operativo**: Linux / Windows 10+ / macOS
- **Navegador**: Chromium 90+ (Google Chrome, Microsoft Edge, Brave, etc.)

### Requisitos Implementados
- ✓ Instalación como PWA (manifest.webmanifest + Service Worker)
- ✓ Funcionamiento offline (Network-First cache strategy)
- ✓ Web Push Notifications (VAPID completo, end-to-end encryption)
- ✓ IndexedDB para offline-first
- ✓ Autenticación segura (JWT + HTTP-only cookies)
- ✓ Reseñas con fotos (validación, almacenamiento local)

---

## 3. Instrucciones de Configuración e Instalación

### 3.1 Requisitos Previos
- Node.js 18+ y npm
- Python 3.13+
- PostgreSQL 14+ (o Aurora DSQL para ambiente cloud)
- Git

### 3.2 Configuración del Backend

#### Paso 1: Clonar el repositorio y navegar al directorio backend
```bash
git clone https://github.com/tu-usuario/grupo-19-entrega-2.git
cd grupo-19-entrega-2/backend
```

#### Paso 2: Crear archivo `.env` con variables de entorno
```bash
# Crear archivo .env en la raíz de backend/
cat > .env << 'EOF'
# Base de datos
DATABASE_URL=postgresql://user:password@localhost:5432/foodie_db

# JWT y sesiones
SECRET_KEY=tu-clave-super-secreta-aqui-minimo-32-caracteres
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24

# Web Push Notifications - Generar con pywebpush
VAPID_PUBLIC_KEY=BExxx...tu-clave-publica-aqui...
VAPID_PRIVATE_KEY=xxx...tu-clave-privada-aqui...
VAPID_SUBJECT_EMAIL=tu-email@example.com

# Almacenamiento de fotos
MEDIA_STORAGE_TYPE=local  # "local" o "s3"
MEDIA_MAX_UPLOAD_BYTES=5242880  # 5MB

# (Opcional) Si usas S3
# AWS_ACCESS_KEY_ID=your-key
# AWS_SECRET_ACCESS_KEY=your-secret
# AWS_REGION=us-east-1
# AWS_S3_BUCKET=foodie-photos

# CORS
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
EOF
```

#### Paso 3: Generar claves VAPID (si no las tienes)
```bash
# Instalar pywebpush si no lo hiciste
pip install pywebpush

# Generar claves
python -c "
from pywebpush import generate_vapid_keys
vapid = generate_vapid_keys()
print('VAPID_PUBLIC_KEY=' + vapid['public_key'])
print('VAPID_PRIVATE_KEY=' + vapid['private_key'])
"

# Copiar las claves generadas al archivo .env
```

#### Paso 4: Instalar dependencias e inicializar base de datos
```bash
# Instalar dependencias de Python
pip install -r requirements.txt --break-system-packages

# Ejecutar migraciones Alembic
cd app/migrations
alembic upgrade head
cd ../..

# (Opcional) Crear datos de prueba
python scripts/seed_data.py
```

#### Paso 5: Ejecutar el servidor backend
```bash
# Opción 1: Con Uvicorn en desarrollo
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Opción 2: Con gunicorn para producción
gunicorn -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000 app.main:app
```

El backend estará disponible en: **http://localhost:8000**

### 3.3 Configuración del Frontend

#### Paso 1: Navegar al directorio frontend
```bash
cd ../frontend
```

#### Paso 2: Instalar dependencias y variables de entorno
```bash
# Instalar dependencias de Node
npm install

# Crear archivo .env (si es necesario)
cat > .env << 'EOF'
VITE_API_ORIGIN=http://localhost:8000
VITE_ENVIRONMENT=development
EOF
```

#### Paso 3: Ejecutar servidor de desarrollo
```bash
# Iniciar servidor Vite
npm run dev

# O compilar para producción
npm run build
npm run preview
```

El frontend estará disponible en: **http://localhost:5173**

### 3.4 Instalación como PWA

1. Abre la aplicación en tu navegador: `http://localhost:5173`
2. En Chrome/Edge: Haz clic en el botón de instalación (esquina superior derecha)
   - Alternativa: Click derecho → "Instalar Foodie"
3. La aplicación se instalará como app nativa en tu computadora
4. Verifica que aparezca en tu menú de aplicaciones

---

## 4. Estrategia de Caché e IndexedDB

### 4.1 Estrategia de Caché

Después de probar diferentes enfoques, terminamos con una **estrategia Network-First con fallback a Cache**. Básicamente:

#### Service Worker (`frontend/src/service-worker.js`)
```javascript
// Patrón Network-First para API calls
// 1. Intenta obtener del servidor
// 2. Si falla, usa la versión en caché
// 3. Actualiza el caché con la respuesta del servidor

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Clonar y guardar en caché si es exitoso
          if (response.ok) {
            const clone = response.clone();
            caches.open('api-cache-v1').then(cache => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback a caché si no hay red
          return caches.match(event.request);
        })
    );
  }
});
```

**Ventajas**:
- ✅ Contenido siempre actualizado cuando hay conexión
- ✅ Fallback automático cuando no hay red
- ✅ Mejor experiencia de usuario

### 4.2 IndexedDB - Estructura de Base de Datos Local

```javascript
// Nombre de la base de datos
const DB_NAME = 'foodie-db';
const DB_VERSION = 1;

// Object Stores (colecciones)
const STORES = {
  restaurants: 'restaurants',      // Caché de lista de restaurantes
  reviews: 'reviews',              // Reseñas locales pendientes de sincronizar
  photos: 'photos',                // Blobs de fotos
  subscriptions: 'subscriptions',  // Estado de suscripción push
  user: 'user'                     // Info del usuario autenticado
};
```

#### Schema de cada Object Store

```javascript
// restaurants
{
  keyPath: 'id',
  indexes: [
    { name: 'name', keyPath: 'name' },
    { name: 'created_at', keyPath: 'created_at' }
  ]
}
// Documento ejemplo:
{
  "id": "uuid-12345",
  "name": "La Trattoria",
  "address": "Av. Providencia 1234",
  "latitude": -33.4234,
  "longitude": -70.5891,
  "created_at": "2025-03-15T10:30:00Z"
}

// reviews (reseñas locales pendientes)
{
  keyPath: 'id',
  indexes: [
    { name: 'status', keyPath: 'status' },  // 'pending', 'synced'
    { name: 'restaurantId', keyPath: 'restaurantId' }
  ]
}
// Documento ejemplo:
{
  "id": "local-review-1",
  "restaurantId": "uuid-12345",
  "dishName": "Pasta Carbonara",
  "text": "Excelente...",
  "photoBlob": Blob,
  "status": "pending",
  "created_at": "2025-03-15T14:22:00Z"
}

// subscriptions
{
  keyPath: 'key',
  value: { endpoint: '...', expirationTime: null, keys: {...} }
}

// user
{
  keyPath: 'id',
  value: { id: 'uuid', name: 'Juan', email: 'juan@example.com' }
}
```

#### Sincronización con Backend
Cuando la app recupera conexión:
1. Service Worker detecta `online` event
2. Procesa reviews pendientes (POST `/api/v1/reviews`)
3. Actualiza índices locales con respuestas del servidor
4. Notifica al usuario sobre éxito/fallos

---

## 5. Ciclo de Suscripción Push Notifications

### 5.1 Flujo Completo

```
┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND (JavaScript)                                           │
│ ─────────────────────────────────────────────────────────────  │
│ 1. requestNotificationPermission()                              │
│    → Pide permiso al navegador (bloqueador o permitir)          │
│                                                                  │
│ 2. subscribeToPush()                                            │
│    → Obtiene VAPID_PUBLIC_KEY del backend                       │
│    → Crea suscripción con: push.subscribe({                     │
│       userVisibleOnly: true,                                    │
│       applicationServerKey: decodificada                        │
│      })                                                          │
│    → Extrae: endpoint, p256dh, auth                             │
│    → POST /api/v1/push/subscribe { endpoint, keys }             │
└────────────────────────┬──────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ BACKEND (FastAPI + SQLAlchemy)                                  │
│ ─────────────────────────────────────────────────────────────  │
│ 3. POST /api/v1/push/subscribe                                  │
│    → Valida sesión (HTTP-only cookie)                           │
│    → Guarda en DB table push_subscriptions:                     │
│      { user_id, endpoint, p256dh, auth, created_at }           │
│                                                                  │
│ 4. Evento: Usuario crea reseña                                  │
│    → create_review() → trigger:                                 │
│    → send_notification_to_restaurant_followers()                │
│      a) Obtiene followers del restaurante                       │
│      b) Para cada seguidor:                                     │
│         - Obtiene sus suscripciones push                        │
│         - Firma con VAPID_PRIVATE_KEY                           │
│         - POST a endpoint (Web Push Service)                    │
│         - Si 410 Gone → borra de DB                             │
│      c) Maneja errores (endpoint inválido, etc)                 │
└────────────────────────┬──────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ SERVICE WORKER (JavaScript - Background)                        │
│ ─────────────────────────────────────────────────────────────  │
│ 5. Event: 'push'                                                │
│    → self.addEventListener('push', event => {                  │
│      const data = event.data.json();                            │
│      self.registration.showNotification(data.title, {           │
│        body: data.message,                                      │
│        icon: '/icon-192.png',                                   │
│        badge: '/badge-72.png',                                  │
│        tag: 'foodie-notification'                               │
│      });                                                         │
│    });                                                           │
│                                                                  │
│ 6. Notificación Mostrada                                        │
│    → Visible en bandeja del SO (incluso si app está cerrada)    │
│    → Cifrada end-to-end (AES-128-GCM)                           │
│                                                                  │
│ 7. Click en Notificación                                        │
│    → self.addEventListener('notificationclick', ...)           │
│    → Abre la aplicación o trae a primer plano                   │
└────────────────────────────────────────────────────────────────┘
```

### 5.2 Responsabilidades por Capa

| Capa | Responsabilidad |
|------|-----------------|
| **Frontend** | • Solicitar permiso al usuario<br>• Generar suscripción con VAPID público<br>• Enviar credenciales al backend<br>• Manejo de UI para suscripción/desuscripción |
| **Service Worker** | • Escuchar evento `push`<br>• Desencriptar payload (automático por navegador)<br>• Mostrar notificación visual<br>• Manejar clicks en notificación<br>• Mantener aplicación despierta en background |
| **Backend** | • Almacenar suscripciones (endpoint + keys)<br>• Firmar payload con VAPID privado<br>• Enviar a Web Push Service (Mozilla, Google)<br>• Limpiar suscripciones inválidas (410 Gone)<br>• Logging y manejo de errores |
| **Web Push Service** | • Almacenar mensaje encriptado<br>• Entregar cuando dispositivo está online<br>• Garantizar entrega (best-effort) |

---

## 6. Endpoints Implementados

### 6.1 Autenticación

#### POST `/api/v1/auth/login`
**Descripción**: Inicia sesión y devuelve sesión activa

**Request**:
```json
{
  "email": "demo@example.com",
  "password": "demo-password"
}
```

**Response** (200 OK):
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Demo User",
    "email": "demo@example.com",
    "handle": "demouser",
    "nationality": "Chile"
  },
  "session": {
    "id": "650e8400-e29b-41d4-a716-446655440001",
    "expires_at": "2025-04-20T10:30:00Z"
  }
}
```

**Cookies**: 
- `session_id`: JWT firmado, HttpOnly, Secure, SameSite=Strict

#### GET `/api/v1/auth/session`
**Descripción**: Verifica si existe sesión activa

**Response** (200 - Autenticado):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Demo User",
  "email": "demo@example.com",
  "expires_at": "2025-04-20T10:30:00Z"
}
```

**Response** (401 - No autenticado):
```json
{
  "detail": "No active session"
}
```

#### POST `/api/v1/auth/logout`
**Descripción**: Cierra sesión actual

**Response** (200 OK):
```json
{
  "message": "Session revoked"
}
```

### 6.2 Restaurantes

#### GET `/api/v1/restaurants`
**Descripción**: Lista pagina de restaurantes

**Query Parameters**:
- `limit`: número de items (default: 20, max: 100)
- `offset`: número de items a saltar (default: 0)
- `search`: buscar por nombre (opcional)

**Response** (200):
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "La Trattoria",
      "address": "Av. Providencia 1234, Santiago",
      "latitude": -33.4234,
      "longitude": -70.5891,
      "cuisine_styles": ["Italiana", "Pasta"],
      "reviews_count": 5,
      "created_at": "2025-03-01T08:00:00Z"
    }
  ],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

### 6.3 Web Push Notifications

#### GET `/api/v1/push/vapid-key`
**Descripción**: Obtiene clave pública VAPID para suscribirse

**Response** (200):
```json
{
  "vapid_public_key": "BExxx...base64url...xxx"
}
```

#### POST `/api/v1/push/subscribe`
**Descripción**: Registra suscripción push del usuario

**Headers**: Cookie con sesión válida

**Request**:
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/xxxxx",
  "keys": {
    "p256dh": "xxxxx...base64url...xxxxx",
    "auth": "xxxxx...base64url...xxxxx"
  }
}
```

**Response** (201 Created):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440010",
  "endpoint": "https://fcm.googleapis.com/fcm/send/xxxxx",
  "created_at": "2025-03-15T14:30:00Z"
}
```

#### DELETE `/api/v1/push/subscribe`
**Descripción**: Desuscribe endpoint del usuario

**Query Parameters**:
- `endpoint`: URL del endpoint a desuscribir

**Response** (204 No Content):
```
(sin body)
```

### 6.4 Reseñas (Reviews)

#### POST `/api/v1/reviews`
**Descripción**: Crea nueva reseña con foto

**Headers**: 
- Cookie con sesión válida
- Content-Type: multipart/form-data

**Request** (form-data):
```
restaurant_id: "550e8400-e29b-41d4-a716-446655440000"
dish_name: "Lomo a la Pimienta"
text: "Excepcional sabor, punto perfecto. Recomendado."
photo: <archivo JPEG/PNG/WebP, max 5MB>
```

**Response** (201 Created):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440020",
  "author_id": "550e8400-e29b-41d4-a716-446655440000",
  "restaurant_id": "550e8400-e29b-41d4-a716-446655440000",
  "dish_name": "Lomo a la Pimienta",
  "text": "Excepcional sabor...",
  "photo": {
    "id": "550e8400-e29b-41d4-a716-446655440021",
    "content_url": "/api/v1/photos/550e8400-e29b-41d4-a716-446655440021/content"
  },
  "created_at": "2025-03-15T14:35:00Z"
}
```

**Errores**:
- 400: Foto inválida (formato, tamaño, contenido)
- 404: Restaurante no encontrado
- 413: Foto supera límite (5 MB)
- 500: Error al guardar

---

## 7. Evidencia de Funcionamiento

### 7.1 Instalación como PWA
**[INCLUIR SCREENSHOT: Navegador mostrando botón de instalación y aplicación instalada en el sistema operativo]**

Pasos:
1. Navegar a http://localhost:5173
2. Click en botón "Install" o menú → "Install Foodie"
3. Confirmar instalación
4. Aplicación aparece en menú de aplicaciones

**Expected**: Icono de Foodie en escritorio / menú de aplicaciones

### 7.2 Funcionamiento Offline
**[INCLUIR SCREENSHOT O VIDEO: Cerrar aplicación, desconectar red, abrir aplicación nuevamente, navegar restaurantes]**

Pasos:
1. Abrir Foodie (connected)
2. Navegar por lista de restaurantes
3. Cerrar aplicación completamente
4. Desconectar internet (offline)
5. Abrir Foodie nuevamente
6. Verificar que la lista de restaurantes aún es accesible

**Expected**: Lista de restaurantes visible (from cache), indicador "🔴 Offline" en esquina superior

### 7.3 Notificación Push Recibida (App Cerrada)
**[INCLUIR SCREENSHOT: Notificación visible en bandeja del SO]**

Pasos:
1. Estar autenticado y suscrito a notificaciones
2. Seguir un restaurante
3. Cerrar completamente la aplicación Foodie
4. Otra persona crea una reseña en ese restaurante
5. Notificación aparece en bandeja del sistema

**Expected**: 
```
┌─────────────────────────────────┐
│ 🔔 Foodie                        │
│                                 │
│ Nueva reseña en La Trattoria     │
│ "Lomo a la pimienta - Excelente" │
└─────────────────────────────────┘
```

---

## 8. Testing y Verificación

### 8.1 Verificar Backend Funcionando

```bash
# Test de healthcheck
curl -v http://localhost:8000/healthz
# Expected: 200 OK

# Test de autenticación (login)
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"demo-password"}' \
  -c cookies.txt \
  -v
# Expected: 200, Set-Cookie header con session_id

# Test de obtener restaurantes
curl http://localhost:8000/api/v1/restaurants \
  -b cookies.txt \
  -v
# Expected: 200, JSON con lista de restaurantes

# Test de obtener VAPID key
curl http://localhost:8000/api/v1/push/vapid-key \
  -v
# Expected: 200, JSON con clave pública
```

### 8.2 Verificar Frontend Funcionando

```bash
# Compile frontend
cd frontend
npm run build
# Expected: dist/ carpeta creada sin errores

# Test con Vite dev server
npm run dev
# Expected: Servidor en http://localhost:5173, sin errores en consola
```

### 8.3 Verificar Registración de Suscripción Push

Después de hacer login en la UI:
1. Abre DevTools (F12) → Console
2. Ejecuta:
```javascript
// Verificar que existe Service Worker
navigator.serviceWorker.controller
// Expected: ServiceWorkerContainer con .controller activo

// Verificar suscripción push
navigator.serviceWorker.ready.then(reg => {
  return reg.pushManager.getSubscription();
}).then(sub => {
  console.log('Suscripción:', sub);
  // Expected: objeto con endpoint y keys
});
```

### 8.4 Verificar Notificación Recibida

Desde backend (Python):
```python
from app.services.push import send_notification

# Simular envío de notificación
send_notification(
    endpoint="<endpoint-del-usuario>",
    title="Test Notificación",
    message="¿Recibiste esto?",
    vapid_private_key=settings.vapid_private_key,
    vapid_public_key=settings.vapid_public_key,
    subject=settings.vapid_subject_email,
)
# Expected: Notificación visible en bandeja del SO en pocos segundos
```

---

## 9. Problemas Conocidos y Restricciones

### 9.1 Restricciones del Navegador

1. **Notificaciones requieren HTTPS (en producción)**
   - En desarrollo local: funciona con HTTP
   - En producción: OBLIGATORIO HTTPS con certificado válido
   - Workaround: Usar localhost o ngrok

2. **Service Worker limitado a HTTPS**
   - Registración falla si no es HTTPS (excepto localhost)
   - Push Notifications requieren Service Worker

3. **IndexedDB limitado por origen**
   - Datos separados por: scheme + domain + puerto
   - localhost:5173 ≠ localhost:3000
   - Límite de espacio: ~50MB (varía por navegador)

4. **Cookies HttpOnly no accesibles desde JavaScript**
   - Por seguridad (XSS protection)
   - Navegador las adjunta automáticamente en requests con `credentials: 'include'`

### 9.2 Problemas Conocidos

1. **Notificaciones no aparecen en algunos navegadores**
   - Normalmente es que el SO o el navegador las bloqueó
   - Solución: Revisar configuración de notificaciones (System Settings → Notifications)
   - En macOS en particular hay que permitir explícitamente en Chrome

2. **Service Worker se queda en cache viejo**
   - Pasa cuando cambias código del SW y el navegador sigue usando la versión anterior
   - Solución fácil: Ctrl+Shift+R (hard refresh) o limpiar Application tab en DevTools
   - En desarrollo usamos incógnito a veces para evitar esto

3. **CORS muere en desarrollo con puertos diferentes**
   - Tomó un rato notar que Frontend en 5173 y Backend en 8000 necesitaban CORS habilitado
   - Verificar `ALLOWED_ORIGINS` en `.env` del backend

4. **Upload de fotos falla sin credenciales S3**
   - Si configuran `MEDIA_STORAGE_TYPE=s3` sin AWS keys, revienta
   - En dev: dejar en `local` es más rápido

5. **Alembic downgrade es lento**
   - Si la BD existe con esquema viejo, a veces las migraciones se quejan
   - Más rápido hacer backup y `DROP DATABASE foodie_db;` que esperar

### 9.3 Limitaciones Intencionales

1. **No hay edición/eliminación de reseñas**
   - Diseño: una reseña es un registro histórico
   - Futura mejora: soft-delete con flag

2. **Push Notifications solo para seguidores públicos**
   - Diseño: respeta privacidad de usuarios
   - Solo se notifica a who explicitly siguen el restaurante

3. **Sin persistencia offline de reseñas no enviadas**
   - En esta entrega: requiere conexión para enviar
   - Futura mejora: queue en IndexedDB con sync cuando se restaure conexión

---

## 10. Declaración de Uso de IA Generativa

Se utilizó **Claude (Anthropic)** como herramienta de desarrollo para:

- ✅ Scaffold inicial del backend (estructura FastAPI, modelos SQLAlchemy)
- ✅ Implementación de Web Push (VAPID signing, payload encryption, cleanup de endpoints 410)
- ✅ Código del Service Worker y manejo offline
- ✅ Fixtures de testing y setup de base de datos
- ✅ Documentación técnica (README, guías de integración)

**Lo que hicieron los integrantes**:
- ✅ Arquitectura general (decidir Network-First, IndexedDB schema, protección con HTTP-only cookies)
- ✅ Debugging y fixes (problemas con CORS, rutas, validaciones)
- ✅ Testing manual de toda la cadena (login → suscripción → notificación)
- ✅ Decisiones de trade-offs (por qué PostgreSQL, por qué local storage vs S3)
- ✅ Revisión y adaptación de todo código generado al contexto del proyecto

**Nota**: IA aceleró el desarrollo, pero todas las decisiones técnicas críticas fueron del equipo.

---

## 11. Referencias y Recursos

### Documentación Oficial
- [Web Push API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [VAPID RFC 8292](https://tools.ietf.org/html/rfc8292)
- [Service Workers API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [IndexedDB - MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)

### Herramientas Utilizadas
- **Frontend**: Vite, Vanilla JavaScript (ES6+), Service Workers
- **Backend**: FastAPI, SQLAlchemy (Table-based), Alembic, PyWebPush
- **Base de Datos**: PostgreSQL / Aurora DSQL
- **Push Notifications**: Web Push Protocol, VAPID, AES-128-GCM

---

## 12. Próximos Pasos (Futuras Entregas)

- [ ] Implementar edición y soft-delete de reseñas
- [ ] Sincronización offline de reseñas (queue en IndexedDB)
- [ ] Búsqueda full-text en backend
- [ ] Autenticación con OAuth (Google, GitHub)
- [ ] Compresión automática de fotos
- [ ] Estadísticas y ranking de restaurantes
- [ ] Chat entre usuarios
- [ ] Mapas interactivos con ubicaciones

---

**Última actualización**: Septiembre 2026  
**Estado**: Entrega 2 - Web Push Notifications  
**Versión**: 1.0.0

