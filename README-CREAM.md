# Cream Los Cabos · MVP 1.4

## Resultado

Se amplió el prototipo existente conservando React/Vite, las rutas `/club` y `/hub` y el binding D1 `DB`. La arquitectura queda preparada para Cloudflare Pages y Pages Functions; el Worker vigente reutiliza esas Functions para pedidos y acceso. No hay configuración ni dependencias de Netlify.

### Identidad visual

- Paleta de la web oficial: azul `#293B99`, crema `#EDEBE3`, verde `#1A9961`, azul claro `#A6C4D6` y acentos oficiales.
- Logo y ave oficiales, fotografías locales de Cream, tarjetas visuales de categorías, navegación móvil y tablero con colores por estado.
- Información pública de Palmilla y Ánima Village: direcciones, horarios y teléfonos; enlaces a mapas y a la web oficial.
- Los recursos y su procedencia se registran en `public/brand/SOURCES.md`; el uso de la app no requiere descargar recursos externos.

### Cream Club

- 255 productos: 254 de la carta oficial más el croissant original; portada de cuatro favoritos, categorías y secciones con seis productos por página y búsqueda global sin acentos.
- Carta pública sin precios: los productos nuevos se pueden pedir con precio pendiente explícito; los cuatro originales conservan sus precios configurados.
- Fotografías locales de referencia del plato o bebida descritos; menú verificado contra las seis pestañas oficiales. La interfaz usa iconos SVG y la identidad oficial, sin emojis.
- Personalización de tamaño, leche, temperatura y acompañamientos según producto; precio recalculado y notas.
- Carrito persistente, cantidades, edición y eliminación.
- Nombre, teléfono opcional, sucursal de recolección y nota de pedido.
- Pedido real en D1; reintentos identificados para impedir duplicados. Un error conserva el carrito.
- Tarjeta Club real en D1, QR sin claves privadas, perfil editable e historial asociado a pedidos. Beneficios pendientes de definición; no se anuncian puntos ni canjes.
- Comprobante y seguimiento automático de los cinco estados, conservado en el navegador del cliente.
- Diseño adaptable a móvil y escritorio; diálogos con teclado, etiquetas y estados de carga.
- Portada con fotografías oficiales, accesos visuales a categorías y navegación inferior en móvil.

### Cream Hub

- Código privado de equipo y sesión firmada en cookie HttpOnly; cierre de sesión.
- Pedidos de Palmilla y Ánima Village en columnas por estado.
- Preparación separada por Barra, Cocina y Panadería, conservando opciones y notas.
- Búsqueda por cliente/pedido, filtros de sucursal, activos/entregados y resumen del día.
- Precios pendientes y subtotal conocido visibles; el indicador de total con precio excluye pedidos sin importe final.
- Cambios secuenciales Nuevo → Confirmado → En preparación → Listo → Entregado, con control de concurrencia.
- Actualizaciones cada cinco segundos y reintento manual; errores visibles sin borrar los últimos pedidos.
- Consulta de tarjetas desde QR o identificador, sólo con sesión de empleados; contador basado en pedidos entregados reales.
- Los pedidos creados antes de ayer pero entregados hoy se conservan en el historial de operación.

### Arquitectura

- `shared/brand.js`: datos públicos de sucursales y contacto, separados del catálogo y del estado operativo.
- `shared/menu.js`: carta oficial y metadatos de procedencia, sin inventar precios.
- `shared/catalog.js`: catálogo fusionado y validación común; el backend calcula los precios conocidos y conserva los pendientes.
- `src/components/Club.jsx` y `Hub.jsx`: interfaces; `src/api.js`: cliente de API sin fallback de pedidos locales.
- `functions/api/orders/[[id]].js`: creación, consulta privada, lista de operación y estados.
- `functions/api/hub/session.js`: acceso del equipo, expiración y cierre de sesión.
- `functions/api/members/[[id]].js`: creación idempotente, consulta privada y edición de tarjetas; D1 guarda sólo el hash del acceso privado.
- `migrations/`: migración aditiva del esquema original; conserva pedidos existentes.
- `wrangler.toml`, `public/_routes.json`, `public/_headers`: configuración de Pages/D1 y headers.
- `tests/`: validación de catálogo, SQLite/API y recorrido de navegador con D1 real local.
- `.github/workflows/ci.yml`: build, pruebas y recorrido completo en cada push/PR.
- `.github/workflows/deploy-cloudflare.yml` y `scripts/deploy-cloudflare.mjs`: despliegue manual de producción en Pages y D1, con migraciones y verificación del acceso a Hub.
- `.github/workflows/bootstrap-cloudflare.yml`, `scripts/bootstrap-hub.mjs` y `scripts/unseal-hub-access.mjs`: primera publicación exclusivamente sobre recursos nuevos en la cuenta actual; código del equipo cifrado para una clave pública RSA y recuperación local privada.
- `worker/` y `scripts/update-existing-worker.mjs`: actualizador del Worker publicado que reutiliza las Functions y conserva su D1, secretos, rutas y protecciones. Guarda export D1 y versión anterior antes de migrar.

## Configuración pendiente de producción

La publicación anterior utiliza `cream-los-cabos-preview` en Workers con su D1 existente. El bootstrap de Pages crea una publicación y una D1 nuevas en la cuenta actual, conservando esos recursos anteriores. Rechaza recursos de destino existentes y no transfiere pedidos. El repositorio no incluye secretos.

Para la primera publicación, seguir la entrega cifrada descrita en README y ejecutar **Bootstrap fresh Cream Pages and private Hub access** en `main`. La subida obligatoria del artifact cifrado sucede antes de cualquier modificación de Cloudflare; conservarlo y descifrarlo localmente antes de su caducidad de siete días. Los despliegues posteriores con **Deploy Cream to Cloudflare** requieren añadir el código recuperado como secreto `HUB_TOKEN` de GitHub. La presencia del workflow no implica que exista un despliegue público.

El alcance es pedidos para recoger y pago en sucursal. Validar con el negocio los precios y opciones originales y cargar la lista vigente de precios antes del lanzamiento comercial. La carta oficial publicada no indica diferencias de disponibilidad entre Palmilla y Ánima Village; ambos locales utilizan el catálogo común y confirman disponibilidad e importe en sucursal. Las tarjetas se conservan mediante acceso privado en el navegador; no incluyen recuperación de cuenta en otros dispositivos. No incluye pagos en línea, inventario, delivery ni notificaciones externas.

Las instrucciones de ejecución y despliegue están en [README.md](README.md).

## Validación de esta entrega

- 80 pruebas de catálogo, API/SQLite, tarjetas, fotografías y preflight de despliegue.
- 48 escenarios de navegador aprobados sobre Pages Functions y D1 local: estados completos, separación de sucursales/estaciones, permisos, móvil, recargas, recuperación idempotente, precios pendientes, tarjeta/perfil y decodificación real del QR.
- Verificación visual local final: las 141 imágenes que cubren los 255 productos se sirven sin autenticación en la aplicación local. Fotos y créditos incluidos en la entrega; nueve referencias generadas se identifican expresamente, sin presentarlas como fotografías reales de Cream.
- Auditoría visual en 1440, 768, 390 y 320 px: Club, login y tablero Hub sin desbordamiento, imágenes fallidas ni errores del navegador; navegación móvil fija comprobada.
- Build de producción Vite y compilación de Pages Functions: aprobados.
- Migraciones nuevas y conservación de pedidos del esquema original: verificadas.
- Catálogo contrastado con las seis pestañas oficiales: 254 productos únicos, sin perder porciones distintas ni variantes infantiles.
- Auditoría npm de la entrega anterior: cero vulnerabilidades.

La prueba visual del 8 de octubre de 2026 creó el pedido técnico **#46**, Ánima Village, con Barra/Cocina/Panadería. Hub avanzó los cinco estados; Club observó cada cambio y el historial D1 contó la entrega. Evidencia en `cream-v1-4-verification.json` junto a las capturas de esta entrega. Esta prueba corresponde a D1 local y no se presenta como validación del nuevo código en producción.

El 403 reproducido se originó en Envoy durante CONNECT, antes de TLS con Cloudflare. No se modificaron WAF, Access ni controles de origen. La nueva publicación y su verificación remota siguen pendientes de acceso autenticado a Cloudflare; no se afirma que el 403 externo esté solucionado.
