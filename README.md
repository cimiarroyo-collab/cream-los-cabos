# Cream Los Cabos

MVP de pedidos con la identidad visual oficial de Cream Café Los Cabos, para las sucursales **Palmilla** y **Ánima Village**. React + Vite, API en Cloudflare Pages Functions y pedidos persistidos en Cloudflare D1. No utiliza Netlify.

- **Cream Club · `/club`**: portada con cuatro favoritos, menú por categorías y secciones de hasta seis productos por página, búsqueda en toda la carta, fotografías por producto, opciones y notas, carrito editable, selección de sucursal, envío y seguimiento privado del pedido.
- **Cream Hub · `/hub`**: acceso del equipo, pedidos sincronizados, filtros de sucursal y estación (Barra, Cocina, Panadería), búsqueda, indicadores y entregados recientes.
- **Cream Club**: tarjeta persistida en D1, perfil editable, QR e historial privado. Los beneficios se definirán posteriormente; no se anuncian puntos ni canjes.
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

La publicación existente utiliza el Worker **cream-los-cabos-preview** y su D1 del mismo nombre. Para actualizarla conservando sus pedidos y protecciones se preparó [worker/README.md](worker/README.md) y `scripts/update-existing-worker.mjs`. Ese actualizador verifica recursos y esquema existentes, conserva secretos y variables, exporta D1 antes de migrar y guarda la versión anterior. Reutiliza las Pages Functions del repositorio; no crea otra cuenta ni otra base.

La publicación inicial nueva en Pages utiliza una D1 nueva en la cuenta actual. El bootstrap conserva el Worker y su D1 existentes y rechaza un proyecto Pages o una D1 llamados `cream-los-cabos` que ya existan; no importa ni transfiere sus datos.

### Primera publicación con entrega privada del código

Configurar únicamente `CLOUDFLARE_API_TOKEN` (Pages Edit + D1 Edit, limitado a la cuenta de destino) y `CLOUDFLARE_ACCOUNT_ID` como secretos de GitHub. Ejecutar **Bootstrap fresh Cream Pages and private Hub access** en `main`, con el identificador de cuenta esperado, una clave pública RSA de al menos 3072 bits en PEM codificado en base64 y, opcionalmente, el SHA completo esperado. Generar y conservar la clave privada fuera del repositorio y de GitHub Actions.

Antes de modificar Cloudflare, el workflow verifica que el destino sea nuevo, genera un código de 256 bits, lo cifra mediante RSA-OAEP/SHA-256 y sube exclusivamente `initial-hub-access.sealed.json` al artifact `cream-initial-hub-access-<run>-<attempt>` (caduca a los siete días). El ciphertext vincula cuenta, proyecto, repositorio, commit, ejecución, intento y huella de la clave. El código se enmascara y pasa entre pasos sólo mediante `GITHUB_ENV`; no se publica en logs, outputs ni artifacts. Si falla la subida del archivo cifrado, el despliegue no comienza. Después publica Pages/D1 y verifica el recorrido público; el segundo artifact contiene sólo el resultado no secreto.

Descargar el artifact cifrado y descifrarlo localmente, contrastando los valores con la cuenta, el commit, la ejecución de Actions y la huella SHA-256 SPKI de la clave pública original. No tomar esos valores del archivo descargado como única fuente de confianza:

```bash
node scripts/unseal-hub-access.mjs \
  --sealed /ruta/initial-hub-access.sealed.json \
  --private-key /ruta/clave-privada.pem \
  --out /ruta/directorio-privado/hub-code.txt \
  --account CUENTA_ESPERADA --repository OWNER/REPO \
  --commit SHA_COMPLETO --run RUN_ID --attempt INTENTO \
  --fingerprint HUELLA_SHA256_SPKI
```

El descifrador no imprime el código: lo escribe en un archivo nuevo de permisos `0600`, dentro de un directorio `0700`, y rechaza sobrescrituras. Conservar la clave privada y el código en almacenamiento privado. El bootstrap no añade `HUB_TOKEN` a los secretos del repositorio: los despliegues posteriores mediante el workflow siguiente requieren configurar ese secreto con el mismo código recuperado; el bootstrap no sirve para rotarlo ni para repetir una publicación existente.

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

El catálogo común vive en `shared/catalog.js` y `shared/menu.js`: 254 productos únicos de la [carta oficial de Cream](https://www.creamcafeloscabos.com/cream-menu), consultada el 7 de octubre de 2026, más el croissant del prototipo. Incluye Desayunos, Comida, Café, Bebidas, Bar y Vinos. La portada presenta cuatro favoritos; elegir una categoría abre sus secciones y muestra hasta seis productos por página. La búsqueda sin acentos abarca la carta completa, independientemente de la sección elegida.

La carta pública no publica precios. Los 251 productos incorporados quedan con precio `null` y pueden pedirse con la advertencia **«Precio por confirmar en sucursal»** en menú, carrito, comprobante y Hub. Los cuatro productos originales conservan los precios y opciones del prototipo; deben validarse con operación antes del lanzamiento comercial. Las fotografías de ambiente proceden de la web oficial. Las fotografías del catálogo son referencias del plato o bebida descritos; no representan necesariamente la presentación exacta de Cream ni cada personalización. Se sirven desde archivos locales, con procedencia y créditos en `public/photos/`.

Si hay una línea sin precio, la API devuelve `total: null`, `pricingPending: true` y `knownTotal` con el subtotal de las líneas que sí tienen precio. Este subtotal no representa el total final. D1 conserva ese subtotal en la columna original `total` y los indicadores pendientes en las líneas del pedido; no requiere otra migración. Hub identifica los pedidos pendientes y los excluye de su indicador de total con precio. El equipo confirma el importe en sucursal antes del pago.

El servidor valida productos, opciones, cantidades, cliente y sucursal; calcula precios desde el catálogo e ignora precios o estados enviados por el navegador. El `requestId` evita pedidos duplicados al reintentar una solicitud. Los cambios de estado usan `expectedStatus` para detectar modificaciones concurrentes.

| Endpoint                           | Acceso                 | Resultado                                                                           |
| ---------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `POST /api/orders`                 | Cliente                | Crea el pedido; devuelve el pedido y `trackingToken` (201, o 200 en reintentos).    |
| `GET /api/orders/:id`              | Header `X-Order-Token` | Seguimiento de ese pedido.                                                          |
| `GET /api/orders?branch=...`       | Sesión Hub             | Pedidos activos y entregados de las últimas 24 horas, hasta 500; sucursal opcional. |
| `PATCH /api/orders/:id`            | Sesión Hub             | Avanza un paso con `{status, expectedStatus}`.                                      |
| `GET/POST/DELETE /api/hub/session` | Equipo                 | Consulta, abre con `{token}` o cierra sesión.                                       |
| `POST /api/members` | Cliente | Crea tarjeta con nombre, teléfono opcional, requestId y accessToken UUID privados. Reintentos idénticos no duplican la tarjeta. |
| `GET /api/members/:id` | Header `X-Member-Token` o sesión Hub | Perfil e historial de hasta 30 pedidos; contador de todos los entregados. |
| `PATCH /api/members/:id` | Header `X-Member-Token` | Actualiza nombre y teléfono; la sesión de empleados no puede modificar el perfil. |

Todas las respuestas de API son JSON y `no-store`. La lista del equipo no expone tokens de seguimiento. Club guarda en este navegador el carrito, los datos de recolección y hasta ocho comprobantes con su token privado; D1 es la fuente compartida de pedidos. Ambas interfaces consultan cambios cada cinco segundos mientras están visibles. Los pedidos antiguos se muestran en Hub sin perder sus líneas originales.

La tercera migración añade tarjetas y su asociación a pedidos sin alterar los pedidos existentes. D1 guarda sólo el hash SHA-256 del acceso privado a la tarjeta. Ese acceso se conserva en el navegador del cliente; el QR contiene únicamente un identificador público y abre una consulta que exige sesión Hub. Los pedidos asociados requieren `memberId` y `X-Member-Token`; el historial y el contador derivan de D1.

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

## Identidad y fotografías

El diseño utiliza los colores publicados en la [web oficial](https://www.creamcafeloscabos.com/index), su logo, el ave y fotografías del sitio, alojados en `public/brand/`. La procedencia y uso de cada recurso se detalla en [public/brand/SOURCES.md](public/brand/SOURCES.md). Los datos de sucursales viven en `shared/brand.js`. Se mantienen fuentes del sistema para evitar depender del kit tipográfico externo de la web.

Recursos ilustrativos iniciales conservados en el repositorio, alojados en `public/images/`, obtenidas de Unsplash: [café](https://images.unsplash.com/photo-1511081692775-05d0f180a065), [coffee](https://images.unsplash.com/photo-1509042239860-f550ce710b93), [bebidas](https://images.unsplash.com/photo-1622597467836-f3285f2131b8), [croissant](https://images.unsplash.com/photo-1555507036-ab1f4038808a) y [toast](https://images.unsplash.com/photo-1525351484163-7529414344d8). No dependen de servicios externos durante el uso de la app.

Los créditos del catálogo se publican también en `/photos/credits.html`. Las referencias generadas se identifican expresamente en la procedencia; no se presentan como fotografías reales del restaurante.

## Acceso público observado

El 8 de octubre de 2026, el entorno de trabajo recibió un rechazo **403 de Envoy durante CONNECT**, antes de establecer TLS con el host `workers.dev`. No recibió una respuesta del Worker ni un CF-Ray. Ese resultado no demuestra un bloqueo WAF de Cloudflare. En el repositorio no hay filtros de User-Agent, IP o país para GET `/club`; el guard de origen de las escrituras de API sigue activo.

El acceso local limpio a Club y los permisos privados de Hub se verifican en las pruebas. Para confirmar la publicación vigente y revisar su seguridad remota se necesita conexión autenticada a Cloudflare y un entorno autorizado para acceder al host. No se desactivaron WAF, Access ni protecciones, y no se afirma que el 403 remoto esté solucionado.
