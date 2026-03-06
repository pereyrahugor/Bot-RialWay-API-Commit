// Type guard to check if reply is an object with a non-empty string 'text' property
function isReplyWithText(reply: any): reply is { text: string } {
    return (
        reply !== null &&
        typeof reply === 'object' &&
        'text' in reply &&
        typeof reply.text === 'string' &&
        reply.text.trim().length > 0
    );
}
// ...existing imports y lógica del bot...
import "dotenv/config";
import path from 'path';
import serveStatic from 'serve-static';
import { Server } from 'socket.io';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import bodyParser from 'body-parser';
// Note: polka is already used via adapterProvider.server
import { historyEvents } from "./utils/historyHandler";

import { createBot, createProvider, createFlow, EVENTS, MemoryDB } from "@builderbot/bot";
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
import { AssistantResponseProcessor } from "./utils/AssistantResponseProcessor";
import { HistoryHandler } from "./utils/historyHandler";
import { userQueues, userLocks, handleQueue, registerProcessCallback } from "./utils/queueManager";
import { waitForActiveRuns } from "./utils/AssistantResponseProcessor";

// Estado global para encender/apagar el bot
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webChatManager = new WebChatManager();

/** Puerto en el que se ejecutará el servidor (Railway usa 8080 por defecto) */
const PORT = process.env.PORT || 8080;
/** ID del asistente de OpenAI */
const ASSISTANT_ID = process.env.ASSISTANT_ID;
const ID_GRUPO_RESUMEN = process.env.ID_GRUPO_WS ?? "";
const BACKOFFICE_TOKEN = process.env.BACKOFFICE_TOKEN || "admin123";

/**
 * Middleware para autenticación del Backoffice
 */
const backofficeAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (authHeader === `token=${BACKOFFICE_TOKEN}`) {
        next();
    } else {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'No autorizado' }));
    }
};

/**
 * Función para servir páginas HTML con inyección dinámica opcional
 */
const serveHtmlPage = (filename, botName = '') => {
  return (req, res) => {
    const filePath = path.join(__dirname, '../src/html', filename);
    if (fs.existsSync(filePath)) {
      let htmlContent = fs.readFileSync(filePath, 'utf8');
      
      // Inyección dinámica para el Backoffice
      if (filename === 'backoffice.html' && botName) {
        htmlContent = htmlContent.replace(
          '<h2 style="margin:0; font-size: 1.2rem;">Backoffice</h2>',
          `<h2 style="margin:0; font-size: 1.2rem;">Backoffice - ${botName}</h2>`
        );
      }
      
      res.setHeader('Content-Type', 'text/html');
      res.end(htmlContent);
    } else {
      res.statusCode = 404;
      res.end('Página no encontrada');
    }
  };
};

const adapterProvider = createProvider(BaileysProvider, {
    groupsIgnore: false,
    readStatus: false,
});

const errorReporter = new ErrorReporter(adapterProvider, ID_GRUPO_RESUMEN); // Reemplaza YOUR_GROUP_ID con el ID del grupo de WhatsApp

const TIMEOUT_MS = 30000;

// Control de timeout por usuario para evitar ejecuciones automáticas superpuestas
const userTimeouts = new Map();

/**
 * Wrapper seguro para toAsk que añade control de thread_id y esperas de runs activos.
 * Implementa Backoff Loop para reintentos de red o saturación.
 */
export const safeToAsk = async (assistantId, message, state, attempts = 3) => {
    const thread_id = state.get('thread_id');
    
    for (let i = 0; i < attempts; i++) {
        try {
            if (thread_id) {
                await waitForActiveRuns(thread_id);
            }
            return await toAsk(assistantId, message, state);
        } catch (error: any) {
            console.error(`[safeToAsk] Fallo en intento ${i + 1}/${attempts}:`, error.message);
            if (i < attempts - 1) {
                const waitTime = (i + 1) * 2000;
                console.log(`[safeToAsk] Reintentando en ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            throw error;
        }
    }
};

export const getAssistantResponse = async (assistantId, message, state, fallbackMessage, userId, thread_id = null) => {
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
      resolve(safeToAsk(assistantId, fallbackMessage ?? message, state));
      userTimeouts.delete(userId);
    }, TIMEOUT_MS);
    userTimeouts.set(userId, timeoutId);
  });

    // Lanzamos la petición a OpenAI
    const askPromise = safeToAsk(assistantId, message, state).then((result) => {
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
        const from = ctx.from;
        const pushName = ctx.pushName || 'Usuario';

        // PERSISTENCIA: Guardar mensaje del usuario
        await HistoryHandler.saveMessage(
            from, 
            'user', 
            body || (ctx.type === EVENTS.VOICE_NOTE ? "[Audio]" : "[Media]"), 
            ctx.type || 'text',
            pushName
        );

        // COMANDOS DE ADMINISTRACIÓN (Solo WhatsApp o según prefieras)
        if (body === "#ON#") {
            await HistoryHandler.toggleBot(from, true);
            await flowDynamic([{ body: "🤖 Bot activado para este chat." }]);
            return state;
        }

        if (body === "#OFF#") {
            await HistoryHandler.toggleBot(from, false);
            await flowDynamic([{ body: "🛑 Bot desactivado para este chat. No responderé hasta recibir #ON#." }]);
            return state;
        }

        if (body === "#ACTUALIZAR#") {
            try {
                await updateMain();
                await flowDynamic([{ body: "🔄 Datos actualizados desde Google Sheets." }]);
            } catch (err) {
                await flowDynamic([{ body: "❌ Error al actualizar datos." }]);
            }
            return state;
        }

        // VERIFICAR SI EL BOT ESTÁ ENCENDIDO PARA ESTE USUARIO
        const isEnabled = await HistoryHandler.isBotEnabled(from);
        if (!isEnabled) {
            console.log(`[BotStatus] Bot apagado para ${from}. Ignorando mensaje.`);
            return;
        }

        // Ignorar mensajes de listas de difusión
        if (from && /@broadcast$/.test(from)) {
            return;
        }

        const response = await getAssistantResponse(ASSISTANT_ID, ctx.body, state, "Prueba a responder de forma concisa.", from, ctx.thread_id);

        if (!response) {
            await errorReporter.reportError(new Error("No se recibió respuesta del asistente."), from, `https://wa.me/${from}`);
            return;
        }

        // PROCESAR RESPUESTA (AssistantResponseProcessor se encarga de TODO: APIs, recursividad, limpieza y flowDynamic)
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

        return state;
    } catch (error) {
        console.error("Error al procesar el mensaje del usuario:", error);
        await errorReporter.reportError(error, ctx.from, `https://wa.me/${ctx.from}`);
        
        if (ctx.type === EVENTS.VOICE_NOTE) {
            return gotoFlow(welcomeFlowVoice);
        } else {
            return gotoFlow(welcomeFlowTxt);
        }
    }
};


// La lógica de colas está en queueManager.ts

// Main function to initialize the bot and load Google Sheets data
const main = async () => {
    console.log("📌 Inicializando datos desde Google Sheets...");

    registerProcessCallback(async ({ ctx, flowDynamic, state, provider, gotoFlow }) => {
        await processUserMessage(ctx, { flowDynamic, state, provider, gotoFlow });
    });

    await updateMain();

    const { httpServer } = await createBot({
        flow: createFlow([
            welcomeFlowTxt,
            welcomeFlowVoice,
            welcomeFlowImg,
            welcomeFlowDoc,
            locationFlow
        ]),
        provider: createProvider(BaileysProvider),
        database: new MemoryDB(),
    });

    const realHttpServer = (httpServer as any).server || httpServer;
    const io = new Server(realHttpServer, {
        cors: { origin: "*", methods: ["GET", "POST"] }
    });

    io.on('connection', (socket) => {
        console.log('Cliente conectado via Socket.io:', socket.id);
        
        socket.on('join_chat', (chatId) => {
            socket.join(chatId);
            console.log(`Socket ${socket.id} se unió al chat ${chatId}`);
        });

        socket.on('send_message', async (data) => {
            try {
                const { chatId, message } = data;
                console.log(`Mensaje manual desde Backoffice para ${chatId}: ${message}`);
                
                // Aquí podrías implementar la lógica para enviar mensajes manuales vía provider
                // Por ahora solo lo guardamos en el historial
                await HistoryHandler.saveMessage(chatId, 'assistant', message, 'text', 'Soporte');
                
                // Notificar a otros clientes
                io.to(chatId).emit('new_message', {
                    from: 'assistant',
                    body: message,
                    type: 'text',
                    timestamp: new Date().toISOString()
                });
            } catch (err) {
                console.error('Error enviando mensaje manual:', err);
            }
        });
    });

    historyEvents.on('new_message', (data) => {
        io.to(data.chatId).emit('new_message', data);
        io.emit('global_new_message', data);
    });

    historyEvents.on('bot_toggled', (data) => {
        io.emit('bot_status_changed', data);
    });

    const polkaApp = (httpServer as any).polka || httpServer;

    polkaApp.use(bodyParser.json());
    polkaApp.use(serveStatic(path.join(__dirname, 'html')));
    polkaApp.use('/js', serveStatic(path.join(__dirname, 'html', 'js')));
    polkaApp.use('/style', serveStatic(path.join(__dirname, 'html', 'style')));
    polkaApp.use('/assets', serveStatic(path.join(__dirname, 'html', 'assets')));

    polkaApp.get('/backoffice', backofficeAuth, serveHtmlPage('backoffice.html', (process.env.ASSISTANT_NAME || 'Bot')));
    polkaApp.get('/dashboard', backofficeAuth, serveHtmlPage('dashboard.html'));
    polkaApp.get('/login', serveHtmlPage('login.html'));
    polkaApp.get('/variables', backofficeAuth, serveHtmlPage('variables.html'));
    polkaApp.get('/webchat', serveHtmlPage('webchat.html'));
    polkaApp.get('/webreset', serveHtmlPage('webreset.html'));

    polkaApp.get('/api/backoffice/chats', backofficeAuth, async (req, res) => {
        try {
            const chats = await HistoryHandler.listChats();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(chats));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    polkaApp.get('/api/backoffice/messages/:chatId', backofficeAuth, async (req, res) => {
        try {
            const { chatId } = req.params;
            const history = await HistoryHandler.getMessages(chatId);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(history));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    polkaApp.get('/api/backoffice/profile-pic/:chatId', backofficeAuth, async (req, res) => {
        try {
            const { chatId } = req.params;
            let url = 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png';
            
            try {
                // jid format: XXXXX@s.whatsapp.net
                const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
                url = await adapterProvider.vendor.profilePictureUrl(jid, 'image');
            } catch (e) {
                // Silently ignore if no profile pic
            }
            
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ url }));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    polkaApp.post('/api/backoffice/toggle-bot', backofficeAuth, async (req, res) => {
        try {
            const { chatId, enabled } = req.body;
            await HistoryHandler.toggleBot(chatId, enabled);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    polkaApp.post('/api/backoffice/send-message', backofficeAuth, async (req, res) => {
        try {
            const { chatId, message } = req.body;
            const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
            
            console.log(`[Backoffice] Enviando mensaje manual a ${jid}: ${message}`);
            
            // Enviar via Baileys
            await adapterProvider.sendMessage(jid, message, {});
            
            // Guardar en historial con rol assistant (Soporte Humano)
            await HistoryHandler.saveMessage(chatId, 'assistant', message, 'text', 'Soporte Humano');
            
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            console.error('Error enviando mensaje manual desde API:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    polkaApp.post('/webchat-api', async (req, res) => {
        try {
            const { message, thread_id } = req.body;
            let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            if (Array.isArray(ip)) ip = ip[0];
            
            const from = `web_${ip?.replace(/[^a-zA-Z0-9]/g, '') || 'unknown'}`;
            
            // Lógica similar a processUserMessage pero para WebChat
            const response = await getAssistantResponse(ASSISTANT_ID, message, {}, "Responde al usuario del webchat.", from, thread_id);
            
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ reply: response }));
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    httpServer(+PORT);
};

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

export { welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowDoc, locationFlow };

main();
