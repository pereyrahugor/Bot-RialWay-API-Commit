# 👥 Búsqueda de Clientes

Este módulo es utilizado para validar la existencia de un cliente en el sistema comercial antes de proceder con una venta o un alta.

## 🤖 Activación por IA
El asistente puede invocar esta búsqueda enviando el bloque JSON `#BUSCAR_CLIENTE#`.

```json
[API]
{
  "type": "#BUSCAR_CLIENTE#",
  "payload": "20301234567"
}
[/API]
```

## 📋 Parámetros del Payload

| Parámetro | Tipo | Descripción | Requerido |
| :--- | :--- | :--- | :--- |
| `payload` | String | CUIT, DNI o Nombre del cliente a buscar. | ✅ |

## ⚙️ Funcionamiento
1. El sistema detecta el trigger y llama a `searchClient` en `src/API/Commit.ts`.
2. Realiza un `POST` a `https://ventas.construsitio.com.ar/api/clientes/searchclient`.
3. Si el cliente existe, devuelve los datos al asistente; de lo contrario, informa que no hubo resultados.

## 📤 Respuesta Detallada
El sistema comercial devuelve un objeto con los datos del cliente:

| Campo | Tipo | Descripción |
| :--- | :--- | :--- |
| `razonSocial` | String | Nombre o empresa del cliente. |
| `cuit` | String | CUIT/DNI registrado. |
| `saldo` | Number | Saldo actual en cuenta corriente (si aplica). |
| `condicion_iva` | String | Situación frente al IVA. |

### Ejemplo de Éxito
```json
{
  "status": "success",
  "data": {
    "id": 505,
    "razonSocial": "Juan Pérez",
    "cuit": "20301234567",
    "localidad": "Berazategui"
  }
}
```

---
> **Tip**: Si el cliente no existe, la IA debe ofrecer el [Alta de Cliente](alta-cliente.md).
