# Recomendaciones según la actividad

«Soy docente y músico: ¿qué funciones me recomiendas de Gunter?» utiliza el
LLM existente, el contexto inmediato y la memoria explícita autorizada. Si
falta contexto, pregunta por actividad y objetivo, sin deducir una profesión
de un nombre o encasillar al usuario en un solo rol.

`GunterAssistantTools.getRecommendationContext` aporta un catálogo compacto de
preferencias reales, rutas y estados. `nlp-llm-service` lo reutiliza en texto y
streaming; distingue activación de disponibilidad. No se crea otro perfil ni
almacén y no se envía la memoria local a cloud. «Recuerda que…» sigue siendo
la vía explícita para conservar información entre conversaciones.

Pedir consejos sobre qué activar nunca se reescribe como una orden ejecutable:
el registro, el dispatcher legado y las automatizaciones dejan esa consulta
al razonamiento. «Activa el planificador diario» mantiene su confirmación normal.
La preferencia de recomendaciones proactivas no impide responder una consulta
explícita. No se garantizan recomendaciones si el LLM seleccionado no está disponible.

Pruebas focalizadas: `node test/personalized-guidance.js`,
`node test/settings-awareness.js` y `node test/context-personality.js`.
