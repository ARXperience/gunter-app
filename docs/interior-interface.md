# Interfaz interior unificada

Referencia: `stitch_personal_assistant_dashboard_expansion (1).zip`, incluidos
`screen.png`, `code.html` y `DESIGN.md`. Se adaptan su arco de navegación,
paleta cian/ámbar/violeta, planos oscuros y controles a las funciones reales.
No se incorporan métricas ficticias ni permisos autónomos del prototipo.

`styles/gunter-interior.css` se carga después de los estilos existentes.
Todos sus selectores excluyen `.gunter-orbit-home-active`: Inicio y su núcleo
conservan su presentación. Las páginas interiores mantienen sus controles,
identificadores, estados nativos/ARIA y flujos de confirmación.

`styles/gunter-workspace-layout.css` agrega la composición de sectores del ZIP:
cinco destinos principales, navegación contextual izquierda, trabajo central
y un inspector orbital con rutas y datos reales. `gunter-command-center.js`
reubica nodos existentes, sin clonar formularios ni reemplazar sus listeners.
Inicio queda excluido y recupera su composición al volver desde otro apartado.

Configuración utiliza `styles/pages/config-layout.css`: diez categorías
agrupadas, buscador y accesos internos. Agenda y ubicación reúne jornada,
ciudad y zona horaria; Datos contiene los respaldos de memoria; Diagnóstico
agrupa motores locales y controles técnicos desplegables. Existe un único
catálogo avanzado y un único panel de runtime, con estados reales.

En móvil la navegación se compacta y el inspector lateral se oculta sin
eliminar funciones. Los modos claro/oscuro, foco, movimiento reducido y alto
contraste mantienen reglas específicas. No se añaden motores gráficos.

Validación: `node test/interior-theme.js`, `node test/config-layout.js`,
`node test/workspace-structure.js`, revisión visual de Configuración
en escritorio y móvil, y comprobación de ausencia de desbordamiento horizontal.
La referencia visual no implica que sus funcionalidades imaginarias existan.
