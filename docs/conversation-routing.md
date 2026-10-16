# Conversación y herramientas: una sola ruta verificada

Las preguntas educativas, explicativas y creativas usan el LLM existente, sin
pasar por activadores históricos ni convertir verbos citados en acciones.
Las consultas de configuración reconocidas siguen consultando el catálogo
real. Explicar cómo hacer algo no autoriza hacerlo. No se amplió el acceso a
dispositivos ni se incorporaron modelos, bases de datos o servicios externos.

Chat y voz navegan mediante `GunterAssistantTools` y su catálogo allowlist;
se retiró el atajo duplicado del companion que apuntaba a rutas antiguas.
Se aceptan nombres de sección y variantes como «llévame al apartado de voz».
El catálogo de Sabio solo se abre al pedir explícitamente su biblioteca o
modo: preguntar por un autor o una biblioteca pública sigue siendo general.

«¿Qué puedes hacer?» muestra las descripciones del registro de herramientas
cargado y el número de ajustes locales; no afirma que estén conectados sus
servicios. Disponibilidad, cuenta, permisos, confirmación y verificación se
resuelven al ejecutar cada herramienta, conservando sus políticas actuales.
Las funciones que requieren selección de archivos, consentimiento del
navegador o controles sensibles siguen su flujo de pantalla; no se simulan.

Pruebas aisladas: `test/general-conversation-routing.js`,
`test/companion-navigation.js` y los casos relacionados de configuración.
No validan respuestas de conocimiento del modelo ni disponibilidad real de
conexiones: validan enrutamiento, catálogo y ausencia de acciones no pedidas.
