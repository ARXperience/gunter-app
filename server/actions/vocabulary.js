/* =============================================
   GUNTER ACTIONS — Vocabulario hablable (v1)
   -------------------------------------------------
   Mapa: alias hablado → flag técnico + acción.
   Compartido entre:
     - Endpoint /api/actions (llamado desde browser widget)
     - handler.js de WhatsApp

   Cada entry:
     flag           → nombre técnico en premium-features
     aliases        → array de frases/palabras que el user puede decir
     kind           → 'boolean' | 'enum' | 'text'
     enumValues     → si kind='enum'
     shortDesc      → 1 línea para explicar rápido
     longDesc       → descripción detallada para preguntas "qué es X"
     risk           → 'safe' | 'confirm' | 'destructive'
     ownerOnly      → true si solo el owner phone puede tocar via WA
   ============================================= */

const FEATURES = [
  // ─────────────────────────────────────────────
  // Personalidad / voz (afectan cómo suena Gunter)
  // ─────────────────────────────────────────────
  {
    flag: 'adaptivePersonality',
    aliases: ['personalidad', 'personalidad adaptativa'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Ajusta tono y estilo según el contexto',
    longDesc: 'Personalidad adaptativa. Cuando está activa, adapto tono al entorno del proyecto.'
  },
  {
    flag: 'personalityMode',
    aliases: ['modo', 'modo de personalidad', 'tono', 'estilo'],
    kind: 'enum',
    enumValues: ['professional', 'direct', 'coach', 'fun', 'strategic'],
    enumAliases: {
      professional: ['profesional', 'ejecutivo', 'formal'],
      direct: ['directo', 'al grano', 'sin rodeos'],
      coach: ['coach', 'mentor', 'entrenador'],
      fun: ['divertido', 'juguetón', 'gracioso', 'fun'],
      strategic: ['estratégico', 'estrategico', 'strategist']
    },
    risk: 'safe',
    shortDesc: 'Cambia mi personalidad',
    longDesc: 'El modo controla cómo razono y respondo. Profesional es neutro; coach es motivador; fun es más suelto.'
  },
  {
    flag: 'voiceEnabled',
    aliases: ['voz', 'hablar', 'que hables', 'que hables conmigo'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Gunter habla o solo escribe',
    longDesc: 'Cuando está activo, Gunter responde con voz humanizada. Si está apagado, solo texto.'
  },
  {
    flag: 'voiceStyle',
    aliases: ['estilo de voz', 'como hablo', 'personalidad al hablar'],
    kind: 'enum',
    enumValues: ['professional', 'warm', 'chaotic_scientist', 'energetic_cartoon', 'minimal_penguin', 'executive', 'focus_coach'],
    enumAliases: {
      professional: ['profesional', 'ejecutivo'],
      warm: ['cálido', 'calido', 'cercano', 'amigable'],
      chaotic_scientist: ['científico caótico', 'cientifico caotico', 'sarcástico', 'sarcastico'],
      energetic_cartoon: ['energético', 'energetico', 'caricatura', 'cartoon'],
      minimal_penguin: ['minimalista', 'pingüino', 'pinguino'],
      executive: ['ejecutivo', 'corporativo'],
      focus_coach: ['coach de enfoque', 'coach', 'concentración'],
    },
    risk: 'safe',
    shortDesc: 'Estilo del carácter cuando hablo'
  },
  {
    flag: 'wakeWordEnabled',
    aliases: ['activación por voz', 'wake word', 'hi gunter', 'palabra de activación'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Que Gunter te escuche al decir "Hi Gunter"',
    longDesc: 'Activa el reconocimiento continuo. Solo funciona con la app abierta en primer plano en Android.'
  },
  {
    flag: 'dictationEnabled',
    aliases: ['dictado por micrófono', 'dictado', 'transcripción por micrófono'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Permite dictar cuando pulsas Hablar; el micrófono siempre requiere permiso.'
  },
  {
    flag: 'conversationContinuity',
    aliases: ['continuidad de conversación', 'continuidad del chat', 'mantener el hilo'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Usa turnos recientes para mantener el hilo de la conversación.'
  },
  {
    flag: 'personalMemoryContext',
    aliases: ['recuerdos autorizados', 'memoria personal contextual', 'usar mis recuerdos guardados'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Usa recuerdos guardados explícitamente solo en inferencia local.'
  },
  {
    flag: 'contextualRecommendations',
    aliases: ['recomendaciones contextuales', 'sugerencias de herramientas', 'sugerencias de acciones'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Sugiere herramientas pertinentes sin ejecutarlas automáticamente.'
  },
  {
    flag: 'diagnosticsEnabled',
    aliases: ['diagnóstico de Gunter', 'diagnóstico de funcionamiento', 'explicación de errores'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Explica el estado y los errores reales cuando lo consultas.'
  },

  // ─────────────────────────────────────────────
  // Productividad
  // ─────────────────────────────────────────────
  {
    flag: 'productivityPanel',
    aliases: ['panel de productividad', 'productividad', 'métricas'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Panel con métricas de rendimiento',
    longDesc: 'Muestra tiempo por tarea, eficiencia semanal, cumplimiento de objetivos y ROI de tu tiempo.'
  },
  {
    flag: 'meetingMemory',
    aliases: ['memoria de reuniones', 'memoria de meetings', 'recordar reuniones'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Buscar en reuniones pasadas',
    longDesc: 'Guarda decisiones, indexa transcripciones y permite buscar semánticamente entre proyectos.'
  },
  {
    flag: 'smartDocuments',
    aliases: ['documentos inteligentes', 'analizar documentos', 'recibos'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Analiza recibos, facturas e imágenes',
    longDesc: 'Extrae fechas de vencimiento, montos y clasifica gastos usando visión por computadora (Gemini Vision).'
  },
  {
    flag: 'googleCalendarSync',
    aliases: ['google calendar', 'calendario', 'agenda'],
    kind: 'boolean', risk: 'confirm',
    shortDesc: 'Conectar Google Calendar',
    longDesc: 'Sincroniza eventos bidireccionalmente. Requiere autenticar con Google. Activarlo NO conecta solo — tienes que autorizarlo en la app.'
  },
  {
    flag: 'whatsappAssistant',
    aliases: ['whatsapp', 'wa', 'asistente de whatsapp'],
    kind: 'boolean', risk: 'confirm',
    shortDesc: 'Conectar Gunter a WhatsApp',
    longDesc: 'Requiere escanear un QR para vincular tu WhatsApp. Después puedes hablarme por WA.'
  },

  // ─────────────────────────────────────────────
  // Inteligencia Premium
  // ─────────────────────────────────────────────
  {
    flag: 'dailyPlanner',
    aliases: ['planificador diario', 'plan del día', 'plan de hoy', 'planeador diario'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Plan del día priorizado con IA',
    longDesc: 'Organiza tareas, reuniones, pagos y proyectos en un plan diario. Genera un brief matutino con lo importante.'
  },
  {
    flag: 'weeklyPlanner',
    aliases: ['planificador semanal', 'plan de la semana', 'mi semana'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Distribuye tareas y prioridades en la semana',
    longDesc: 'Balancea carga entre proyectos, sugiere bloques de calendario y agrupa tareas relacionadas.'
  },
  {
    flag: 'projectAutoFollowUp',
    aliases: ['seguimiento de proyectos', 'follow up', 'proyectos inactivos'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Detecta proyectos sin actividad',
    longDesc: 'Avisa cuando un proyecto lleva días sin movimiento, cuando hay tareas vencidas o reuniones sin próximos pasos.'
  },
  {
    flag: 'projectExecutiveSummary',
    aliases: ['resumen ejecutivo', 'estado del proyecto', 'briefing'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Estado ejecutivo por proyecto',
    longDesc: 'Genera un resumen con avances, pendientes, riesgos, decisiones y próximos pasos. Exportable a PDF.'
  },
  {
    flag: 'meetingSmartFollowUp',
    aliases: ['follow up de reunión', 'post reunión', 'follow-up de meeting'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Detecta compromisos al terminar reunión',
    longDesc: 'Al finalizar una reunión, extrae automáticamente tareas, decisiones y responsables.'
  },
  {
    flag: 'urgencyRanking',
    aliases: ['urgencia', 'ranking de urgencia', 'prioridades'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Ranking explicable de urgencia',
    longDesc: 'Ordena tus tareas por urgencia real considerando fecha, impacto en el proyecto y dinero involucrado.'
  },
  {
    flag: 'project360',
    aliases: ['proyecto 360', 'vista 360', 'panel de proyecto'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Vista consolidada del proyecto',
    longDesc: 'Muestra en una sola pantalla: tareas, tiempo invertido, decisiones, riesgos y compromisos del proyecto.'
  },
  {
    flag: 'decisionCenter',
    aliases: ['decisiones', 'centro de decisiones'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Registra y busca decisiones',
    longDesc: 'Guarda decisiones importantes con contexto. Búsqueda semántica. Timeline por proyecto.'
  },
  {
    flag: 'smartWhatsappAlerts',
    aliases: ['alertas de whatsapp', 'alertas wa'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Alertas inteligentes por WhatsApp',
    longDesc: 'Envía por WA: brief matutino, avisos de pagos que vencen, riesgos de proyecto. Siempre pide confirmación antes de enviar.'
  },
  {
    flag: 'delegationMode',
    aliases: ['delegación', 'delegacion', 'modo delegación', 'redactar mensajes'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Redacta mensajes para delegar',
    longDesc: 'Genera borradores en 5 tonos para pedir cosas por WA/email. Puede crear un recordatorio de seguimiento automático.'
  },

  // ─────────────────────────────────────────────
  // Funciones avanzadas v2
  // ─────────────────────────────────────────────
  {
    flag: 'conversationMemory',
    aliases: ['memoria conversacional', 'memoria', 'recordar conversaciones', 'que me recuerdes'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Memoria de largo plazo entre sesiones',
    longDesc: 'Guardo cada turno que hablamos, con embeddings. Al responder, recupero lo relevante — recuerdo cosas de conversaciones pasadas.'
  },
  {
    flag: 'commitmentTracker',
    aliases: ['compromisos', 'tracker de compromisos', 'promesas'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Detecta y trackea promesas',
    longDesc: 'Detecta cuando alguien promete algo (en reunión, chat, WA) y trackea si se cumple. Reconcilia automáticamente.'
  },
  {
    flag: 'proactivePulse',
    aliases: ['pulso proactivo', 'pulso', 'proactivo', 'alertas proactivas'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Agente proactivo con alertas',
    longDesc: 'Cada 15 min revisa tus proyectos y detecta: compromisos vencidos, proyectos inactivos, días muy cargados. Te avisa.'
  },
  {
    flag: 'proactivePulseAggression',
    aliases: ['agresividad del pulso', 'nivel del pulso'],
    kind: 'enum',
    enumValues: ['soft', 'normal', 'high'],
    enumAliases: {
      soft: ['suave', 'poco', 'tranquilo', 'poco intrusivo'],
      normal: ['normal', 'medio', 'balanceado'],
      high: ['alto', 'agresivo', 'mucho', 'insistente']
    },
    risk: 'safe',
    shortDesc: 'Qué tan intenso es el pulso proactivo'
  },
  {
    flag: 'meetingClimate',
    aliases: ['clima de reunión', 'clima de meeting', 'clima'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Análisis emocional de reunión en vivo',
    longDesc: 'Durante grabación, muestro un overlay con energía, acuerdo, intensidad y mood detectado (calmado, tenso, entusiasta, etc.).'
  },
  {
    flag: 'mirrorStyle',
    aliases: ['modo espejo', 'imitar estilo', 'clon de estilo'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Clona tu estilo por contacto',
    longDesc: 'Aprende cómo escribes con cada contacto y genera mensajes en tu propio estilo (formalidad, calidez, longitud, emojis).'
  },
  {
    flag: 'projectForecast',
    aliases: ['forecast', 'predicción de proyecto', 'prediccion de proyecto', 'proyección'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Predicción probabilística Monte Carlo',
    longDesc: 'Simula 1000 escenarios por proyecto. Da percentiles P50/P80/P95 y probabilidad de cumplir deadline.'
  },

  // ─────────────────────────────────────────────
  // Integraciones documentales
  // ─────────────────────────────────────────────
  {
    flag: 'documentSync',
    aliases: ['sincronizar documentos', 'sync de documentos', 'documentos externos', 'notion', 'google drive', 'drive'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Conecta Notion / Drive como memoria',
    longDesc: 'Conecta documentos externos (Notion, Drive) para que Gunter los use como fuente de contexto adicional.'
  },
  {
    flag: 'notionSync',
    aliases: ['notion', 'sync notion', 'sincronizar notion'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Notion como fuente de conocimiento',
    longDesc: 'Sincroniza tus notas de Notion. (Coming soon: integración con Notion API.)'
  },
  {
    flag: 'googleDriveSync',
    aliases: ['drive', 'google drive', 'sync drive', 'sincronizar drive'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Google Drive como fuente',
    longDesc: 'Sincroniza tus archivos de Drive. (Coming soon: integración con Drive API.)'
  },

  // ─────────────────────────────────────────────
  // Google Calendar subs
  // ─────────────────────────────────────────────
  {
    flag: 'googleCalendarNaturalLanguage',
    aliases: ['agenda por texto', 'agenda natural', 'crear eventos por texto', 'lenguaje natural en calendar'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Crear eventos desde texto libre',
    longDesc: 'Cuando dices "agenda X mañana 3pm" en Calendar, lo interpreto y creo el evento.'
  },
  {
    flag: 'googleCalendarAutoReminders',
    aliases: ['recordatorios automáticos', 'auto recordatorios de calendar', 'aviso 1 día antes'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Recordatorios 1día + 30min antes',
    longDesc: 'Cada evento nuevo trae recordatorios automáticos: 1 día antes y 30 min antes.'
  },

  // ─────────────────────────────────────────────
  // Personalidad extras
  // ─────────────────────────────────────────────
  {
    flag: 'personalityIntensity',
    aliases: ['intensidad de personalidad', 'que tan intenso', 'nivel de personalidad', 'personalidad'],
    kind: 'enum',
    enumValues: ['soft', 'normal', 'intense'],
    enumAliases: {
      soft: ['sutil', 'suave', 'discreto'],
      normal: ['normal', 'balanceado', 'medio', 'equilibrado'],
      intense: ['fuerte', 'marcado', 'intenso']
    },
    risk: 'safe',
    shortDesc: 'Qué tan marcado es el modo actual',
    longDesc: 'Controla cuánta personalidad se cuela en respuestas: sutil (casi neutro), balanceado o fuerte.'
  },
  {
    flag: 'focusCoachEnabled',
    aliases: ['coach de enfoque', 'focus coach', 'coach', 'entrenador de foco'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Coach que empuja a mantener foco',
    longDesc: 'Coach de enfoque. Detecta que estás disperso y te pide volver al bloque planeado. (Preview.)'
  },
  {
    flag: 'distractionBlocker',
    aliases: ['bloqueador de distracciones', 'anti distracciones', 'block distractions'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Alerta cuando cambias de contexto',
    longDesc: 'Detecta cambios de contexto durante bloques de foco y te pregunta si eso realmente era prioridad. (Preview.)'
  },
  {
    flag: 'smartTimer',
    aliases: ['timer', 'temporizador', 'pomodoro', 'smart timer'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Pomodoro consciente del contexto',
    longDesc: 'Timer que se adapta: bloques más largos para trabajo profundo, más cortos para tareas repetitivas. (Preview.)'
  },

  // ─────────────────────────────────────────────
  // Voz — sub-config
  // ─────────────────────────────────────────────
  {
    flag: 'voiceMode',
    aliases: ['modo de voz', 'como responde la voz'],
    kind: 'enum',
    enumValues: ['text_only', 'notifications_only', 'live_voice', 'wake_word_only'],
    enumAliases: {
      text_only:         ['solo texto', 'text only', 'sin voz'],
      notifications_only:['solo notificaciones', 'notificaciones'],
      live_voice:        ['voz en vivo', 'live voice', 'voz siempre'],
      wake_word_only:    ['solo con wake word', 'solo tras la palabra de activación', 'después de hi gunter', 'voz al invocarme']
    },
    risk: 'safe',
    shortDesc: 'Cómo se activa la voz',
    longDesc: 'Modo de voz. text_only = solo texto, notifications_only = solo avisos, live_voice = voz en conversación, wake_word_only = habla solo después de que la invoques.'
  },
  {
    flag: 'voiceSpeed',
    aliases: ['velocidad de voz', 'que tan rápido hablas', 'speed de voz'],
    kind: 'enum',
    enumValues: ['slow', 'normal', 'fast'],
    enumAliases: {
      slow: ['lento', 'despacio', 'slow'],
      normal: ['normal', 'medio'],
      fast: ['rápido', 'rapido', 'veloz', 'fast']
    },
    risk: 'safe',
    shortDesc: 'Velocidad de la voz',
    longDesc: 'Velocidad TTS. Slow para claridad, fast para agilidad.'
  },
  {
    flag: 'voiceInMeetings',
    aliases: ['voz en reuniones', 'que hables en reunión', 'voz durante reunión'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Hablar durante reuniones',
    longDesc: 'Permite que Gunter hable en voz durante una reunión activa (útil para copiloto de host).'
  },

  // ─────────────────────────────────────────────
  // Wake word — sub-config
  // ─────────────────────────────────────────────
  {
    flag: 'wakeWordListeningMode',
    aliases: ['modo de escucha', 'modo del wake word', 'como escucha el wake'],
    kind: 'enum',
    enumValues: ['manual', 'continuous'],
    enumAliases: {
      manual: ['manual', 'a demanda', 'cuando yo la active'],
      continuous: ['continuo', 'continuamente', 'siempre escuchando', 'siempre activa']
    },
    risk: 'safe',
    shortDesc: 'Cuándo escucha "Hi Gunter"',
    longDesc: 'Controla cuándo se activa el reconocimiento de voz para el wake word.'
  },

  // ─────────────────────────────────────────────
  // Modo Tutor · biblioteca curada + sesiones
  // ─────────────────────────────────────────────
  {
    flag: 'tutorMode',
    aliases: ['modo sabio', 'sabio', 'tutor', 'modo tutor', 'enseñame', 'ensename', 'clases', 'maestro', 'profe', 'profesor', 'biblioteca sabia'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Activa o desactiva el modo Sabio y su biblioteca curada',
    longDesc: 'Modo Sabio: Gunter accede a una biblioteca curada y puede explicar sus obras, sugerir rutas de estudio, hacer preguntas socráticas y seguir tu progreso. Al desactivarlo, esa biblioteca no se consulta; el conocimiento general de Gunter sigue disponible.'
  },
  {
    flag: 'voiceTone',
    aliases: ['tono de voz', 'tono al hablar'],
    kind: 'enum',
    enumValues: ['calm', 'neutral', 'expressive', 'intense'],
    enumAliases: {
      calm: ['calmado', 'tranquilo', 'sereno'],
      neutral: ['neutral'],
      expressive: ['expresivo', 'expresiva'],
      intense: ['intenso', 'enérgico', 'energetico']
    },
    risk: 'safe',
    shortDesc: 'Ajusta la expresividad de la voz'
  },
  {
    flag: 'wakeWordResponseMode',
    aliases: ['respuesta al invocarme', 'modo de respuesta al llamado', 'respuesta hablada al llamado', 'respuesta de hi gunter', 'respuesta wake word'],
    kind: 'enum',
    enumValues: ['voice', 'text'],
    enumAliases: { voice: ['con voz', 'hablada'], text: ['solo texto', 'escrita'] },
    risk: 'safe',
    shortDesc: 'Elige si Gunter confirma la invocación hablando o solo en texto'
  },
  {
    flag: 'wakeWord',
    aliases: ['palabra de activación personalizada', 'wake word personalizada', 'nombre para invocarte'],
    kind: 'text', risk: 'safe',
    shortDesc: 'Cambia la frase que activa a Gunter',
    longDesc: 'Frase personalizada para invocar a Gunter. Los llamados “Hi Gunter”, “Hola Gunter” y “Gunter” siguen disponibles.'
  },
  {
    flag: 'wakeWordAutoStopSeconds',
    aliases: ['tiempo de escucha', 'duración de escucha', 'tiempo para responder por voz'],
    kind: 'number', risk: 'safe',
    shortDesc: 'Cuánto espera Gunter una orden después de invocarlo'
  },
  {
    flag: 'voiceOnlyAfterWakeWord',
    aliases: ['voz solo después de invocarte', 'hablar solo después de hi gunter'],
    kind: 'boolean', risk: 'safe',
    shortDesc: 'Limita la voz conversacional a las respuestas después de invocar a Gunter'
  }
];

// ============================================
// Lookup helpers
// ============================================

const _normalized = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Busca la feature que matchea una frase. Devuelve la mejor coincidencia
 * o null si no hay match confiable.
 */
function findFeature(text) {
  const norm = _normalized(text);
  if (!norm) return null;

  let best = null;
  let bestScore = 0;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const feat of FEATURES) {
    for (const alias of feat.aliases) {
      const aliasNorm = _normalized(alias);
      if (!aliasNorm) continue;

      // 1. Match exacto de todo el texto → confianza máxima
      if (norm === aliasNorm) return { ...feat, matchedAlias: alias, score: 1.0 };

      // 2. Substring: el alias completo está en el texto
      if (norm.includes(aliasNorm)) {
        // Score base: specificidad del alias vs texto (longitud proporcional).
        // Aliases más largos y específicos ganan naturalmente sobre cortos.
        let score = aliasNorm.length / norm.length;
        // Bonus SOLO para aliases cortos bounded (palabra completa) que si no
        // no pasarían el threshold 0.4. Ejemplo: "voz" en "activa la voz" → 0.23 → 0.55.
        // Este bonus NUNCA supera a aliases más específicos (0.55 tope).
        if (score < 0.5) {
          const boundedRe = new RegExp('\\b' + escapeRe(aliasNorm) + '\\b');
          if (boundedRe.test(norm)) {
            score = Math.max(score, 0.55);
          }
        }
        if (score > bestScore) { best = { ...feat, matchedAlias: alias, score }; bestScore = score; }
      }

      // 3. Palabras del alias contenidas en la frase (multi-palabra)
      const words = aliasNorm.split(' ').filter(w => w.length > 3);
      if (words.length && words.every(w => norm.includes(w))) {
        const score = 0.6 + (words.length * 0.05);
        if (score > bestScore) { best = { ...feat, matchedAlias: alias, score }; bestScore = score; }
      }
    }
  }

  return best && best.score >= 0.4 ? best : null;
}

/**
 * Extrae el valor de un enum en la frase del usuario.
 * "cambia tu voz a warm" → 'warm'
 * "ponte más divertido" con feature.enumAliases['fun'] = ['divertido'] → 'fun'
 */
function extractEnumValue(feature, text) {
  if (feature.kind !== 'enum') return null;
  const norm = _normalized(text);
  const aliasMap = feature.enumAliases || {};

  for (const value of feature.enumValues) {
    const aliases = [value, ...(aliasMap[value] || [])];
    for (const a of aliases) {
      const aNorm = _normalized(a);
      if (aNorm && norm.includes(aNorm)) return value;
    }
  }
  return null;
}

/**
 * Determina intent de action a partir de texto libre.
 * Devuelve:
 *   { intent: 'toggle_on' | 'toggle_off' | 'set_enum' | 'query' | 'list' | null,
 *     feature, value?, confidence, matchedAlias }
 */
function classifyActionIntent(text) {
  const norm = _normalized(text);
  if (!norm) return null;

  // list  -- "qué tengo activo" / "cuáles funciones tengo" / "qué está encendido"
  if (/\b(que|cuales?)\b.*\b(tengo|tienes|hay|est[aá]n?)\b.*\b(activas?|activos?|encendidas?|encendidos?|prendidas?|prendidos?|on)\b/.test(norm)
   || /\blistar?\b\s*(funciones?|features?)?/.test(norm)
   || /\b(funciones?|features?)\s+(activas?|prendidas?|encendidas?|on)/.test(norm)) {
    return { intent: 'list', confidence: 0.9 };
  }

  // PRIORIDAD ENUM: si el texto contiene un valor de enum (ej. "warm", "divertido"),
  // priorizamos la feature enum que lo contiene por encima de matches simples de alias.
  const verbEnum = /\b(cambia|cambiar|ponte|pon|setea|set|hazte|se)\b/.test(norm);
  const enumMatches = FEATURES
    .filter(f => f.kind === 'enum')
    .map(feature => ({ feature, value: extractEnumValue(feature, text) }))
    .filter(match => match.value);
  if (verbEnum && enumMatches.length) {
    // No cambiar una preferencia por coincidir solo con un valor ambiguo
    // (p. ej. "suave" puede ser intensidad o agresividad del pulso).
    const explicit = enumMatches.find(({ feature }) =>
      feature.aliases.some(alias => norm.includes(_normalized(alias)))
    );
    const selected = explicit || (enumMatches.length === 1 ? enumMatches[0] : null);
    if (selected) {
      return {
        intent: 'set_enum',
        feature: selected.feature,
        value: selected.value,
        confidence: 0.85,
        matchedAlias: selected.feature.aliases.find(alias => norm.includes(_normalized(alias))) || selected.value
      };
    }
  }

  const feat = findFeature(text);
  if (!feat) return null;

  const isOn  = /\b(activa|activar|prende|prender|enciende|encender|habilita|habilitar|conecta|conectar|on|activate|enable)\b/.test(norm);
  const isOff = /\b(desactiva|desactivar|apaga|apagar|deshabilita|deshabilitar|desconecta|desconectar|quita|quitar|off|deactivate|disable)\b/.test(norm);
  const isQuery = /^(que|cual|como|donde|para que|explica|dime)\b/.test(norm)
               || /\?$/.test(text.trim())
               || /\b(esta|está)\s+(activo|activa|encendido|encendida|on|off)/.test(norm);

  if (feat.kind === 'text') {
    const setter = /\b(cambia|cambiar|pon|establece|setea|set)\b/.test(norm);
    const rawValue = setter ? String(text).match(/\b(?:a|por)\s+["'“]?(.+?)["'”]?\s*[.!?]*$/i)?.[1]?.trim() : '';
    if (!rawValue) return { intent: 'query', feature: feat, confidence: feat.score, matchedAlias: feat.matchedAlias };
    const value = rawValue.replace(/["'“”]/g, '').trim();
    if (value.length < 2 || value.length > 30 || !/^[\p{L}\p{N}][\p{L}\p{N} \-’']*$/u.test(value)) return null;
    return { intent: 'set_text', feature: feat, value, confidence: feat.score, matchedAlias: feat.matchedAlias };
  }

  if (feat.kind === 'number') {
    const match = norm.match(/\b(\d{1,2})\s*(?:segundos?|s)\b/);
    if (!match || !/\b(cambia|cambiar|pon|establece|setea|set)\b/.test(norm)) {
      return { intent: 'query', feature: feat, confidence: feat.score, matchedAlias: feat.matchedAlias };
    }
    const value = Number(match[1]);
    if (value < 5 || value > 60 || value % 5 !== 0) return null;
    return { intent: 'set_number', feature: feat, value, confidence: feat.score, matchedAlias: feat.matchedAlias };
  }

  // Detectar verbo del intent
  // enum: "cambia tu voz a warm" o "ponte más divertido"
  if (feat.kind === 'enum') {
    const val = extractEnumValue(feat, text);
    if (val) return { intent: 'set_enum', feature: feat, value: val, confidence: feat.score, matchedAlias: feat.matchedAlias };
    // sin valor explícito → query
    return { intent: 'query', feature: feat, confidence: feat.score, matchedAlias: feat.matchedAlias };
  }

  if (isQuery && !isOn && !isOff) {
    return { intent: 'query', feature: feat, confidence: feat.score, matchedAlias: feat.matchedAlias };
  }
  if (isOn && !isOff) {
    return { intent: 'toggle_on', feature: feat, confidence: feat.score, matchedAlias: feat.matchedAlias };
  }
  if (isOff && !isOn) {
    return { intent: 'toggle_off', feature: feat, confidence: feat.score, matchedAlias: feat.matchedAlias };
  }

  return { intent: 'query', feature: feat, confidence: feat.score * 0.7, matchedAlias: feat.matchedAlias };
}

function getFeature(flag) {
  return FEATURES.find(f => f.flag === flag) || null;
}

function listAll() {
  return FEATURES.map(f => ({
    flag: f.flag,
    kind: f.kind,
    aliases: f.aliases,
    shortDesc: f.shortDesc,
    risk: f.risk
  }));
}

module.exports = { FEATURES, findFeature, classifyActionIntent, extractEnumValue, getFeature, listAll };
