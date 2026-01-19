# 💬 Procesar Mensajes (WebChat)

Este endpoint es utilizado por la interfaz web para enviar mensajes al bot y recibir la respuesta procesada por la IA y los módulos internos.

## 📍 Definición Técnica
- **Método**: `POST`
- **Ruta**: `/webchat-api`
- **Protocolo**: HTTP/1.1

## 📥 Parámetros de Entrada

### Body (JSON)
| Parámetro | Tipo | Descripción | Requerido |
| :--- | :--- | :--- | :--- |
| `message` | String | El contenido textual enviado por el usuario. | ✅ |

### Headers
| Header | Valor |
| :--- | :--- |
| `Content-Type` | `application/json` |

## 💻 Ejemplo de Request

```json
{
  "message": "Hola, me gustaría consultar el precio del cemento Avellaneda."
}
```

## 📤 Respuesta / Retorno

### Respuesta Exitosa (`200 OK`)
| Campo | Tipo | Descripción |
| :--- | :--- | :--- |
| `reply` | String | Respuesta generada por el bot (IA o lógica). |

```json
{
  "reply": "¡Hola! El precio actual del Cemento Avellaneda de 50kg es de $8.500. ¿Deseas que te lo agregue a un pedido?"
}
```

## ⚠️ Gestión de Errores

| Código | Descripción |
| :--- | :--- |
| `500 Internal Server Error` | Ocurrió un error al procesar el mensaje con el motor de IA. |

---

## 🔗 Enlaces Relacionados
- [Información del Asistente](assistant.md)
- [Búsqueda de Productos](../modulos-internos/busqueda-productos.md)
