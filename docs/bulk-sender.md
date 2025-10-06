# Bulk sender workbook statuses

El script `bulk-sender.js` añade columnas de estado para cada contacto cuando se procesa un archivo de Excel. Las columnas se crean automáticamente si no existen:

- `whatsapp_status`
- `whatsapp_status_message`
- `whatsapp_last_checked`

## ¿Qué valores se escriben?

| Valor                     | Cuándo se usa                                                                 |
|---------------------------|-------------------------------------------------------------------------------|
| `INVALID_NUMBER`          | El número no tiene el formato venezolano esperado o la fila no incluye número |
| `NOT_REGISTERED`          | El número existe pero no está afiliado a WhatsApp                             |
| `REGISTERED`              | El número se validó como activo en WhatsApp                                   |

Además se almacena un mensaje de contexto y una marca de tiempo ISO en las otras dos columnas.

## ¿Qué ocurre en siguientes ejecuciones?

* Si una fila está marcada como `INVALID_NUMBER` o `NOT_REGISTERED`, el script la omite automáticamente en ejecuciones futuras para evitar validar el mismo número una y otra vez.
* Si una fila está marcada como `REGISTERED`, el script asume que sigue siendo válido y tampoco vuelve a consultar a WhatsApp. Añade la nota `"Validación omitida (resultado previo)."` en la columna de mensajes.
* Si necesitas forzar la revalidación de todos los números, establece la variable de entorno `BULK_FORCE_REVALIDATE=true` antes de ejecutar el script.

Al terminar la validación (incluso si se interrumpe la ejecución con `Ctrl+C`), el script guarda los cambios en el mismo archivo Excel, por lo que los estados quedan persistidos para la próxima corrida.
