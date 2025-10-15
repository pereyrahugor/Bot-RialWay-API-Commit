// ...existing imports y lógica del bot...
import "dotenv/config";
import path from 'path';
import serve from 'serve-static';
import { Server } from 'socket.io';
import fs from 'fs';
// Estado global para encender/apagar el bot
let botEnabled = true;
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from "@builderbot/bot";
import { MemoryDB } from "@builderbot/bot";
import { BaileysProvider } from "@builderbot/provider-baileys";
import { toAsk, httpInject } from "@builderbot-plugins/openai-assistants";
import { typing } from "./utils/presence";
import { idleFlow } from "./Flows/idleFlow";
import { welcomeFlowTxt } from "./Flows/welcomeFlowTxt";
import { welcomeFlowVoice } from "./Flows/welcomeFlowVoice";
import { welcomeFlowImg } from "./Flows/welcomeFlowImg";
import { welcomeFlowDoc } from "./Flows/welcomeFlowDoc";
import { locationFlow } from "./Flows/locationFlow";
import { updateMain } from "./addModule/updateMain";
import { ErrorReporter } from "./utils/errorReporter";
import { AssistantBridge } from './utils-web/AssistantBridge';
import { WebChatManager } from './utils-web/WebChatManager';
import { WebChatSession } from './utils-web/WebChatSession';
import { AssistantResponseProcessor } from "./utils/AssistantResponseProcessor";
import { fileURLToPath } from 'url';
//import { imgResponseFlow } from "./Flows/imgResponse";
//import { listImg } from "./addModule/listImg";
//import { testAuth } from './utils/test-google-auth.js';

// Definir __dirname para ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Instancia global de WebChatManager para sesiones webchat
const webChatManager = new WebChatManager();
// Eliminado: processUserMessageWeb. Usar lógica principal para ambos canales.

/** Puerto en el que se ejecutará el servidor (Railway usa 8080 por defecto) */
const PORT = process.env.PORT || 8080;
/** ID del asistente de OpenAI */
export const ASSISTANT_ID = process.env.ASSISTANT_ID;
const ID_GRUPO_RESUMEN = process.env.ID_GRUPO_WS ?? "";

const userQueues = new Map();
const userLocks = new Map();

const adapterProvider = createProvider(BaileysProvider, {
    groupsIgnore: false,
    readStatus: false,
});

const errorReporter = new ErrorReporter(adapterProvider, ID_GRUPO_RESUMEN); // Reemplaza YOUR_GROUP_ID con el ID del grupo de WhatsApp

const TIMEOUT_MS = 30000;

// Control de timeout por usuario para evitar ejecuciones automáticas superpuestas
const userTimeouts = new Map();

export const getAssistantResponse = async (assistantId, message, state, fallbackMessage, userId, thread_id = null) => {
    // Solo enviar la fecha/hora si es realmente un hilo nuevo (no existe thread_id ni en el argumento ni en el state)
    let effectiveThreadId = thread_id;
    if (!effectiveThreadId && state && typeof state.get === 'function') {
        effectiveThreadId = state.get('thread_id');
    }
  // Si hay un timeout previo, lo limpiamos
  if (userTimeouts.has(userId)) {
    clearTimeout(userTimeouts.get(userId));
    userTimeouts.delete(userId);
  }

  let timeoutResolve;
  const timeoutPromise = new Promise((resolve) => {
    timeoutResolve = resolve;
    const timeoutId = setTimeout(() => {
      console.warn("⏱ Timeout alcanzado. Reintentando con mensaje de control...");
      resolve(toAsk(assistantId, fallbackMessage ?? message, state));
      userTimeouts.delete(userId);
    }, TIMEOUT_MS);
    userTimeouts.set(userId, timeoutId);
  });

    // Lanzamos la petición a OpenAI, pasando thread_id si existe
    const askPromise = toAsk(assistantId, message, state).then((result) => {
    // Si responde antes del timeout, limpiamos el timeout
    if (userTimeouts.has(userId)) {
      clearTimeout(userTimeouts.get(userId));
      userTimeouts.delete(userId);
    }
    // Resolvemos el timeout para evitar que quede pendiente
    timeoutResolve(result);
    return result;
  });

  // El primero que responda (OpenAI o timeout) gana
  return Promise.race([askPromise, timeoutPromise]);
};

export const processUserMessage = async (
    ctx,
    { flowDynamic, state, provider, gotoFlow }
) => {
    await typing(ctx, provider);
    try {
        const body = ctx.body && ctx.body.trim();


        // Comando para encender el bot
        if (body === "#ON#") {
            if (!botEnabled) {
                botEnabled = true;
                await flowDynamic([{ body: "🤖 Bot activado." }]);
            } else {
                await flowDynamic([{ body: "🤖 El bot ya está activado." }]);
            }
            return state;
        }

        // Comando para apagar el bot
        if (body === "#OFF#") {
            if (botEnabled) {
                botEnabled = false;
                await flowDynamic([{ body: "🛑 Bot desactivado. No responderé a más mensajes hasta recibir #ON#." }]);
            } else {
                await flowDynamic([{ body: "🛑 El bot ya está desactivado." }]);
            }
            return state;
        }

        // Comando para actualizar datos desde sheets
        if (body === "#ACTUALIZAR#") {
            try {
                await updateMain();
                await flowDynamic([{ body: "🔄 Datos actualizados desde Google Sheets." }]);
            } catch (err) {
                await flowDynamic([{ body: "❌ Error al actualizar datos desde Google Sheets." }]);
            }
            return state;
        }

        // Si el bot está apagado, ignorar todo excepto #ON#
        if (!botEnabled) {
            return;
        }

        // Ignorar mensajes de listas de difusión (ID termina en @broadcast)
        if (ctx.from && /@broadcast$/.test(ctx.from)) {
            console.log('Mensaje de difusión ignorado:', ctx.from);
            return;
        }

        // Interceptar trigger de imagen antes de pasar al asistente
        // if (body === "#TestImg#") {
        //     // Usar el flow de imagen para responder y detener el flujo
        //     return gotoFlow(imgResponseFlow);
        // }

        // Usar el nuevo wrapper para obtener respuesta y thread_id
        const response = await getAssistantResponse(ASSISTANT_ID, ctx.body, state, "Por favor, responde aunque sea brevemente.", ctx.from, ctx.thread_id);

        if (
            !response ||
            (typeof response === 'object' && response !== null && !('text' in response))
        ) {
            await errorReporter.reportError(
                new Error("No se recibió respuesta del asistente."),
                ctx.from,
                `https://wa.me/${ctx.from}`
            );
        }

            await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
            response,
            ctx,
            flowDynamic,
            state,
            provider,
            gotoFlow,
            getAssistantResponse,
            ASSISTANT_ID
        );

        // Guardar thread_id en el contexto si lo retorna la respuesta
        if (
            response &&
            typeof response === 'object' &&
            response !== null &&
            'thread_id' in response
        ) {
            ctx.lastThreadId = (response as { thread_id: string }).thread_id;
        }

        const textResponse =
            response && typeof response === 'object' && response !== null && 'text' in response
                ? (response as { text: string }).text
                : String(response);
        const chunks = textResponse.split(/\n\n+/);
    const allChunks = [];
        for (const chunk of chunks) {
            // Detecta trigger de imagen en la respuesta del asistente
            const imgMatch = chunk.trim().match(/\[IMG\]\s*(.+)/i);
            if (imgMatch) {
                continue;
            }
            if (/un momento/i.test(chunk.trim())) {
                allChunks.push(chunk.trim());
                await new Promise(res => setTimeout(res, 10000));
                // Usar el wrapper también para followup
                const followup = await getAssistantResponse(ASSISTANT_ID, ctx.body, state, undefined, ctx.from, ctx.thread_id);
                if (
                    followup &&
                    typeof followup === 'object' &&
                    followup !== null &&
                    'text' in followup &&
                    (followup as { text: string }).text &&
                    !/un momento/i.test((followup as { text: string }).text)
                ) {
                    allChunks.push(String((followup as { text: string }).text).trim());
                }
                continue;
            }
            allChunks.push(chunk.trim());
        }
        await flowDynamic([{ body: allChunks.join('\n\n') }]);
        return state;
    } catch (error) {
        console.error("Error al procesar el mensaje del usuario:", error);

        // Enviar reporte de error al grupo de WhatsApp
        await errorReporter.reportError(
            error,
            ctx.from,
            `https://wa.me/${ctx.from}`
        );

        // 📌 Manejo de error: volver al flujo adecuado
        if (ctx.type === EVENTS.VOICE_NOTE) {
            return gotoFlow(welcomeFlowVoice);
        } else {
            return gotoFlow(welcomeFlowTxt);
        }
    }
};


const handleQueue = async (userId) => {
    const queue = userQueues.get(userId);

    if (userLocks.get(userId)) return;

    userLocks.set(userId, true);

    while (queue.length > 0) {
        const { ctx, flowDynamic, state, provider, gotoFlow } = queue.shift();
        try {
            await processUserMessage(ctx, { flowDynamic, state, provider, gotoFlow });
        } catch (error) {
            console.error(`Error procesando el mensaje de ${userId}:`, error);
        }
    }

    userLocks.set(userId, false);
    userQueues.delete(userId);
};

// Main function to initialize the bot and load Google Sheets data
const main = async () => {
    // Verificar credenciales de Google Sheets al iniciar
    //await testAuth();

    // Actualizar listado de imágenes en vector store
    //await listImg();

    // // Paso 1: Inicializar datos desde Google Sheets
     console.log("📌 Inicializando datos desde Google Sheets...");

    // Cargar todas las hojas principales con una sola función reutilizable
    await updateMain();


                // ...existing code...
                const adapterFlow = createFlow([welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowDoc, locationFlow, idleFlow]);
                const adapterProvider = createProvider(BaileysProvider, {
                    version: [2, 3000, 1027934701],
                    groupsIgnore: false,
                    readStatus: false,
                });
                const adapterDB = new MemoryDB();
                const { httpServer } = await createBot({
                    flow: adapterFlow,
                    provider: adapterProvider,
                    database: adapterDB,
                });
                httpInject(adapterProvider.server);

                // Usar la instancia Polka (adapterProvider.server) para rutas
                const polkaApp = adapterProvider.server;
                polkaApp.use("/js", serve("src/js"));
                polkaApp.use("/style", serve("src/style"));
                polkaApp.use("/assets", serve("src/assets"));
                // Endpoint para obtener el nombre del asistente de forma dinámica
                polkaApp.get('/api/assistant-name', (req, res) => {
                    const assistantName = process.env.ASSISTANT_NAME || 'Asistente demo';
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ name: assistantName }));
                });

                // Agregar ruta personalizada para el webchat
                polkaApp.get('/webchat', (req, res) => {
                    res.setHeader('Content-Type', 'text/html');
                    res.end(fs.readFileSync(path.join(__dirname, '../webchat.html')));
                });

                // Obtener el servidor HTTP real de BuilderBot después de httpInject
                const realHttpServer = adapterProvider.server.server;

                // Integrar Socket.IO sobre el servidor HTTP real de BuilderBot
                const io = new Server(realHttpServer, { cors: { origin: '*' } });
                io.on('connection', (socket) => {
                    console.log('💬 Cliente web conectado');
                    socket.on('message', async (msg) => {
                        // Procesar el mensaje usando la lógica principal del bot
                        try {
                            let ip = '';
                            const xff = socket.handshake.headers['x-forwarded-for'];
                            if (typeof xff === 'string') {
                                ip = xff.split(',')[0];
                            } else if (Array.isArray(xff)) {
                                ip = xff[0];
                            } else {
                                ip = socket.handshake.address || '';
                            }
                            // Centralizar historial y estado igual que WhatsApp
                            if (!global.webchatHistories) global.webchatHistories = {};
                            const historyKey = `webchat_${ip}`;
                            if (!global.webchatHistories[historyKey]) global.webchatHistories[historyKey] = [];
                            const _history = global.webchatHistories[historyKey];
                            const state = {
                                get: function (key) {
                                    if (key === 'history') return _history;
                                    return undefined;
                                },
                                update: async function (msg, role = 'user') {
                                    if (_history.length > 0) {
                                        const last = _history[_history.length - 1];
                                        if (last.role === role && last.content === msg) return;
                                    }
                                    _history.push({ role, content: msg });
                                    if (_history.length >= 6) {
                                        const last3 = _history.slice(-3);
                                        if (last3.every(h => h.role === 'user' && h.content === msg)) {
                                            _history.length = 0;
                                        }
                                    }
                                },
                                clear: async function () { _history.length = 0; }
                            };
                            const provider = undefined;
                            const gotoFlow = () => {};
                            let replyText = '';
                            const flowDynamic = async (arr) => {
                                if (Array.isArray(arr)) {
                                    replyText = arr.map(a => a.body).join('\n');
                                } else if (typeof arr === 'string') {
                                    replyText = arr;
                                }
                            };
                            if (msg.trim().toLowerCase() === "#reset" || msg.trim().toLowerCase() === "#cerrar") {
                                await state.clear();
                                replyText = "🔄 El chat ha sido reiniciado. Puedes comenzar una nueva conversación.";
                            } else {
                                await processUserMessage({ from: ip, body: msg, type: 'webchat' }, { flowDynamic, state, provider, gotoFlow });
                            }
                            socket.emit('reply', replyText);
                        } catch (err) {
                            console.error('Error procesando mensaje webchat:', err);
                            socket.emit('reply', 'Hubo un error procesando tu mensaje.');
                        }
                    });
                });



                // Integrar AssistantBridge si es necesario
                const assistantBridge = new AssistantBridge();
                assistantBridge.setupWebChat(polkaApp, realHttpServer);

                                polkaApp.post('/webchat-api', async (req, res) => {
                                    console.log('Llamada a /webchat-api'); // log para debug
                                    // Si el body ya está disponible (por ejemplo, con body-parser), úsalo directamente
                                        if (req.body && req.body.message != null) {
                                        console.log('Body recibido por body-parser:', req.body); // debug
                                        try {
                                            const message = req.body.message;
                                            console.log('Mensaje recibido en webchat:', message); // debug
                                            let ip = '';
                                            const xff = req.headers['x-forwarded-for'];
                                            if (typeof xff === 'string') {
                                                ip = xff.split(',')[0];
                                            } else if (Array.isArray(xff)) {
                                                ip = xff[0];
                                            } else {
                                                ip = req.socket.remoteAddress || '';
                                            }
                                            // Crear un ctx similar al de WhatsApp, usando el IP como 'from'
                                            const ctx = {
                                                from: ip,
                                                body: message,
                                                type: 'webchat',
                                                // Puedes agregar más propiedades si tu lógica lo requiere
                                            };
                                            // Usar WebChatManager y WebChatSession para gestionar la sesión webchat
                                            // Usar un Set para evitar duplicados y asegurar acumulación en recursividad
                                            const replyChunksSet = new Set();
                                            const flowDynamic = async (arr) => {
                                                const filtrarAPI = (txt) => txt && typeof txt === 'string' && !/\[API\][\s\S]*?\[\/API\]/.test(txt) && txt.trim().length > 0;
                                                if (Array.isArray(arr)) {
                                                    for (const a of arr) {
                                                        if (a && typeof a.body === 'string' && filtrarAPI(a.body)) replyChunksSet.add(a.body.trim());
                                                    }
                                                } else if (typeof arr === 'string' && filtrarAPI(arr)) {
                                                    replyChunksSet.add(arr.trim());
                                                }
                                            };
                                            const { getOrCreateThreadId, sendMessageToThread, deleteThread } = await import('./utils-web/openaiThreadBridge');
                                            const session = webChatManager.getSession(ip);
                                            if (message.trim().toLowerCase() === "#reset" || message.trim().toLowerCase() === "#cerrar") {
                                                await deleteThread(session);
                                                session.clear();
                                                replyChunksSet.add("🔄 El chat ha sido reiniciado. Puedes comenzar una nueva conversación.");
                                            } else {
                                                session.addUserMessage(message);
                                                const threadId = await getOrCreateThreadId(session);
                                                const reply = await sendMessageToThread(threadId, message, ASSISTANT_ID);
                                                session.addAssistantMessage(reply);
                                                // Procesar SIEMPRE la respuesta del asistente
                                                let bloqueoSoloPrimeraAPI = false;
                                                const flowDynamicProxy = async (arr) => {
                                                    const filtrarAPI = (txt) => txt && typeof txt === 'string' && !/\[API\][\s\S]*?\[\/API\]/.test(txt) && txt.trim().length > 0;
                                                    // Bloquear solo la PRIMERA llamada con resultado crudo de API
                                                    if (!bloqueoSoloPrimeraAPI && arr && Array.isArray(arr) && arr.length === 1 && arr[0].body && (arr[0].body.includes('No se encontraron resultados para la búsqueda.') || arr[0].body.includes('Ocurrió un error al buscar el producto.') || arr[0].body.startsWith('{'))) {
                                                        bloqueoSoloPrimeraAPI = true;
                                                        return; // NO agregar este mensaje al usuario
                                                    }
                                                    // Todas las siguientes (del asistente) sí se agregan, pero nunca [API]...
                                                    if (Array.isArray(arr)) {
                                                        for (const a of arr) {
                                                            if (a && typeof a.body === 'string' && filtrarAPI(a.body)) replyChunksSet.add(a.body.trim());
                                                        }
                                                    } else if (typeof arr === 'string' && filtrarAPI(arr)) {
                                                        replyChunksSet.add(arr.trim());
                                                    }
                                                };
                                                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                                                    reply,
                                                    ctx,
                                                    flowDynamicProxy,
                                                    session,
                                                    undefined,
                                                    () => {},
                                                    async (...args) => await sendMessageToThread(threadId, args[1], ASSISTANT_ID),
                                                    ASSISTANT_ID
                                                );
                                                // Si NO hubo bloque API ni respuesta acumulada, mostrar la última respuesta del asistente (plana o recursiva)
                                                if (!replyChunksSet.size) {
                                                    if (typeof reply === 'string' && reply.trim().length > 0) {
                                                        replyChunksSet.add(reply.trim());
                                                    } else if (reply !== null && reply && typeof reply === 'object' && 'text' in reply && typeof (reply as any).text === 'string' && (reply as any).text.trim().length > 0) {
                                                        replyChunksSet.add((reply as any).text.trim());
                                                    }
                                                }
                                            }
                                            res.setHeader('Content-Type', 'application/json');
                                            const replyText = Array.from(replyChunksSet).join('\n');
                                            res.end(JSON.stringify({ reply: replyText }));
                                        } catch (err) {
                                            console.error('Error en /webchat-api:', err); // debug
                                            res.statusCode = 500;
                                            res.end(JSON.stringify({ reply: 'Hubo un error procesando tu mensaje.' }));
                                        }
                                    } else {
                                        // Fallback manual si req.body no está disponible
                                        let body = '';
                                        req.on('data', chunk => { body += chunk; });
                                        req.on('end', async () => {
                                            console.log('Body recibido en /webchat-api:', body); // log para debug
                                            try {
                                                const { message } = JSON.parse(body);
                                                console.log('Mensaje recibido en webchat:', message); // debug
                                                let ip = '';
                                                const xff = req.headers['x-forwarded-for'];
                                                if (typeof xff === 'string') {
                                                    ip = xff.split(',')[0];
                                                } else if (Array.isArray(xff)) {
                                                    ip = xff[0];
                                                } else {
                                                    ip = req.socket.remoteAddress || '';
                                                }
                                                // Centralizar historial y estado igual que WhatsApp
                                                if (!global.webchatHistories) global.webchatHistories = {};
                                                const historyKey = `webchat_${ip}`;
                                                if (!global.webchatHistories[historyKey]) global.webchatHistories[historyKey] = { history: [], thread_id: null };
                                                const _store = global.webchatHistories[historyKey];
                                                const _history = _store.history;
                                                const state = {
                                                    get: function (key) {
                                                        if (key === 'history') return _history;
                                                        if (key === 'thread_id') return _store.thread_id;
                                                        return undefined;
                                                    },
                                                    setThreadId: function (id) {
                                                        _store.thread_id = id;
                                                    },
                                                    update: async function (msg, role = 'user') {
                                                        if (_history.length > 0) {
                                                            const last = _history[_history.length - 1];
                                                            if (last.role === role && last.content === msg) return;
                                                        }
                                                        _history.push({ role, content: msg });
                                                        if (_history.length >= 6) {
                                                            const last3 = _history.slice(-3);
                                                            if (last3.every(h => h.role === 'user' && h.content === msg)) {
                                                                _history.length = 0;
                                                                _store.thread_id = null;
                                                            }
                                                        }
                                                    },
                                                    clear: async function () { _history.length = 0; _store.thread_id = null; }
                                                };
                                                const provider = undefined;
                                                const gotoFlow = () => {};
                                                let replyText = '';
                                                const flowDynamic = async (arr) => {
                                                    if (Array.isArray(arr)) {
                                                        replyText = arr.map(a => a.body).join('\n');
                                                    } else if (typeof arr === 'string') {
                                                        replyText = arr;
                                                    }
                                                };
                                                if (message.trim().toLowerCase() === "#reset" || message.trim().toLowerCase() === "#cerrar") {
                                                    await state.clear();
                                                    replyText = "🔄 El chat ha sido reiniciado. Puedes comenzar una nueva conversación.";
                                                } else {
                                                    // ...thread_id gestionado por openaiThreadBridge, no es necesario actualizar aquí...
                                                }
                                                res.setHeader('Content-Type', 'application/json');
                                                res.end(JSON.stringify({ reply: replyText }));
                                            } catch (err) {
                                                console.error('Error en /webchat-api:', err); // debug
                                                res.statusCode = 500;
                                                res.end(JSON.stringify({ reply: 'Hubo un error procesando tu mensaje.' }));
                                            }
                                        });
                                    }
                                });

            // No llamar a listen, BuilderBot ya inicia el servidor

    // ...existing code...
    httpServer(+PORT);
};

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

export { welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowDoc, locationFlow,
        handleQueue, userQueues, userLocks,
 };

main();

//ok