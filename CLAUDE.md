# Gunter — Arquitectura

App web local-first con dos productos bajo el mismo codebase:

- **Gunter Día** (`day.html`) — asistente diario: tareas, eventos, recordatorios, chat, documentos.
- **Gunter Reuniones** (`meeting.html` → `results.html`) — grabación, transcripción, análisis IA, presentaciones.

Stack: Vanilla JS multi-page, sin bundler. Backend Node.js http (sin Express). Persistencia: localStorage + IndexedDB. Backend WhatsApp: Baileys.

---

## Páginas (HTML)

| Archivo | Función |
|---|---|
| `index.html` | Landing / portal |
| `dashboard.html` | Hub de proyectos |
| `day.html` | Gunter Día — tabs dinámicos (Hoy + premium) |
| `config.html` | Nuevo Proyecto + Premium + Preferencias + Datos |
| `meeting.html` | Grabación en vivo — 3 paneles (audio/transcript/Gunter) |
| `results.html` | Análisis IA + presentaciones + follow-up post-reunión |

---

## Backend

```
server.js                    Proxy HTTP único — endpoints /api/*
server/openai-client.js      Wrapper OpenAI (chat, whisper, tts, embeddings)
server/gemini-client.js      Wrapper Gemini (text + vision + image)
server/whatsapp/             Baileys — handler conversacional con memoria
  ├ index.js                 sendMessage, QR, lifecycle
  ├ handler.js               Pipeline NLU + intent premium intercept
  ├ memory.js                Historia + facts por contacto
  ├ personality.js           System preamble compartido con browser
  ├ state-mirror.js          Estado tasks/events sincronizado desde browser
  └ message-log.js           Outgoing log + sync queue
server/knowledge/            Memoria de proyectos (Etapa 11)
  ├ store.js                 Snapshot persistido + índice + aliases
  ├ search.js                resolveProject + search + projectContextBundle
  ├ summarizer.js            Resumen ejecutivo cached
  └ index.js                 Facade
server/premium-intel/        Premium Intelligence (Sprint B-F)
  ├ _util.js                 Respuesta canónica + LLM safe + cache TTL
  ├ planner.js               daily + weekly plan
  ├ follow-up.js             project followups + meeting followup
  ├ summary.js               project executive summary
  ├ urgency.js               ranking explicable
  ├ project360.js            vista 360 consolidada
  ├ decisions.js             list + auto-detect
  ├ alerts.js                smart WA alerts (previews)
  ├ delegation.js            drafts en 5 tonos
  └ index.js                 Dispatcher con 11 acciones
```

### Endpoints HTTP

```
POST  /api/transcribe         Whisper
POST  /api/chat               OpenAI chat (primary LLM)
POST  /api/tts                OpenAI TTS-1-HD humanizado
POST  /api/embeddings         text-embedding-3-small
POST  /api/gemini-text        Gemini text
POST  /api/gemini-image       Gemini Nano Banana
POST  /api/document-extract   Recibos/facturas (Gemini Vision)
GET   /api/gemini-status      Health
GET   /api/google/status      OAuth setup
*     /api/whatsapp/*         WA bridge (status, qr, send, messages, personality)
*     /api/knowledge/*        Project memory (sync, projects, project/:id, search, resolve, summary/:id, stats)
POST  /api/premium-intel      Dispatcher único — { action, params }
GET   /api/premium-intel/actions   Lista 11 acciones

—— v2 — Funciones avanzadas ——
POST  /api/commitments        F2 — { op:'ingest'|'reconcile'|'list'|'stats'|'mark_fulfilled'|'mark_cancelled'|'add_manual'|'remove'|'clear', params }
POST  /api/proactive          F3 — { op:'tick'|'queue'|'dismiss'|'snooze'|'act'|'stats'|'clear', params }
POST  /api/style-mirror       F5 — { op:'profile'|'redact'|'list'|'get'|'remove'|'clear', params }
POST  /api/forecast           F6 — { op:'project'|'all'|'history'|'clear', params }
```

---

## Premium Features (92 flags)

`js/premium-features-service.js` — registry central con persistencia + cascada padre→hijos + import/export.

**Categorías:**
1. Productivity panel (5 subflags)
2. Meeting memory (3) — semantic search con embeddings reales
3. Smart documents (5)
4. Google Calendar (2)
5. WhatsApp Assistant (3)
6. Document sync (2)
7. Personality / focus / distraction
8. Voice (mode, style, speed, tone)
9. Wake word
10. **Premium Intelligence (Sprint A)** — 10 flags padres + 30 subflags:
    - `dailyPlanner`, `weeklyPlanner`, `projectAutoFollowUp`, `projectExecutiveSummary`,
      `meetingSmartFollowUp`, `urgencyRanking`, `project360`, `decisionCenter`,
      `smartWhatsappAlerts`, `delegationMode`
11. **v2 — Funciones avanzadas** (sección `advanced` en advanced-settings):
    - `conversationMemory` (F1) — LTM cross-sesión con embeddings + recall semántico
    - `commitmentTracker` (F2) — detector de promesas con extractor LLM + reconciliación de cumplimiento
    - `proactivePulse` (F3) — agente proactivo con engine de triggers + queue persistente; subflag `proactivePulseAggression: 'soft'|'normal'|'high'`
    - `meetingClimate` (F4) — análisis emocional de reunión en tiempo real (heurísticas + LLM cada 75s) con overlay flotante
    - `mirrorStyle` (F5) — clonado del estilo de escritura del usuario por contacto (formality, warmth, length, emojis, jerga, openings, closings)
    - `projectForecast` (F6) — Monte Carlo determinístico (1k simulaciones, seed por projectId) con percentiles P50/P80/P95 y P(deadline)

UI: `js/advanced-settings.js` declara `FEATURE_MAP` con cards + subs + `section: 'advanced'` para v2. Renderizado en tab `Premium` de `config.html`.

---

## Pipeline cognitivo (`js/core/`)

```
text → IntentEngine → EntityExtractor → TimeParser
                          ↓
                    PremiumIntel branch (si intent ∈ INTENT_MAP)
                          ↓
                    DecisionEngine → ActionEngine → uiResponse
```

`pipeline.js` ejecuta los 5 stages + un **stage `premium_intel`** entre `time` y `decision` que delega a `GunterPremiumIntel.handlePremiumIntent()` cuando el intent es premium.

11 intents premium en `intent-engine.js`:
`daily_plan, weekly_plan, project_followup, project_summary, project_360,
 meeting_followup, urgency_query, decision_query, decision_create,
 smart_alerts, delegation`

---

## Servicios cliente (`js/services/`)

| Servicio | Función |
|---|---|
| `notifications-service.js` | Toasts + recordatorios + `withOperation` (loading actualizable) |
| `error-mapper.js` | Errores técnicos → mensajes humanos en español latino |
| `status-bus.js` | Pub/sub de estados de operación (saving, syncing, etc.) |
| `connectivity-monitor.js` | Banner offline + interceptor de fetch para `/api/*` |
| `voice-service.js` | TTS humanizado + truncation inteligente para respuestas largas |
| `wake-word-service.js` | "Hi Gunter" tolerante + feedback variado por estilo |
| `tasks-service.js` | CRUD tareas IndexedDB |
| `events-service.js` | CRUD eventos IndexedDB + sync Calendar |
| `calendar-service.js` | Google Calendar push/pull con cola offline |
| `google-auth-service.js` | OAuth client-side |
| `whatsapp-service.js` | Cliente del bridge WA con sync queue |
| `document-service.js` | Extracción de recibos via Gemini Vision |
| `embedding-service.js` | text-embedding-3-small + cache IndexedDB |
| `semantic-index.js` | Top-K cosine search sobre transcripciones/análisis |
| `nlp-llm-service.js` | Wrapper /api/chat con personalidad latina |
| `project-knowledge-service.js` | Snapshot builder (Etapa 11) |
| `knowledge-sync-service.js` | Push debounced del snapshot |
| `premium-intelligence-service.js` | Cliente del dispatcher /api/premium-intel |
| **`conversation-memory-service.js` (v2 F1)** | LTM IDB `gunter_conversation_memory`. `remember/recall/forget/list/clear/stats/contextSnippet`. Auto-purge >180d. Hookeado en `assistant-controller.push()` (write) y `nlp-llm-service.complete()` (recall + inject) |
| **`commitments-service.js` (v2 F2)** | Wrapper `/api/commitments`. `ingestText/reconcile/list/stats/markFulfilled/markCancelled/addManual/remove/clear` |
| **`proactive-service.js` (v2 F3)** | Pulso proactivo. Auto-tick 15min + `getQueue/dismiss/snooze/act`. Toast + voz si severidad alta |
| **`meeting-climate-service.js` (v2 F4)** | Análisis emocional en vivo. Heurísticas locales + LLM 75s. Overlay flotante en meeting.html. Eventos `gunter-recording-started/stopped` |
| **`style-mirror-service.js` (v2 F5)** | Wrapper `/api/style-mirror`. `buildFromMessages/buildFromWhatsApp/redact/list/get/remove` |
| **`forecast-service.js` (v2 F6)** | Wrapper `/api/forecast`. Monte Carlo 1k simulaciones por proyecto |

---

## Adapters (`js/adapters/`) — capa para futuro backend

5 adapters thin que envuelven los servicios anteriores con API estable + `register/use`:
`storage, auth, notification, calendar, voice`.

Hoy todos apuntan a la implementación local. Mañana: `GunterAdapters.storage.use('remote')` sin tocar consumidores.

---

## UI panels (`js/controllers/`)

| Controller | Tab/lugar | Flag premium |
|---|---|---|
| `today-widget.js` | Tab Hoy de day.html | (siempre activo) |
| `today-shortcuts.js` | Tab Hoy — atajos visuales | varios |
| `productivity-panel.js` | Tab Productividad | `productivityPanel` |
| `meeting-memory.js` | Tab Memoria | `meetingMemory` |
| `daily-planner-panel.js` | Tab 🌅 Plan de hoy | `dailyPlanner` |
| `weekly-planner-panel.js` | Tab 📅 Mi semana | `weeklyPlanner` |
| `urgency-ranking-panel.js` | Tab 🔥 Urgencia | `urgencyRanking` |
| `project-360-panel.js` | Tab 🛰️ Proyecto 360 | `project360` |
| `decisions-panel.js` | Tab 🧭 Decisiones | `decisionCenter` |
| `delegation-panel.js` | Tab 🤝 Delegación | `delegationMode` |
| `smart-alerts-panel.js` | Tab 🔔 Alertas WA | `smartWhatsappAlerts` |
| `meeting-followup-card.js` | Card en results.html | `meetingSmartFollowUp` |
| `day-tabs.js` | Router de tabs dinámicos | — |
| `day-controller.js` | Orquestador de day.html | — |
| `assistant-controller.js` | Chat in-app | — |
| **`commitments-panel.js` (v2 F2)** | Tab 🤝 Compromisos | `commitmentTracker` |
| **`proactive-panel.js` (v2 F3)** | Tab ⚡ Pulso | `proactivePulse` |
| **`forecast-panel.js` (v2 F6)** | Tab 🔮 Forecast | `projectForecast` |
| **`conversation-memory-panel.js` (v2 F1)** | Card en config.html · Datos | `conversationMemory` |

---

## Persistencia local

```
localStorage:
  gunter_data                 Proyectos + analyses cached
  gunter_premium_features     Estado de los 92 flags
  gunter_generated_analyses   Análisis cacheados por proyecto
  gunter_full_transcript      Última transcripción
  gunter_username, gunter_user, etc.

IndexedDB:
  gunter_daily                tasks, events, reminders, documents
  gunter_audio_vault          chunks de audio durante grabación
  gunter_transcription_db     metadata de sesiones
  gunter_documents            extracciones de Gemini Vision
  gunter_embeddings           vectores text-embedding-3-small (Sprint 4)
  gunter_semantic_index       chunks indexados (Sprint 4)
  gunter_transcript_archive   transcripciones >200KB (Fase A)
  gunter_conversation_memory  v2 F1 — turnos chat/voz/wake con vector + metadata

Disco backend (gitignored):
  whatsapp-data/
    session/                  Baileys creds
    state-mirror.json         Estado mirror
    sync-queue.json           Cola WA → browser
    messages.json             Log
    memory.json               Por contacto: history + facts
    personality.json          Espejo del browser
    knowledge/
      snapshot.json           Snapshot completo
      index.json              Índice rápido
      summaries.json          Cache de resúmenes
      contact-aliases.json    contactId → projectIds frecuentes
  data/                       (v2)
    commitments.json          F2 — promesas detectadas + estado
    proactive-queue.json      F3 — interventions de pulso proactivo
    style-mirror.json         F5 — perfiles de estilo por contactKey
    forecast-history.json     F6 — histórico de simulaciones por proyecto
```

---

## Flujo Etapa 11: WhatsApp con memoria de proyectos

```
Usuario edita proyecto en day.html
        ↓
gunter-data-changed event
        ↓
KnowledgeSyncService (debounce 2s)
        ↓
ProjectKnowledgeService.build()  → snapshot
        ↓
POST /api/knowledge/sync         → KnowledgeStore (server)
                                                   ↓
WhatsApp message arrives                    Snapshot persistido
        ↓
handler.js
  → detectPremiumIntent (regex)
        ├── matchea? → premiumIntel.dispatch() → respuesta directa
        └── no matchea? → planActions LLM con knowledge bundle inyectado
        ↓
executeActions
  → resolveProjectFor (resuelve "SERVIMIL", "el de transporte", aliases)
  → enqueueSync con projectId + tag project:<id>
        ↓
Browser sync queue → tasks-service / events-service / data-service
        ↓
Otro snapshot → ciclo se repite
```

---

## Flujo Sprint B-F: Premium Intelligence

```
Cualquier canal: web chat, voz, wake word, WhatsApp
        ↓
Pipeline.handleUserInput(text)
        ↓
IntentEngine clasifica (regex + pesos)
        ↓
Si intent ∈ PREMIUM (daily_plan, urgency_query, etc.):
        ↓
GunterPremiumIntel.handlePremiumIntent(intent, entities, ctx)
        ↓
fetch POST /api/premium-intel { action, params }
        ↓
server/premium-intel/index.js dispatch(action, params)
        ↓
Módulo correspondiente (planner, urgency, etc.)
  • Lee snapshot via knowledge.getSnapshot()
  • Heurística determinística (siempre)
  • LLM enrichment (si openai.hasKey)
  • Cache TTL 30min/1h
        ↓
Respuesta canónica { success, data, summary, naturalResponse, ... }
        ↓
uiResponse.speech = naturalResponse
        ↓
voice.speak (truncado si > 380 chars con filler humano)
        ↓
Panel UI render data (si está en day.html)
```

---

## Reglas de seguridad

- **Sin API keys en frontend.** Todo va por `/api/*`.
- **Sin envíos automáticos a WhatsApp.** Smart alerts genera previews; el usuario confirma con modal antes de POST `/api/whatsapp/send`.
- **Sin acciones masivas sin confirmación.** Calendar bloques, eventos múltiples → `requiresConfirmation: true`.
- **Sin alucinación.** Cada acción premium verifica snapshot; si vacío, retorna mensaje humano "Abre Gunter Web para sincronizar".
- **Cero tracking.** No analytics, no telemetría externa.

`.gitignore` cubre `whatsapp-data/`, `node_modules/`, `.env`.

---

## Convenciones de código

- Vanilla JS, sin bundler. Cada módulo es un IIFE que registra `window.Gunter*`.
- IDs de DOM con prefijo: `gday-*` (día), `gpi-*` (premium intel), `gmem-*` (memoria), etc.
- Clases CSS con BEM: `gpi-card__head`, `gpi-card--active`.
- Diseño tokens en `styles/design-system.css` y `styles/variables.css`. Premium intel usa `--gpi-*` que heredan de gday.
- Personalidad: español neutro latinoamericano (es-419). Lista negra de modismos de España aplicada en preamble del LLM.

---

---

## Auditoría — archivos huérfanos (Fase H — completado)

| Archivo original | Estado | Acción tomada |
|---|---|---|
| `js/transcript-editor.js` | 100% huérfano confirmado (0 callers, no cargado en ningún HTML, no importado dinámicamente) | **Movido a `_archive/legacy/transcript-editor.js`** en Fase H (2026-04-27) |
| `js/verify-charts.js` | Script de testing one-off (sin globals, sin uso en producto) | **Movido a `_archive/legacy/verify-charts.js`** en Fase H (2026-04-27) |

**Política**: los archivos en `_archive/legacy/` no se eliminan; se conservan con README explicativo (`_archive/legacy/README.md`) que documenta cómo restaurarlos si se necesitan en el futuro. Ver también `LEGACY_CLEANUP_REPORT.md` en la raíz para auditoría completa.

**CSS de `styles/themes/`** (`_shared.css`, `_unique-structures.css`, `artistico.css`, `empresarial.css`, `podcast.css`, `zen.css`): aparentan ser huérfanos pero **se cargan dinámicamente** desde `theme-manager.js:102-117`. NO TOCAR.

## Auditoría — flags premium sin uso real (Fase A)

**Estado 2026-05-01 (re-auditado empíricamente)**: la auditoría original de Fase A detectó 31 subflags sin lectura. Fase C aplicó "honestidad de configuración" → **30 de los 31 ya están marcados** con `subStatus: 'included_in_parent'` o `'coming_soon'` en `FEATURE_MAP` (advanced-settings.js), y la UI los renderiza con badge informativo en vez de toggle funcional falso.

Detalle por categoría (todos marcados, nada pendiente):

- **Meeting memory subs** (3): `meetingSemanticSearch` → `included_in_parent`, `meetingDecisionTimeline` → `included_in_parent` (sí se lee en `results.html`), `meetingCrossProjectLinks` → `coming_soon`.
- **Smart documents subs** (5): `smartReceipt/DueDate/PaymentAlerts` → `included_in_parent`, `smartExpenseClassification`/`smartFinancialHistory` → `coming_soon`.
- **WhatsApp subs** (3): los 3 → `included_in_parent`.
- **Personality extras** (3): `focusCoachEnabled`, `distractionBlocker`, `smartTimer` — renderizados con badge "Próximamente" hardcoded en `renderPersonalityCard`. No tienen toggle real (no hay `data-switch`), solo aparecen como vista previa.
- **Daily / Weekly planner subs** (6): todos `included_in_parent`.
- **Project followup / Executive summary subs** (6): todos `included_in_parent`.
- **Urgency ranking subs** (3): todos `included_in_parent`.

Razón histórica: los módulos backend devuelven el dataset completo, no granularizan por subflag. La UI ahora lo refleja honestamente: el usuario ve la opción + un badge que explica si ya viene incluida o llega después.

Sub-flags que SÍ funcionan como toggles funcionales: `productivity*` (5), `meetingSmartFollowUp*` (3), `project360*` (5), `decisionCenter*` (3), `smartWhatsappAlerts*` (3), `delegationMode*` (3) — total 22.

## Auditoría — duplicaciones detectadas (Fase A)

3 implementaciones de toast coexisten:
- `js/app.js#showToast` — legacy con clase `.toast .toast--{type}`. Aún usado por código antiguo en results.
- `js/services/notifications-service.js#showToast` — el oficial actual (variants, sticky, withOperation).
- `js/slide-renderer.js#showToast` — interno al overlay del visualizador, no expone API global. **Aceptable** (scope local).

Pendiente Fase B: migrar `js/app.js#showToast` para que delegue a `GunterNotificationsService`.

## Auditoría — riesgos de datos detectados (Fase A)

| Almacén | Riesgo | Mitigación |
|---|---|---|
| `gunter_full_transcript` (localStorage) | Reuniones largas exceden 5MB | ✅ **Mitigado en A2** con `transcript-store.js` |
| `gunter_audio_vault` (IDB) | Sin política de purga; crece sin límite | Pendiente Fase D |
| `gunter_generated_analyses` (localStorage) | Acumula JSON sin tope | Pendiente Fase D |

## Bugs pre-existentes — estado

- ~~`meeting.html:343` tag malformado de `audio-vault.js`~~ — **resuelto**. Verificación 2026-05-01: `<script src="js/audio-vault.js"></script>` está bien formado en la línea 363 actual (numeración cambió tras inserciones v2). Auditoría con `grep -nE '<script src="[^"]*"</script>'` sobre los 6 HTML de producción → 0 matches.

## Para ejecutar

```bash
node server.js                     # http://localhost:3001
```

Variables de entorno (`.env`):
```
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
PORT=3001
```

WhatsApp: scan QR desde `config.html → Premium → WhatsApp Assistant → Conectar`.
