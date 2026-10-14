# Verificación del inicio orbital

## Alcance

Identidad y presentación, no modelos, datos, capacidades o Permission Gate. Se
conservan rutas, pestañas y GunterCompanion. Los assets anteriores no se eliminan;
una reversión de este commit restaura las referencias visuales sin migrar datos.

Scroll-craft aporta composición en capas, superficie viva, recomposición móvil y
verificación visual. Se respeta la petición explícita de una sola pantalla sin
scroll; no se incorpora un motor de scroll sin función.

## Evidencia focalizada

- Escritorio 1440×900: documento 1440×900, navegación anterior oculta únicamente
  en inicio, diez destinos, burbuja dentro del viewport, núcleo Canvas local.
- Móvil emulado 390×844 y 360×640: sin desplazamiento horizontal/vertical en inicio,
  las diez rutas permanecen visibles. Chat compacto: 332×550, x=14, y=78, bottom=628.
- Oscuro/claro y movimiento reducido: capturas revisadas. Canvas no disponible:
  fallback SVG local visible, rutas y chat siguen utilizables.
- Clics reales: Tareas, Conversaciones, regreso a Inicio, Escribir y Cerrar chat;
  chat en Configuración conserva sus controles y no crea otra conversación.
- Estado de habla: captura visual con playback simulado y luego restaurado; tests
  verifican que audio pendiente o eventos obsoletos no simulan reproducción real.
  No se sintetizó audio ni se probó calidad/latencia o micrófono en esta fase.
- Pruebas VM: orbit-home, core-renderer, abstract-core-identity. Sintaxis JavaScript,
  manifest JSON y diff sin errores. Smoke final único: 139 aprobadas, 0 fallos,
  con cuenta/datos/puerto temporales aislados de los usuarios reales.

## Correcciones durante QA

Estilos legacy imponían posición relativa al widget, título sobredimensionado y
transformaciones que reducían el chat a 6×3 px. El stylesheet final aislado restablece
posición fija, dimensiones reales y contraste. Chat minimizado queda invisible
también para navegación accesible. Las primeras comprobaciones se corrigieron con
las etiquetas y el estado persistido reales del chat, sin alterar su comportamiento.
Se versionan recursos y Service Worker para evitar bytes antiguos en caché.
El aro cian transitorio observado en Configuración era el efecto de clic ya
configurado por el usuario, no un elemento de la miniatura; se conserva su ajuste.

Las capturas locales quedan en output/playwright/gunter-orbit-*.png y
gunter-core-settings-chat.png. La cuenta QA y sus preferencias son temporales.
No se validaron dispositivos físicos ni la instalación nativa en esta fase.
