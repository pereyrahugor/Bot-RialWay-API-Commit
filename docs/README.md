# 🤖 Bot-RialWay API Commit

Bienvenido a la documentación técnica de **Bot-RialWay API Commit**. Este proyecto es una solución avanzada de automatización de ventas y atención al cliente impulsada por Inteligencia Artificial (OpenAI Assistants) e integrada con WhatsApp y WebChat.

## 🚀 Introducción

El sistema actúa como un puente inteligente entre los usuarios y los sistemas de gestión comercial. Utiliza un motor de flujo híbrido que permite transiciones fluidas entre respuestas naturales generadas por IA y ejecuciones de lógica persistente (como búsquedas en bases de datos, creación de clientes y toma de pedidos).

### 🛠 Tecnologías Core

- **Motor de Bot**: [BuilderBot](https://builderbot.app/) con proveedor **Baileys**.
- **IA**: OpenAI Assistants API (GPT-4o).
- **Comunicación**: Socket.IO para WebChat en tiempo real.
- **Backend**: Node.js / TypeScript.
- **Integraciones**: Google Sheets, Google Maps API, y API Comercial Construsitio.

---
> **Nota**: Para que el bot funcione en WhatsApp, deberás escanear el código QR que se generará en la consola (o se guardará en `bot.qr.png`) al iniciar el servicio por primera vez.
