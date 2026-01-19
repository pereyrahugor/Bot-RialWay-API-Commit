# 🛒 Toma de Pedido

Este módulo permite al asistente registrar pedidos directamente en el sistema comercial externo cuando el usuario confirma su intención de compra.

## 🤖 Activación por IA
El asistente dispara este proceso devolviendo un bloque JSON con el trigger `#TOMA_PEDIDO#`.

```json
[API]
{
  "type": "#TOMA_PEDIDO#",
  "payload": {
    "NumeroCuitoDNI": "20334445556",
    "Items": [
      { "codigo": "ART-001", "cantidad": 10 },
      { "codigo": "ART-045", "cantidad": 2 }
    ]
  }
}
[/API]
```

## 📋 Parámetros del Payload

| Parámetro | Tipo | Descripción | Requerido |
| :--- | :--- | :--- | :--- |
| `NumeroCuitoDNI` | String | Identificación del cliente (CUIT o DNI). | ✅ |
| `Items` | Array | Lista de objetos con `codigo` y `cantidad`. | ✅ |

### Detalle de Items
| Sub-Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `codigo` | String | Código interno del artículo. |
| `cantidad` | Number | Cantidad a solicitar. |

## ⚙️ Funcionamiento
1. Valida que el cliente exista previamente (o dispara flujo de alta).
2. Envía los datos a `/pedidos/neworder`.
3. El sistema comercial procesa la reserva/pedido.
4. El bot informa al usuario el número de comprobante o estado.

## 📤 Respuesta / Retorno
La API comercial devuelve un objeto indicando el resultado de la operación:

| Campo | Tipo | Descripción |
| :--- | :--- | :--- |
| `id_pedido` | String | Identificador único del pedido en el sistema. |
| `status` | String | Estado (ej: 'Ingresado', 'Error'). |
| `total` | Number | Monto total de la operación. |

### Ejemplo de Éxito
```json
{
  "status": "success",
  "data": {
    "id_pedido": "PED-2024-00123",
    "total": 125400.00,
    "mensaje": "Pedido registrado correctamente."
  }
}
```

---
> **Aviso**: Si el CUIT/DNI no está registrado, la IA debe primero invocar el módulo de [Alta de Cliente](alta-cliente.md).
