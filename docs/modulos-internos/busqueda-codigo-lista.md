# 🆔 Búsqueda de Producto por Código con Precio

Este módulo permite obtener la información de un producto específico mediante su código, incluyendo el precio de una lista determinada.

## 🤖 Activación por IA
El asistente debe usar la etiqueta `[JSON-BUSCAR_CODIGO_LISTA]` cuando el usuario proporcione un código de producto específico.

### Ejemplo de Etiqueta
```json
[API]
{
  "type": "#BUSCAR_CODIGO_LISTA#",
  "data": {
    "buscar": "P0085",
    "lista": 2
  }
}
[/API]
```

## 📋 Parámetros esperados
| Parámetro | Tipo | Descripción | Requerido |
| :--- | :--- | :--- | :--- |
| `buscar` | String | Código del producto (SKU). | ✅ |
| `lista` | Number | ID de la lista de precios a consultar. | ✅ |

## ⚙️ Funcionamiento
1. El sistema detecta `#BUSCAR_CODIGO_LISTA#`.
2. Llama al endpoint: `https://ventas.construsitio.com.ar/api/articulos/getproductbycodewithprice`.
3. Retorna la información del producto directamente al asistente.
