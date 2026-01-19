# 🔑 Variables de Entorno

El sistema requiere una serie de variables configuradas en un archivo `.env` para su correcto funcionamiento. A continuación se detallan cada una de ellas.

## 🧠 OpenAI y Asistente

| Variable | Tipo | Descripción | Requerido |
| :--- | :--- | :--- | :--- |
| `ASSISTANT_ID` | String | ID del asistente principal creado en OpenAI Platform. | ✅ |
| `OPENAI_API_KEY` | String | API Key de OpenAI para el asistente principal. | ✅ |
| `ASSISTANT_ID_IMG` | String | ID del asistente especializado en procesamiento de imágenes. | ✅ |
| `OPENAI_API_KEY_IMG` | String | API Key de OpenAI para el asistente de imágenes. | ✅ |
| `ASSISTANT_NAME` | String | Nombre público que se mostrará en el WebChat. | ✅ |
| `VECTOR_STORE_ID` | String | ID del Vector Store de OpenAI para recuperación de archivos. | ✅ |

## 📊 Integración con Google

| Variable | Tipo | Descripción | Requerido |
| :--- | :--- | :--- | :--- |
| `GOOGLE_CLIENT_EMAIL` | String | Email de la cuenta de servicio de Google Cloud. | ✅ |
| `GOOGLE_PRIVATE_KEY` | String | Clave privada de la cuenta de servicio (con `\n`). | ✅ |
| `GOOGLE_MAPS_API_KEY` | String | API Key para geolocalización y mapas. | ✅ |
| `SHEET_ID_RESUMEN` | String | ID de la hoja de cálculo donde se guardan los reportes. | ✅ |

## ⚙️ Configuración del Bot

| Variable | Tipo | Descripción | Defecto |
| :--- | :--- | :--- | :--- |
| `PORT` | Number | Puerto en el que corre el servidor. | `8080` |
| `ID_GRUPO_WS` | String | JID del grupo de WhatsApp para reportes de errores. | - |
| `msjCierre` | String | Mensaje enviado al finalizar una conversación. | - |
| `timeOutCierre` | Number | Minutos de inactividad para cerrar sesión. | `7` |

## 🛒 API Comercial (Construsitio)

| Variable | Tipo | Descripción |
| :--- | :--- | :--- |
| `CONSTRUSITIO_CUIT` | String | CUIT para autenticación en la API de ventas. |
| `CONSTRUSITIO_EMAIL` | String | Email de acceso a la API comercial. |
| `CONSTRUSITIO_PASSWORD` | String | Contraseña de acceso a la API comercial. |

---

> **Tip**: Para obtener los `SHEET_ID`, búscalo en la URL de tu navegador al abrir el documento de Google Sheets:
> `https://docs.google.com/spreadsheets/d/ID_AQUI/edit`
