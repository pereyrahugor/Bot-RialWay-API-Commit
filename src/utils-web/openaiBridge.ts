import { safeToAsk } from '../utils/openaiHelper';

/**
 * Wrapper para gestionar thread_id y respuesta de OpenAI Assistant
 * @param assistantId string
 * @param message string
 * @param state contexto/historial
 * @param userId string|null
 * @returns { text: string, thread_id: string|null }
 */
export async function askWithThread(assistantId: string, message: string, state: any, userId: string = 'web-user') {
  let response;
  try {
    response = await safeToAsk(assistantId, message, state, userId);
  } catch (err) {
    return { text: 'Error al consultar el asistente.', thread_id: null };
  }

  // Si la respuesta es objeto y tiene thread_id, úsalo
  if (response && typeof response === 'object') {
    return {
      text: response.text || String(response),
      thread_id: response.thread_id || null
    };
  }
  // Si la respuesta es string, retorna como texto y thread_id null
  return { text: String(response), thread_id: null };
}
