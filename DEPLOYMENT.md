# Despliegue de Gunter

No se necesita un dominio comprado: puede usarse el subdominio HTTPS de un
proveedor de servidor. GitHub sirve para código/CI/artefactos; Pages es estático
y no sustituye el backend Node, la IA ni los conectores. Antes de desplegar hay
que elegir el servicio, almacenamiento persistente y secretos; este trabajo no
contrata ni publica hosting. No usar el laboratorio visual ni una página de
reserva como API de clientes.

Elección actual: PC sólo para pruebas, sin contratar hosting. La preview Android
DEBUG permite una conexión loopback por USB y una instancia con datos de prueba
separados. Instrucciones en [ANDROID_PC_TEST.md](docs/ANDROID_PC_TEST.md). No
sustituye el despliegue HTTPS ni la firma/aceptación de la futura release.

1. Copia `.env.example` como `.env` y completa las variables necesarias sin publicar ese archivo.
2. Sirve la aplicación mediante HTTPS. Define `ALLOWED_ORIGINS` con el origen público exacto y activa `AUTH_COOKIE_SECURE=true`.
3. Si un proxy inverso termina TLS, define `TRUST_PROXY=true`; de lo contrario déjalo en `false`.
4. Ejecuta `npm ci`, `npm run preflight` y `npm test` antes del arranque.
5. Inicia el servicio con `npm start`. Mantén el directorio `data/` en almacenamiento privado y persistente; contiene usuarios, sesiones, nodos, trabajos y claves generadas localmente.

El backend actual usa JSON local y operaciones de lectura-modificación-escritura de un solo proceso; no escala de forma segura a varias réplicas. Mantén `GUNTER_REPLICAS=1`: `npm run preflight` detiene el despliegue si se declara más de una. La migración a una base compartida (PostgreSQL) debe cubrir cuentas, sesiones, trabajos, Control Plane y datos por usuario antes de habilitar réplicas; cambiar solo una tabla no elimina las carreras del resto del sistema.

El workflow `.github/workflows/mobile-build.yml` está preparado para ejecutar tests JVM, lint y compilación del APK Android preview, además de la app iOS para simulador, cuando se suben cambios móviles a GitHub. Si termina correctamente conserva artefactos durante 7 días. El APK preview (`com.gunter.mobile.preview`) lleva firma debug y no es una distribución para clientes. Tener el workflow escrito no demuestra que haya corrido ni generado un APK. La firma de distribución, integración de los gaps y pruebas reales siguen pendientes según [el estado del candidato Android](docs/ANDROID_CLIENT_RELEASE.md). Push requiere el `google-services.json` del paquete correcto y la configuración del servidor.

Para activar los avisos de comandos FCM en Android, registra `com.gunter.mobile` en Firebase, instala `google-services.json` en `gunter-mobile/android/app/` y configura `FCM_SERVICE_ACCOUNT_JSON` en el gestor de secretos del servidor. La cuenta de servicio debe tener solo el permiso necesario para enviar FCM HTTP v1.

Para APNs, crea una clave de autenticación APNs en Apple Developer y configura `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID=com.gunter.mobile` y `APNS_ENVIRONMENT` (`sandbox` para builds de desarrollo; `production` para distribución). Nunca incluyas la clave `.p8` en el cliente ni en el repositorio. Habilita Push Notifications para el App ID y usa un provisioning profile que incluya esa capacidad. Gunter registra el token APNs al conceder permiso, lo cifra en el servidor y permite desactivarlo desde el iPhone/iPad. El backend usa el provider indicado por el nodo y elimina tokens que Apple declara vencidos.

En producción define también `MOBILE_PUSH_ENCRYPTION_KEY` como una clave base64url aleatoria de 32 bytes en el gestor de secretos, separada de los datos persistentes. Los avisos pendientes quedan en un outbox durable y se reintentan con espera incremental; solo transportan un identificador opaco, no la instrucción ni sus datos. La ejecución sigue requiriendo que el móvil recoja el comando autenticado y aplique sus permisos/confirmaciones. APNs/FCM despiertan o notifican; no eluden los límites de ejecución en segundo plano impuestos por los sistemas operativos.

## Servicios que se activan por usuario

- Las alertas en segundo plano requieren HTTPS y permiso del navegador. Para un despliegue con varias réplicas, define las dos claves VAPID de forma idéntica en todas ellas.
- El nodo de PC se instala y empareja en el dispositivo del usuario. Su token no se envía a la interfaz web y sus permisos se pueden revocar desde Configuración.
- Las conversaciones personales de Instagram/Messenger requieren que el usuario mantenga Beeper Desktop instalado, conectado y emparejado con su nodo.
- Android incluye el proyecto nativo en `gunter-mobile/android/`: ábrelo con Android Studio, JDK 17 y SDK 35, y firma la variante `release`. iOS incluye fuentes SwiftUI y el manifiesto XcodeGen en `gunter-mobile/ios/`; genera o incorpora el proyecto en Xcode y fírmalo con el equipo de Apple. Cada permiso se solicita en el dispositivo. El workflow de CI verifica compilaciones sin firma, pero no sustituye las pruebas en dispositivos ni el proceso de firma.
- FCM para Android y APNs para iOS son opcionales y necesitan las credenciales de sus respectivos proveedores. Las compilaciones CI sin firma verifican el código, pero no acreditan que tokens, perfiles, permisos y entrega funcionen en dispositivos reales; completa esa verificación con builds firmados antes de habilitarlo para usuarios.
- Google Calendar y otros conectores OAuth se habilitan cuando sus credenciales se hayan configurado.
