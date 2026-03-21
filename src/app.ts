import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import OpenAI from "openai";
import { BaileysProvider } from "builderbot-provider-sherpa";
import { createBot, createProvider, createFlow, MemoryDB } from "@builderbot/bot";
import { httpInject } from "@builderbot-plugins/openai-assistants";

// --- Utils & Handlers ---
import { restoreSessionFromDb, startSessionSync, deleteSessionFromDb } from "./utils/sessionSync";
import { ErrorReporter } from "./utils/errorReporter";
import { updateMain } from "./addModule/updateMain";
import { WebChatManager } from "./utils-web/WebChatManager";
import { HistoryHandler } from "./utils/historyHandler";
import { registerProcessCallback, handleQueue, userQueues, userLocks } from "./utils/queueManager";

// --- Managers & Routes ---
import { registerBackofficeRoutes, processSendMessage, BackofficeDependencies } from "./routes/backoffice.routes";
import { registerRailwayRoutes } from "./routes/railway.routes";
import { registerWebchatRoutes } from "./routes/webchat.routes";
import { registerStaticRoutes } from "./routes/static.routes";
import { initSocketIO } from "./sockets/socket.manager";
import { registerProviderEvents, hasActiveSession } from "./providers/provider.manager";
import { startHumanInactivityWorker } from "./workers/humanInactivity.worker";
import { AiManager } from "./utils/ai.manager";
import { smartBodyParser, compatibilityLayer, rootRedirect } from "./middleware/global";
import { backofficeAuth } from "./middleware/auth";
import bodyParser from 'body-parser';

// --- Flows ---
import { welcomeFlowTxt } from "./Flows/welcomeFlowTxt";
import { welcomeFlowVoice } from "./Flows/welcomeFlowVoice";
import { welcomeFlowImg } from "./Flows/welcomeFlowImg";
import { welcomeFlowVideo } from "./Flows/welcomeFlowVideo";
import { welcomeFlowDoc } from "./Flows/welcomeFlowDoc";
import { locationFlow } from "./Flows/locationFlow";
import { idleFlow } from "./Flows/idleFlow";
import { welcomeFlowButton } from "./Flows/welcomeFlowButton";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Global instances
export let adapterProvider: any;
export let errorReporter: any;
export let aiManagerInstance: AiManager;
const webChatManager = new WebChatManager();
const openaiMain = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openaiVision = new OpenAI({ apiKey: process.env.OPENAI_API_KEY_IMG });
const ASSISTANT_ID = process.env.ASSISTANT_ID!;
const PORT = process.env.PORT || 3008;

// Multer config
const upload = multer({ 
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            const dir = "uploads/";
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname);
            cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
        }
    })
});

// Error handling setup
function registerSafeErrorHandlers() {
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    process.on("uncaughtException", (error) => {
        console.error(`⚠️ [UncaughtException] ${new Date().toISOString()}:`, error);
    });
    process.on("unhandledRejection", (reason) => {
        console.error(`⚠️ [UnhandledRejection] ${new Date().toISOString()}:`, reason);
    });
}

/**
 * Main function for Bot and Server Orchestration
 */
const main = async () => {
    // 1. Storage cleanup and session restoration
    await restoreSessionFromDb();
    const qrPath = path.join(process.cwd(), "bot.qr.png");

    // 2. Initialize Provider
    adapterProvider = createProvider(BaileysProvider, {
        version: [2, 3000, 1030817285],
        groupsIgnore: false,
        readStatus: false,
        disableHttpServer: true,
    });

    // 3. Register Provider Events
    registerProviderEvents(adapterProvider);

    // 4. Initialize Data and Error Reporter
    errorReporter = new ErrorReporter(adapterProvider, process.env.ID_GRUPO_RESUMEN || "");
    await updateMain();

    const app = adapterProvider.server;
    if (app) {
        // 5. Polka/Express Server setup & Early Middlewares
        console.log("🛠️ [POLKA MIDDLEWARES - INITIAL]:", app.middlewares?.length || 0);
        app.onError = (err: any, _req: any, res: any) => {
            console.error("🔥 [POLKA ERROR]:", err);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: err.message || "Internal Server Error" }));
        };

        // APLICAR COMPATIBILIDAD AL INICIO
        app.use(compatibilityLayer);
        // MASTER-INTERCEPTOR DE STREAMS (CRÍTICO)
        // Usamos middleware global (sin prefijo en app.use) para tener el req.url ORIGINAL completo.
        app.use(async (req: any, res: any, next: any) => {
            const fullUrl = req.url.split('?')[0];
            
            if (fullUrl === '/api/backoffice/send-message' && req.method === 'POST') {
                console.log("🛡️ [MASTER-INTERCEPTOR] Captura detectada de envío. Procesando bypass total...");
                
                return backofficeAuth(req, res, () => {
                    const deps: BackofficeDependencies = { adapterProvider, HistoryHandler, openaiMain, upload };
                    const contentType = req.headers['content-type'] || '';

                    if (contentType.includes('multipart/form-data')) {
                        return upload.single('file')(req, res, (err: any) => {
                            if (err) {
                                console.error("❌ [MASTER-INTERCEPTOR] Multer Error:", err.message);
                                return res.status(400).end(JSON.stringify({ success: false, error: `Error de archivo: ${err.message}` }));
                            }
                            const { chatId, message } = req.body;
                            console.log(`📡 [MASTER-INTERCEPTOR] Datos recibidos: chatId=${chatId}, messageLen=${message?.length || 0}, hasFile=${!!(req as any).file}`);
                            return processSendMessage(req, res, chatId, message, (req as any).file, deps);
                        });
                    } else {
                        return bodyParser.json()(req, res, () => {
                            const { chatId, message } = req.body;
                            return processSendMessage(req, res, chatId || '', message || '', null, deps);
                        });
                    }
                });
            }
            next();
        });

        app.use(rootRedirect);
        
        registerBackofficeRoutes(app, {
            adapterProvider,
            HistoryHandler,
            openaiMain,
            upload
        });
    }

    // 6. Initialize AI Manager and flows
    const aiManager = new AiManager(openaiMain, ASSISTANT_ID, errorReporter, {
        welcomeFlowTxt, welcomeFlowVoice, welcomeFlowButton
    });
    aiManagerInstance = aiManager;

    registerProcessCallback(async (item: any) => {
        const { ctx, flowDynamic, state, provider, gotoFlow } = item;
        await aiManager.processUserMessage(ctx, { flowDynamic, state, provider, gotoFlow });
    });

    // 7. Initialize Bot Instance
    const adapterFlow = createFlow([
        welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, 
        welcomeFlowVideo, welcomeFlowDoc, locationFlow, 
        idleFlow, welcomeFlowButton
    ]);
    const adapterDB = new MemoryDB();

    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB
    });

    registerSafeErrorHandlers();
    startSessionSync();

    // 8. Middlewares y Plugins post-Bot
    if (app) {
        // Plugins y Middlewares Globales de Body-Parsing
        httpInject(app);
        app.use(smartBodyParser);

        // 9. Register Other Routes
        registerRailwayRoutes(app, { RailwayApi: (await import("./Api-RailWay/Railway")).RailwayApi });
        registerWebchatRoutes(app, { webChatManager, openaiVision, ASSISTANT_ID, processUserMessage: aiManager.processUserMessage });
        registerStaticRoutes(app, { __dirname });

        // API Health & Info
        app.get("/health", (_req: any, res: any) => res.json({ status: "ok", time: new Date().toISOString() }));
        app.get("/api/assistant-name", (_req: any, res: any) => res.json({ name: process.env.ASSISTANT_NAME || "Bot" }));
        app.get("/api/dashboard-status", backofficeAuth, async (_req: any, res: any) => res.json(await hasActiveSession(adapterProvider)));

        // API Session Control
        app.post("/api/delete-session", backofficeAuth, async (_req: any, res: any) => {
            try {
                await deleteSessionFromDb();
                res.json({ success: true });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
    }
        
    // 10. Workers Initialization
    startHumanInactivityWorker(15);

    // 11. Start Server and Sockets
    try {
        httpServer(+PORT);
        setTimeout(() => {
            if (app?.server) {
                console.log("✅ [Socket.IO] app.server detected, initializing...");
                initSocketIO(app.server, { processUserMessage: aiManager.processUserMessage });
            }
        }, 1000);
    } catch (err) {
        console.error("❌ [FATAL] Error starting server:", err);
    }
};

main().catch(err => console.error("❌ [FATAL MAIN]:", err));

export {
    welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowVideo, welcomeFlowDoc, locationFlow,
    AiManager, handleQueue, userQueues, userLocks
};

export const processUserMessage = async (ctx: any, items: any) => {
    if (!aiManagerInstance) throw new Error("AiManager not initialized");
    return await aiManagerInstance.processUserMessage(ctx, items);
};
