# Gunter Android — candidato de aplicación para clientes

Estado de revisión: 2026-10-25. Entrega solicitada: APK instalable directamente.

**Hay un APK preview; no es una release aprobada para clientes.** El código incorpora una
vista de la aplicación completa y conserva las capacidades del acompañante
nativo. Faltan servidor HTTPS accesible, firma de distribución, integración
de algunas funciones y aceptación en teléfonos reales. No confundir un test
unitario, una captura de viewport móvil o un workflow escrito con esas pruebas.

## Alcance e identidad

- Cliente conectado al despliegue HTTPS existente de Gunter; no instala Node,
  modelos Windows, WhatsApp/Baileys ni un servidor en el teléfono.
- Reutiliza las páginas web de conversación, Día, tareas, agenda, reuniones,
  documentos, resultados, conexiones y configuración. Su disponibilidad real
  sigue dependiendo de la cuenta, permisos, proveedores y backend configurados.
- La interfaz nativa es deliberadamente secundaria: Atrás, Inicio, Dispositivo
  y Navegador. El icono adapta el SVG óptico ya existente de Gunter, sin usar
  las referencias visuales ni los vídeos como fondos o capas.
- Debug se instala como `com.gunter.mobile.preview`, «Gunter · Pruebas», versión
  `0.2.0-preview`. No sustituye la instalación `com.gunter.mobile` ni sus datos.
- Release fija un único origen HTTPS de confianza y no permite cambiarlo desde
  la pantalla. El origen de clientes aún no ha sido suministrado.
- El puerto 3013 del laboratorio visual **no es** el servidor de la aplicación.
  `localhost` o `127.0.0.1` en un teléfono designan ese teléfono, no el PC.

## Sin dominio propio

No es necesario comprar un dominio para preparar el APK: un proveedor de
backend puede dar una dirección HTTPS propia, que se configura como origen.
GitHub conserva código y ejecuta la compilación, pero GitHub Pages sólo sirve
contenido estático; no ejecuta el servidor Node de Gunter, la IA ni WhatsApp.
No apuntar el cliente a una página de reserva de Pages como si fuera su API.
Referencia: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

La preview sin origen permite configurar explícitamente un HTTPS de pruebas.
Mientras no exista un servidor, no hay login/chat conectado. La pantalla
Dispositivo sigue permitiendo gestionar recordatorios exclusivamente locales;
no implica IA offline ni sincronización. No se publicó ni contrató hosting.

## Funciones y límites reales

| Función | Implementación del candidato | Pendiente antes de ofrecerla a clientes |
|---|---|---|
| Chat, tareas, agenda, ajustes y resultados | UI web compartida, sesión web y APIs del despliegue | Recorrer flujos con cuentas reales, aislamiento entre usuarios y reconexión |
| Voz y captura de reuniones | Permiso Android de micrófono a demanda, sólo audio y origen configurado | Captura/STT/TTS reales, interrupciones, reproducción y recuperación en dispositivo; no se ofrece escucha permanente ni IA offline móvil |
| Adjuntar documentos, audio o imágenes | Selector Android de documentos, sin acceso global al almacenamiento | MIME/tamaño, proveedores de archivos y recreación de Activity en teléfono; cámara WebRTC no implementada |
| Guardar archivos HTTPS | Confirmación, selector de destino, sesión same-origin, límite 50 MiB | Descargas autenticadas/reconexión/rotación en dispositivo; un fallo puede dejar un archivo vacío o parcial, se avisa y no se borra automáticamente |
| Exportaciones `blob:`/`data:` | Hook temprano de Blob/anchors, protocolo exclusivo de exportación, origen exacto/frame principal, confirmación y selector de destino; límite 50 MiB y backpressure | Requiere proveedor WebView con WEB_MESSAGE_LISTENER y DOCUMENT_START_SCRIPT. Validar archivos reales, cancelación, rotación y proveedores de documentos en teléfono; hay fallback explícito si no se captura |
| Abrir aplicaciones, archivos o borradores SMS | Intent explícito; SMS nunca se envía directamente | Android puede impedir aperturas en segundo plano. Se informa dispatch, no efecto verificado; backend no marca éxito ni repite automáticamente |
| Multimedia | Observación posterior acotada del estado/pista, además del permiso del listener | Sesiones reales de reproductores y rechazo de permisos; no se inventa una confirmación si no se observa |
| Alarmas locales | Crear, consultar, editar y cancelar desde Dispositivo; persistencia privada con relectura, versión y mutationId, cancelación real de alarma/notificación; recuperación tras arranque/reanudación | Entrega con Doze, reinicio, canales y revocación. La lista no confirma entrega. No hay sincronización con jobs del servidor ni historial de registros retirados |
| Push FCM | Opt-in y configuración distinta por paquete debug/release | Firebase de app y servidor, token real, permisos y entrega. Los avisos no contienen el comando ni eluden los límites de Android |
| Google Calendar/OAuth | No intenta GIS dentro del WebView; explica cómo usar el navegador | Falta flujo OAuth nativo con retorno seguro a la app. La sesión del navegador es independiente: conectarlo allí no transfiere tokens al WebView |
| WhatsApp y otros conectores | Se usan las integraciones del servidor desde la UI compartida | Configuración y pruebas end-to-end del conector; el APK no crea por sí solo un bot de WhatsApp ni una conexión nueva |
| Datos entre dispositivos/offline | Conserva los stores web por origen, sin migrar datos existentes | Sync general, conflictos, backups y motores offline móviles siguen pendientes según las ADR existentes |

Tras autorizar micrófono, antes de adjuntar o descargar se pide guardar la
grabación/edición y confirmar una recarga para cerrar ese contexto, y después
repetir la acción. Al pausar se destruye el contexto que recibió permiso de
audio, evitando dejar captura en segundo plano. Es una limitación conservadora
del candidato, **no una experiencia de voz final ya aceptada**.

La vinculación nativa y la sesión web son almacenes separados. Vincular un nodo
no inicia sesión web ni copia cookies. Deben corresponder a la cuenta adecuada;
no se amplían los permisos o la autonomía por instalar el APK.

## Barreras de seguridad implementadas

Esquema/host/puerto exactos, sin credenciales incrustadas, orígenes ambiguos ni
HTTP; errores TLS cancelados; cookies de terceros desactivadas; accesos
`file:`/`content:` del motor web desactivados; sin `addJavascriptInterface` ni
puente genérico de ejecución. Los enlaces externos necesitan gesto y
confirmación. El selector sólo devuelve documentos elegidos explícitamente.
El nuevo puente WebKit acepta únicamente mensajes de exportación validados;
no expone archivos, credenciales, ejecución ni métodos Android arbitrarios.
La caché temporal propia se elimina al cancelar/terminar normalmente; una
muerte abrupta del proceso puede dejar un temporal privado hasta su evicción.

El permiso web concede exclusivamente `AUDIO_CAPTURE`, después del permiso
Android; no concede automáticamente todos los recursos pedidos. Las
credenciales del nodo permanecen en Android Keystore y sus llamadas no siguen
redirecciones. Un vínculo antiguo a otro servidor exige revincularlo, sin borrar
sus datos silenciosamente. Un fallo al reportar una acción no reejecuta el
efecto ni reemplaza su evidencia con un segundo resultado ficticio; se muestra
que hay que revisar Actividad. Detener el servicio también detiene el resto del
lote, no sólo la siguiente consulta.

Referencias de implementación: [carga segura de URI](https://developer.android.com/privacy-and-security/risks/unsafe-uri-loading),
[permisos WebView](https://developer.android.com/reference/android/webkit/PermissionRequest),
[ajustes de acceso a archivos](https://developer.android.com/reference/android/webkit/WebSettings)
y [política OAuth de Google](https://developers.google.com/identity/protocols/oauth2/policies).

## Preparar y comprobar un build

Con JDK 17, Gradle 8.9 y SDK 35/build-tools 35.0.0 instalados:

```powershell
# Desde la raíz de gunter-app. No usar el puerto del laboratorio como origen.
npm run test:android-client
gradle -p gunter-mobile/android --no-daemon :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
node gunter-mobile/scripts/report-android-apk.cjs debug
```

Debug sin origen compilado ofrece una entrada HTTPS de pruebas explícita.
Cambiar el origen no traslada los datos o sesiones del origen anterior. El
workflow `mobile-build.yml` prepara el SDK y ejecuta tests/lint/build en CI,
y fue subido a `codex/android-client-candidate` con autorización del usuario.
El primer intento (901f9b1) compiló Android pero falló lint por un atributo API27
con minSdk26; se eliminó el atributo sin omitir lint. La ejecución
[40233475226](https://github.com/ARXperience/gunter-app/actions/runs/40233475226)
del commit `8b88a9e` pasó tests, lint y assembleDebug, incluyendo el diálogo y
el exportador reales. También pasó el build de simulador iOS; no es QA física.

Para release, el propietario debe aportar por entorno/gestor de secretos:

- `GUNTER_WEB_ORIGIN`: origen HTTPS real, sin ruta, usuario, contraseña, query
  ni fragmento. No se inventa un dominio ni se publica la app automáticamente.
- `GUNTER_RELEASE_STORE_FILE`: ruta absoluta de un keystore existente **fuera
  del repositorio**; `GUNTER_RELEASE_STORE_PASSWORD`, `GUNTER_RELEASE_KEY_ALIAS`
  y `GUNTER_RELEASE_KEY_PASSWORD`. No pegarlos en el chat ni incluirlos en Git.
- Si se ofrecen avisos: configuración Firebase para `com.gunter.mobile` en
  `android/app/src/release/google-services.json`, y configuración de envío
  del servidor. `GUNTER_REQUIRE_PUSH=true` bloquea release si falta la parte
  Android; no certifica entrega del servidor. Preview requiere su propio
  archivo para `com.gunter.mobile.preview` en `src/debug/`.

Después: `:app:assembleRelease`, reporte `release`, verificación del APK con
`apksigner verify --verbose --print-certs` y comparación con la identidad de
firma esperada por el propietario. El reporte sólo identifica un artefacto,
tamaño y SHA-256: **no acredita firma, instalación ni aceptación**. La misma
clave y un `versionCode` creciente son necesarios para las actualizaciones.
No se generó ni eligió una clave de distribución en este trabajo. La firma
debug de Actions puede cambiar entre builds; no asumir actualización in situ
de la preview ni desinstalarla con datos importantes sin revisar su respaldo.

## Aceptación pendiente y rollback

Antes de distribuir: instalación limpia y actualización conservando datos;
login/logout/cambio de cuenta; tareas, agenda y recordatorios; chat y voz;
reunión con interrupciones; documentos y descargas; permisos denegados y
revocados; rotación, cierre y reinicio; red lenta/sin conexión; recuperación de
sesión; FCM con teléfono bloqueado; batería/temperatura/memoria; TLS inválido,
links externos y verificación de acciones sin duplicados. Al menos un teléfono
de gama baja y uno de gama media, con versiones Android compatibles.

También hay que cerrar los gaps de la tabla, privacidad/avisos de distribución,
inventario de dependencias/licencias y procedimiento de actualización antes de
llamarla versión final. No se redistribuyen modelos ni binarios Windows.

Rollback del candidato: no instalar la preview o desinstalar sólo
`com.gunter.mobile.preview` (elimina únicamente sus datos locales). La web,
backend y acompañante original se conservan; no se hizo migración ni borrado de
datos productivos. Los cambios se suben sólo a la rama candidata autorizada,
sin fusionar main, desplegar backend ni cambiar la cuarentena del laboratorio bio.

## Evidencia de esta revisión

Los comandos Node para contratos Android, restricción OAuth, reporte de APK,
runtime móvil, push simulado, Control Plane y UI se ejecutan sin teléfono ni
proveedores reales. Los tests JVM de políticas/recordatorios usan adaptadores
inyectados, no AlarmManager ni Firebase de un dispositivo.

Resultado local: 55 tests JVM (51 políticas/recordatorios y 4 protocolo de
exportación), 10 contratos Android, 12 aserciones OAuth, 8 tests de políticas
de recordatorios móviles más 2 de aislamiento de confirmaciones,
5 contratos fuente de su diálogo, 7 tests del script
de exportación en VM, 8 del reporte APK, 52 del asistente, 4 del runtime móvil
y 34 del Control Plane. No son pruebas de proveedores ni dispositivos.
Los JVM se compilaron con Kotlin 2.0.21 y stdlib cacheada 1.9.23; `android.jar`
36.1 sólo resuelve tipos del adaptador que no se ejecuta. No se cambió el SDK
35 requerido por el APK para obtener ese resultado.

El typecheck de las seis fuentes exactas del shell/exportador también pasó,
con AndroidX WebKit 1.12.1 oficial verificado, ese `android.jar` y tres stubs
**explícitos** de BuildConfig/MainActivity/recuperación
de alarmas. Encontró y permitió corregir un conflicto Kotlin entre la propiedad
`overlay` y `ViewGroup.overlay`. Quedaron cuatro avisos de deprecación de insets.
No valida el resto de clases, recursos, manifest, Gradle DSL ni runtime Android.
Los informes contienen hashes de fuentes y artefactos de estas pruebas:

- `gunter-mobile/android/app/build/policy-jvm-tests/report.json`
- `output/android-shell-typecheck/report.json`

Los scripts `gunter-mobile/scripts/test-android-policies.ps1` y
`typecheck-android-shell.ps1` reciben `-JavaHome` y `-AndroidJar` del toolchain
oficial cacheado y permiten repetir esos checks sin Gradle ni red. Son una
alternativa diagnóstica, no una vía de empaquetado de distribución.

El bloqueo Java NIO/IPC de Gradle Windows se reprodujo y su prueba mínima se
resolvió igualando el orden de argumentos JVM de Gradle 8.9, sin cambiar el SO.
`invoke-android-gradle-local.ps1` permite repetir ese modo acotado. No sustituye
el build: falta SDK35 local y la configuración Android offline agotó su plazo.
La descarga anterior de herramientas SDK quedó incompleta, no se ejecutó ni
se aceptaron licencias nuevas. La vía de empaquetado usada es Actions en Linux.
Queda pendiente la validación física y la aceptación de los gaps de la tabla.

## Artefacto preview comprobado

Actions generó y se descargó `app-debug.apk` del commit `8b88a9e`:
4.248.919 bytes, SHA-256
`6bd8ea1b5d3e198541370f20b3037a9583307cf48823a7ce37a6c8be7ffa4a23`.
El hash local coincide con el informe de CI. `apksigner` oficial 36.0.0 verificó
la firma v2 y el certificado **Android Debug**, no una identidad de distribución.
`aapt2` confirmó `com.gunter.mobile.preview`, versión `0.2.0-preview`, minSdk26,
target/compile35 y launcher `GunterWebActivity`. No se instaló en un teléfono.

La verificación de firma local complementa el reporte descargado, que conserva
honestamente `signatureVerified:false` porque ese script no ejecuta apksigner.
No se alteró el reporte ni se atribuyó una firma de clientes a la preview.
