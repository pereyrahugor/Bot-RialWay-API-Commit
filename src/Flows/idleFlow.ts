import { addKeyword, EVENTS } from '@builderbot/bot';
import { toAsk } from '@builderbot-plugins/openai-assistants';
import { GenericResumenData, extraerDatosResumen } from '~/utils/extractJsonData';
import { addToSheet } from '~/utils/googleSheetsResumen';
import fs from 'fs';
import path from 'path';// Import the new logic
import { ReconectionFlow } from './reconectionFlow';

//** Variables de entorno para el envio de msj de resumen a grupo de WS */
const ASSISTANT_ID = process.env.ASSISTANT_ID ?? '';
const ID_GRUPO_RESUMEN = process.env.ID_GRUPO_RESUMEN ?? '';
const msjCierre: string = process.env.msjCierre as string;

                // Agregar link de WhatsApp al objeto data
                // const whatsappLink = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;
                // data.linkWS = whatsappLink;
//** Flow para cierre de conversación, generación de resumen y envio a grupo de WS */
const idleFlow = addKeyword(EVENTS.ACTION).addAction(
    async (ctx, { endFlow, provider, state }) => {
        console.log("Ejecutando idleFlow...");

        try {
                        // Agregar link también en onSuccess
            // Obtener el resumen del asistente de OpenAI
            const resumen = await toAsk(ASSISTANT_ID, "GET_RESUMEN", state);

            if (!resumen) {
                console.warn("No se pudo obtener el resumen.");
                return endFlow(msjCierre);
            }

            let data: GenericResumenData;
            try {
                data = JSON.parse(resumen);
            } catch (error) {
                console.warn("⚠️ El resumen no es JSON. Se extraerán los datos manualmente.");
                data = extraerDatosResumen(resumen);
            }

            // Normalizar tipo
            const tipo = data.tipo || "SI_RESUMEN";

            if (tipo === "NO_REPORTAR_BAJA") {
                // No seguimiento, no enviar resumen
                console.log("[idleFlow] tipo=NO_REPORTAR_BAJA: No seguimiento, no se envía resumen al grupo.");
                return endFlow(msjCierre);
            } else if (tipo === "NO_REPORTAR_SEGUIR") {
                // Realizar seguimiento (reconexión), no enviar resumen al grupo
                const whatsappLink = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;
                data.linkWS = whatsappLink;
                let usuarioRespondio = false;
                const reconFlow = new ReconectionFlow({
                    ctx,
                    state,
                    provider,
                    maxAttempts: 3,
                    onSuccess: async (newData) => {
                        // Agregar link también en onSuccess
                        newData.linkWS = whatsappLink;
                        await addToSheet(newData);
                        usuarioRespondio = true;
                        return;
                    },
                    onFail: async () => {
                        // Solo guardar en Google Sheets
                        await addToSheet(data);
                        usuarioRespondio = false;
                        return;
                    }
                });
                await reconFlow.start();
                if (!usuarioRespondio) {
                    return endFlow(msjCierre);
                }
                // Si el usuario respondió, no cerrar el flujo, dejar que continúe la conversación
                return;
            } else {
                // No seguimiento, enviar resumen al grupo
                const whatsappLink = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;
                data.linkWS = whatsappLink;
                const resumenConLink = `${resumen}\n\n🔗 [Chat del usuario](${whatsappLink})`;
                try {
                    await provider.sendText(ID_GRUPO_RESUMEN, resumenConLink);
                    console.log(`✅ TEST: Resumen enviado a ${ID_GRUPO_RESUMEN} con enlace de WhatsApp`);
                } catch (err) {
                    console.error(`❌ TEST: No se pudo enviar el resumen al grupo ${ID_GRUPO_RESUMEN}:`, err?.message || err);
                }
                await addToSheet(data);
                return endFlow(msjCierre);
            }
        } catch (error) {
            // Captura errores generales del flujo
            console.error("Error al obtener el resumen de OpenAI:", error);
        }

        // Mensaje de cierre del flujo
        return endFlow(msjCierre);
    }
);

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

export { idleFlow };