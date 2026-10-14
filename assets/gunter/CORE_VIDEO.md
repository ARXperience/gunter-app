# Núcleo visual: video de referencia

## Procedencia y derechos

Referencia adjuntada por el usuario: `primary fear Made with @touchdesigner Music by @cryochamberlabel Sole Massif - Deca 30 CompoundN.mp4`.

- Archivo original: 27.182.664 bytes, 720 × 1280, 30 fps, 60,21 s.
- SHA-256 del original: `62e7a6b7bd70eb3167d88a91e5e5b79613ec76bbed09ac17318be2714710936d`.
- Se conserva el original fuera del repositorio; no se añade una copia de 27 MB.
- El usuario proporcionó el material como referencia para esta integración. Eso no demuestra titularidad ni una licencia de redistribución pública. No se declara que sea material propio, MIT ni de dominio público. Antes de distribuir públicamente la aplicación con este recurso, verificar la autorización correspondiente del titular del video. La pista musical no forma parte del recurso generado.

## Derivados locales

| Archivo | Formato | Tamaño |
| --- | --- | --- |
| `gunter-core-video.mp4` | H.264 Main, nivel 3.1, YUV420P, 576 × 720, 30 fps, 16,2667 s / 488 fotogramas; sin audio | 6.323.336 bytes |
| `gunter-core-video-poster.jpg` | JPEG, 576 × 720, fotograma original de 25 s | 70.372 bytes |

Conversión con el FFmpeg ya disponible en el proyecto, sin instalar bibliotecas multimedia. Se seleccionaron 17 segundos desde el segundo 8, conservando la imagen original: recorte `720:900:0:190`, escala Lanczos `576:720`, CRF 21, preset medium y dos hilos. El recorte elimina bandas exteriores y conserva el volumen de humo y los filamentos. El MP4 incluye `faststart` para comenzar la reproducción antes de descargar el archivo completo.

Para suavizar la unión del bucle se desplazó el comienzo 0,75 s y se fundió el final con esos 0,75 s iniciales mediante `xfade`. El último fotograma vuelve así a la región temporal que precede al comienzo del archivo. La duración final se ajusta a fotogramas enteros a 30 fps.

## Verificación específica

- FFmpeg reconoce y decodifica H.264 Main de 576 × 720; el MP4 contiene exclusivamente una pista de video, sin música ni otra pista de audio.
- Se revisó el póster generado: conserva el humo, las deformaciones y las zonas rojas luminosas de la referencia.
- Comprobación de continuidad, no benchmark: diferencia RGB absoluta media a 144 × 180 entre último y primer fotograma = 5,79 / 255. Los pares adyacentes al comienzo y al final dieron 4,37 y 8,41 / 255 respectivamente. La unión no presenta un salto de intensidad superior al movimiento adyacente medido. No implica una simulación físicamente periódica ni garantiza una unión imperceptible en toda pantalla.
- La recolorización, la geometría superpuesta y la reacción a estados/audio se realizan en la interfaz, no se precalculan en variantes de este video.
