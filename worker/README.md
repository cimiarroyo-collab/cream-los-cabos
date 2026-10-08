# Actualizar el Worker existente

La publicación vinculada a la cuenta de Cloudflare utiliza el Worker `cream-los-cabos-preview` y la D1 del mismo nombre. Este adaptador reutiliza íntegramente `functions/`: no cambia la arquitectura de API, el binding `DB` ni el despliegue principal preparado para Pages. No utilizar el workflow de Pages para actualizar esta publicación: podría crear otro proyecto y otra base.

`node scripts/update-existing-worker.mjs --prepare` construye el frontend, compila Pages Functions y comprueba el bundle del Worker con `versions upload --dry-run`, sin publicar ni consultar la cuenta. Deja un paquete revisable en `.cream-deploy/worker-*/`, ignorado por Git.

`node --use-env-proxy scripts/update-existing-worker.mjs --deploy` actualiza exclusivamente el Worker existente. Requiere estos valores en el entorno privado:

- `CLOUDFLARE_API_TOKEN`: token con permisos de edición de Workers Scripts y D1 en la cuenta vinculada.
- `CLOUDFLARE_ACCOUNT_ID`: identificador de esa cuenta.
- `CREAM_D1_DATABASE_ID`: UUID de la D1 que ya contiene los pedidos.

No se necesita ni se imprime la clave `HUB_TOKEN`: se verifica que el secreto ya existe y Wrangler lo conserva. También conserva variables existentes. El script exige un repositorio sin cambios pendientes, verifica la base y el binding remoto, rechaza recursos ajenos, ejecuta pruebas/build, exporta D1 antes de migrar y aplica únicamente migraciones aditivas pendientes. Sube una versión con `versions upload --strict --keep-vars` y activa exclusivamente esa versión de código/assets con `versions deploy`, verificando que Cloudflare le asignó el 100% del tráfico. No crea Workers, cuentas ni bases. No cambia WAF, Access, dominios, rutas o protecciones. Los `_headers` del frontend viajan con los assets; las peticiones API conservan URL, cookies, headers y Origin originales al entrar en Pages Functions.

Cada actualización conserva `previous-deployment.json`, `database-before.sql` y la configuración en su carpeta privada. El export contiene datos de clientes: mantenerlo fuera del repositorio y de enlaces públicos. La publicación no se declara verificada hasta comprobar Club sin sesión y el flujo de pedidos desde un entorno autorizado.

## Recuperación

La versión anterior al 100% queda registrada en `previous-deployment.json`. Ante un problema de código, desde la carpeta de preparación se puede volver a esa versión con `wrangler versions deploy <version_id>@100% --config wrangler.json --yes`; conservar la misma cuenta y autorización. La versión anterior incluye sus assets, y este comando conserva la configuración de rutas. No restaurar automáticamente el export D1: borraría pedidos recibidos después de la copia. Las tres migraciones son aditivas, y el código anterior tolera la nueva tabla `club_members` y la columna nullable `orders.member_id`, por lo que una recuperación de código puede conservar la base actual.

La configuración de ejemplo contiene un UUID reservado. El script solo sustituye ese UUID en el paquete privado tras verificar el destino; nunca publica el ejemplo directamente.
