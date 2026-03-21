import { Server } from 'socket.io';
import { historyEvents, HistoryHandler } from '../utils/historyHandler';

/**
 * Inicializa Socket.IO y configura los eventos globales y de conexión.
 */
export const initSocketIO = (serverInstance: any, { processUserMessage }: any) => {
    try {
        if (!serverInstance) {
            console.error('❌ [Socket.IO] No se pudo obtener serverInstance.');
            return;
        }

        console.log('📡 [INFO] Inicializando Socket.IO en el servidor principal...');
        const io = new Server(serverInstance, { 
            cors: { origin: '*' },
            allowEIO3: true
        });

        // Escuchar eventos de la base de datos (HistoryHandler) y retransmitir a Web
        historyEvents.on('new_message', (payload) => {
            io.emit('new_message', payload);
        });

        historyEvents.on('bot_toggled', (payload) => {
            io.emit('bot_toggled', payload);
        });

        io.on('connection', (socket) => {
            // console.log('💬 Cliente web conectado');
            socket.on('message', async (msg) => {
                try {
                    let ip = '';
                    const xff = socket.handshake.headers['x-forwarded-for'];
                    if (typeof xff === 'string') ip = xff.split(',')[0];
                    else if (Array.isArray(xff)) ip = xff[0];
                    else ip = socket.handshake.address || '';

                    // Manejo rudimentario de historial en memoria para webchat
                    if (!(global as any).webchatHistories) (global as any).webchatHistories = {};
                    const historyKey = `webchat_${ip}`;
                    if (!(global as any).webchatHistories[historyKey]) (global as any).webchatHistories[historyKey] = [];
                    const _history = (global as any).webchatHistories[historyKey];

                    const state = {
                        get: (key: string) => key === 'history' ? _history : undefined,
                        update: async (msg: string, role = 'user') => {
                            _history.push({ role, content: msg });
                            if (_history.length > 10) _history.shift();
                        },
                        clear: async () => { _history.length = 0; }
                    };

                    let replyText = '';
                    const flowDynamic = async (arr: any) => {
                        if (Array.isArray(arr)) replyText = arr.map(a => a.body).join('\n');
                        else if (typeof arr === 'string') replyText = arr;
                    };

                    if (msg.trim().toLowerCase() === "#reset") {
                        await state.clear();
                        replyText = "🔄 Chat reiniciado.";
                    } else {
                        // Llamar al procesador de mensajes centralizado
                        await processUserMessage(
                            { from: ip, body: msg, type: 'webchat' }, 
                            { flowDynamic, state, provider: undefined, gotoFlow: () => {} }
                        );
                    }
                    socket.emit('reply', replyText);
                } catch (err) {
                    socket.emit('reply', 'Error procesando mensaje.');
                }
            });
        });

        return io;
    } catch (e) {
        console.error('❌ [Socket.IO] Error durante la inicialización:', e);
    }
};
