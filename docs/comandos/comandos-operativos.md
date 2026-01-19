# ⌨️ Comandos Operativos

El bot posee una serie de comandos especiales que pueden ser enviados tanto por WhatsApp como por WebChat para controlar su comportamiento en tiempo real.

## 🛠 Comandos de Administración

Estos comandos suelen ser utilizados por los administradores directamente en el chat.

| Comando | Acción | Canal |
| :--- | :--- | :--- |
| `#ON#` | **Activa** el bot. Comenzará a responder mensajes. | WhatsApp / Web |
| `#OFF#` | **Desactiva** el bot. Entrará en modo pausa. | WhatsApp |
| `#ACTUALIZAR#` | Fuerza la sincronización con **Google Sheets**. | WhatsApp |

## 🔄 Comandos de Usuario (Sesión)

| Comando | Acción | Canal |
| :--- | :--- | :--- |
| `#reset` | Reinicia la conversación y el hilo (Thread) de OpenAI. | WebChat |
| `#cerrar` | Equivalente a reset, finaliza la sesión actual. | WebChat |

---

### Detalle de Funcionamiento

#### `#ACTUALIZAR#`
Al recibir este comando, el bot ejecuta la función `updateMain()`. Esto descarga los datos más recientes de las hojas configuradas en `SHEET_ID_UPDATE_1`, `SHEET_ID_UPDATE_2`, y `SHEET_ID_UPDATE_3` y los sube al asistente de OpenAI (File Search / Vector Store).

> **Aviso**: El proceso de actualización puede demorar entre 5 a 15 segundos dependiendo del volumen de datos.

#### `#OFF#` y `#ON#`
El estado es persistente en memoria mientras el proceso esté corriendo. Si el bot se reinicia, el valor volverá al defecto definido en el código (habitualmente `active: true`).
