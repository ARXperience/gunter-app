# Gunter Android — candidato de aplicación para clientes

Estado de revisión: 2026-10-25. Entrega solicitada: APK instalable directamente.

**Hay un APK preview; no es una release aprobada para clientes.** El código incorpora una
vista de la aplicación completa y conserva las capacidades del acompañante
nativo. Faltan servidor HTTPS para clientes, firma de distribución, integración
de algunas funciones y aceptación en teléfonos reales. No confundir un test
unitario, una captura de viewport móvil o un workflow escrito con esas pruebas.

## Alcance e identidad

- Cliente conectable a un despliegue HTTPS de Gunter; no instala Node,
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
  `localhost` o `127.0.0.1` en un teléfono designan ese teléfono, no el PC;
  el modo USB de pruebas crea explícitamente ese enlace.

## Sin dominio propio

No es necesario comprar un dominio para preparar el APK: un proveedor de
backend puede dar una dirección HTTPS propia, que se configura como origen.
GitHub conserva código y ejecuta la compilación, pero GitHub Pages sólo sirve
contenido estático; no ejecuta el servidor Node de Gunter, la IA ni WhatsApp.
No apuntar el cliente a una página de reserva de Pages como si fuera su API.
Referencia: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

El propietario eligió **su PC sólo para pruebas**. La preview DEBUG sin origen
compilado permite configurar explícitamente `http://127.0.0.1:3002` y enlazarlo
por USB a una instancia del PC con datos independientes. Guía y límites en
[ANDROID_PC_TEST.md](ANDROID_PC_TEST.md). No se inicia el servidor ni ADB sin
la acción explícita del usuario; no se publicó ni contrató hosting. Release
sigue exigiendo HTTPS. Mientras el backend no esté activo y enlazado, no hay
login/chat conectado. La pantalla
Dispositivo sigue permitiendo gestionar recordatorios exclusivamente locales;
no implica IA offline ni sincronización.

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
| Push FCM | Auto-inicialización y Analytics desactivados de entrada; opt-in y configuración distinta por paquete debug/release, callbacks tardíos comprueban vínculo/permiso actuales | Firebase de app y servidor, token real, permisos y entrega. Los avisos no contienen el comando ni eluden los límites de Android |
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

Esquema/host/puerto exactos, sin credenciales incrustadas ni orígenes ambiguos;
release no admite HTTP. La única excepción DEBUG manual es el literal
`127.0.0.1` con puerto explícito 1024–65535 excepto 3013. La configuración de red
Android limita cleartext al host, no al puerto; los redirects de subrecursos
WebView no tienen todos un callback. No se certifica aislamiento entre puertos
loopback y se usa sólo el servidor de prueba de confianza (ver la guía USB).
Errores TLS cancelados; cookies de terceros desactivadas; accesos
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

Debug sin origen compilado ofrece una entrada HTTPS de pruebas explícita o
el modo loopback USB documentado.
Cambiar el origen no traslada los datos o sesiones del origen anterior. El
workflow `mobile-build.yml` prepara el SDK y ejecuta tests/lint/build en CI,
y fue subido a `codex/android-client-candidate` con autorización del usuario.
El primer intento (901f9b1) compiló Android pero falló lint por un atributo API27
con minSdk26; se eliminó el atributo sin omitir lint. La ejecución
[40259428386](https://github.com/ARXperience/gunter-app/actions/runs/40259428386)
del commit `7c5c84b` pasó tests, lint y assembleDebug, incluyendo el diálogo,
exportador, modo USB y reglas de privacidad. Lint no tiene errores, pero conserva
53 advertencias (dependencias/target, internacionalización y uso deliberado de
JavaScript, entre otras); no se ocultaron. La preview se compila sin origen fijo
para configurar manualmente el PC. También pasó el build de simulador iOS; no es QA física.

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

Resultado local: 59 tests JVM (55 políticas/recordatorios y 4 de protocolo de
exportación, incluidos cuatro nuevos tests del modo loopback),
12 contratos Android, 12 aserciones OAuth, 8 tests de políticas
de recordatorios móviles más 2 de aislamiento de confirmaciones,
5 contratos fuente de su diálogo, 8 tests del script
de exportación en VM, 2 del arranque aislado, 8 guardas del helper USB,
8 del reporte APK, 53 del asistente, 4 del runtime móvil
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

Actions generó y se descargó `app-debug.apk` del commit `7c5c84b`:
4.250.957 bytes, SHA-256
`b705c531ef130663701e5408b0ef3a93e010c116a51f81f7a709176fc55bbe45`.
El hash local coincide con el informe de CI. `apksigner` oficial 36.0.0 verificó
la firma v2 y el certificado **Android Debug**, no una identidad de distribución.
`aapt2` confirmó `com.gunter.mobile.preview`, versión `0.2.0-preview`, minSdk26,
target/compile35 y launcher `GunterWebActivity`. No se instaló en un teléfono.
Ubicación local: `output/android-client-7c5c84b/android/app/build/outputs/apk/debug/app-debug.apk`.
El siguiente teléfono elegido es un OPPO Reno11; falta confirmar su Android
instalado. No se ejecutó ADB ni el backend de pruebas ni se concedieron permisos.

La verificación de firma local complementa el reporte descargado, que conserva
honestamente `signatureVerified:false` porque ese script no ejecuta apksigner.
No se alteró el reporte ni se atribuyó una firma de clientes a la preview.

El control general web es independiente del build Android: `npm test` pasó en
Actions. Se corrigieron fixtures obsoletos y se añadió diagnóstico técnico sin
textos de sesión. Se acotaron esperas opcionales de ubicación, tareas/agenda y
modelo sin saltar el registro de entrada ni la comprobación de cuenta/sesión;
los 24 tests locales de presencia pasan. El recorrido de `c1ac669` ya superó la
bienvenida sin el bloqueo prolongado, pero encontró después una captura oculta:
la UI actual requiere entrar desde Inicio a Captura rápida. Se actualizó la
prueba para recorrer esos enlaces visibles, sin forzar CSS ni omitir aserciones;
el recorrido completo pasó después en
[40259939307](https://github.com/ARXperience/gunter-app/actions/runs/40259939307),
commit `c30b9b8`: registro/login, bienvenida, creación/persistencia/finalización
de tarea, ajustes híbridos y preferencias con confirmación de voz, reingreso,
cancelación de respuesta tardía y navegación de captura en viewport móvil sin
overflow horizontal. También pasaron `npm test` y `npm audit --omit=dev` con
instalación limpia del lockfile parcheado. No sustituye WebView ni dispositivo
físico; la prueba usa el fallback honesto al no disponer de GPU admitida.

Se corrigió además una colisión del catálogo: una orden exacta de «saludo al
entrar» cambiaba el ajuste distinto de «bienvenida por voz». Ahora conserva la
preferencia de voz independiente y, si se dicta, exige confirmación escrita.
La nueva regresión prueba la detección con el catálogo activo y la relectura
del valor guardado.

Auditoría de dependencias del servidor: el lockfile actualiza sólo
`follow-redirects` de 1.16.0 a 1.16.1, dentro del rango existente de Axios. El
registro publicado confirma tarball e integridad; la auditoría de producción
sobre ese lockfile informa 0 avisos conocidos. No implica ausencia de todos los
riesgos ni actualiza por sí sola un `node_modules` existente: sigue la guía PC
antes de iniciar la prueba. Referencias:
[aviso de cabeceras array](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8),
[aviso de cabeceras sensibles](https://github.com/advisories/GHSA-8r9p-f939-6h3c).

Revisión posterior de seguridad: reglas explícitas excluyen datos privados tanto
del backup como de la transferencia Android entre dispositivos. No hay migración
automática de credenciales, sesiones, WebView o recordatorios; una reinstalación
necesita respaldo/exportación voluntaria y nueva vinculación. El exportador
comprueba las dos capacidades opcionales de WebKit también al responder/retirar
su script. Referencia: [reglas de backup Android](https://developer.android.com/identity/data/autobackup).

El núcleo pide `failIfMajorPerformanceCaveat:true` antes de compilar shaders. Si
el navegador rechaza ese contexto, mantiene el fallback explícito y las funciones
de Gunter, sin reintentar silenciosamente un camino 3D lento. No baja el detalle
en hardware admitido ni acredita fluidez física. También rechaza drivers CPU
conocidos cuando el navegador los identifica; no guarda ni publica el nombre
del driver y no evade el bloqueo de esa información por privacidad. Referencia:
[atributos WebGL de Khronos](https://registry.khronos.org/webgl/specs/latest/1.0/#WEBGLCONTEXTATTRIBUTES).
Los 70 contratos GPU y 50 del wrapper pasan en VM; no ejecutan shaders reales
ni certifican el aspecto, detalle de formas o fluidez en el teléfono.
