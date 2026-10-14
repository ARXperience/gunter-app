# Verificación de espacios orbitales

## Alcance y fuente

Se aplicó la composición del ZIP Stitch proporcionado y la gramática Live surface
de Scroll-craft al producto existente. Se conservan las rutas, IDs, formularios,
controladores, datos, modelos y Permission Gate. No hay métricas ficticias del ZIP,
otra base de datos, permisos nuevos ni cambios en captura/síntesis de voz.

La navegación global pasa a cabecera horizontal y menú móvil; cada herramienta
abre su espacio enfocado. Inicio conserva su mapa y pantalla única sin scroll.
Los espacios operativos mantienen scroll nativo: no se añade un motor de scroll
ni pinning decorativo a formularios y listas. El chat y los controles son los
existentes, no una demostración visual ni un segundo sistema conversacional.

## Comprobaciones realizadas

- 17 grupos en `test/orbital-workspaces.js`: resolución de vistas y pestañas,
  controles originales, 10 páginas con estilos finales, disclosure móvil, límites
  del dock, foco/disabled/hidden, privacidad de la capa visual, efectos de clic,
  preferencias de movimiento y contraste AA de los tokens claros/oscuros.
- `test/ui-contracts.js` aprobado. Se corrigieron tres expectativas obsoletas:
  ya existían nueve pestañas y el núcleo anterior había reemplazado la mascota.
- Sintaxis de los cuatro JavaScript modificados y diff sin errores.
- Un único smoke general con datos/cuenta/puerto temporales: 139 aprobadas,
  cero fallos. No benchmark, generación de audio ni regresión de modelos.
- Navegador real: 12 destinos × 2 tamaños (1440×1000 y 390×844), sin
  desbordamiento horizontal. Tareas, agenda, recordatorios, conversaciones,
  actividad, reuniones, preparación, sala, resultados, IA, datos y administración.
- Las nueve pestañas de Configuración abren su panel y actualizan aria-selected,
  sin cambiar preferencias sensibles. Acceso anónimo con formulario etiquetado
  conserva inputs/submit y cabe en 390px; también se capturó en escritorio.
- 360×640: Menú → Agenda, cierre tras navegación y por Escape, dock dentro de
  pantalla, Escribir → chat existente → Cerrar, alternancia clara/oscura.
- Captura rápida → chat original visible: una tarea de QA creada/verificada por
  el pipeline existente. No acciones sobre cuentas ni datos de usuarios reales.
- Formulario de reunión: campo requerido, selector de audio y botón de inicio
  deshabilitado antes de completar su contexto. No se abrió el micrófono.
- Inicio final: scrollHeight igual a innerHeight y scrollWidth igual a innerWidth
  en 1440×1000 y 390×844. Se conserva el núcleo, no el pingüino.

## Hallazgos corregidos durante QA

Reglas legacy estrechaban los paneles, ocultaban el summary móvil y convertían el
dock fijo en un hijo del header. Se restablecen anchos, referencia de posición,
viewport y foco. El menú compacto queda por encima del dock (y=83..543 frente
al dock y=574..628 en 360×640), con desplazamiento propio para todas las opciones.

La captura rápida se movió, sin clonarla, desde la consola oculta al panel original;
al enviar abre #chat para que respuestas y confirmaciones no queden invisibles.
El pie de sala dejó de tapar controles y el chat del proyecto no pisa el companion.

El enlace «Configurar canales» heredaba texto cian sobre fondo cian. Se corrigió
y se comprobó su color calculado: #052636 sobre #6edafa (oscuro), blanco sobre
#08617d (claro). Las explosiones de clic de hasta 300px se sustituyen, solo en
estos espacios, por un aro de 22px/220ms que respeta clickFx y reduceMotion.
No se modifican los valores guardados. Los formularios de credenciales declaran
POST para no enviar contraseñas en la URL si JavaScript no está disponible.

Recursos y Service Worker versionados v139 para no mezclar estilos anteriores.
Las capturas locales están en `output/playwright/workspace-*.png`; se conservaron
los archivos locales ajenos. No se publican las cuentas ni los datos de QA.

## Límites

No certifica todas las funciones de negocio ni dispositivos físicos Android/iOS.
La sala/resultados se inspeccionaron sin grabaciones privadas; la bandeja sin
cuentas sociales reales conectadas. No se probaron voz, latencia ni servicios
externos. Las fuentes web mantienen fallback de sistema si no hay conexión.
Reversión: revertir el commit visual y actualizar caché; no hay migración de datos.
