# Android con el PC: prueba local por USB

Elección del propietario: PC sólo para pruebas, sin dominio ni nube. Esto es
para `Gunter · Pruebas` (`com.gunter.mobile.preview`), no para clientes. El PC
debe permanecer encendido y el teléfono conectado. No se ha instalado ni
probado todavía el APK en un teléfono real.

## 1. Preparar un backend de prueba independiente

Desde la raíz del repositorio, con Node y las dependencias ya instaladas:

El lockfile actualizado incorpora el parche `follow-redirects@1.16.1`. Una
instalación anterior de `node_modules` **no se actualiza al descargar código**:
antes de usar el backend de prueba, reinstala con `npm ci` en una ventana de
mantenimiento apropiada. No lo hagas mientras otro servidor del mismo checkout
esté en uso sin coordinarlo. Este trabajo no reinstaló sus dependencias ni
reinició esa instancia existente. Los helpers tampoco instalan paquetes.

```powershell
# Sólo verifica herramientas/puerto; no arranca nada.
pwsh -NoProfile -File .\gunter-mobile\scripts\start-android-pc-test.ps1

# Cuando quieras iniciar la prueba, en una terminal propia:
pwsh -NoProfile -File .\gunter-mobile\scripts\start-android-pc-test.ps1 -Start
```

El arranque explícito escucha sólo en `127.0.0.1:3002`. Usa datos privados
independientes en `data/android-pc-test/`, ignorados por Git: cuentas, sesiones,
Control Plane y WhatsApp no se toman de la instalación habitual. Si el puerto
está ocupado, se detiene sin cerrar ni reiniciar el proceso existente. No usa
el puerto 3013 del laboratorio visual ni cambia el servidor habitual de 3001.

El proceso puede cargar la configuración habitual de proveedores del servidor;
el script no copia claves al APK ni edita `.env`. Crea una cuenta **de prueba**
en esta instancia. Una respuesta de salud no acredita IA, voz, OAuth o WhatsApp:
cada proveedor sigue necesitando configuración y validación propias.

## 2. Autorizar la conexión USB en el teléfono

Instala manualmente el APK preview verificado. En Android, activa Opciones de
desarrollador → Depuración USB, conecta un cable de datos, desbloquea el
teléfono y acepta personalmente el aviso de confianza de este PC. No aceptes
una clave de un equipo desconocido. Necesitas Android SDK Platform-Tools ya
instalado en el PC; el helper no lo descarga ni concede permisos.

```powershell
# Comprueba ADB instalado y /api/health; no ejecuta ADB por defecto.
pwsh -NoProfile -File .\gunter-mobile\scripts\connect-android-pc-test.ps1

# Acción explícita, después de autorizar el teléfono y arrancar el servidor:
pwsh -NoProfile -File .\gunter-mobile\scripts\connect-android-pc-test.ps1 -Connect
```

`-Connect` usa ADB local y puede iniciar su daemon normal. Crea/verifica sólo
`tcp:3002 → tcp:3002` para el dispositivo elegido, sin reinstalar apps ni
alterar otros mapeos. Si hay varios dispositivos, exige `-Serial` explícito;
no imprime sus identificadores. Puedes indicar un `-AdbPath` existente. No se
abren puertos del firewall ni se crea un túnel público.

## 3. Abrir la preview

En la pantalla inicial de **Gunter · Pruebas**, introduce exactamente:

```text
http://127.0.0.1:3002
```

Sin el mapeo USB, esa dirección apunta al teléfono, no al PC. Sólo DEBUG, sin
origen compilado, acepta este HTTP literal con puerto explícito 1024–65535
(salvo 3013); no acepta IP LAN, `localhost`, alias DNS ni IPv6. Release y un
origen compilado siguen exigiendo HTTPS. Si cambias `-Port`, usa el mismo
valor en ambos scripts y en la app.

La política Android de cleartext se limita al host 127.0.0.1, no al puerto;
el shell aplica además el origen elegido a navegación, descargas, permisos y
puentes. El proveedor WebView no vuelve a notificar todos los redirects de
subrecursos: esta preview **no certifica aislamiento entre puertos loopback**
de un servidor que redirija recursos. Usa sólo esta instancia de confianza;
no la conviertas en un navegador de servidores arbitrarios.

Inicia sesión con tu cuenta de prueba. Para acciones nativas, vincula además
Dispositivo con el código generado por esa misma cuenta/servidor. La sesión web
y el vínculo del nodo son independientes; uno no inicia el otro.

## 4. Comprobar y terminar

Prueba login/logout, chat, tareas y agenda; después voz, adjuntos/exportaciones
y recordatorios con permisos aceptados y rechazados. Revisa rotación, pausa,
reinicio, pérdida del cable y reconexión. La fluidez/GPU, captura de audio,
alarmas con pantalla bloqueada y conectores requieren observación física: no
están acreditados por el build. Push FCM y OAuth nativo con retorno siguen
pendientes según [la matriz del candidato](ANDROID_CLIENT_RELEASE.md).

```powershell
# Retira únicamente el mapeo elegido; no detiene ADB ni el servidor.
pwsh -NoProfile -File .\gunter-mobile\scripts\connect-android-pc-test.ps1 -Disconnect
```

Después, Ctrl+C únicamente en la terminal del backend de prueba que abriste.
Los datos de prueba permanecen; no se borran automáticamente. Revoca la
depuración USB desde Android si ya no la necesitas. No desinstales una preview
con datos importantes sin respaldo: la clave debug de Actions puede cambiar
entre compilaciones y no permitir una actualización sobre la anterior.

Referencia: [ADB y autorización USB](https://developer.android.com/tools/adb).
