import { JsonBlockFinder } from "../API/JsonBlockFinder";
import { searchProduct } from "../API/Commit";
import { searchClient } from "../API/Commit";
import fs from 'fs';
import moment from 'moment';

function limpiarBloquesJSON(texto: string): string {
    return texto.replace(/\[API\][\s\S]*?\[\/API\]/g, "");
}

// Ajustar fecha/hora a GMT-3 (hora argentina)
// function toArgentinaTime(fechaReservaStr: string): string {
//     const [fecha, hora] = fechaReservaStr.split(' ');
//     const [anio, mes, dia] = fecha.split('-').map(Number);
//     const [hh, min] = hora.split(':').map(Number);
//     const date = new Date(Date.UTC(anio, mes - 1, dia, hh, min));
//     date.setHours(date.getHours() - 3);
//     const yyyy = date.getFullYear();
//     const mm = String(date.getMonth() + 1).padStart(2, '0');
//     const dd = String(date.getDate()).padStart(2, '0');
//     const hhh = String(date.getHours()).padStart(2, '0');
//     const mmm = String(date.getMinutes()).padStart(2, '0');
//     return `${yyyy}-${mm}-${dd} ${hhh}:${mmm}`;
// }

// function corregirFechaAnioVigente(fechaReservaStr: string): string {
// function toArgentinaTime(fechaReservaStr: string): string {
//     // Recibe 'YYYY-MM-DD HH:mm' y ajusta a GMT-3
//     const [fecha, hora] = fechaReservaStr.split(' ');
//     const [anio, mes, dia] = fecha.split('-').map(Number);
//     const [hh, min] = hora.split(':').map(Number);
//     // Construir fecha en UTC y restar 3 horas
//     const date = new Date(Date.UTC(anio, mes - 1, dia, hh, min));
//     date.setHours(date.getHours() - 3);
//     const yyyy = date.getFullYear();
//     const mm = String(date.getMonth() + 1).padStart(2, '0');
//     const dd = String(date.getDate()).padStart(2, '0');
//     const hhh = String(date.getHours()).padStart(2, '0');
//     const mmm = String(date.getMinutes()).padStart(2, '0');
//     return `${yyyy}-${mm}-${dd} ${hhh}:${mmm}`;
// }
//     const ahora = new Date();
//     const vigente = ahora.getFullYear();
//     const [fecha, hora] = fechaReservaStr.split(" ");
//     const [anioRaw, mes, dia] = fecha.split("-").map(Number);
//     let anio = anioRaw;
//     if (anio < vigente) anio = vigente;
//     return `${anio.toString().padStart(4, "0")}-${mes.toString().padStart(2, "0")}-${dia.toString().padStart(2, "0")} ${hora}`;
// }

function esFechaFutura(fechaReservaStr: string): boolean {
    const ahora = new Date();
    const fechaReserva = new Date(fechaReservaStr.replace(" ", "T"));
    return fechaReserva >= ahora;
}

export class AssistantResponseProcessor {
    static async analizarYProcesarRespuestaAsistente(
        response: any,
        ctx: any,
        flowDynamic: any,
        state: any,
        provider: any,
        gotoFlow: any,
        getAssistantResponse: Function,
        ASSISTANT_ID: string
    ) {
        // Log de mensaje entrante del asistente (antes de cualquier filtro)
        if (ctx && ctx.type === 'webchat') {
            console.log('[Webchat Debug] Mensaje entrante del asistente:', response);
        } else {
            console.log('[WhatsApp Debug] Mensaje entrante del asistente:', response);
        }
        let jsonData: any = null;
        const textResponse = typeof response === "string" ? response : String(response || "");

        // Log de mensaje saliente al usuario (antes de cualquier filtro)
        if (ctx && ctx.type === 'webchat') {
            console.log('[Webchat Debug] Mensaje saliente al usuario (sin filtrar):', textResponse);
        } else {
            console.log('[WhatsApp Debug] Mensaje saliente al usuario (sin filtrar):', textResponse);
        }
        // 1) Extraer bloque [API] ... [/API]
        const apiBlockRegex = /\[API\](.*?)\[\/API\]/is;
        const match = textResponse.match(apiBlockRegex);
        if (match) {
            const jsonStr = match[1].trim();
            console.log('[Debug] Bloque [API] detectado:', jsonStr);
            try {
                jsonData = JSON.parse(jsonStr);
            } catch (e) {
                jsonData = null;
                if (ctx && ctx.type === 'webchat') {
                    console.log('[Webchat Debug] Error al parsear bloque [API]:', jsonStr);
                }
            }
        }

        // 2) Fallback heurístico (desactivado, solo [API])
        if (!jsonData) {
            jsonData = JsonBlockFinder.buscarBloquesJSONEnTexto(textResponse) || (typeof response === "object" ? JsonBlockFinder.buscarBloquesJSONProfundo(response) : null);
            if (!jsonData && ctx && ctx.type === 'webchat') {
                console.log('[Webchat Debug] No JSON block detected in assistant response. Raw output:', textResponse);
            }
        }

        // 3) Procesar JSON si existe
        if (jsonData && typeof jsonData.type === "string") {
            // Log para detectar canal y datos antes de enviar
            if (ctx && ctx.type !== 'webchat') {
                console.log('[WhatsApp Debug] Antes de enviar con flowDynamic:', jsonData, ctx.from);
            }
            const tipo = jsonData.type.trim();

            if (tipo === "#BUSCAR_PRODUCTO#") {
                try {
                    const payload = jsonData.payload || jsonData.data || {};
                    const result = await searchProduct(payload);
                    console.log("Resultado de searchProduct:", result);
                    // Reinyectar el resultado al asistente y mostrar SOLO la respuesta del asistente al usuario
                    let apiResultText;
                    if (result && result.data) {
                        if (Array.isArray(result.data)) {
                            apiResultText = JSON.stringify(result.data.slice(0, 10));
                        } else {
                            apiResultText = JSON.stringify(result.data);
                        }
                    } else {
                        apiResultText = "No se encontraron resultados para la búsqueda.";
                    }
                    // Llamar al asistente con el resultado de la API
                    if (getAssistantResponse && typeof getAssistantResponse === 'function') {
                        const respuestaAsistente = await getAssistantResponse(
                            ASSISTANT_ID,
                            apiResultText,
                            state,
                            undefined,
                            ctx.from,
                            ctx.from
                        );
                        // Procesar la respuesta final del asistente (puede contener [API] anidados)
                        await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                            respuestaAsistente,
                            ctx,
                            flowDynamic,
                            state,
                            provider,
                            gotoFlow,
                            getAssistantResponse,
                            ASSISTANT_ID
                        );
                        return; // Importante: no continuar con el flujo normal después de la recursividad
                    } else {
                        // Fallback: mostrar el resultado plano si no hay getAssistantResponse
                        await flowDynamic([{ body: apiResultText }]);
                        return;
                    }
                } catch (err) {
                    console.error("Error al ejecutar searchProduct:", err);
                    // Enviar el error al asistente y mostrar solo la respuesta natural
                    let errorMsg = "Ocurrió un error al buscar el producto.";
                    if (getAssistantResponse && typeof getAssistantResponse === 'function') {
                        const respuestaAsistente = await getAssistantResponse(
                            ASSISTANT_ID,
                            errorMsg,
                            state,
                            undefined,
                            ctx.from,
                            ctx.from
                        );
                        await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                            respuestaAsistente,
                            ctx,
                            flowDynamic,
                            state,
                            provider,
                            gotoFlow,
                            getAssistantResponse,
                            ASSISTANT_ID
                        );
                    } else {
                        await flowDynamic([{ body: errorMsg }]);
                    }
                    return;
                }
            } else if (tipo === "#BUSCAR_CLIENTE#") {
                try {
                    const payload = jsonData.payload || jsonData.data || {};
                    const result = await searchClient(payload);
                    console.log("Resultado de searchClient:", result);
                    // Reinyectar el resultado al asistente y mostrar SOLO la respuesta del asistente al usuario
                    let apiResultText;
                    if (result && result.data) {
                        if (Array.isArray(result.data)) {
                            apiResultText = JSON.stringify(result.data.slice(0, 10));
                        } else {
                            apiResultText = JSON.stringify(result.data);
                        }
                    } else {
                        apiResultText = "No se encontraron resultados para la búsqueda.";
                    }
                    // Llamar al asistente con el resultado de la API
                    if (getAssistantResponse && typeof getAssistantResponse === 'function') {
                        const respuestaAsistente = await getAssistantResponse(
                            ASSISTANT_ID,
                            apiResultText,
                            state,
                            undefined,
                            ctx.from,
                            ctx.from
                        );
                        // Procesar la respuesta final del asistente (puede contener [API] anidados)
                        await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                            respuestaAsistente,
                            ctx,
                            flowDynamic,
                            state,
                            provider,
                            gotoFlow,
                            getAssistantResponse,
                            ASSISTANT_ID
                        );
                        return; // Importante: no continuar con el flujo normal después de la recursividad
                    } else {
                        // Fallback: mostrar el resultado plano si no hay getAssistantResponse
                        await flowDynamic([{ body: apiResultText }]);
                        return;
                    }
                } catch (err) {
                    console.error("Error al ejecutar searchClient:", err);
                    let errorMsg = "Ocurrió un error al buscar el cliente.";
                    if (getAssistantResponse && typeof getAssistantResponse === 'function') {
                        const respuestaAsistente = await getAssistantResponse(
                            ASSISTANT_ID,
                            errorMsg,
                            state,
                            undefined,
                            ctx.from,
                            ctx.from
                        );
                        await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                            respuestaAsistente,
                            ctx,
                            flowDynamic,
                            state,
                            provider,
                            gotoFlow,
                            getAssistantResponse,
                            ASSISTANT_ID
                        );
                    } else {
                        await flowDynamic([{ body: errorMsg }]);
                    }
                    return;
                }
            } else if (tipo === "#ALTA_CLIENTE#") {
                try {
                    let payload = jsonData.payload || jsonData.data || {};
                    // Normalizar campos para la API (ejemplo: convertir nombres de campos si es necesario)
                    // Puedes adaptar este mapeo según los requerimientos reales de la API
                    if (payload) {
                        payload = {
                            dni_o_Cuit: payload.dni_o_Cuit || payload.dni || payload.cuit || "",
                            codigo: "", // Siempre vacío
                            razonSocial_o_ApellidoNombre: payload.razonSocial_o_ApellidoNombre || payload.razonSocial || payload.apellidoNombre || payload.nombre || "",
                            domicilio: payload.domicilio || "",
                            localidad: payload.localidad || "",
                            provincia: payload.provincia || "",
                            email: payload.email || "",
                            telefonos: payload.telefonos || payload.telefono || "",
                            contacto: payload.contacto || "",
                            condicionesComerciales: payload.condicionesComerciales || null
                        };
                    }
                    const result = await import("../API/Commit").then(m => m.createClient(payload));
                    console.log("Resultado de createClient:", result);
                    // Reinyectar el resultado al asistente y mostrar SOLO la respuesta del asistente al usuario
                    let apiResultText;
                    if (result && result.data) {
                        if (Array.isArray(result.data)) {
                            apiResultText = JSON.stringify(result.data.slice(0, 10));
                        } else {
                            apiResultText = JSON.stringify(result.data);
                        }
                    } else {
                        apiResultText = "No se pudo crear el cliente.";
                    }
                    // Llamar al asistente con el resultado de la API
                    if (getAssistantResponse && typeof getAssistantResponse === 'function') {
                        const respuestaAsistente = await getAssistantResponse(
                            ASSISTANT_ID,
                            apiResultText,
                            state,
                            undefined,
                            ctx.from,
                            ctx.from
                        );
                        // Procesar la respuesta final del asistente (puede contener [API] anidados)
                        await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                            respuestaAsistente,
                            ctx,
                            flowDynamic,
                            state,
                            provider,
                            gotoFlow,
                            getAssistantResponse,
                            ASSISTANT_ID
                        );
                        return; // Importante: no continuar con el flujo normal después de la recursividad
                    } else {
                        // Fallback: mostrar el resultado plano si no hay getAssistantResponse
                        await flowDynamic([{ body: apiResultText }]);
                        return;
                    }
                } catch (err) {
                    console.error("Error al ejecutar createClient:", err);
                    let errorMsg = "Ocurrió un error al crear el cliente.";
                    if (getAssistantResponse && typeof getAssistantResponse === 'function') {
                        const respuestaAsistente = await getAssistantResponse(
                            ASSISTANT_ID,
                            errorMsg,
                            state,
                            undefined,
                            ctx.from,
                            ctx.from
                        );
                        await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                            respuestaAsistente,
                            ctx,
                            flowDynamic,
                            state,
                            provider,
                            gotoFlow,
                            getAssistantResponse,
                            ASSISTANT_ID
                        );
                    } else {
                        await flowDynamic([{ body: errorMsg }]);
                    }
                    return;
                }
            } else if (tipo === "#TOMA_PEDIDO#") {
                // Implementar lógica para toma pedido si es necesario
            }
        }

        // Si no hubo bloque JSON válido, o después de procesar cualquier flujo, enviar el texto limpio
        const cleanTextResponse = limpiarBloquesJSON(textResponse).trim();
        // Lógica especial para reserva: espera y reintento
        if (cleanTextResponse.includes('Voy a proceder a realizar la reserva.')) {
            // Espera 30 segundos y responde ok al asistente
            await new Promise(res => setTimeout(res, 30000));
            let assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx.from, ctx.from);
            // Si la respuesta contiene (ID: ...), no la envíes al usuario, espera 10s y vuelve a enviar ok
            while (assistantApiResponse && /(ID:\s*\w+)/.test(assistantApiResponse)) {
                console.log('[Debug] Respuesta contiene ID de reserva, esperando 10s y reenviando ok...');
                await new Promise(res => setTimeout(res, 10000));
                assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx.from, ctx.from);
            }
            // Cuando la respuesta no contiene el ID, envíala al usuario
            if (assistantApiResponse) {
                try {
                    await flowDynamic([{ body: limpiarBloquesJSON(String(assistantApiResponse)).trim() }]);
                    if (ctx && ctx.type !== 'webchat') {
                        console.log('[WhatsApp Debug] flowDynamic ejecutado correctamente');
                    }
                } catch (err) {
                    console.error('[WhatsApp Debug] Error en flowDynamic:', err);
                }
            }
        } else if (cleanTextResponse.length > 0) {
            const chunks = cleanTextResponse.split(/\n\n+/);
            for (const chunk of chunks) {
                if (chunk.trim().length > 0) {
                    try {
                        await flowDynamic([{ body: chunk.trim() }]);
                        if (ctx && ctx.type !== 'webchat') {
                            console.log('[WhatsApp Debug] flowDynamic ejecutado correctamente');
                        }
                    } catch (err) {
                        console.error('[WhatsApp Debug] Error en flowDynamic:', err);
                    }
                }
            }
        }
    }
}

