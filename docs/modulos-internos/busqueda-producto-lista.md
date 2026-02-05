# 💰 Búsqueda de Productos con Lista de Precios

Este módulo permite al asistente consultar productos devolviendo el precio específico de una lista de precios determinada.

## 🤖 Activación por IA
El asistente debe incluir un bloque JSON con la etiqueta `[JSON-BUSCAR_PRODUCTO_LISTA]` para activar esta búsqueda.

### Ejemplo de Etiqueta
```json
[API]
{
  "type": "#BUSCAR_PRODUCTO_LISTA#",
  "data": {
    "buscar": "Tinta Negra",
    "lista": 2
  }
}
[/API]
```

## 📋 Parámetros esperados
| Parámetro | Tipo | Descripción | Requerido |
| :--- | :--- | :--- | :--- |
| `buscar` | String | Nombre o término de búsqueda del producto. | ✅ |
| `lista` | Number | ID de la lista de precios a consultar. | ✅ |

## ⚙️ Funcionamiento
1. El sistema detecta `#BUSCAR_PRODUCTO_LISTA#`.
2. Llama al endpoint: `https://ventas.construsitio.com.ar/api/articulos/searchproductswithprice`.
3. Envía los resultados completos al asistente para su interpretación.

---
> **Nota**: Los resultados se envían sin límite de objetos al asistente, permitiendo una visión completa del catálogo para el término buscado.
