
import { createClient } from '@supabase/supabase-js';
import { AuthenticationCreds, AuthenticationState, SignalDataTypeMap, initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';

export const useSupabaseAuthState = async (
    supabaseUrl: string,
    supabaseKey: string,
    projectId: string,
    sessionId: string = 'default',
    botName: string | null = null
): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void>, clearSession: () => Promise<void> }> => {

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Helpers para interactuar con la DB
    const writeData = async (data: any, key: string) => {
        try {
            // Si data es null, lo guardamos como null (si la DB lo permite) o como objeto vacío marcado
            // Nuestra tabla tiene NOT NULL en data, así que evitamos guardar nulls si no son creds.
            if (data === null || data === undefined) return;

            // const { error } = await supabase.rpc('save_whatsapp_session', {
            //     p_project_id: projectId,
            //     p_session_id: sessionId,
            //     p_key_id: key,
            //     p_data: JSON.parse(JSON.stringify(data, BufferJSON.replacer)),
            //     p_bot_name: botName
            // });
            const { error } = await supabase
                .from('whatsapp_sessions')
                .upsert({
                    project_id: projectId,
                    session_id: sessionId,
                    key_id: key,
                    data: JSON.parse(JSON.stringify(data, BufferJSON.replacer)),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'project_id,session_id,key_id' });
            if (error) throw error;
            console.log(`[SupabaseAdapter] ✅ Data saved for key: ${key}`);
        } catch (error) {
            console.error('[SupabaseAdapter] ❌ Error saving data:', key, error);
            // No lanzar throw para no romper el flujo del bot, pero loguear
        }
    };

    const readData = async (key: string) => {
        try {
            // Leemos TODA la sesión y filtramos en memoria (dado que la RPC actual trae todo)
            // Esto no es óptimo para escalado masivo pero funcional para sesiones de WhatsApp estándar
            // const { data, error } = await supabase.rpc('get_whatsapp_session', {
            //     p_project_id: projectId,
            //     p_session_id: sessionId
            // });
            const { data, error } = await supabase
                .from('whatsapp_sessions')
                .select('key_id, data')
                .eq('project_id', projectId)
                .eq('session_id', sessionId);

            if (error) throw error;
            if (!data || !Array.isArray(data)) return null;

            const row = data.find((r: any) => r.key_id === key);
            return row ? JSON.parse(JSON.stringify(row.data), BufferJSON.reviver) : null;
        } catch (error) {
            console.error('[SupabaseAdapter] Error reading data:', key, error);
            return null;
        }
    };

    const clearSession = async () => {
        try {
            // const { error } = await supabase.rpc('delete_whatsapp_session', {
            //     p_project_id: projectId,
            //     p_session_id: sessionId
            // });
            const { error } = await supabase
                .from('whatsapp_sessions')
                .delete()
                .eq('project_id', projectId)
                .eq('session_id', sessionId);
            if (error) throw error;
            console.log(`[SupabaseAdapter] Session ${sessionId} cleared for project ${projectId}`);
        } catch (error) {
            console.error('[SupabaseAdapter] Error clearing session:', error);
        }
    };

    // Cargar credenciales iniciales
    const creds: AuthenticationCreds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data: { [key: string]: SignalDataTypeMap[typeof type] } = {};

                    try {
                        // const { data: allRows, error } = await supabase.rpc('get_whatsapp_session', {
                        //     p_project_id: projectId,
                        //     p_session_id: sessionId
                        // });
                        const { data: allRows, error } = await supabase
                            .from('whatsapp_sessions')
                            .select('key_id, data')
                            .eq('project_id', projectId)
                            .eq('session_id', sessionId);

                        if (error) throw error;

                        // Mapear filas a objeto en memoria eficiente
                        const memoryMap = new Map();
                        if (allRows && Array.isArray(allRows)) {
                            allRows.forEach((r: any) => {
                                memoryMap.set(r.key_id, JSON.parse(JSON.stringify(r.data), BufferJSON.reviver));
                            });
                        }

                        ids.forEach((id) => {
                            const key = `${type}-${id}`;
                            const val = memoryMap.get(key);
                            if (val) {
                                data[id] = val;
                            }
                        });
                    } catch (e) {
                        console.error('[SupabaseAdapter] Error in keys.get:', e);
                    }

                    return data;
                },
                set: async (data) => {
                    const tasks: Promise<void>[] = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(writeData(value, key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => {
            return writeData(creds, 'creds');
        },
        clearSession
    };
};
