# Núcleo: voz real y continuidad visual

El analizador existente de `GunterVoice` mide RMS de la salida realmente
reproducida. El contexto de audio se prepara también al iniciar una respuesta
automática, sin necesitar otro clic cuando el navegador ya permite audio.
Si no existe señal utilizable, no se inventa amplitud ni se bloquea la voz.
El shader modula la emisión interna y los filamentos cercanos; no aplica
destellos globales ni una pulsación basada en el indicador «hablando».

`GunterCorePresence` controla únicamente posición y transición: transporta
el host y canvas originales de Inicio, conserva un ancla para su mapa, y usa
el compositor compartido de `GunterParticles`. Fuera de Inicio se ubica en
el círculo del chat inferior izquierdo; foco o puntero lo hacen asomarse.
El chat, su historial, controles y Permission Gate no se reemplazan.

Los cambios de sección usan una transición FLIP cancelable de 550 ms. Los
navegadores con transiciones entre documentos enlazan la misma identidad
por CSS; sin soporte, la nueva página coloca el núcleo en su destino sin
retrasar la navegación. No se interceptan enlaces ni se guarda estado privado.
Reducir movimiento evita desplazamientos y efectos de salida del círculo.

La resolución de render se mide con dimensiones de layout, no con el tamaño
temporalmente escalado: volver del círculo a Inicio no deja un canvas borroso.
WebGL, pestañas ocultas, BFCache y la ocultación del chat conservan su ciclo
de vida. No hay nuevos modelos, bibliotecas, micrófonos ni permisos.

Pruebas focalizadas: `core-presence-transition`, `core-renderer`,
`core-audio-levels`, `idle-core-gpu` y contratos de UI. Validación visual en
Chrome: Inicio ↔ Tareas, Configuración, chat y viewport móvil; prueba local
«Probar voz» completada. La escucha humana del dispositivo no es un benchmark.
