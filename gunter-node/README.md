# Gunter Node para PC

Este acompañante mantiene las acciones de escritorio y el token local de Beeper en el equipo del usuario. El servidor solo recibe heartbeats, resultados verificables y los mensajes que el usuario decidió integrar.

## Uso de desarrollo

1. En `Configuración > Centro de control de Gunter > Dispositivos activos`, crea un acceso de un solo uso.
2. Empareja este PC:

   `node gunter-node/cli.js pair --server http://127.0.0.1:3001 --token gp_... --name "Mi PC"`

3. Opcionalmente configura Beeper Desktop (debe permanecer abierto):

   `node gunter-node/cli.js beeper --token <token-local-de-beeper>`

4. Elige el alcance local. El modo inicial solo permite carpetas estándar y una lista segura de programas. Para permitir todas las rutas y ejecutables que Windows autorice para ese usuario:

   `node gunter-node/cli.js permissions --files all --programs all --yes`

   Para volver al modo limitado:

   `node gunter-node/cli.js permissions --files standard --programs standard`

5. Inicia el nodo:

   `node gunter-node/cli.js start`

   Para dejarlo residente y que Windows lo inicie al abrir sesión:

   `node gunter-node/cli.js install`

   Para eliminar solo el inicio automático:

   `node gunter-node/cli.js uninstall`

En una instalación remota se exige HTTPS. HTTP solo se admite para `localhost`, salvo que el desarrollador establezca explícitamente `GUNTER_NODE_ALLOW_INSECURE=1`.

Las credenciales se cifran con AES-256-GCM en `%APPDATA%/Gunter/Node`. Esta versión es el runtime funcional de desarrollo; el instalador firmado y el uso del almacén nativo de credenciales de Windows quedan como endurecimiento de distribución.

`install` crea una tarea de Windows para el usuario actual llamada `Gunter Node`. No concede permisos nuevos ni inicia la aplicación como administrador; el nodo conserva exactamente el alcance configurado con `permissions`.

El acceso `all` no evita las reglas de Windows: carpetas de otros usuarios, archivos del sistema protegidos y recursos que requieran elevación continuarán bloqueados si la cuenta local no tiene permiso. Gunter abre ejecutables directamente, sin concatenar comandos de shell.

## Capacidades del nodo

- Abrir y descubrir programas instalados.
- Listar, buscar y abrir archivos o carpetas dentro del alcance concedido.
- Reproducir o pausar, cambiar de pista, detener, silenciar y ajustar el volumen mediante las teclas multimedia de Windows.
- Inspeccionar nombres, tipos e identificadores de controles accesibles sin extraer el contenido escrito.
- Enfocar ventanas y controles accesibles.
- Pulsar botones y establecer texto en campos accesibles después de la confirmación del usuario.

Ejemplos de órdenes: `reproduce la música`, `siguiente canción`, `sube el volumen`, `qué botones hay en Paint`, `pulsa el botón Guardar en Bloc de notas` o `escribe "Hola" en el campo "Contenido" de Bloc de notas`.

La interacción usa Windows UI Automation y guarda objetivos semánticos —nombre, tipo e identificador— en las rutas aprendidas. No usa coordenadas de pantalla. Algunas aplicaciones, juegos o superficies dibujadas sin accesibilidad no exponen esos controles; en ese caso el nodo devuelve un error verificable. Gunter no escribe contraseñas, códigos de acceso, tokens, PIN u OTP, y nunca acepta scripts o comandos de terminal dentro de una orden remota.

## Enseñar una ruta de PC

1. Abre `Configuración > Datos y conexiones > Rutas aprendidas`.
2. Escribe el nombre de la rutina y selecciona **Enseñar ruta del PC**.
3. Elige si el paso debe pulsar, escribir o enfocar.
4. Pulsa **Capturar en 5 segundos**, cambia a la aplicación y mantén el cursor sobre el control.
5. Repite la captura para cada paso y guarda la ruta.
6. Usa **Simular** para comprobar todos los objetivos sin accionarlos; después podrás aprobar y ejecutar la rutina.

El texto de los pasos de escritura se solicita durante cada ejecución y no se almacena dentro de la ruta. Los pasos que pulsan o escriben vuelven a solicitar confirmación, aunque la rutina ya esté aprobada.
