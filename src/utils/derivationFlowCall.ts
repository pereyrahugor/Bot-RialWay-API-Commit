// Ejemplo de integración básica con Vapi para realizar una llamada telefónica impulsada por OpenAI
// Documentación oficial: https://docs.vapi.ai/

import { VapiClient } from '@vapi-ai/server-sdk';

export class DerivationFlowCall {

    private client: InstanceType<typeof VapiClient>;

    constructor(token: string) {
        this.client = new VapiClient({ token });
    }

    async startCall(assistantId: string, phoneNumberId: string, options?: any) {
        try {
            const call = await this.client.calls.create({
                assistantId,
                phoneNumberId,
                ...(options ?? {})
            });
            console.log('Call started:', call);
            return call;
        } catch (error) {
            console.error('Error starting call:', error);
            return null;
        }
    }
}