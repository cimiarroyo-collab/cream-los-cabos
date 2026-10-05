# Cream Los Cabos

MVP de pedidos para las sucursales **Palmilla** y **Ánima Village**. React + Vite, API en Cloudflare Pages Functions y pedidos persistidos en Cloudflare D1. No utiliza Netlify.

- **Cream Club · `/club`**: menú por categoría y búsqueda, opciones y notas por producto, carrito editable, selección de sucursal, datos del cliente, envío y seguimiento privado del pedido.
- **Cream Hub · `/hub`**: acceso del equipo, pedidos sincronizados, filtros de sucursal y estación (Barra, Cocina, Panadería), búsqueda, indicadores y entregados recientes.
- **Flujo**: Nuevo → Confirmado → En preparación → Listo → Entregado. La separación por estación organiza la preparación; el estado corresponde al pedido completo.
- Pago al recoger; no se realiza ningún cobro en línea.

## Ejecutar el MVP completo

Requiere Node.js 24 y npm. El servidor de Pages sirve la aplicación construida y las Functions con una D1 local, sin cuenta de Cloudflare.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Establecer HUB_TOKEN en .dev.vars (mínimo 12 caracteres).
npm run db:migrate
npm run build
npm run pages:dev
```

Abrir `http://localhost:8788/club` y `/hub`. El código de acceso de Hub es el `HUB_TOKEN` configurado. `.dev.vars` y el estado de D1 local están excluidos de Git.

`npm run dev` sirve sólo el frontend para iterar su diseño. El envío de pedidos requiere Pages Functions; si la API no está disponible, el carrito se conserva y se muestra el error. Los pedidos nunca se simulan como enviados.

## Cloudflare Pages + D1

### Despliegue desde GitHub Actions

En el repositorio, abrir **Settings → Secrets and variables → Actions** y añadir tres secretos:

- `CLOUDFLARE_API_TOKEN`: token limitado a la cuenta de destino, con permisos **Account → Cloudflare Pages → Edit** y **Account → D1 → Edit**.
- `CLOUDFLARE_ACCOUNT_ID`: identificador de esa cuenta de Cloudflare.
- `HUB_TOKEN`: código privado del equipo, de al menos 12 caracteres. No reutilizar la clave de pruebas.

Ejecutar **Actions → Deploy Cream to Cloudflare → Run workflow** desde `main`. El workflow instala las dependencias fijadas, verifica pruebas y build, compila Functions y ejecuta `scripts/deploy-cloudflare.mjs` para preparar Pages/D1, aplicar migraciones, configurar el acceso del equipo y publicar. El resultado del despliegue muestra la URL pública. Se ejecuta únicamente de forma manual y desde `main`; los pushes siguen ejecutando las verificaciones de CI.

Esta configuración prepara el despliegue. La publicación real requiere los tres secretos y un workflow terminado correctamente.

### Configuración manual en Cloudflare

1. Crear una base D1 llamada `cream-los-cabos` y sustituir el identificador reservado de `wrangler.toml` por su UUID real.
2. Vincular el repositorio con un proyecto **Cloudflare Pages**: comando `npm run build`, directorio de salida `dist`, Node.js 24. `functions/` se despliega como Pages Functions; `_routes.json` limita su ejecución a `/api/*`. El resto conserva las rutas SPA de Club y Hub.
3. Configurar el binding D1 **DB** y el secreto **HUB_TOKEN** para producción. Para previews, utilizar una base y una clave separadas.
4. Aplicar las migraciones con `npm run db:migrate:remote` antes de habilitar pedidos. Si ya existe la tabla del prototipo, la migración inicial la conserva y la segunda añade los campos nuevos. No ejecutar `schema.sql` y después las migraciones sobre la misma base: `schema.sql` es una referencia del esquema final.

`HUB_TOKEN` no se incluye en el bundle. El acceso al Hub utiliza una cookie firmada de ocho horas, HttpOnly, SameSite=Strict y Secure en HTTPS. Rotar la clave invalida las sesiones. No existe clave predeterminada de producción.

## Datos y contrato

El catálogo común vive en `shared/catalog.js`. Conserva los cuatro productos y precios de la base original; sus opciones, textos y fotografías son material inicial que debe validarse con operación antes del lanzamiento comercial. Las fotos son ilustrativas, no fotografías de las sucursales ni de sus productos reales.

El servidor valida productos, opciones, cantidades, cliente y sucursal; calcula precios desde el catálogo e ignora precios o estados enviados por el navegador. El `requestId` evita pedidos duplicados al reintentar una solicitud. Los cambios de estado usan `expectedStatus` para detectar modificaciones concurrentes.

| Endpoint                           | Acceso                 | Resultado                                                                           |
| ---------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `POST /api/orders`                 | Cliente                | Crea el pedido; devuelve el pedido y `trackingToken` (201, o 200 en reintentos).    |
| `GET /api/orders/:id`              | Header `X-Order-Token` | Seguimiento de ese pedido.                                                          |
| `GET /api/orders?branch=...`       | Sesión Hub             | Pedidos activos y entregados de las últimas 24 horas, hasta 500; sucursal opcional. |
| `PATCH /api/orders/:id`            | Sesión Hub             | Avanza un paso con `{status, expectedStatus}`.                                      |
| `GET/POST/DELETE /api/hub/session` | Equipo                 | Consulta, abre con `{token}` o cierra sesión.                                       |

Todas las respuestas de API son JSON y `no-store`. La lista del equipo no expone tokens de seguimiento. Club guarda en este navegador el carrito, los datos de recolección y hasta ocho comprobantes con su token privado; D1 es la fuente compartida de pedidos. Ambas interfaces consultan cambios cada cinco segundos mientras están visibles. Los pedidos antiguos se muestran en Hub sin perder sus líneas originales.

## Verificación

```sh
npm run check                         # Pruebas SQLite/catálogo y build
npx wrangler pages functions build    # Compilación del Worker
```

Con el servidor Pages local activo y una D1 exclusiva de pruebas:

```sh
# Instalar Chromium si no está disponible en el sistema.
npx playwright install chromium
CREAM_HUB_TOKEN='tu-clave-local' npm run test:e2e
```

El navegador usa Chromium del sistema cuando existe; también acepta `CREAM_CHROMIUM_PATH` y `CREAM_E2E_URL`. Las pruebas de navegador crean pedidos reales en la base de destino: ejecutarlas sobre una base local/de pruebas, con una clave de equipo válida. GitHub Actions verifica pruebas, build, compilación de Functions y recorrido Club → Hub → Entregado sobre D1 local.

Ver [README-CREAM.md](README-CREAM.md) para el registro de alcance y validaciones del MVP.

## Fotografías

Imágenes ilustrativas alojadas en `public/images/`, obtenidas de Unsplash: [café](https://images.unsplash.com/photo-1511081692775-05d0f180a065), [coffee](https://images.unsplash.com/photo-1509042239860-f550ce710b93), [bebidas](https://images.unsplash.com/photo-1622597467836-f3285f2131b8), [croissant](https://images.unsplash.com/photo-1555507036-ab1f4038808a) y [toast](https://images.unsplash.com/photo-1525351484163-7529414344d8). No dependen de servicios externos durante el uso de la app.
