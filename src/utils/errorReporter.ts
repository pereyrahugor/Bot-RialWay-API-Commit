import { EVENTS } from "@builderbot/bot";
import { BaileysProvider } from "@builderbot/provider-baileys";

class ErrorReporter {
    private provider: BaileysProvider;
    private groupId: string;

    constructor(provider: BaileysProvider, groupId: string) {
        this.provider = provider;
        this.groupId = groupId;
    }

    async reportError(error: Error, userId: string, userLink: string) {
        const errorMessage = `Error externo, se interrumpio la conexion con OpenAI. Verificar el chat manualmente\n${userLink}`;

        try {
            await this.provider.sendMessage(this.groupId, errorMessage, {});
        } catch (sendError) {
            console.error("Error al enviar el mensaje de error al grupo:", sendError);
        }
    }
}

export { ErrorReporter };