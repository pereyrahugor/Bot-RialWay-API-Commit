# 👋 Mensaje Inicial (Welcome Flow)

El bot está configurado para reaccionar a cualquier mensaje inicial que no sea un comando operativo, dándole la bienvenida al usuario y derivando la conversación al asistente de OpenAI.

## ⚙️ Funcionamiento
1. El bot detecta un mensaje entrante de texto.
2. Identifica si el usuario tiene una sesión activa (Thread) o crea una nueva.
3. El mensaje se envía a la función `processUserMessage` en `app.ts`.
4. El asistente de OpenAI genera la respuesta de bienvenida basada en su "Instructions" y conocimiento previo.

## 🎙️ Notas de Voz (`welcomeFlowVoice.ts`)

Cuando un usuario envía un audio por WhatsApp:
- El bot utiliza el servicio de **transcripción** de OpenAI (Whisper).
- El texto transcrito es procesado por el asistente como si fuera un mensaje de texto normal.
- El bot responde de forma textual (por defecto).

---
> **Tip**: Puedes personalizar el tono de la bienvenida modificando las instrucciones del Asistente en el panel de control de OpenAI Platform.
