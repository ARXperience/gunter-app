# GunterMemory — fundación local

## Decisión de almacenamiento

Se reutiliza IndexedDB `gunter_conversation_memory`, ya empleado por `GunterConversationMemory`. La versión 2 añade únicamente el object store `records`; conserva `turns` y sus índices. No se introduce SQLite, otra base de memoria, un servicio cloud ni una copia automática de datos anteriores. Tareas, eventos, proyectos y configuraciones conservan sus almacenes actuales: esta fase no los duplica ni los migra.

```text
Asistente (lectura local)
  → GunterMemory (fachada)
  → GunterDataRepository.memory (MemoryRepository)
  → IndexedDB gunter_conversation_memory v2
       ├─ turns   (legacy, intacto)
       └─ records (memoria estructurada)
```

## Contrato inicial

`GunterMemory` expone `put(record)`, `get(id)`, `search(query, options)`, `delete(id)` y `list(options)`. Un registro contiene `id`, `createdAt`, `updatedAt`, `type`, `source`, `content`, `metadata`, `privacy` y `version`. `version` aumenta al actualizar un ID. Tipos iniciales: `preference`, `personal_fact`, `project`, `conversation`, `task`, `person`, `decision` y `context`. La búsqueda es **léxica local**, no semántica; no hay vectores ni nuevas llamadas de red.

`privacy` acepta `LOCAL` (predeterminado), `SYNCABLE` y `SENSITIVE_LOCAL_ONLY`. Son clasificaciones preparatorias, **no** permisos de transmisión. Nada se sincroniza ni se sube por esta fachada. La lectura de memoria en `GunterNlpLlm.complete` se limita al proveedor local; no se inyecta automáticamente información personal en prompts cloud. LOCAL_ONLY permanece local.

La fachada exige una cuenta verificada o, durante una caída del servidor, una sesión local previamente verificada cuya cuenta coincide con `gunter_device_user`. Una respuesta explícita 401/pending/blocked desautoriza el acceso local. Cada registro guarda `ownerId` y las consultas filtran por el usuario actual. Los turnos nuevos en `turns` también reciben `ownerId`. Los turnos v1 sin dueño se muestran como registros virtuales `conversation.legacy` solo cuando **ambos** marcadores locales (`gunter_device_user` y `gunter_memory_legacy_owner`) acreditan la misma cuenta. Si el marcador del dispositivo faltaba al verificar la sesión, esos turnos quedan en cuarentena (`UNBOUND`), sin borrarse ni adjudicarse al nuevo usuario. `delete(id)` puede borrar un turno legacy únicamente por petición explícita. El panel de memoria anterior continúa usando `turns` mediante la misma conexión de repositorio y solo lista o borra los turnos visibles para la cuenta actual autorizada.

El chat principal (`GunterCompanion`) usa `GunterMemory.rememberConversation` y `GunterMemory.recallConversation`: son adaptadores al almacén semántico `turns`, no una segunda escritura en `records`. La recuperación para el prompt de ese flujo solo se efectúa al elegir el proveedor local o `LOCAL_ONLY`; no se incorpora automáticamente memoria personal al prompt cloud. El ajuste de memoria conversacional sigue gobernando el guardado y la recuperación.

## Migración y límites

- Upgrade IndexedDB v1→v2 no destructivo: añade `records`, conserva `turns`.
- Una pestaña antigua que bloquee el upgrade provoca `MEMORY_UPGRADE_BLOCKED_RELOAD_OLD_TABS`; no se crea una base alternativa ni se borra información.
- No se han trasladado aún tareas, proyectos, preferencias ni archivos JSON/JSONL. Se incorporarán mediante adaptadores sobre sus fuentes existentes, sin importaciones duplicadas automáticas.
- La política preexistente de la app limpia datos locales al cambiar de cuenta en el mismo navegador; no se modifica en esta fase. La persistencia tras reiniciar la app o recargar la página para la **misma** cuenta sí está cubierta.
- Los turnos v1 sin marcador de propietario no pueden atribuirse de forma segura: permanecen en la base pero invisibles hasta una futura recuperación manual verificada. No se infiere propiedad por haber iniciado sesión después.
- Pendiente: sync cloud, backup remoto, embeddings, RAG, resolución de conflictos y almacenamiento multiplataforma.

## Verificación reproducible

`npm run test:memory` cubre contrato de la fachada, aislamiento entre cuentas, cuarentena de turnos sin dueño, sesión local offline y ausencia de copias del turno en `records`. La comprobación en IndexedDB real se puede repetir con `node test/memory-fixture-server.js 55824` y la página local `http://127.0.0.1:55824/test/fixtures/memory.html`; esta fixture no sirve archivos privados ni usa cuentas reales. También pasaron `npm run test:hybrid` y `npm run test:smoke` (139/139). La prueba de navegador confirmó escritura, recarga, lectura, recuperación semántica y bloqueo de lectura tras cambiar la cuenta simulada.
