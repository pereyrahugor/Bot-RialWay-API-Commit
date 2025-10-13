// Clase para envío de difusión (broadcast) a múltiples contactos con control de espera

import { BaileysProvider } from '@builderbot/provider-baileys';

export class Difusion {
    private provider: BaileysProvider;
    private delayMs: number;

    constructor(provider: BaileysProvider, delayMs: number = 1500) {
        this.provider = provider;
        this.delayMs = delayMs;
    }

    /**
     * Envía un mensaje de difusión a una lista de contactos (jid)
     * @param contactos Array de jids (ej: 5491112345678@s.whatsapp.net)
     * @param mensaje Texto a enviar
     */
    async enviar(contactos: string[], mensaje: string) {
        for (const jid of contactos) {
            try {
                await this.provider.sendText(jid, mensaje);
                console.log(`[Difusion] Mensaje enviado a ${jid}`);
            } catch (err) {
                console.error(`[Difusion] Error enviando a ${jid}:`, err);
            }
            await new Promise(res => setTimeout(res, this.delayMs));
        }
    }
}
