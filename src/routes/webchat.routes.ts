import path from 'path';
import fs from 'fs';
import { withRetry } from "../utils/retryHelper";
import { getOrCreateThreadId, deleteThread, sendMessageToThread } from "../utils-web/openaiThreadBridge";
import { AssistantResponseProcessor } from "../utils/AssistantResponseProcessor";
import { transcribeAudioFile } from "../utils/audioTranscriptior";

import { backofficeAuth } from "../middleware/auth";

/**
 * Registra las rutas de Webchat en la instancia de Polka.
 */
export const registerWebchatRoutes = (app: any, { 
    webChatManager, 
    openaiVision, 
    ASSISTANT_ID, 
    processUserMessage 
}: any) => {

    app.post('/webchat-api', backofficeAuth, async (req: any, res: any) => {
        if (!req.body || (!req.body.message && !req.body.file)) {
            return res.status(400).json({ error: "Falta 'message' o 'file'" });
        }
        try {
            let message = req.body.message || "";
            let ip = '';
            const xff = req.headers['x-forwarded-for'];
            if (typeof xff === 'string') ip = xff.split(',')[0];
            else ip = req.ip || '';

            if (req.body.file) {
                const file = req.body.file;
                const mimetype = file.mime || '';
                const base64Data = file.base64;
                const ext = mimetype.split('/')[1] || 'bin';
                
                try {
                    const buffer = Buffer.from(base64Data, 'base64');
                    
                    if (mimetype.startsWith('image/')) {
                        const localDir = path.join("./temp/");
                        if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
                        const localPath = path.join(localDir, Date.now() + "." + ext);
                        fs.writeFileSync(localPath, buffer);

                        const visionResponse = await withRetry(async () => {
                            return await openaiVision.chat.completions.create({
                                model: "gpt-4o",
                                messages: [{
                                    role: "user",
                                    content: [
                                        { type: "text", text: "Describe esta imagen detalladamente..." },
                                        { type: "image_url", image_url: { url: `data:${mimetype};base64,${base64Data}` } }
                                    ]
                                }]
                            });
                        }, { maxRetries: 3 });
                        
                        const result = visionResponse.choices?.[0]?.message?.content || "No se pudo obtener una descripción.";
                        message = `[Imagen recibida]: ${result} \n${message}`;

                    } else if (mimetype.startsWith('audio/') || mimetype.startsWith('video/')) {
                        const localDir = path.join("./temp/voiceNote/");
                        if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
                        const localPath = path.join(localDir, Date.now() + "." + ext);
                        fs.writeFileSync(localPath, buffer);

                        try {
                            const transcription = await transcribeAudioFile(localPath);
                            message = `[Audio/Video transcrito]: ${transcription} \n${message}`;
                        } catch (err) {
                            message = `[Error] No se pudo procesar el audio/video. \n${message}`;
                        }
                    } else {
                        message = `[Archivo adjunto] ${file.name} \n${message}`;
                    }
                } catch (e) {
                    message = `[Error al procesar archivo adjunto] \n${message}`;
                }
            }

            const session = webChatManager.getSession(ip);
            let replyText = '';

            if (message.trim().toLowerCase() === "#reset") {
                await deleteThread(session);
                session.clear();
                replyText = "🔄 Chat reiniciado.";
            } else {
                const threadId = await getOrCreateThreadId(session);
                session.addUserMessage(message);

                const state = {
                    get: (key: string) => key === 'thread_id' ? session.thread_id : undefined,
                    update: async () => {},
                    clear: async () => session.clear(),
                };

                const webChatAdapterFn = async (assistantId: string, msg: string, _st: any, _fb: any, _uid: any, tid: string) => {
                    return await sendMessageToThread(tid, msg, assistantId);
                };

                const reply = await webChatAdapterFn(ASSISTANT_ID, message, state, "", ip, threadId);

                const flowDynamic = async (arr: any) => {
                    const text = Array.isArray(arr) ? arr.map(a => a.body).join('\n') : arr;
                    replyText = replyText ? replyText + "\n\n" + text : text;
                };

                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    reply,
                    { type: 'webchat', from: ip, thread_id: threadId, body: message },
                    flowDynamic,
                    state,
                    undefined,
                    () => {},
                    webChatAdapterFn,
                    ASSISTANT_ID
                );
                session.addAssistantMessage(replyText);
            }
            res.json({ reply: replyText });
        } catch (err) {
            console.error('[Error Webchat API] check failed:', err);
            res.status(500).json({ reply: 'Error interno.' });
        }
    });

};
