# 📝 Alta de Cliente

Este módulo permite al asistente registrar nuevos clientes en la base de datos central de ventas cuando se identifica a un nuevo prospecto interesado en comprar.

## 🤖 Activación por IA
Cuando la IA determina que el cliente no existe y ha recopilado los datos necesarios, envía:

```json
[API]
{
  "type": "#ALTA_CLIENTE#",
  "payload": {
    "dni_o_Cuit": "20301234567",
    "nombre": "Juan Pérez",
    "domicilio": "Av. Libertador 1234",
    "localidad": "CABA",
    "email": "juan.perez@email.com",
    "telefonos": "1144556677"
  }
}
[/API]
```

## 📋 Parámetros del Payload

| Parámetro | Tipo | Descripción | Requerido |
| :--- | :--- | :--- | :--- |
| `dni_o_Cuit` | String | Identificación fiscal o personal. | ✅ |
| `nombre` | String | Razón social o Nombre y Apellido. | ✅ |
| `domicilio` | String | Dirección de entrega o fiscal. | ✅ |
| `localidad` | String | Ciudad/Localidad. | ✅ |
| `email` | String | Correo electrónico de contacto. | ❌ |
| `telefonos` | String | Número de contacto. | ✅ |

## ⚙️ Funcionamiento
1. El procesador captura el trigger `#ALTA_CLIENTE#`.
2. Normaliza los campos (mapea `nombre` a `razonSocial_o_ApellidoNombre`, etc.).
3. Ejecuta `createClient` contra el endpoint `/clientes/newclient`.
4. Devuelve la confirmación ("Cliente ID: XXX creado") al asistente.
