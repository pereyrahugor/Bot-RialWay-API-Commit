// src/utils/AssistantResponseProcessor.ts
// Ajustar fecha/hora a GMT-3 (hora argentina)
function toArgentinaTime(fechaReservaStr: string): string {
    const [fecha, hora] = fechaReservaStr.split(' ');
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const [hh, min] = hora.split(':').map(Number);
    const date = new Date(Date.UTC(anio, mes - 1, dia, hh, min));
    date.setHours(date.getHours() - 3);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hhh = String(date.getHours()).padStart(2, '0');
    const mmm = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hhh}:${mmm}`;
}
import { executeDbQuery } from '../utils/dbHandler';
import { JsonBlockFinder } from "../Api-Google/JsonBlockFinder";
import { CalendarEvents } from "../Api-Google/calendarEvents";
import { downloadFileFromDrive } from './googleDriveHandler';
import fs from 'fs';
import moment from 'moment';
import OpenAI from "openai";
import { transcribeAudioFile } from './audioTranscriptior';
import { HistoryHandler } from './historyHandler';
import { searchProduct, searchProductsWithPrice, getProductByCodeWithPrice, searchClient, createClient, createOrder } from "../API/Commit";
//import { handleToolFunctionCall } from '../Api-BotAsistente/handleToolFunctionCall.js';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function cancelRun(threadId: string, runId: string) {
    if (!threadId || !runId) return;
    try {
        console.log(`[AssistantResponseProcessor] Cancelando run ${runId} en thread ${threadId}...`);
        await openai.beta.threads.runs.cancel(threadId, runId);
        
        // Esperar un máximo de 5 segundos a que el estado cambie a 'cancelled'
        let attempts = 0;
        while (attempts < 5) {
            const run = await openai.beta.threads.runs.retrieve(threadId, runId);
            if (run.status === 'cancelled' || run.status === 'failed' || run.status === 'completed' || run.status === 'expired') {
                console.log(`[AssistantResponseProcessor] Run ${runId} finalizado (estado: ${run.status}).`);
                return;
            }
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
        }
    } catch (error) {
        console.error(`[AssistantResponseProcessor] Error cancelando run ${runId}:`, error);
    }
}

export async function waitForActiveRuns(threadId: string) {
    if (!threadId) return;
    try {
        console.log(`[AssistantResponseProcessor] Verificando runs activos en thread ${threadId}...`);
        let attempt = 0;
        const maxAttempts = 10; // Suficientes intentos antes de desistir
        while (attempt < maxAttempts) {
            const runs = await openai.beta.threads.runs.list(threadId, { limit: 5 });
            const activeRun = runs.data.find(run => 
                ["queued", "in_progress", "cancelling", "requires_action"].includes(run.status)
            );
            
            if (activeRun) {
                // Estrategia: Si está en 'requires_action' durante más de 2 intentos, lo cancelamos proactivamente
                if (activeRun.status === "requires_action" && attempt >= 2) {
                    console.warn(`[AssistantResponseProcessor] Run ${activeRun.id} estancado en requires_action. Cancelando de forma proactiva.`);
                    await cancelRun(threadId, activeRun.id);
                    // Tras cancelar, retornamos para permitir el reintento desde la capa superior (safeToAsk)
                    return;
                }

                console.log(`[AssistantResponseProcessor] [${attempt}/${maxAttempts}] Run activo detectado (${activeRun.id}, estado: ${activeRun.status}). Esperando 2s...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempt++;
            } else {
                console.log(`[AssistantResponseProcessor] No hay runs activos en thread ${threadId}. OK.`);
                // Solo un pequeño delay para asegurar la consistencia del thread
                await new Promise(resolve => setTimeout(resolve, 800));
                return;
            }
        }
        
        // Si llegamos aquí sin haber retornado, es que agotamos los intentos
        console.warn(`[AssistantResponseProcessor] Timeout esperando liberación del thread ${threadId}. Intentando limpieza forzada...`);
        const remainingRuns = await openai.beta.threads.runs.list(threadId, { limit: 2 });
        const stuckRun = remainingRuns.data.find(r => ["queued", "in_progress", "requires_action"].includes(r.status));
        if (stuckRun) {
            await cancelRun(threadId, stuckRun.id);
        }
    } catch (error) {
        console.error(`[AssistantResponseProcessor] Error verificando runs en thread ${threadId}:`, error);
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
}

// Mapa global para bloquear usuarios de WhatsApp durante operaciones API
const userApiBlockMap = new Map();
const API_BLOCK_TIMEOUT_MS = 5000; // 5 segundos

function limpiarBloquesJSON(texto: string): string {
    // 1. Preservar bloques especiales temporalmente
    const specialBlocks: string[] = [];
    let textoConMarcadores = texto;
    
    // Preservar [DB_QUERY: ...] (Permitiendo espacios opcionales tras el corchete y el separador opcional)
    textoConMarcadores = textoConMarcadores.replace(/\[\s*DB_QUERY\s*:?\s*[\s\S]*?\]/gi, (match) => {
        const index = specialBlocks.length;
        specialBlocks.push(match);
        return `___SPECIAL_BLOCK_${index}___`;
    });

    // Preservar [DB: "T":"tabla", "D":"dato"] o [DB{"T":"..."}]
    textoConMarcadores = textoConMarcadores.replace(/\[\s*DB\s*:?\s*[\s\S]*?\]/gi, (match) => {
        const index = specialBlocks.length;
        specialBlocks.push(match);
        return `___SPECIAL_BLOCK_${index}___`;
    });
    
    // Preservar [API]...[/API] (Tolerante a espacios)
    textoConMarcadores = textoConMarcadores.replace(/\[\s*API\s*\][\s\S]*?\[\/\s*API\s*\]/gi, (match) => {
        const index = specialBlocks.length;
        specialBlocks.push(match);
        return `___SPECIAL_BLOCK_${index}___`;
    });
    
    // 2. Limpiar referencias de OpenAI tipo 【4:0†archivo.pdf】
    let limpio = textoConMarcadores.replace(/【.*?】/g, "");

    // 2b. Limpiar bloques JSON de "queries" que a veces fuga el asistente de OpenAI (File Search / Web Search)
    // Se incluye opcionalmente una coma al final por si el asistente lo envía como parte de un array incompleto
    limpio = limpio.replace(/\{\s*"queries"\s*:\s*\[[\s\S]*?\]\s*\}[\s,]*?/gi, "");
    
    // 2c. Limpiar bloques de PDF [PDF: ID]
    limpio = limpio.replace(/\[\s*PDF\s*:\s*[\s\S]*?\]/gi, "");

    // 2d. Filtrar SYSTEM_DB_RESULT o SYSTEM_API_RESULT filtrados por error del asistente
    limpio = limpio.replace(/\[?\s*SYSTEM_(DB|API)_RESULT[\s\S]*?(?:\]|$)/gi, "");


    // 3. Restaurar bloques especiales
    specialBlocks.forEach((block, index) => {
        limpio = limpio.replace(`___SPECIAL_BLOCK_${index}___`, block);
    });
    
    return limpio;
}

function corregirFechaAnioVigente(fechaReservaStr: string): string {
    const ahora = new Date();
    const vigente = ahora.getFullYear();
    const [fecha, hora] = fechaReservaStr.split(" ");
    const [anioRaw, mes, dia] = fecha.split("-").map(Number);
    let anio = anioRaw;
    if (anio < vigente) anio = vigente;
    return `${anio.toString().padStart(4, "0")}-${mes.toString().padStart(2, "0")}-${dia.toString().padStart(2, "0")} ${hora}`;
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
            console.error('[AssistantResponseProcessor] Límite de recursión alcanzado (5). Abortando para evitar bucle infinito.');
            await flowDynamic([{ body: "Lo siento, hubo un problema procesando la respuesta. Por favor, intenta de nuevo." }]);
            return;
        }
        // if (response && typeof response === 'object' && response.tool_call) {
        //     // Espera que response.tool_call tenga { name, parameters }
        //     const toolResponse = handleToolFunctionCall(response.tool_call);
        //     // Enviar la respuesta al asistente (como tool response)
        //     await flowDynamic([{ body: JSON.stringify(toolResponse, null, 2) }]);
        //     return;
        // }
        // Log de mensaje entrante del asistente (antes de cualquier filtro)
        if (ctx && ctx.type === 'webchat') {
            // console.log('[Webchat Debug] Mensaje entrante del asistente:', response);
        } else {
            // console.log('[WhatsApp Debug] Mensaje entrante del asistente:', response);
            // Si el usuario está bloqueado por una operación API, evitar procesar nuevos mensajes
            if (userApiBlockMap.has(ctx.from)) {
                console.log(`[API Block] Mensaje ignorado de usuario bloqueado: ${ctx.from}`);
                return;
            }
        }
        let jsonData: any = null;
        let jsonContent: string = "";
        // Sanitización y normalización del texto de respuesta
        const textResponseRaw = typeof response === "string" ? response : String(response || "");
        const textResponse = textResponseRaw.replace(/\0/g, '').trim();

        // Log de mensaje saliente al usuario (antes de cualquier filtro)
        if (ctx && ctx.type === 'webchat') {
            console.log('[Webchat Debug] Mensaje saliente al usuario (sin filtrar):', textResponse.substring(0, 500));
        } else {
            console.log('[WhatsApp Debug] Mensaje saliente al usuario (sin filtrar):', textResponse.substring(0, 500));
        }
        
        // Log específico para debug de DB_QUERY
        console.log('[DEBUG] Buscando [DB_QUERY] en:', textResponse.substring(0, 200));
        
        let dbQueryMatchRegexResult = false;
        let sqlQueryToExecute = "";
        const sanitizedTextResponse = textResponse; // Alias para compatibilidad con mis edits anteriores fallidos si los hubiera

        // 0.a) Detectar y procesar DB QUERY [DB_QUERY: ...] (Permitiendo espacios opcionales tras el corchete y el separador opcional)
        const dbQueryRegex = /\[\s*DB_QUERY\s*:?\s*([\s\S]*?)\]/i;
        const dbMatch = textResponse.match(dbQueryRegex);
        
        // 0.b) Detectar y procesar DB simple [DB: "T":"tabla", "D":"dato"] o [DB{"T":"..."}]
        const dbSimpleRegex = /\[\s*DB\s*:?\s*([\s\S]*?)\]/i;
        const dbSimpleMatch = textResponse.match(dbSimpleRegex);
        
        if (dbMatch) {
             console.log('[DEBUG] DB Match result: FOUND [DB_QUERY]');
             sqlQueryToExecute = dbMatch[1].trim();
             dbQueryMatchRegexResult = true;
             if (ctx && ctx.type === 'webchat') console.log(`[Webchat Debug] 🔄 Detectada solicitud de DB Query: ${sqlQueryToExecute}`);
             else console.log(`[WhatsApp Debug] 🔄 Detectada solicitud de DB Query: ${sqlQueryToExecute}`);
        } else if (dbSimpleMatch) {
             console.log('[DEBUG] DB Match result: FOUND [DB] simple');
             const jsonContent = dbSimpleMatch[1].trim();
             
             // Reparación de JSON: envolver en llaves si faltan y asegurar comillas en claves T y D
             let cleanJson = jsonContent;
             if (!cleanJson.startsWith('{')) cleanJson = '{' + cleanJson + '}';
             
             // Intentar reparar comillas faltantes en claves comunes (T o D) para que JSON.parse no falle
             cleanJson = cleanJson.replace(/([{,]\s*)(T|D)(\s*:)/g, '$1"$2"$3');
             
             try {
                 let parsedData: any = null;
                 try {
                     parsedData = JSON.parse(cleanJson);
                 } catch (e) {
                     // Si falla JSON.parse, intentar extracción vía regex como último recurso
                     const tMatch = cleanJson.match(/"?T"?\s*:\s*"([^"]+)"/i);
                     const dMatch = cleanJson.match(/"?D"?\s*:\s*"([^"]+)"/i);
                     if (tMatch && dMatch) {
                         parsedData = { T: tMatch[1], D: dMatch[1] };
                     }
                 }

                 if (parsedData && parsedData.T && parsedData.D) {
                     // Escapar comillas simples en el dato para evitar errores de SQL
                     const safeDato = String(parsedData.D).replace(/'/g, "''");
                     sqlQueryToExecute = `SELECT * FROM "${parsedData.T}" WHERE "${parsedData.T}"::text ~* '${safeDato}'`;
                     dbQueryMatchRegexResult = true;
                     if (ctx && ctx.type === 'webchat') console.log(`[Webchat Debug] 🔄 Detectada solicitud de DB simple: ${sqlQueryToExecute}`);
                     else console.log(`[WhatsApp Debug] 🔄 Detectada solicitud de DB simple: ${sqlQueryToExecute}`);
                 } else {
                     console.log('[DEBUG] JSON en [DB] no contiene T o D validos:', parsedData);
                 }
             } catch (e) {
                 console.log('[DEBUG] Error procesando contenido en [DB]:', e.message, 'Content:', cleanJson);
             }
        }
 else {
             console.log('[DEBUG] DB Match result: NULL');
        }

        if (dbQueryMatchRegexResult) {
            // Ejecutar Query
            const queryResult = await executeDbQuery(sqlQueryToExecute);
            console.log(`[AssistantResponseProcessor] 📝 Resultado DB RAW:`, queryResult.substring(0, 500) + (queryResult.length > 500 ? "..." : "")); 
            const feedbackMsg = `[SYSTEM_DB_RESULT]: ${queryResult}`;
            
            // Obtener threadId de forma segura
            let threadId = ctx && ctx.thread_id;
            if (!threadId && state && typeof state.get === 'function') {
                threadId = state.get('thread_id');
            }

            // Esperar a que el Run anterior haya finalizado realmente en OpenAI
            if (threadId) {
                await waitForActiveRuns(threadId);
            } else {
                 await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Obtener nueva respuesta del asistente
            let newResponse: any;
            try {
                 newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado DB.", ctx ? ctx.from : null, threadId);
            } catch (err: any) {
                // Si aún así falla por run activo, intentamos una vez más tras una espera larga
                if (err?.message?.includes('active')) {
                    console.log("[AssistantResponseProcessor] Re-intentando tras detectar run activo residual (DB)...");
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado DB.", ctx ? ctx.from : null, threadId);
                } else {
                    console.error("Error al obtener respuesta recursiva (DB):", err);
                    return;
                }
            }
            
            // Recursión: procesar la nueva respuesta
            await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                newResponse, ctx, flowDynamic, state, provider, gotoFlow, getAssistantResponse, ASSISTANT_ID, recursionDepth + 1
            );
            return; // Terminar ejecución actual
        }

        // 1) Extraer bloque [API] ... [/API] (Tolerante a espacios)
        const apiBlockRegex = /\[\s*API\s*\]([\s\S]*?)\[\/\s*API\s*\]/is;
        const match = sanitizedTextResponse.match(apiBlockRegex);
        if (match) {
            jsonContent = match[1].trim();
            console.log('[Debug] Bloque [API] detectado:', jsonContent);
            
            // Intentar extraer solo el JSON si hay texto adicional dentro de las etiquetas
            const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonContent = jsonMatch[0];
            }
            
            try {
                jsonData = JSON.parse(jsonContent);
            } catch (e) {
                console.error('[AssistantResponseProcessor] Error al parsear bloque [API]:', e.message);
                // Intento desesperado de rescate si el JSON está mal formateado (ej: comillas faltantes)
                try {
                    // Reemplazo simple para casos comunes de JSON mal formado por el asistente
                    const repairedJson = jsonContent
                        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":') // Asegurar comillas en claves
                        .replace(/'/g, '"'); // Cambiar comillas simples por dobles
                    jsonData = JSON.parse(repairedJson);
                } catch (e2) {
                    // Intento de rescate manual detectando el tipo si el JSON está muy roto
                    const typeMatch = jsonContent.match(/"type"\s*:\s*"([^"]+)"/i);
                    if (typeMatch) {
                        jsonData = { type: typeMatch[1], data: {} };
                        const listaMatch = jsonContent.match(/"lista"\s*:\s*(?:(\d+)|"(\d+)")/i);
                        if (listaMatch) jsonData.data.lista = parseInt(listaMatch[1] || listaMatch[2]);
                    } else {
                        jsonData = null;
                    }
                }
            }
        }

        // 3) Procesar JSON si existe
        if (jsonData && typeof jsonData.type === "string") {
            let apiResponse: any = null;

            // Bloquear usuario temporalmente si es WhatsApp
            let unblockUser = null;
            if (ctx && ctx.type !== 'webchat' && ctx.from) {
                userApiBlockMap.set(ctx.from, true);
                const timeoutId = setTimeout(() => { userApiBlockMap.delete(ctx.from); }, API_BLOCK_TIMEOUT_MS);
                unblockUser = () => { clearTimeout(timeoutId); userApiBlockMap.delete(ctx.from); };
            }

            const tipo = jsonData.type.trim();

            try {
                if (tipo === "create_event") {
                    apiResponse = await CalendarEvents.createEvent({
                        fecha: jsonData.fecha,
                        hora: jsonData.hora,
                        titulo: jsonData.titulo,
                        descripcion: jsonData.descripcion,
                        invitados: jsonData.invitados
                    });
                } else if (tipo === "available_event") {
                    const start = `${jsonData.fecha}T${jsonData.hora}:00-03:00`;
                    const end = moment(start).add(1, 'hour').format('YYYY-MM-DDTHH:mm:ssZ');
                    apiResponse = await CalendarEvents.checkAvailability(start, end);
                } else if (tipo === "modify_event") {
                    apiResponse = await CalendarEvents.updateEvent(jsonData.id, {
                        fecha: jsonData.fecha,
                        hora: jsonData.hora,
                        titulo: jsonData.titulo,
                        descripcion: jsonData.descripcion
                    });
                } else if (tipo === "cancel_event") {
                    apiResponse = await CalendarEvents.deleteEvent(jsonData.id);
                // } else if (tipo === "#BUSCAR_PRODUCTO#") {
                //     const payload = jsonData.payload || jsonData.data || {};
                //     apiResponse = await searchProduct(payload);
                } else if (tipo === "#BUSCAR_PRODUCTO_LISTA#") {
                    let data = jsonData.payload || jsonData.data || {};
                    const lista = data.lista || 0;
                    
                    // Extraer términos: soportar array, duplicados o formato lista manual
                    let busquedas: string[] = [];
                    if (Array.isArray(data.buscar)) {
                        busquedas = data.buscar.map(b => String(b));
                    } else {
                        // Regex para todos los "buscar" en el crudo por si vienen duplicados o en formato extraño
                        const buscarRegex = /"buscar"\s*:\s*(?:\[([\s\S]*?)\]|"([^"]*)"|'([^']*)')/gi;
                        let m;
                        while ((m = buscarRegex.exec(jsonContent)) !== null) {
                            if (m[1]) busquedas.push(...m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')));
                            else busquedas.push(m[2] || m[3]);
                        }
                        if (busquedas.length === 0 && data.buscar) busquedas.push(String(data.buscar));
                    }

                    busquedas = [...new Set(busquedas)].map(b => b.trim()).filter(b => b.length > 0 && b.toLowerCase() !== "nombre de producto");

                    if (busquedas.length > 1) {
                        const results = [];
                        for (const query of busquedas) {
                            try {
                                const res = await searchProductsWithPrice({ searchData: query, numeroDeListaDePrecios: lista });
                                results.push({ llamada: `Producto: ${query}`, resultado: res });
                            } catch (e) {
                                results.push({ llamada: `Producto: ${query}`, error: e.message });
                            }
                        }
                        apiResponse = { info: "Resultados para múltiples productos", items: results };
                    } else {
                        apiResponse = await searchProductsWithPrice({
                            searchData: busquedas[0] || "",
                            numeroDeListaDePrecios: lista
                        });
                    }
                } else if (tipo === "#BUSCAR_CODIGO_LISTA#") {
                    let data = jsonData.payload || jsonData.data || {};
                    const lista = data.lista || 0;
                    
                    let busquedas: string[] = [];
                    if (Array.isArray(data.buscar)) {
                        busquedas = data.buscar.map(b => String(b));
                    } else {
                        const buscarRegex = /"buscar"\s*:\s*(?:\[([\s\S]*?)\]|"([^"]*)"|'([^']*)')/gi;
                        let m;
                        while ((m = buscarRegex.exec(jsonContent)) !== null) {
                            if (m[1]) busquedas.push(...m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')));
                            else busquedas.push(m[2] || m[3]);
                        }
                        if (busquedas.length === 0 && data.buscar) busquedas.push(String(data.buscar));
                    }

                    busquedas = [...new Set(busquedas)].map(b => b.trim()).filter(b => b.length > 0 && b.toLowerCase() !== "nombre de producto");

                    if (busquedas.length > 1) {
                        const results = [];
                        for (const query of busquedas) {
                            try {
                                const res = await getProductByCodeWithPrice({ searchData: query, numeroDeListaDePrecios: lista });
                                results.push({ llamada: `Código: ${query}`, resultado: res });
                            } catch (e) {
                                results.push({ llamada: `Código: ${query}`, error: e.message });
                            }
                        }
                        apiResponse = { info: "Resultados para múltiples códigos", items: results };
                    } else {
                        apiResponse = await getProductByCodeWithPrice({
                            searchData: busquedas[0] || "",
                            numeroDeListaDePrecios: lista
                        });
                    }
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
                apiResponse = { error: "Error en operación API: " + err.message };
            }

            if (apiResponse) {
                // En lugar de enviar el JSON al usuario, se lo devolvemos al asistente para que responda algo natural
                const feedbackMsg = `[SYSTEM_API_RESULT]: ${JSON.stringify(apiResponse)}`;
                
                let threadId = ctx?.thread_id;
                if (!threadId && state?.get) threadId = state.get('thread_id');

                if (threadId) await waitForActiveRuns(threadId);
                else await new Promise(resolve => setTimeout(resolve, 2000));

                let newResponse: any;
                try {
                    newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado API.", ctx?.from, threadId);
                } catch (err: any) {
                    // Si falla por run activo, intentamos una vez más tras una espera larga
                    if (err?.message?.includes('active')) {
                        console.log("[AssistantResponseProcessor] Re-intentando tras detectar run activo residual (API)...");
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado API.", ctx?.from, threadId);
                    } else {
                        console.error("Error al obtener respuesta recursiva tras API:", err);
                        if (unblockUser) unblockUser();
                        return;
                    }
                }

                if (unblockUser) unblockUser();

                // Recursión: procesar la respuesta final del asistente
                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    newResponse, ctx, flowDynamic, state, provider, gotoFlow, getAssistantResponse, ASSISTANT_ID, recursionDepth + 1
                );
                return;
            }
            if (unblockUser) unblockUser();
        }


        // 4) Procesar [PDF: ID] si existen
        const pdfRegex = /\[\s*PDF\s*:\s*([a-zA-Z0-9_-]+)\s*\]/gi;
        const pdfPaths: string[] = [];
        let pdfMatch;

        // Usar sanitizedTextResponse para buscar los IDs antes de limpiar
        while ((pdfMatch = pdfRegex.exec(sanitizedTextResponse)) !== null) {
            const fileId = pdfMatch[1];
            try {
                const filePath = await downloadFileFromDrive(fileId);
                pdfPaths.push(filePath);
            } catch (err: any) {
                console.error(`[PDF Processor] Error con ID ${fileId}:`, err.message);
            }
        }

        const cleanTextResponse = limpiarBloquesJSON(sanitizedTextResponse).trim();
        // Lógica especial para reserva: espera y reintento
        if (cleanTextResponse.includes('Voy a proceder a realizar la reserva.')) {
            // Espera 30 segundos y responde ok al asistente
            await new Promise(res => setTimeout(res, 30000));
            let threadId = ctx?.thread_id;
            if (!threadId && state?.get) threadId = state.get('thread_id');
            
            let assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx.from, threadId);
            // Si la respuesta contiene (ID: ...), no la envíes al usuario, espera 10s y vuelve a enviar ok
            while (assistantApiResponse && /(ID:\s*\w+)/.test(assistantApiResponse)) {
                console.log('[Debug] Respuesta contiene ID de reserva, esperando 10s y reenviando ok...');
                await new Promise(res => setTimeout(res, 10000));
                assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx.from, threadId);
            }
            // Cuando la respuesta no contiene el ID, envíala al usuario
            if (assistantApiResponse) {
                try {
                    await flowDynamic([{ body: limpiarBloquesJSON(String(assistantApiResponse)).trim() }]);
                    // flowDynamic ejecutado correctamente
                } catch (err) {
                    console.error('[WhatsApp Debug] Error en flowDynamic:', err);
                }
            }
        } else if (cleanTextResponse.length > 0 || pdfPaths.length > 0) {
            // Guardar en Supabase antes de fragmentar
            if (ctx && ctx.from) {
                await HistoryHandler.saveMessage(ctx.from, 'assistant', cleanTextResponse, 'text');
            }
            
            const chunks = cleanTextResponse.split(/\n\n+/);
            for (const chunk of chunks) {
                if (chunk.trim().length > 0) {
                    try {
                        await flowDynamic([{ body: chunk.trim() }]);
                        // Pequeña pausa para evitar que WhatsApp ignore mensajes muy rápidos
                        await new Promise(r => setTimeout(r, 600)); 
                        // flowDynamic ejecutado correctamente
                    } catch (err) {
                        console.error('[WhatsApp Debug] Error en flowDynamic:', err);
                    }
                }
            }

            // Enviar PDFs recolectados
            for (const path of pdfPaths) {
                try {
                    console.log(`[AssistantResponseProcessor] Enviando media: ${path}`);
                    await flowDynamic([{ body: "📄 Documento adjunto:", media: path }]);
                    // Breve espera entre archivos para asegurar el orden
                    await new Promise(r => setTimeout(r, 1000));
                } catch (err) {
                    console.error('[WhatsApp Debug] Error enviando PDF:', err);
                }
            }
        }
    }
}

