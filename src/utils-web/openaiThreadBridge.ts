import OpenAI from 'openai';
import { withRetry } from '../utils/retryHelper';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Obtiene o crea un thread_id para el usuario webchat con reintentos para fallos de red.
 * @param store objeto de sesión por IP
 * @returns thread_id
 */
export async function getOrCreateThreadId(store: { thread_id?: string | null }) {
  if (store.thread_id) return store.thread_id;
  
  const thread = await withRetry(async () => {
    return await openai.beta.threads.create();
  }, {
    maxRetries: 3,
    onRetry: (err, attempt) => console.log(`[ThreadBridge] Reintento ${attempt} creando thread por error: ${err.message}`)
  });

  store.thread_id = thread.id;
  return thread.id;
}

/**
 * Envía un mensaje al thread y ejecuta el run
 * @param threadId string
 * @param userMessage string
 * @param assistantId string
 * @returns respuesta del asistente
 */
export async function sendMessageToThread(threadId: string, userMessage: string, assistantId: string) {
  // CRÍTICO: Esperar a que no haya runs activos antes de enviar mensaje
  try {
    console.log(`[sendMessageToThread] Verificando runs activos en thread ${threadId}...`);
    let attempt = 0;
    while (attempt < 30) { // Max 60 seconds wait
      const runs = await openai.beta.threads.runs.list(threadId, { limit: 1 });
      const activeRun = runs.data.find(run => 
        ["queued", "in_progress", "cancelling"].includes(run.status)
      );
      
      if (activeRun) {
        if (attempt % 5 === 0) console.log(`[sendMessageToThread] Run activo detectado (${activeRun.id}, estado: ${activeRun.status}). Esperando...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempt++;
      } else {
        console.log(`[sendMessageToThread] No hay runs activos. Procediendo.`);
        break;
      }
    }
    if (attempt >= 30) {
      console.warn(`[sendMessageToThread] Timeout esperando liberación del thread. Intentando proceder de todos modos.`);
    }
  } catch (error) {
    console.error(`[sendMessageToThread] Error verificando runs:`, error);
    // Fallback to simple wait if API fails
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  await openai.beta.threads.messages.create(
    threadId,
    {
      role: "user",
      content: [{ type: "text", text: userMessage }],
    }
  );
  
  const run = await openai.beta.threads.runs.create(
    threadId,
    { assistant_id: assistantId }
  );
  
  // Esperar a que el run genere al menos una respuesta CON CONTENIDO
  let runStatus = run.status;
  const runId = run.id;
  let attempts = 0;
  const maxAttempts = 60; // 60 segundos máximo
  let foundMessage: any = null;
  
  while (attempts < maxAttempts) {
    await new Promise(res => setTimeout(res, 1000));
    const runInfo = await openai.beta.threads.runs.retrieve(threadId, runId);
    runStatus = runInfo.status;
    
    if (runStatus === 'failed' || runStatus === 'cancelled') {
      throw new Error('Run fallido o cancelado');
    }
    
    // Si el run completó, salir del bucle
    if (runStatus === 'completed') {
      break;
    }
    
    // Verificar si ya hay un nuevo mensaje del asistente CON CONTENIDO
    const messages = await openai.beta.threads.messages.list(threadId, { limit: 5 });
    const newAssistantMsg = messages.data.find(m => 
      m.role === 'assistant' && 
      m.run_id === runId &&
      m.content.length > 0 &&
      m.content[0].type === 'text' &&
      (m.content[0] as any).text?.value?.trim().length > 0
    );
    
    if (newAssistantMsg) {
      console.log('[sendMessageToThread] Mensaje del asistente con contenido detectado');
      foundMessage = newAssistantMsg;
      break;
    }
    
    attempts++;
  }
  
  if (attempts >= maxAttempts && !foundMessage) {
    throw new Error('Timeout esperando respuesta del asistente');
  }
  
  // Si no encontramos el mensaje en el bucle, buscarlo ahora
  if (!foundMessage) {
    const messages = await openai.beta.threads.messages.list(threadId);
    const assistantMessages = messages.data.filter(m => m.role === 'assistant' && m.run_id === runId);
    
    if (!assistantMessages.length) {
      console.warn('[sendMessageToThread] No se encontraron mensajes del asistente para este run');
      return '';
    }
    
    foundMessage = assistantMessages[0];
  }
  
  // Extraer el texto del mensaje encontrado
  const textBlock = foundMessage.content.find((block: any) => block.type === 'text' && typeof block.text?.value === 'string');
  let response = '';
  if (textBlock && textBlock.type === 'text') {
    response = (textBlock as { type: 'text'; text: { value: string } }).text.value;
  } else {
    response = foundMessage.content.length ? JSON.stringify(foundMessage.content[0]) : '';
  }
  
  // Log de debug para webchat
  console.log('[sendMessageToThread] Respuesta del asistente:', response.substring(0, 200));
  
  if (!response || response.trim().length === 0) {
    console.warn('[sendMessageToThread] ⚠️ Respuesta vacía del asistente');
  }
  
  return response;
}

/**
 * Elimina el thread y limpia el thread_id
 */
export async function deleteThread(store: { thread_id?: string | null }) {
  // No existe un método delete para threads en la API de OpenAI.
  // Simplemente limpia el thread_id en el store.
  if (store.thread_id) {
    store.thread_id = null;
  }
}
