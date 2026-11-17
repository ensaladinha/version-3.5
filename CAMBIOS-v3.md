# Cambios de la v3.5

**v3.5:** permiso de adultos en Perfil (apagado por defecto; sin cuenta siempre queda apagado). Filtra noticias y juegos +18 con la clasificación de Steam y una lista de palabras: es una heurística, puede dejar pasar o esconder algo.

# Cambios de la v3.4

**v3.4:** las novedades de videojuegos (tarjetas, portada, rankings y búsqueda) abren una ventana con el mini resumen; «Ver más» redirige a la fuente original. Lo demás es la v3.

# Cambios de la v3 (según «Pulso: revisión sin anestesia»)

Estado de cada punto de la revisión. ✅ hecho · 🟡 hecho en parte · ⬜ no se hizo.

| # | Punto | Estado | Qué se hizo / qué falta |
|---|-------|--------|-------------------------|
| 1 | Muro de registro | ✅ | La portada, las secciones y la búsqueda son públicas. Registrarse se pide solo al guardar favoritos o gustos. El modal de gustos ahora es una **oferta** en la portada («Elegir mis gustos» / «Ahora no»). Quien se registra conserva lo que eligió como invitado. |
| 2 | Foco del buscador | ✅ | El foco no se mueve al contenido mientras el buscador sigue enfocado. |
| 3 | Límites en serverless | ✅ | Bloqueo por contraseñas (por IP **y** por cuenta), registros, recuperación y búsquedas de video se cuentan en Redis (`INCR`+`EXPIRE`). El freno general de 120/min sigue siendo por instancia a propósito (no gasta un comando de Redis por pedido). |
| 4 | Cuentas | 🟡 | ✅ «Olvidé mi contraseña» (correo por Resend), ✅ borrado real de cuenta, ✅ cerrar sesión en todos los dispositivos. ⬜ Verificación de email. ⬜ Lista de sesiones. |
| 5 | APIs no oficiales | ⬜ | No hay capa de adaptadores ni pruebas de contrato. Parcial: `/api/home` informa **qué fuente** falló. |
| 6 | Cuota de YouTube | ✅ | Postura: preview de 30 s + «Completa» (apps externas). La canción embebida de YouTube queda **apagada** salvo `YT_MUSIC=1`. Embeds con `youtube-nocookie`. |
| 7 | Portada con ~20 pedidos | 🟡 | ✅ `/api/home` (un solo pedido, cacheado) y aviso cuando la personalización no llegó a tiempo. ⬜ `games/news` sigue pidiendo 14 juegos × 2 llamadas a Steam (ahora detrás de la caché compartida). |
| 8 | Caché por instancia | ✅ | Caché de dos niveles: memoria + Redis compartido. |
| 9 | «Noticiero» sin noticias | ⬜ | Sin fuentes nuevas ni cambio de nombre. |
| 10 | Argentina / voseo | ⬜ | Sin cambios: `region` sigue sin usarse y los textos siguen en voseo. |
| 11 | **Escuchar completa** | ✅ | Botón «Completa» en tarjetas de canciones y en el reproductor, con selector de Spotify, YouTube Music, Apple Music/iCloud, Deezer, Tidal y Amazon Music (enlaces de búsqueda, sin API). «Recordar mi app» + selector en Perfil. |
| 12 | **Juegos: clasificaciones y carga manual** | ✅ | De 6 a 16 géneros y 5 plataformas. Cuadro «Tus juegos favoritos» con sugerencias de Steam (también en Perfil); suman peso a los géneros de cada juego. |
| 13 | «Actualizado ahora» | ✅ | Usa la hora real que devuelve el servidor y se refresca sola. |
| 14 | Sin conexión | ✅ | El service worker guarda las listas de `/api` (nunca datos personales) y la app avisa «datos guardados hace X». |
| 15 | Tarjetas = botones | ✅ | Noticias y juegos usan `<a href>` real. Canciones y tráilers siguen siendo botones (abren el reproductor). |
| 16 | CSS en capas | ⬜ | No se limpió. |
| 17 | Contraste en hover | ✅ | El fondo al pasar el mouse es el acento mezclado con el fondo oscuro. **No se midió en un navegador.** |
| 18 | Tema claro / emojis | 🟡 | ✅ Sin emojis en los gustos. ⬜ Tema claro (hay colores oscuros fijos por todo el CSS). |
| 19 | Reproductor | ✅ | El reloj corre solo mientras suena algo; el video arranca minimizado en pantallas chicas. |
| 20 | Perfil | ✅ | Versionado (`rev`, respuesta 409) y validación de forma y tamaño en el servidor. |
| 21 | Sin build | ⬜ | Sin Vite/esbuild. |
| 22 | Pruebas | 🟡 | ✅ GitHub Actions corre `npm test`; ✅ pruebas nuevas de cuentas, perfil, `/api/home` y almacenamiento. ⬜ Sin pruebas de extremo a extremo ni `axe`. |
| 23 | Código «golf» | ⬜ | Sin Prettier ni partir `server.js`; Express sigue en 4. |
| 24 | Fechas ISO | ✅ | El navegador las formatea con `Intl` (zona e idioma de la persona). |
| 25 | Instalable a medias | ✅ | Íconos PNG 192/512/maskable y `apple-touch-icon`. |
| 26 | Compartible | 🟡 | ✅ `og:image` y `twitter:card` grande. ⬜ Sin páginas por ítem. **`og:image` es relativo: para que las redes lo muestren ponele la dirección completa de tu sitio.** |
| 27 | Seguridad menor | 🟡 | ✅ `/api/health` sin datos internos; ✅ un POST sin `Origin` de otro sitio (según `Sec-Fetch-Site`) se rechaza. ⬜ La CSP sigue permitiendo imágenes de cualquier `https:` (las imágenes de los RSS vienen de muchos sitios). |
| 28 | Región de la función | ⬜ | Hay que medir antes (`gru1` vs `iad1`). |
| 29 | Despliegue frágil | ✅ | `npm run smoke` + workflow `smoke.yml` tras cada despliegue. |
| — | Privacidad | ✅ | `privacidad.html` enlazada en el pie. Es un texto base: revisalo con tus datos de contacto. |
