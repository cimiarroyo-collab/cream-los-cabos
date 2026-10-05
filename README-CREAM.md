# Cream Los Cabos · MVP 1.1

## Resultado

Se amplió el prototipo existente conservando React/Vite, las rutas `/club` y `/hub` y el binding D1 `DB`. Cloudflare Pages sirve el frontend; Pages Functions gestiona pedidos y acceso. No hay configuración ni dependencias de Netlify.

### Cream Club

- Cuatro productos originales con categorías, búsqueda y fotografías locales.
- Personalización de tamaño, leche, temperatura y acompañamientos según producto; precio recalculado y notas.
- Carrito persistente, cantidades, edición y eliminación.
- Nombre, teléfono opcional, sucursal de recolección y nota de pedido.
- Pedido real en D1; reintentos identificados para impedir duplicados. Un error conserva el carrito.
- Comprobante y seguimiento automático de los cinco estados, conservado en el navegador del cliente.
- Diseño adaptable a móvil y escritorio; diálogos con teclado, etiquetas y estados de carga.

### Cream Hub

- Código privado de equipo y sesión firmada en cookie HttpOnly; cierre de sesión.
- Pedidos de Palmilla y Ánima Village en columnas por estado.
- Preparación separada por Barra, Cocina y Panadería, conservando opciones y notas.
- Búsqueda por cliente/pedido, filtros de sucursal, activos/entregados y resumen del día.
- Cambios secuenciales Nuevo → Confirmado → En preparación → Listo → Entregado, con control de concurrencia.
- Actualizaciones cada cinco segundos y reintento manual; errores visibles sin borrar los últimos pedidos.

### Arquitectura

- `shared/catalog.js`: catálogo y validación común; el backend calcula todos los precios.
- `src/components/Club.jsx` y `Hub.jsx`: interfaces; `src/api.js`: cliente de API sin fallback de pedidos locales.
- `functions/api/orders/[[id]].js`: creación, consulta privada, lista de operación y estados.
- `functions/api/hub/session.js`: acceso del equipo, expiración y cierre de sesión.
- `migrations/`: migración aditiva del esquema original; conserva pedidos existentes.
- `wrangler.toml`, `public/_routes.json`, `public/_headers`: configuración de Pages/D1 y headers.
- `tests/`: validación de catálogo, SQLite/API y recorrido de navegador con D1 real local.
- `.github/workflows/ci.yml`: build, pruebas y recorrido completo en cada push/PR.

## Configuración pendiente de producción

Sustituir el UUID reservado de D1 por la base real, configurar `HUB_TOKEN` y aplicar migraciones. El repositorio no incluye secretos ni modifica recursos Cloudflare de producción.

El alcance es pedidos para recoger y pago en sucursal. Validar con el negocio precios, opciones y catálogo inicial antes del lanzamiento comercial. No incluye pagos en línea, cuentas de clientes, inventario, delivery ni notificaciones externas.

Las instrucciones de ejecución y despliegue están en [README.md](README.md).

## Validación de esta entrega

- 32 pruebas de catálogo y API contra SQLite: aprobadas.
- 19 escenarios de navegador sobre Pages Functions y D1 local: aprobados, incluidos estados completos, separación de sucursales/estaciones, permisos, móvil, recargas y recuperación sin pedidos duplicados.
- Build de producción Vite y compilación de Pages Functions: aprobados.
- Migraciones nuevas y conservación de pedidos del esquema original: verificadas.
- Auditoría npm: cero vulnerabilidades.
