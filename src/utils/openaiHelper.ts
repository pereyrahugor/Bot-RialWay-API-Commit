import OpenAI from "openai";
import { HistoryHandler } from "./historyHandler";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const askWithFunctions = async (assistantId: string, message: string, state: any): Promise<string> => {
    let threadId = state && typeof state.get === 'function' ? state.get('thread_id') : null;
    
    // 1. Obtiene o crea el Thread
    if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
        if (state && typeof state.update === 'function') {
            await state.update({ thread_id: threadId });
        }
    }

    // 2. Envía el mensaje del usuario al Thread
    await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: message
    });

    // Función recursiva que evalúa el estado de la comunicación iterativamente
    const handleRunStatus = async (run: OpenAI.Beta.Threads.Runs.Run): Promise<string> => {
        // A) OpenAI completó la respuesta generativa en modo "Respuesta de Texto"
        if (run.status === 'completed') {
            const messages = await openai.beta.threads.messages.list(run.thread_id);
            const latestMessage = messages.data.filter(m => m.role === 'assistant')[0];
            return latestMessage && latestMessage.content[0].type === 'text' ? latestMessage.content[0].text.value : '';
        } 
        
        // B) OpenAI entró en modo Tool Call (Function Calling) y necesita que procesemos la lógica localmente
        else if (run.status === 'requires_action') {
            const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls;
            if (!toolCalls) return '';

            // Ejecutar en paralelo todas las funciones que nos pidió la IA
            const toolOutputs = await Promise.all(toolCalls.map(async (toolCall: any) => {
                const funcName = toolCall.function.name;
                let args = {};
                try {
                    args = JSON.parse(toolCall.function.arguments || "{}");
                } catch (e) {
                     console.error(`[FunctionCall] Error parseando argumentos para ${funcName}:`, e);
                }

                // console.log(`[FunctionCall] Función requerida: ${funcName}`, args);
                
                let result = "";
                try {
                    // =========================================================
                    // 🚨 AQUÍ MAPEAR Y EJECUTAR TUS FUNCIONES REALES DEL BACKEND
                    // =========================================================
                    // Mantenemos esto por defecto ya que las llamadas a DB y API se manejan como texto plano
                    // sin embargo, si algún día creas tools en OpenAI, colócalas aquí.
                    result = JSON.stringify({ error: `Function ${funcName} not implemented in bot environment` });
                } catch (e: any) {
                    result = JSON.stringify({ error: e.message || String(e) });
                }

                // Asegurar formato esperado por OpenAI para Tool Output
                return {
                    tool_call_id: toolCall.id,
                    output: result,
                };
            }));
            
            // console.log(`[FunctionCall] Enviando resultados de ${toolCalls.length} funciones de vuelta a OpenAI...`);
            
            // Retornamos la respuesta interna al Run correspondiente. Esto forzará a OpenAI a continuar evaluando
            const newRun = await openai.beta.threads.runs.submitToolOutputsAndPoll(
               threadId,
               run.id,
               { tool_outputs: toolOutputs }
            );
            
            // Evaluamos otra vez recursivamente (OpenAI quizás pide otra Tool seguida, o finalmente da el 'completed' con la respuesta de texto informando al usuario)
            return handleRunStatus(newRun);
        } else if (['cancelled', 'failed', 'expired'].includes(run.status)) {
            console.error(`[askWithFunctions] Run falló o fue cancelado, estado: ${run.status}`);
            throw new Error(`Execution ended with status: ${run.status}`);
        } else {
            // Espera activa de estado
            await new Promise(r => setTimeout(r, 2000));
            const polledRun = await openai.beta.threads.runs.retrieve(threadId, run.id);
            return handleRunStatus(polledRun);
        }
    };

    const run = await openai.beta.threads.runs.createAndPoll(threadId, {
        assistant_id: assistantId
    });

    return await handleRunStatus(run);
};

/**
 * Capa 1: Verificación Proactiva (waitForActiveRuns)
 * Antes de cada llamada, verificamos si el hilo tiene procesos activos.
 */
export async function waitForActiveRuns(threadId: string, maxAttempts = 5) {
    if (!threadId) return;
    try {
        let attempt = 0;
        while (attempt < maxAttempts) {
            const runs = await openai.beta.threads.runs.list(threadId, { limit: 5 });
            const activeRun = runs.data.find(r => 
                ['in_progress', 'queued', 'requires_action'].includes(r.status)
            );

            if (activeRun) {
                // console.log(`[Reconexión] Run activo detectado (${activeRun.status}): ${activeRun.id}`);
                // Si está estancado en requires_action, lo cancelamos proactivamente
                if (activeRun.status === 'requires_action' && attempt >= 2) {
                    // console.warn(`[Reconexión] Run ${activeRun.id} estancado en requires_action. Cancelando...`);
                    await openai.beta.threads.runs.cancel(threadId, activeRun.id);
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempt++;
            } else {
                return;
            }
        }
        
        // Si llegamos al límite, forzamos cancelación de cualquier cosa que quede
        await cancelActiveRuns(threadId);
    } catch (error) {
        // console.error(`Error verificando runs:`, error);
    }
}

/**
 * Cancela todos los runs activos encontrados en un thread
 */
export async function cancelActiveRuns(threadId: string) {
    if (!threadId) return;
    try {
        const runs = await openai.beta.threads.runs.list(threadId, { limit: 10 });
        for (const run of runs.data) {
            if (['in_progress', 'queued', 'requires_action'].includes(run.status)) {
                // console.log(`[Reconexión] Cancelando run residual ${run.id} (${run.status})`);
                try {
                    await openai.beta.threads.runs.cancel(threadId, run.id);
                    await new Promise(r => setTimeout(r, 1000));
                } catch (e) {
                    // console.error(`Error cancelando run ${run.id}:`, e.message);
                }
            }
        }
    } catch (error) {
        // console.error(`Error en cancelActiveRuns:`, error);
    }
}

/**
 * Capa 3: Renovación Automática de Hilo
 * Crea un nuevo hilo con el contexto reciente si el actual está bloqueado.
 */
export async function renewThreadAndRetry(
    assistantId: string, 
    message: string, 
    state: any, 
    userId: string, 
    errorReporter?: any
) {
    // console.warn(`[ThreadRenewal] Renovando hilo para ${userId} debido a errores persistentes.`);
    
    // 1. Notificar al desarrollador (si hay reporter)
    if (errorReporter && typeof errorReporter.reportError === 'function') {
        await errorReporter.reportError(new Error("Hilo bloqueado. Renovando automáticamente..."), userId, `https://wa.me/${userId.replace(/[^0-9]/g, '')}`);
    }

    // 2. Traer el historial reciente (últimos 10 mensajes)
    const history = await HistoryHandler.getMessages(userId, 10);
    
    // 3. Crear nuevo hilo en OpenAI con ese contexto
    const threadOptions: any = {};
    if (history && history.length > 0) {
        threadOptions.messages = history
            .filter(m => m.content && m.content.trim() !== '')
            .map(m => ({ 
                role: m.role === 'assistant' ? 'assistant' : 'user', 
                content: m.content 
            }));
    }

    const newThread = await openai.beta.threads.create(threadOptions);
    // console.log(`[ThreadRenewal] Nuevo hilo creado: ${newThread.id}`);

    // 4. Actualizar estado y reintentar
    if (state && typeof state.update === 'function') {
        await state.update({ thread_id: newThread.id });
    }
    
    return await askWithFunctions(assistantId, message, state);
}

/**
 * Capa 2: Petición Segura con Reintentos (safeToAsk)
 * Centraliza la lógica de comunicación con OpenAI Assistants.
 */
export const safeToAsk = async (
    assistantId: string,
    message: string,
    state: any,
    userId: string = 'unknown',
    errorReporter?: any,
    maxRetries = 5
) => {
    const SAFE_TIMEOUT = 120000; // 2 minutos de timeout total de seguridad
    
    return Promise.race([
        (async () => {
            let attempt = 0;
            while (attempt < maxRetries) {
                const threadId = state && typeof state.get === 'function' && state.get('thread_id');
                
                if (threadId) {
                    await waitForActiveRuns(threadId);
                }

                try {
                    return await askWithFunctions(assistantId, message, state);
                } catch (err: any) {
                    attempt++;
                    const errorMessage = err?.message || String(err);
                    // console.error(`[safeToAsk] Error (Intento ${attempt}/${maxRetries}):`, errorMessage);

                    // Si OpenAI nos dice qué run está bloqueando, lo cancelamos de inmediato
                    if (errorMessage.includes('while a run') && errorMessage.includes('is active') && threadId) {
                        const runIdMatch = errorMessage.match(/run_[a-zA-Z0-9]+/);
                        if (runIdMatch) {
                            // console.log(`[safeToAsk] Cancelando run bloqueante detectado: ${runIdMatch[0]}`);
                            try {
                                await openai.beta.threads.runs.cancel(threadId, runIdMatch[0]);
                                await new Promise(r => setTimeout(r, 3000));
                                continue; // Reintento inmediato
                            } catch (cancelErr) {
                                // console.error(`[safeToAsk] Error cancelando ${runIdMatch[0]}:`, cancelErr);
                            }
                        }
                    }

                    if (attempt >= maxRetries) {
                        // CAPA 3: Renovación de Hilo
                        return await renewThreadAndRetry(assistantId, message, state, userId, errorReporter);
                    }
                    
                    const waitTime = attempt * 2000;
                    // console.log(`[safeToAsk] Esperando ${waitTime/1000}s para reintentar...`);
                    await new Promise(r => setTimeout(r, waitTime));
                }
            }
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_SAFE_TO_ASK')), SAFE_TIMEOUT))
    ]);
};
