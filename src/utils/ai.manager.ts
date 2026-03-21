import { typing } from "./presence";
import { HistoryHandler } from "./historyHandler";
import { EVENTS } from "@builderbot/bot";
import { getArgentinaDatetimeString } from "./ArgentinaTime";
import { safeToAsk } from "./openaiHelper";
import { AssistantResponseProcessor } from "./AssistantResponseProcessor";
import { stop, reset } from "./timeOut";
import { updateMain } from "../addModule/updateMain";

export class AiManager {
    private userTimeouts = new Map<string, NodeJS.Timeout>();
    private readonly TIMEOUT_MS = 60000;

    constructor(
        private openaiMain: any,
        private assistantId: string,
        private errorReporter: any,
        private flows: any // Objeto con welcomeFlowTxt, welcomeFlowVoice, etc.
    ) {}

    public getAssistantResponse = async (assistantId: string, message: string, state: any, fallbackMessage: string | undefined, userId: string, thread_id: string | null = null) => {
        const currentDatetimeArg = getArgentinaDatetimeString();
        let systemPrompt = `Fecha, hora y día de la semana de referencia: ${currentDatetimeArg}`;
        
        if (process.env.EXTRA_SYSTEM_PROMPT) {
            systemPrompt += `\nInstrucción de refuerzo: ${process.env.EXTRA_SYSTEM_PROMPT}`;
        }

        if (fallbackMessage) systemPrompt += `\n${fallbackMessage}`;
        if (userId) systemPrompt += `\nNúmero de contacto: ${userId}`;
        
        const finalMessage = systemPrompt + "\n" + message;

        if (this.userTimeouts.has(userId)) {
            clearTimeout(this.userTimeouts.get(userId)!);
            this.userTimeouts.delete(userId);
        }

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                console.warn("⏱ Timeout de 60s alcanzado en la comunicación con OpenAI.");
            }, this.TIMEOUT_MS);
            this.userTimeouts.set(userId, timeoutId);

            safeToAsk(assistantId, finalMessage, state, userId, this.errorReporter)
                .then(result => {
                    if (this.userTimeouts.has(userId)) {
                        clearTimeout(this.userTimeouts.get(userId)!);
                        this.userTimeouts.delete(userId);
                    }
                    resolve(result);
                })
                .catch(error => {
                    if (this.userTimeouts.has(userId)) {
                        clearTimeout(this.userTimeouts.get(userId)!);
                        this.userTimeouts.delete(userId);
                    }
                    if (error?.message === 'TIMEOUT_SAFE_TO_ASK') {
                        console.error(`[AiManager] Finalizando por timeout de seguridad para ${userId}`);
                        resolve(fallbackMessage || "Lo siento, estoy tardando un poco más de lo habitual. Por favor, reintenta en un momento.");
                    } else {
                        reject(error);
                    }
                });
        });
    };

    public processUserMessage = async (ctx: any, { flowDynamic, state, provider, gotoFlow }: any) => {
        await typing(ctx, provider);
        try {
            const body = ctx.body && ctx.body.trim();

            // COMANDOS DE CONTROL (WhatsApp Admin)
            if (body === "#ON#") {
                await HistoryHandler.toggleBot(ctx.from, true);
                if (ctx.pushName) await HistoryHandler.getOrCreateChat(ctx.from, 'whatsapp', ctx.pushName);
                const msg = "🤖 Bot activado para este chat.";
                await flowDynamic([{ body: msg }]);
                await HistoryHandler.saveMessage(ctx.from, 'assistant', msg, 'text');
                return state;
            }

            if (body === "#OFF#") {
                await HistoryHandler.toggleBot(ctx.from, false);
                if (ctx.pushName) await HistoryHandler.getOrCreateChat(ctx.from, 'whatsapp', ctx.pushName);
                const msg = "🛑 Bot desactivado. (Intervención humana activa)";
                await flowDynamic([{ body: msg }]);
                await HistoryHandler.saveMessage(ctx.from, 'assistant', msg, 'text');
                return state;
            }

            // Filtro de Eco
            const botNumber = (process.env.YCLOUD_WABA_NUMBER || '').replace(/\D/g, '');
            const senderNumber = (ctx.from || '').replace(/\D/g, '');
            if (ctx.key?.fromMe || (botNumber && senderNumber === botNumber)) {
                stop(ctx);
                return;
            }

            stop(ctx);

            await HistoryHandler.saveMessage(
                ctx.from, 
                'user', 
                body || (ctx.type === EVENTS.VOICE_NOTE ? "[Audio]" : "[Media]"), 
                ctx.type,
                ctx.pushName || null
            );

            const isBotActiveForUser = await HistoryHandler.isBotEnabled(ctx.from);
            if (!isBotActiveForUser) {
                try {
                    const threadId = await HistoryHandler.getThreadId(ctx.from);
                    if (threadId) {
                        await this.openaiMain.beta.threads.messages.create(threadId, {
                            role: 'user',
                            content: body || '[Media]'
                        });
                    }
                } catch (e: any) {
                    console.error("[AiManager] Error guardando threadId:", e.message);
                }
                return state;
            }

            // Comandos Globales y Sheet Update
            if (body === "#ACTUALIZAR#") {
                try {
                    await updateMain();
                    await flowDynamic([{ body: "🔄 Datos actualizados desde Google." }]);
                } catch (err) {
                    await flowDynamic([{ body: "❌ Error al actualizar datos desde Google." }]);
                }
                return state;
            }

            // Filtro de Broadcast/Channel/Lid
            if (ctx.from) {
                if (/@broadcast$/.test(ctx.from) || /@newsletter$/.test(ctx.from) || /@channel$/.test(ctx.from)) return;
                if (/@lid$/.test(ctx.from)) {
                    if (provider && typeof provider.sendMessage === 'function') {
                        await provider.sendMessage('+5491130792789', `⚠️ @lid contacto: ${ctx.from}`);
                    }
                    return;
                }
            }

            const response = (await this.getAssistantResponse(this.assistantId, ctx.body, state, undefined, ctx.from, ctx.thread_id)) as string;

            try {
                const currentThreadId = state && typeof state.get === 'function' ? state.get('thread_id') : null;
                if (currentThreadId && ctx.from) {
                    await HistoryHandler.saveThreadId(ctx.from, currentThreadId);
                }
            } catch (e: any) {
                console.error("[AiManager] Error guardando threadId:", e.message);
            }

            await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                response,
                ctx,
                flowDynamic,
                state,
                provider,
                gotoFlow,
                this.getAssistantResponse,
                this.assistantId
            );

            const setTime = Number(process.env.timeOutCierre || 5) * 60 * 1000;
            reset(ctx, gotoFlow, setTime);
            return state;

        } catch (error: any) {
            await this.errorReporter.reportError(error, ctx.from, `https://wa.me/${ctx.from}`);

            if (ctx.type === EVENTS.VOICE_NOTE) return gotoFlow(this.flows.welcomeFlowVoice);
            if (ctx.type === EVENTS.ACTION) return gotoFlow(this.flows.welcomeFlowButton);
            return gotoFlow(this.flows.welcomeFlowTxt);
        }
    };
}
