# Gunter — Legacy Archive

Esta carpeta contiene archivos que estuvieron en el proyecto pero que **no se usan en producción** y han sido movidos aquí para reducir ruido técnico sin perderlos.

**Estos archivos NO se cargan en ningún HTML.** No tienen efecto en el comportamiento de Gunter Día, Reuniones, WhatsApp, voz, ni ninguna feature premium.

Si en el futuro alguno se necesita, basta con devolverlo a su ubicación original (`js/`) y volver a referenciarlo en el HTML correspondiente.

---

## Inventario

### `transcript-editor.js`

- **Origen**: `js/transcript-editor.js`
- **Movido**: Fase H (limpieza) — `2026-04-27`
- **Tamaño**: 10.4 KB
- **Expone (cuando se carga)**: `window.GunterTranscriptEditor` (clase con `open(transcript, onSave)`).
- **Función**: modal para editar transcripciones manualmente antes de mandarlas al análisis.
- **Por qué se movió**: 0 callers en todo el repo. No referenciado por ningún `<script src>`. No es importado dinámicamente. La funcionalidad equivalente (editar transcripción) ya existe en `results.html` con `transcription-textarea`.
- **Cómo restaurar si lo necesitas**:
  1. `mv _archive/legacy/transcript-editor.js js/transcript-editor.js`
  2. Añadir `<script src="js/transcript-editor.js"></script>` al HTML que lo necesite (probablemente `results.html`).
  3. Llamarlo desde el caller con `new GunterTranscriptEditor().open(transcript, callback)`.

### `verify-charts.js`

- **Origen**: `js/verify-charts.js`
- **Movido**: Fase H (limpieza) — `2026-04-27`
- **Tamaño**: 2.2 KB
- **Expone**: nada (script de testing one-off).
- **Función**: utilidad de desarrollo para probar manualmente los charts de `results.html` con datos sintéticos por entorno (`empresarial`, `artistico`, `podcast`). Imprime instrucciones en consola: `testState('empresarial')`, etc.
- **Por qué se movió**: no es código de producto, es herramienta de desarrollo. Se conserva por si en el futuro se necesita validar los charts manualmente.
- **Cómo usarlo si lo necesitas**:
  1. `mv _archive/legacy/verify-charts.js js/verify-charts.js`
  2. Añadirlo temporalmente con `<script src="js/verify-charts.js"></script>` en `results.html`.
  3. Abrir DevTools → consola → `testState('empresarial')`.
  4. Una vez terminada la prueba, volver a moverlo aquí.

---

## Política de archivado

- Los archivos aquí **no son código muerto eliminable** — son **código aparcado** con potencial de uso futuro.
- Antes de eliminar definitivamente cualquier archivo de esta carpeta, verificar:
  1. Buscar referencias dinámicas en todo el repo (`grep -r "<basename>"`).
  2. Confirmar que no hay tests, scripts CI o documentación que lo mencione.
  3. Mover a `_backups/` con timestamp por si acaso.

- **No hay automatización de eliminación**. Las decisiones de borrar definitivamente se toman caso por caso.
