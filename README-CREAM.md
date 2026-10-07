# Cream Los Cabos · MVP 1.3

## Resultado

Se amplió el prototipo existente conservando React/Vite, las rutas `/club` y `/hub` y el binding D1 `DB`. Cloudflare Pages sirve el frontend; Pages Functions gestiona pedidos y acceso. No hay configuración ni dependencias de Netlify.

### Identidad visual

- Paleta de la web oficial: azul `#293B99`, crema `#EDEBE3`, verde `#1A9961`, azul claro `#A6C4D6` y acentos oficiales.
- Logo y ave oficiales, fotografías locales de Cream, tarjetas visuales de categorías, navegación móvil y tablero con colores por estado.
- Información pública de Palmilla y Ánima Village: direcciones, horarios y teléfonos; enlaces a mapas y a la web oficial.
- Los recursos y su procedencia se registran en `public/brand/SOURCES.md`; el uso de la app no requiere descargar recursos externos.

### Cream Club

- 255 productos: 254 de la carta oficial más el croissant original; ocho filtros de categoría, secciones y búsqueda sin acentos.
- Carta pública sin precios: los productos nuevos se pueden pedir con precio pendiente explícito; los cuatro originales conservan sus precios configurados.
- Ilustraciones locales por categoría y fotografías originales; menú verificado contra las seis pestañas oficiales.
- Personalización de tamaño, leche, temperatura y acompañamientos según producto; precio recalculado y notas.
- Carrito persistente, cantidades, edición y eliminación.
- Nombre, teléfono opcional, sucursal de recolección y nota de pedido.
- Pedido real en D1; reintentos identificados para impedir duplicados. Un error conserva el carrito.
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

### Arquitectura

- `shared/brand.js`: datos públicos de sucursales y contacto, separados del catálogo y del estado operativo.
- `shared/menu.js`: carta oficial y metadatos de procedencia, sin inventar precios.
- `shared/catalog.js`: catálogo fusionado y validación común; el backend calcula los precios conocidos y conserva los pendientes.
- `src/components/Club.jsx` y `Hub.jsx`: interfaces; `src/api.js`: cliente de API sin fallback de pedidos locales.
- `functions/api/orders/[[id]].js`: creación, consulta privada, lista de operación y estados.
- `functions/api/hub/session.js`: acceso del equipo, expiración y cierre de sesión.
- `migrations/`: migración aditiva del esquema original; conserva pedidos existentes.
- `wrangler.toml`, `public/_routes.json`, `public/_headers`: configuración de Pages/D1 y headers.
- `tests/`: validación de catálogo, SQLite/API y recorrido de navegador con D1 real local.
- `.github/workflows/ci.yml`: build, pruebas y recorrido completo en cada push/PR.
- `.github/workflows/deploy-cloudflare.yml` y `scripts/deploy-cloudflare.mjs`: despliegue manual de producción en Pages y D1, con migraciones y verificación del acceso a Hub.

## Configuración pendiente de producción

Sustituir el UUID reservado de D1 por la base real, configurar `HUB_TOKEN` y aplicar migraciones. El repositorio no incluye secretos ni modifica recursos Cloudflare de producción.

El workflow de despliegue prepara el identificador de D1 automáticamente en una configuración temporal. Para publicarlo desde GitHub, configurar los secretos indicados en README y ejecutar **Deploy Cream to Cloudflare** en `main`. La presencia del workflow no implica que exista un despliegue público.

El alcance es pedidos para recoger y pago en sucursal. Validar con el negocio los precios y opciones originales y cargar la lista vigente de precios antes del lanzamiento comercial. La carta oficial publicada no indica diferencias de disponibilidad entre Palmilla y Ánima Village; ambos locales utilizan el catálogo común y confirman disponibilidad e importe en sucursal. No incluye pagos en línea, cuentas de clientes, inventario, delivery ni notificaciones externas.

Las instrucciones de ejecución y despliegue están en [README.md](README.md).

## Validación de esta entrega

- 41 pruebas de catálogo y API contra SQLite: aprobadas, incluidos pedidos sin precio, pedidos mixtos, persistencia, estados e idempotencia.
- 8 pruebas de despliegue: credenciales, compatibilidad de migraciones, conservación de bindings y configuración temporal.
- 29 escenarios de navegador sobre Pages Functions y D1 local: aprobados, incluidos estados completos, separación de sucursales/estaciones, permisos, móvil, recargas, recuperación sin pedidos duplicados y pedidos mixtos con precios pendientes.
- Auditoría visual en 1440, 768, 390 y 320 px: Club, login y tablero Hub sin desbordamiento, imágenes fallidas ni errores del navegador; navegación móvil fija comprobada.
- Build de producción Vite y compilación de Pages Functions: aprobados.
- Migraciones nuevas y conservación de pedidos del esquema original: verificadas.
- Catálogo contrastado con las seis pestañas oficiales: 254 productos únicos, sin perder porciones distintas ni variantes infantiles.
- Auditoría npm de la entrega anterior: cero vulnerabilidades.
