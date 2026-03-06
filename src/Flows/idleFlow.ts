import { addKeyword, EVENTS } from '@builderbot/bot';
import { safeToAsk } from '../app';
import { GenericResumenData, extraerDatosResumen } from '~/utils/extractJsonData';
import { addToSheet } from '~/utils/googleSheetsResumen';
import fs from 'fs';
import path from 'path';// Import the new logic
import { ReconectionFlow } from './reconectionFlow';

//** Variables de entorno para el envio de msj de resumen a grupo de WS */
const ASSISTANT_ID = process.env.ASSISTANT_ID ?? '';
const ID_GRUPO_RESUMEN = process.env.ID_GRUPO_RESUMEN ?? '';
const ID_GRUPO_RESUMEN_2 = process.env.ID_GRUPO_RESUMEN_2 ?? '';
const msjCierre: string = process.env.msjCierre as string;

// Función auxiliar para reenviar media
async function sendMediaToGroup(provider: any, state: any, targetGroup: string, data: any) {
    // Detectar variaciones de "si" (si, sí, sii, si., Si, YES, etc - aunque el json suele ser español)
    // Usamos regex flexible que busca "s" seguido de "i" o "í"
    const fotoOVideoRaw = data["Foto o video"] || '';
    const debeEnviar = /s[ií]+/i.test(fotoOVideoRaw);

    if (debeEnviar) {
        const lastImage = state.get('lastImage');
        const lastVideo = state.get('lastVideo');

        if (lastImage && typeof lastImage === 'string') {
            if (fs.existsSync(lastImage)) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                console.log(`📡 Intentando enviar imagen: ${lastImage} a ${targetGroup}`);
                await provider.sendImage(targetGroup, lastImage, "");
                console.log(`✅ Imagen reenviada al grupo ${targetGroup}`);
                try {
                    fs.unlinkSync(lastImage);
                    await state.update({ lastImage: null });
                } catch (e) { console.error('Error borrando img:', e); }
            }
        }

        if (lastVideo && typeof lastVideo === 'string') {
            if (fs.existsSync(lastVideo)) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                console.log(`📡 Intentando enviar video: ${lastVideo} a ${targetGroup}`);
                if (provider.sendVideo) {
                    await provider.sendVideo(targetGroup, lastVideo, "");
                } else {
                    await provider.sendImage(targetGroup, lastVideo, "");
                }
                console.log(`✅ Video reenviado al grupo ${targetGroup}`);
                try {
                    fs.unlinkSync(lastVideo);
                    await state.update({ lastVideo: null });
                } catch (e) { console.error('Error borrando video:', e); }
            }
        }
    }
}

//** Flow para cierre de conversación, generación de resumen y envio a grupo de WS */
const idleFlow = addKeyword(EVENTS.ACTION).addAction(
    async (ctx, { endFlow, provider, state }) => {
        const userId = ctx.from;
        // Filtrar contactos ignorados antes de procesar el flujo
        if (
            /@broadcast$/.test(userId) ||
            /@newsletter$/.test(userId) ||
            /@channel$/.test(userId) ||
            /@lid$/.test(userId)
        ) {
            console.log(`idleFlow ignorado por filtro de contacto: ${userId}`);
            return endFlow();
        }

        console.log("Ejecutando idleFlow...");

        try {
            // Obtener el resumen del asistente de OpenAI
            const resumen = await safeToAsk(ASSISTANT_ID, "GET_RESUMEN", state);

            if (!resumen) {
                console.warn("No se pudo obtener el resumen.");
                return endFlow();
            }

            let data: GenericResumenData;
            try {
                data = JSON.parse(resumen);
            } catch (error) {
                console.warn("⚠️ El resumen no es JSON. Se extraerán los datos manualmente.");
                data = extraerDatosResumen(resumen);
            }

            // Log para depuración del valor real de tipo
            console.log('Valor de tipo:', JSON.stringify(data.tipo), '| Longitud:', data.tipo?.length);
            // Limpieza robusta de caracteres invisibles y espacios, preservando números y guiones bajos
            const tipo = (data.tipo ?? '').replace(/[^A-Z0-9_]/gi, '').toUpperCase();

            if (tipo === 'NO_REPORTAR_BAJA') {
                // No seguimiento, no enviar resumen al grupo ws, envia resumen a sheet, envia msj de cierre
                console.log('NO_REPORTAR_BAJA: No se realiza seguimiento ni se envía resumen al grupo.');
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

                // Limpieza de imagen o video si existe
                const lastImage = state.get('lastImage');
                if (lastImage && typeof lastImage === 'string' && fs.existsSync(lastImage)) {
                    fs.unlinkSync(lastImage);
                    await state.update({ lastImage: null });
                }
                const lastVideo = state.get('lastVideo');
                if (lastVideo && typeof lastVideo === 'string' && fs.existsSync(lastVideo)) {
                    fs.unlinkSync(lastVideo);
                    await state.update({ lastVideo: null });
                }

                await addToSheet(data);
                return endFlow(); //("BNI, cambiando la forma en que el mundo hace negocios\nGracias por su contacto.");
            } else if (tipo === 'NO_REPORTAR_SEGUIR') {
                // Solo este activa seguimiento
                console.log('NO_REPORTAR_SEGUIR: Se realiza seguimiento, pero no se envía resumen al grupo.');
                const reconFlow = new ReconectionFlow({
                    ctx,
                    state,
                    provider,
                    maxAttempts: 3,
                    onSuccess: async (newData) => {
                        // Derivar al flujo conversacional usando gotoFlow
                        if (typeof ctx.gotoFlow === 'function') {
                            if (ctx.type === 'voice_note' || ctx.type === 'VOICE_NOTE') {
                                const mod = await import('./welcomeFlowVoice');
                                await ctx.gotoFlow(mod.welcomeFlowVoice);
                            } else {
                                const mod = await import('./welcomeFlowTxt');
                                await ctx.gotoFlow(mod.welcomeFlowTxt);
                            }
                        }
                    },
                    onFail: async () => {
                        data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;
                        await addToSheet(data);
                    }
                });
                return await reconFlow.start();
                // No cerrar el hilo aquí, dejar abierto para que el usuario pueda responder
                // Bloque SI_RESUMEN_G2
            } else if (tipo === 'SI_REPORTAR_SEGUIR') {
                // Se envía resumen al grupo y se activa seguimiento
                console.log('SI_REPORTAR_SEGUIR: Se envía resumen al grupo y se realiza seguimiento.');
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

                const resumenLimpio = resumen.replace(/https:\/\/wa\.me\/[0-9]+/g, '').trim();
                const resumenConLink = `${resumenLimpio}\n\n🔗 [Chat del usuario](${data.linkWS})`;

                try {
                        await provider.sendMessage(ID_GRUPO_RESUMEN, resumenConLink, {});
                        console.log(`✅ SI_REPORTAR_SEGUIR: Resumen enviado a ${ID_GRUPO_RESUMEN}`);
                        await sendMediaToGroup(provider, state, ID_GRUPO_RESUMEN, data);

                } catch (err: any) {
                    console.error(`❌ SI_REPORTAR_SEGUIR Error:`, err?.message || err);
                }

                await addToSheet(data);

                const reconFlow = new ReconectionFlow({
                    ctx,
                    state,
                    provider,
                    maxAttempts: 3,
                    onSuccess: async (newData) => {
                        // Derivar al flujo conversacional usando gotoFlow
                        if (typeof ctx.gotoFlow === 'function') {
                            if (ctx.type === 'voice_note' || ctx.type === 'VOICE_NOTE') {
                                const mod = await import('./welcomeFlowVoice');
                                await ctx.gotoFlow(mod.welcomeFlowVoice);
                            } else {
                                const mod = await import('./welcomeFlowTxt');
                                await ctx.gotoFlow(mod.welcomeFlowTxt);
                            }
                        }
                    },
                    onFail: async () => {
                        console.log('SI_REPORTAR_SEGUIR: No se obtuvo respuesta luego del seguimiento.');
                    }
                });
                return await reconFlow.start();
                // No cerrar el hilo aquí, dejar abierto para que el usuario pueda responder
                // Bloque SI_RESUMEN_G2
            } else if (tipo === 'SI_RESUMEN_G2') {
                console.log('SI_RESUMEN_G2: Solo se envía resumen al grupo y sheets.');
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

                const resumenConLink = `${resumen}\n\n🔗 [Chat del usuario](${data.linkWS})`;
                try {
                    await provider.sendText(ID_GRUPO_RESUMEN_2, resumenConLink);
                    console.log(`✅ SI_RESUMEN_G2: Resumen enviado a ${ID_GRUPO_RESUMEN_2}`);

                    await sendMediaToGroup(provider, state, ID_GRUPO_RESUMEN_2, data);

                } catch (err: any) {
                    console.error(`❌ SI_RESUMEN_G2 Error:`, err?.message || err);
                }

                await addToSheet(data);
                return;

            } else if (tipo === 'SI_RESUMEN') {
                console.log('SI_RESUMEN: Solo se envía resumen al grupo y sheets.');
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

                const resumenConLink = `${resumen}\n\n🔗 [Chat del usuario](${data.linkWS})`;
                try {
                    await provider.sendText(ID_GRUPO_RESUMEN, resumenConLink);
                    console.log(`✅ SI_RESUMEN: Resumen enviado a ${ID_GRUPO_RESUMEN}`);

                    await sendMediaToGroup(provider, state, ID_GRUPO_RESUMEN, data);

                } catch (err: any) {
                    console.error(`❌ SI_RESUMEN Error:`, err?.message || err);
                }

                await addToSheet(data);
                return;

            } else {
                // DEFAULT
                console.log('Tipo desconocido, procesando como SI_RESUMEN por defecto.');
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

                const resumenConLink = `${resumen}\n\n🔗 [Chat del usuario](${data.linkWS})`;
                try {
                    await provider.sendText(ID_GRUPO_RESUMEN, resumenConLink);
                    console.log(`✅ DEFAULT: Resumen enviado a ${ID_GRUPO_RESUMEN}`);

                    await sendMediaToGroup(provider, state, ID_GRUPO_RESUMEN, data);

                } catch (err: any) {
                    console.error(`❌ DEFAULT Error:`, err?.message || err);
                }

                await addToSheet(data);
                return;
            }
        } catch (error) {
            console.error("Error al obtener el resumen de OpenAI:", error);
            return endFlow();
        }
    });

export { idleFlow };