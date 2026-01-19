# 🔍 Búsqueda de Productos

Este módulo es activado automáticamente por el asistente de IA cuando detecta que el usuario tiene una intención de consulta sobre el catálogo de artículos.

## 🤖 Activación por IA
El asistente debe incluir en su respuesta un bloque JSON con el siguiente formato para disparar la búsqueda:

```json
[API]
{
  "type": "#BUSCAR_PRODUCTO#",
  "payload": {
    "nombre": "Cemento",
    "marca": "Loma Negra"
  }
}
[/API]
```

## 📋 Parámetros del Payload

| Parámetro | Tipo | Descripción | Requerido |
| :--- | :--- | :--- | :--- |
| `nombre` | String | Palabra clave o nombre del producto. | ✅ |
| `marca` | String | Marca específica (opcional). | ❌ |

## ⚙️ Funcionamiento Interno
1. El parser `AssistantResponseProcessor` detecta el bloque `#BUSCAR_PRODUCTO#`.
2. Llama a la función `searchProduct` en `src/API/Commit.ts`.
3. Realiza una petición `POST` a la API de Ventas: `https://ventas.construsitio.com.ar/api/articulos/searchproducts`.
4. El resultado se reinyecta al asistente de IA para que genere una respuesta natural al usuario.

## 📤 Respuesta Detallada
El sistema comercial devuelve un objeto con la siguiente estructura (máximo 10 resultados):

| Campo | Tipo | Descripción |
| :--- | :--- | :--- |
| `codigo` | String | Código único del artículo. |
| `descripcion` | String | Nombre completo y detalles. |
| `precio` | Number | Precio unitario vigente. |
| `stock` | Boolean/Number | Disponibilidad en sistema. |

### Ejemplo de Retorno de API (Interno)
```json
{
  "status": "success",
  "data": [
    {
      "codigo": "ART-001",
      "descripcion": "Cemento Loma Negra 50kg",
      "precio": 9200.50,
      "stock": true
    }
  ]
}
```

---
> **Nota**: Si no se encuentran productos, el sistema enviará un mensaje de control al asistente para que este informe al usuario de forma amigable.
