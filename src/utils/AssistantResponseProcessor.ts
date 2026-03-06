import { JsonBlockFinder } from "../API/JsonBlockFinder";
import { searchProduct, searchProductsWithPrice, getProductByCodeWithPrice, searchClient, createClient, createOrder } from "../API/Commit";
import fs from 'fs';
import moment from 'moment';
import OpenAI from "openai";
import { HistoryHandler } from './historyHandler';
import { ErrorReporter } from "./errorReporter";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function waitForActiveRuns(threadId: string) {
    if (!threadId) return;
    try {
        console.log(`[AssistantResponseProcessor] Verificando runs activos en thread ${threadId}...`);
        let attempt = 0;
        const maxAttempts = 20; // 40-60 segundos total
        while (attempt < maxAttempts) {
            const runs = await openai.beta.threads.runs.list(threadId, { limit: 5 });
            const activeRun = runs.data.find(run => 
                ["queued", "in_progress", "cancelling", "requires_action"].includes(run.status)
            );
            
            if (activeRun) {
                console.log(`[AssistantResponseProcessor] [${attempt}/${maxAttempts}] Run activo detectado (${activeRun.id}, estado: ${activeRun.status}). Esperando 2s...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempt++;
            } else {
                console.log(`[AssistantResponseProcessor] No hay runs activos. OK.`);
                // Delay adicional reducido pero presente para asegurar sincronización de OpenAI
                await new Promise(resolve => setTimeout(resolve, 1500));
                return;
            }
        }
        console.warn(`[AssistantResponseProcessor] Timeout esperando liberación del thread ${threadId}.`);
    } catch (error) {
        console.error(`[AssistantResponseProcessor] Error verificando runs:`, error);
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// Mapa global para bloquear usuarios de WhatsApp durante operaciones API
const userApiBlockMap = new Map();
const API_BLOCK_TIMEOUT_MS = 5000; // 5 segundos

function limpiarBloquesJSON(texto: string): string {
    if (!texto || typeof texto !== 'string') return "";
    
    // 1. Preservar bloques especiales temporalmente
    const specialBlocks: string[] = [];
    let textoConMarcadores = texto;
    
    // Preservar [API]...[/API] (Tolerante a espacios)
    textoConMarcadores = textoConMarcadores.replace(/\[\s*API\s*\][\s\S]*?\[\/\s*API\s*\]/gi, (match) => {
        const index = specialBlocks.length;
        specialBlocks.push(match);
        return `___SPECIAL_BLOCK_${index}___`;
    });
    
    // 2. Limpiar referencias de OpenAI tipo 【4:0†archivo.pdf】
    let limpio = textoConMarcadores.replace(/【.*?】/g, "");

    // 2b. Limpiar bloques JSON sueltos (queries o resultados que a veces fuga el asistente)
    limpio = limpio.replace(/\{\s*"queries"\s*:\s*\[[\s\S]*?\]\s*\}[\s,]*?/gi, "");
    limpio = limpio.replace(/\{\s*"type"\s*:\s*"#[\s\S]*?"[\s\S]*?\}[\s,]*?/gi, "");
    
    // 2c. Limpiar bloques de PDF [PDF: ID]
    limpio = limpio.replace(/\[\s*PDF\s*:\s*[\s\S]*?\]/gi, "");

    // 2d. FILTRADO CRÍTICO: Eliminar SYSTEM_API_RESULT y SYSTEM_DB_RESULT (Regex salvaje contra fugas)
    // Se "engulle" incluso si el bloque está mal cerrado o cortado
    limpio = limpio.replace(/\[?\s*SYSTEM_(?:DB|API)_RESULT[\s\S]*?(?:\]|$)/gi, "");

    // 3. Restaurar bloques especiales
    specialBlocks.forEach((block, index) => {
        limpio = limpio.replace(`___SPECIAL_BLOCK_${index}___`, block);
    });
    
    return limpio.trim();
}

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
        ASSISTANT_ID: string,
        recursionDepth: number = 0
    ) {
        if (recursionDepth > 5) {
            console.error('[AssistantResponseProcessor] Límite de recursión alcanzado (5). Abortando.');
            await flowDynamic([{ body: "Lo siento, hubo un problema procesando la respuesta. Por favor, intenta de nuevo." }]);
            return;
        }

        // Si el usuario está bloqueado por una operación API, evitar procesar nuevos mensajes (WhatsApp)
        if (ctx && ctx.type !== 'webchat' && userApiBlockMap.has(ctx.from)) {
            console.log(`[API Block] Mensaje ignorado de usuario bloqueado: ${ctx.from}`);
            return;
        }

        let jsonData: any = null;
        const textResponseRaw = typeof response === "string" ? response : String(response || "");
        const textResponse = textResponseRaw.replace(/\0/g, '').trim();

        // 1) Extraer bloque [API] ... [/API]
        const apiBlockRegex = /\[\s*API\s*\]([\s\S]*?)\[\/\s*API\s*\]/is;
        const match = textResponse.match(apiBlockRegex);
        if (match) {
            const jsonStr = match[1].trim();
            try {
                jsonData = JSON.parse(jsonStr);
            } catch (e) {
                console.error('[AssistantResponseProcessor] Error al parsear bloque [API]:', e.message);
                jsonData = null;
            }
        }

        // 2) Fallback heurístico si no hay bloque explícito
        if (!jsonData) {
            jsonData = JsonBlockFinder.buscarBloquesJSONEnTexto(textResponse) || (typeof response === "object" ? JsonBlockFinder.buscarBloquesJSONProfundo(response) : null);
        }

        // 3) Procesar JSON si existe
        if (jsonData && typeof jsonData.type === "string") {
            let apiResponse: any = null;
            let unblockUser = null;

            // Bloquear usuario temporalmente si es WhatsApp
            if (ctx && ctx.type !== 'webchat' && ctx.from) {
                userApiBlockMap.set(ctx.from, true);
                const timeoutId = setTimeout(() => { userApiBlockMap.delete(ctx.from); }, API_BLOCK_TIMEOUT_MS);
                unblockUser = () => { clearTimeout(timeoutId); userApiBlockMap.delete(ctx.from); };
            }

            const tipo = jsonData.type.trim();

            try {
                if (tipo === "#BUSCAR_PRODUCTO#") {
                    const payload = jsonData.payload || jsonData.data || {};
                    apiResponse = await searchProduct(payload);
                } else if (tipo === "#BUSCAR_PRODUCTO_LISTA#") {
                    let payload = jsonData.payload || jsonData.data || {};
                    if (payload.buscar !== undefined || payload.lista !== undefined) {
                        payload = {
                            searchData: payload.buscar || "",
                            numeroDeListaDePrecio: payload.lista || 0
                        };
                    }
                    apiResponse = await searchProductsWithPrice(payload);
                } else if (tipo === "#BUSCAR_CODIGO_LISTA#") {
                    let payload = jsonData.payload || jsonData.data || {};
                    if (payload.buscar !== undefined || payload.lista !== undefined) {
                        payload = {
                            searchData: payload.buscar || "",
                            numeroDeListaDePrecio: payload.lista || 0
                        };
                    }
                    apiResponse = await getProductByCodeWithPrice(payload);
                } else if (tipo === "#BUSCAR_CLIENTE#") {
                    const payload = jsonData.payload || jsonData.data || {};
                    apiResponse = await searchClient(payload);
                } else if (tipo === "#ALTA_CLIENTE#") {
                    let payload = jsonData.payload || jsonData.data || {};
                    if (payload) {
                        payload = {
                            dni_o_Cuit: payload.dni_o_Cuit || payload.dni || payload.cuit || "",
                            codigo: payload.codigo || null, 
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
                    apiResponse = await createClient(payload);
                } else if (tipo === "#TOMA_PEDIDO#") {
                    let payload = jsonData.payload || jsonData.data || {};
                    if (payload) {
                        payload = {
                            NumeroCuitoDNI: payload.NumeroCuitoDNI || payload.dni || payload.cuit || "",
                            Items: Array.isArray(payload.Items) ? payload.Items : (payload.items || [])
                        };
                    }
                    apiResponse = await createOrder(payload);
                }
            } catch (err) {
                console.error(`[AssistantResponseProcessor] Error en operación API (${tipo}):`, err);
                apiResponse = { error: "Error en operación API: " + err.message };
            }

            if (apiResponse) {
                const feedbackMsg = `[SYSTEM_API_RESULT]: ${JSON.stringify(apiResponse)}`;
                
                let threadId = ctx?.thread_id;
                if (!threadId && state?.get) threadId = state.get('thread_id');

                if (threadId) await waitForActiveRuns(threadId);
                else await new Promise(resolve => setTimeout(resolve, 1500));

                let newResponse: any;
                try {
                    newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado API.", ctx?.from, threadId);
                } catch (err: any) {
                    if (err?.message?.includes('active')) {
                        console.log("[AssistantResponseProcessor] Re-intentando tras detectar run activo residual...");
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado API.", ctx?.from, threadId);
                    } else {
                        console.error("Error al obtener respuesta recursiva tras API:", err);
                        if (unblockUser) unblockUser();
                        return;
                    }
                }

                if (unblockUser) unblockUser();

                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    newResponse, ctx, flowDynamic, state, provider, gotoFlow, getAssistantResponse, ASSISTANT_ID, recursionDepth + 1
                );
                return;
            }
            if (unblockUser) unblockUser();
        }

        // 4) Respuesta final limpia al usuario
        const cleanTextResponse = limpiarBloquesJSON(textResponse).trim();
        
        if (cleanTextResponse.includes('Voy a proceder a realizar la reserva.')) {
            await new Promise(res => setTimeout(res, 30000));
            let threadId = ctx?.thread_id;
            if (!threadId && state?.get) threadId = state.get('thread_id');
            
            let assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx?.from, threadId);
            while (assistantApiResponse && /(ID:\s*\w+)/.test(assistantApiResponse)) {
                await new Promise(res => setTimeout(res, 10000));
                assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx?.from, threadId);
            }
            if (assistantApiResponse) {
                try {
                    const finalMsg = limpiarBloquesJSON(String(assistantApiResponse)).trim();
                    if (finalMsg) {
                        if (ctx && ctx.from) await HistoryHandler.saveMessage(ctx.from, 'assistant', finalMsg, 'text');
                        await flowDynamic([{ body: finalMsg }]);
                    }
                } catch (err) {
                    console.error('[AssistantResponseProcessor] Error en flowDynamic (reserva):', err);
                }
            }
        } else if (cleanTextResponse.length > 0) {
            // Persistir antes de enviar
            if (ctx && ctx.from) {
                await HistoryHandler.saveMessage(ctx.from, 'assistant', cleanTextResponse, 'text');
            }
            
            const chunks = cleanTextResponse.split(/\n\n+/);
            for (const chunk of chunks) {
                if (chunk.trim().length > 0) {
                    try {
                        await flowDynamic([{ body: chunk.trim() }]);
                        await new Promise(r => setTimeout(r, 600)); 
                    } catch (err) {
                        console.error('[AssistantResponseProcessor] Error en flowDynamic:', err);
                    }
                }
            }
        }
    }
}
