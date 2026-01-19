# 🤖 Información del Asistente

Este endpoint secundario permite a la interfaz web obtener metadatos dinámicos sobre el asistente configurado, como su nombre comercial.

## 📍 Definición Técnica
- **Método**: `GET`
- **Ruta**: `/api/assistant-name`
- **Protocolo**: HTTP/1.1

## 💻 Ejemplo de Llamada

```javascript
fetch('/api/assistant-name')
  .then(response => response.json())
  .then(data => console.log(data.name));
```

## 📤 Respuesta / Retorno

### Respuesta Exitosa (`200 OK`)
| Campo | Tipo | Descripción |
| :--- | :--- | :--- |
| `name` | String | El nombre configurado en la variable de entorno `ASSISTANT_NAME`. |

```json
{
  "name": "Asistente Virtual RialWay"
}
```

---
## 🔗 Enlaces Relacionados
- [Variables de Entorno](../configuracion/variables.md)
- [Procesar Mensajes](webchat.md)
