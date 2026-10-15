# Interfaz interior unificada

Referencia: `stitch_personal_assistant_dashboard_expansion (1).zip`, incluidos
`screen.png`, `code.html` y `DESIGN.md`. Se adaptan su arco de navegación,
paleta cian/ámbar/violeta, planos oscuros y controles a las funciones reales.
No se incorporan métricas ficticias ni permisos autónomos del prototipo.

`styles/gunter-interior.css` se carga después de los estilos existentes.
Todos sus selectores excluyen `.gunter-orbit-home-active`: Inicio y su núcleo
conservan su presentación. Las páginas interiores mantienen sus controles,
identificadores, estados nativos/ARIA y flujos de confirmación.

Configuración conserva nueve categorías, un único catálogo avanzado y sus
estados reales. En móvil se muestran todas las categorías sin desplazamiento
horizontal. Los modos claro/oscuro, foco, movimiento reducido y alto contraste
mantienen reglas específicas.

Validación: `node test/interior-theme.js`, revisión visual de Configuración
en escritorio y móvil, y comprobación de ausencia de desbordamiento horizontal.
La referencia visual no implica que sus funcionalidades imaginarias existan.
