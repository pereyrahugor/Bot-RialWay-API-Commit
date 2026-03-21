import { HistoryHandler, supabase } from "../utils/historyHandler";

/**
 * Inicia un worker que verifica cada minuto los chats con intervención humana (bot desactivado).
 * Si no han recibido un mensaje humano en 15 minutos, reactiva el bot automáticamente.
 */
export const startHumanInactivityWorker = (timeoutMinutes = 15) => {
    console.log(`🤖 [Worker] Iniciando worker de inactividad humana (${timeoutMinutes} min)...`);
    
    setInterval(async () => {
        try {
            const now = new Date();
            const threshold = new Date(now.getTime() - timeoutMinutes * 60 * 1000);
            
            const { data: inactiveChats, error } = await supabase
                .from('chats')
                .select('id, last_human_message_at')
                .eq('project_id', process.env.RAILWAY_PROJECT_ID || 'default_project')
                .eq('bot_enabled', false)
                .or(`last_human_message_at.lte.${threshold.toISOString()},last_human_message_at.is.null`);

            if (error) throw error;

            for (const chat of (inactiveChats || [])) {
                console.log(`[WORKER] [${new Date().toLocaleTimeString()}] Auto-activando bot para ${chat.id} (Inactividad > ${timeoutMinutes} min)`);
                await HistoryHandler.toggleBot(chat.id, true);
            }
        } catch (e) {
            console.error('[WORKER] Error checking human inactivity:', e);
        }
    }, 60000);
};
