# 🛠 Tecnologías del Sistema

El bot está construido sobre un stack moderno y escalable, diseñado para integrarse con múltiples plataformas.

## 🧱 Arquitectura Técnica

### 1. Motor de Chat (BuilderBot)
Utilizamos [BuilderBot](https://builderbot.app/) como orquestador de flujos.
- **Provider**: Baileys (Conexión directa vía WebSockets a WhatsApp).
- **Database**: MemoryDB (Sesiones temporales volátiles).

### 2. Capa de Inteligencia (OpenAI)
El "cerebro" del bot reside en OpenAI Platform.
- **Model**: GPT-4o o GPT-4o-mini.
- **Assistants API**: Gestión de hilos de conversación persistentes y recuperación de conocimientos (RAG) mediante Vector Stores.

### 3. Servidor Web (Polka & Socket.IO)
- **Servidor**: Polka (Ligero y de alto rendimiento).
- **Comunicación Web**: Socket.IO para mantener una conexión bidireccional estable con el WebChat frontal.

### 4. Integraciones de Datos
- **Google Sheets API**: Consumo de datos dinámicos (precios, stock manual).
- **Google Maps API**: Análisis de ubicaciones y georreferenciación.

## 📦 Dependencias Principales
```json
{
  "@builderbot/bot": "latest",
  "@builderbot/provider-baileys": "latest",
  "@builderbot-plugins/openai-assistants": "latest",
  "openai": "^4.x",
  "socket.io": "^4.x",
  "axios": "^1.x"
}
```
