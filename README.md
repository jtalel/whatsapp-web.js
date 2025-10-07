<div align="center">
    <br />
    <p>
        <a href="https://wwebjs.dev"><img src="https://github.com/wwebjs/logos/blob/main/4_Full%20Logo%20Lockup_Small/small_banner_blue.png?raw=true" title="whatsapp-web.js" alt="whatsapp-web.js" width="500" /></a>
    </p>
    <br />
    <p>
        <a href="https://www.npmjs.com/package/whatsapp-web.js"><img src="https://img.shields.io/npm/v/whatsapp-web.js.svg" alt="Versión en npm" /></a>
        <img src="https://img.shields.io/badge/WhatsApp_Web-2.3000.1017054665-brightgreen.svg" alt="Compatibilidad con WhatsApp Web" />
    </p>
    <br />
</div>

## Acerca del proyecto

**Cliente no oficial de la API de WhatsApp que funciona sobre la aplicación web de WhatsApp.**

La biblioteca controla una sesión del navegador de WhatsApp Web mediante Puppeteer para exponer una API flexible de envío y recepción de mensajes. Gracias a ello se pueden automatizar flujos de trabajo en Node.js con casi todas las capacidades disponibles en la interfaz web oficial.

> [!IMPORTANT]
> WhatsApp no permite bots ni clientes no oficiales. Aunque el proyecto reduce el riesgo de bloqueo, no existe garantía alguna de que la cuenta no sea suspendida.

## Requisitos

* Node.js `>= 18`.
* Google Chrome o Chromium instalado si necesitas enviar GIFs o vídeos pesados.
* Credenciales válidas de WhatsApp para escanear el código QR cuando se inicializa el cliente.

## Instalación

```bash
npm install whatsapp-web.js
```

Si trabajas en un repositorio clonado, ejecuta `npm install` para descargar las dependencias de desarrollo necesarias para ejecutar pruebas y generar documentación.

## Uso básico

```js
const { Client } = require('whatsapp-web.js');

const client = new Client();

client.on('qr', (qr) => {
    console.log('QR RECIBIDO', qr);
});

client.on('ready', () => {
    console.log('¡El cliente está listo!');
});

client.on('message', msg => {
    if (msg.body === '!ping') {
        msg.reply('pong');
    }
});

client.initialize();
```

Consulta `example.js` para ver un ejemplo más completo y revisa las estrategias de autenticación disponibles en la documentación oficial para conservar sesiones entre reinicios.

## Scripts útiles

| Comando | Descripción |
| --- | --- |
| `npm test` | Ejecuta la batería de pruebas con Mocha. |
| `npm run test-single` | Ejecuta una prueba individual de Mocha (útil junto con opciones de CLI). |
| `npm run shell` | Abre una shell interactiva con el cliente ya configurado para depuración rápida. |
| `npm run generate-docs` | Genera la documentación JSDoc en la carpeta configurada. |

## Envío masivo desde Excel

El script `bulk-sender.js` permite cargar un archivo Excel con columnas `telefono` y `nombre` (o sus equivalentes en inglés) para enviar mensajes personalizados respetando un retraso configurable entre envíos.

```bash
node bulk-sender.js ./ruta/al/archivo.xlsx 7000
```

* El segundo argumento define el retraso mínimo en milisegundos entre mensajes (por defecto `5000`).
* Usa la opción `--optout <numero>` para registrar manualmente números que no deben volver a recibir mensajes. Puedes repetir la opción varias veces y los números se guardarán en `optout.txt` (o en la ruta definida por `BULK_OPTOUT_FILE`). Ejemplo durante un envío: `node bulk-sender.js contactos.xlsx --optout 4141234567 --optout 4247654321`.
* También puedes añadir números sin procesar un Excel ejecutando solo la opción: `node bulk-sender.js --optout 4141234567`. El script actualizará el archivo de opt-out y terminará inmediatamente.
* Variables de entorno disponibles:
  * `BULK_DEFAULT_COUNTRY_CODE`: Prefijo de país que se añadirá si el número no lo incluye.
  * `BULK_MESSAGE_TEMPLATE`: Plantilla de mensaje; admite los marcadores `{name}` y `{phone}`.
  * `BULK_MIN_DELAY_MS`: Retraso mínimo cuando no se pasa como argumento.
  * `BULK_OPTOUT_FILE`: Ruta del archivo donde se almacenan los números en opt-out (por defecto `optout.txt`).
* Los números se normalizan automáticamente (sin espacios, `+`, `00` inicial ni ceros sobrantes) y se omiten los registros con menos de 8 dígitos tras la limpieza.

## Funcionalidades admitidas

| Funcionalidad | Estado |
| ------------- | ------------- |
| Multi Dispositivo | ✅ |
| Envío de mensajes | ✅ |
| Recepción de mensajes | ✅ |
| Envío de imágenes/audio/documentos | ✅ |
| Envío de vídeo | ✅ (requiere Google Chrome) |
| Envío y recepción de stickers | ✅ |
| Recepción de medios | ✅ |
| Envío de tarjetas de contacto | ✅ |
| Envío de ubicaciones | ✅ |
| Botones y listas | ❌ (funciones oficiales en desuso) |
| Respuestas a mensajes | ✅ |
| Gestión de grupos (invitar, añadir, expulsar, promover) | ✅ |
| Menciones a usuarios y grupos | ✅ |
| Silenciar/activar chats | ✅ |
| Bloquear/desbloquear contactos | ✅ |
| Obtener información y fotos de perfil | ✅ |
| Cambiar estado del usuario | ✅ |
| Reaccionar a mensajes | ✅ |
| Crear encuestas y canales | ✅ |
| Votar en encuestas | 🔜 |
| Comunidades | 🔜 |

Si echas en falta alguna característica, abre un issue en el repositorio.

## Contribuciones

Toda contribución es bienvenida. Abre un pull request con tus cambios y, si se trata de una mejora importante, crea primero un issue para discutir la propuesta. Asegúrate de seguir las pautas del Código de Conducta.

## Apoya el proyecto

Si este proyecto te resulta útil, puedes apoyarlo con una donación en Bitcoin (Taproot):

```
bc1pfdjlc5p92pxzvacgc5nhn3vgtt54e98472ymxgtejaa0ttdx8lkqzn304u
```

¡Gracias por tu apoyo!

## Aviso legal

Este proyecto no está afiliado, asociado, autorizado, respaldado ni conectado oficialmente con WhatsApp o cualquiera de sus subsidiarias o afiliadas. El sitio oficial de WhatsApp es [whatsapp.com](https://whatsapp.com). "WhatsApp" y las marcas relacionadas son propiedad de sus respectivos dueños. Tampoco se garantiza que el uso de este cliente evite bloqueos o suspensiones de cuenta.

## Licencia

Copyright 2019 Pedro S. Lopez.

Las partes modificadas y ampliadas en este fork están protegidas por el copyright 2025 Talal Jomaa. Todos los fragmentos originales mantienen sus avisos correspondientes al autor original.

El proyecto se distribuye bajo la licencia Apache 2.0. Puedes consultar el texto completo en el archivo `LICENSE` incluido en el repositorio.

