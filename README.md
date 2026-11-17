# Pulso

![Node](https://img.shields.io/badge/node-22-3c873a) ![Licencia](https://img.shields.io/badge/licencia-MIT-blue)

Noticiero de entretenimiento: música (iTunes), videojuegos (Steam y RSS), series (TVmaze) y películas (iTunes), con un recomendador que aprende de tus gustos.

**Novedades de la v3.5:** casilla «Contenido para adultos» en Perfil. Apagada por defecto: oculta las noticias y juegos +18 (marca de Steam o palabras claras en el título/resumen).

**Novedades de la v3.4:** al tocar una novedad de videojuegos se abre una ventana con un mini resumen y un botón «Ver más» que lleva a la fuente original.

**Novedades de la v3:** portada pública sin registro · «Completa» para escuchar cada canción entera en Spotify, YouTube Music, Apple Music, Deezer, Tidal o Amazon Music (con app preferida) · más géneros de juegos y carga manual de juegos con búsqueda en Steam · recuperar contraseña, eliminar cuenta y cerrar sesión en todos los dispositivos · límites de intentos, caché y bloqueos compartidos vía Redis · `/api/home` (un solo pedido) con la hora real de armado · perfil con versiones (un dispositivo ya no pisa al otro) · datos de la última visita sin conexión · CI y prueba de humo posterior al despliegue.

## Publicarlo sin usar la terminal

Todo se hace desde el navegador: **GitHub** guarda el código y **Vercel** lo convierte en una página web.

### 1. Subirlo a GitHub (máximo 100 archivos por subida; este proyecto tiene menos de 60)

1. Descomprimí el zip en tu PC.
2. En github.com: **+ → New repository**, poné un nombre (por ejemplo `pulso`) y creá el repo (puede ser privado).
3. En el repo vacío tocá **uploading an existing file**.
4. Abrí la carpeta descomprimida, **seleccioná todo su contenido** (`Ctrl+A`) y arrastralo a la página. Arrastrá el *contenido*, no la carpeta `pulso` en sí: en la raíz del repo tienen que quedar `api/`, `package.json`, `vercel.json` y `public/`.
5. Abajo tocá **Commit changes**.

`.gitignore` y `.env.example` son archivos ocultos: si tu sistema no los muestra, no pasa nada, la app funciona igual.

### 2. Publicarlo en Vercel

1. En vercel.com entrá con tu cuenta de GitHub → **Add New → Project** → elegí el repo → **Deploy**. No hay nada que configurar: `vercel.json` ya indica que `public/` es el sitio y que `/api/*` lo atiende la app (`api/index.js`).
2. **Guardar cuentas (necesario para uso real):** Vercel no tiene disco permanente. En el proyecto: **Storage → Create → Upstash Redis** (plan gratuito) y conectalo al proyecto; Vercel agrega solas las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN`. Sin Redis la app funciona, pero las cuentas se pierden cuando la función se reinicia.
3. **Settings → Environment Variables:** agregá `TRUST_PROXY` = `1`. Opcionales: `YT_KEY` (tráilers directos), `RESEND_API_KEY` + `MAIL_FROM` (correo de «Olvidé mi contraseña»; sin ellos esa función no envía nada) y `APP_URL` (la dirección pública del sitio). `YT_MUSIC=1` activa la canción completa embebida de YouTube, pero gasta la cuota diaria muy rápido: no se recomienda.
4. **Deployments → ⋯ → Redeploy** para que tome las variables.
5. Abrí `https://TU-PROYECTO.vercel.app/api/health`: debe responder `{"ok":true}`. (Ya no muestra datos internos; para comprobar Redis, registrá una cuenta, esperá un par de minutos y volvé a entrar.) Con `npm run smoke` se puede probar todo el sitio.

Cada cambio que hagas en el repo (editar un archivo en GitHub con el lápiz ✏️, o subir uno nuevo) se despliega solo.

**Si la página dice `Cannot GET /` o `/api/health` da 404:** falta `vercel.json`, `api/index.js` o `public/` en la raíz del repo (lo más común: se subió la carpeta entera y quedó un nivel más abajo; en ese caso, en Vercel → Settings → General → *Root Directory* poné esa carpeta). Revisá también que en Settings → Build and Deployment el *Framework Preset* sea **Other** (si no, `vercel.json` lo fuerza igual) y mirá **Deployments → Runtime Logs**. **El repo no debe contener un `Dockerfile`**: Vercel construiría una imagen en vez de usar las funciones.

## Correrlo en tu PC (opcional)

Solo hace falta si querés probar cambios antes de publicarlos. Con Node 22:

```bash
npm install
npm start      # http://localhost:3000  (las claves van en un archivo .env, ver .env.example)
npm test       # sin internet: usa respuestas simuladas
```

## Estructura

| Ruta | Qué hace |
| --- | --- |
| `server/server.js` | Servidor Express: API, caché de dos niveles, límites, cabeceras de seguridad y cuentas |
| `server/store.js` | Almacenamiento: archivo JSON local o Redis (Upstash / Vercel KV) según las variables de entorno |
| `server/personal.js` | Recomendaciones y resolución de música |
| `api/index.js` | Entrada para Vercel: recibe `/api/*` y usa la app de `server/server.js` |
| `vercel.json` | Le dice a Vercel que `public/` es el sitio, que `/api/*` va a la función y agrega las cabeceras de seguridad |
| `public/` | Sitio: `index.html`, `privacidad.html`, `css/`, `js/` (módulos), `icons/` (PNG), `sw.js` (modo sin conexión), manifest |
| `scripts/smoke.mjs` | Prueba de humo: pide `/`, `/api/health`, `/api/home`… (`npm run smoke`) |
| `.github/workflows/` | `ci.yml` (corre `npm test` en cada subida) y `smoke.yml` (prueba de humo tras cada despliegue de Vercel) |
| `test/` | Pruebas automáticas |

## Límites y caché en Vercel

El servidor corre en varias instancias que nacen y mueren, así que lo que importa se cuenta en **Redis**, no en memoria: el bloqueo tras 10 contraseñas incorrectas (por IP y por cuenta), el límite de registros, de pedidos de recuperación y de búsquedas de video, y la caché de respuestas de las APIs externas. Sin Redis (en tu PC) se usa la memoria del proceso, que ahí es suficiente. El freno general de 120 pedidos por minuto sigue siendo por instancia a propósito: solo corta ráfagas y así no gasta un comando de Redis por cada pedido.

## Licencia

MIT (ver `LICENSE`).
