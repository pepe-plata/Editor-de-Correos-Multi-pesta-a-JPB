# Editor de Correos

Editor de correos en el navegador con soporte para múltiples pestañas, apertura de archivos `.msg`, `.eml` y `.html`, y herramientas de formato enriquecido similares a Outlook.

## Características

- **Multi-pestaña**: Abre varios correos a la vez, cada uno con su propio estado.
- **Apertura de archivos**:
  - `.msg` (Outlook) — parseado con `msglens-cli`, que respeta la página de códigos del archivo para mostrar correctamente acentos y caracteres especiales.
  - `.eml` (estándar MIME) — parseado con `postal-mime`, con resolución de imágenes inline (`cid:` → `data:`).
  - `.html` — recupera asunto, destinatarios y cuerpo desde las etiquetas `<meta>` del propio editor.
- **Destinatarios**: Campos "Para" y "CC" que se rellenan automáticamente al abrir un correo.
- **Formato enriquecido**:
  - Tipo y tamaño de letra (incluye Aptos, Calibri y otras fuentes comunes de Outlook/Gmail).
  - Negrita, cursiva, subrayado, tachado, superíndice y subíndice.
  - Color de texto y de fondo con paletas, colores recientes y colores del correo abierto.
  - Alineación, listas, sangría e interlineado.
  - Inserción de imágenes, enlaces, tablas, líneas horizontales y emojis.
- **Zoom**: `Ctrl + rueda del ratón` (o `Ctrl + +` / `Ctrl + -` / `Ctrl + 0`) con indicador de porcentaje.
- **Exportación**: Ver, copiar o descargar el HTML generado.

## Requisitos

- Un navegador moderno (Chrome, Edge, Firefox, Safari).
- Conexión a internet la primera vez que se carga la página, para descargar las librerías desde el CDN (`esm.sh`).
- Servidor local para servir los archivos (no funciona con `file://` porque `app.js` usa módulos ES).

## Cómo ejecutar

1. Clona o descarga los archivos en una carpeta: