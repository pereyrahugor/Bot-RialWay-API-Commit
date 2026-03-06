/**
 * Utility to retry async functions, specifically useful for network-sensitive operations like OpenAI API calls.
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: {
        maxRetries?: number;
        delayMs?: number;
        onRetry?: (error: any, attempt: number) => void;
    } = {}
): Promise<T> {
    const { maxRetries = 3, delayMs = 2000, onRetry } = options;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            
            // Typical network errors that are worth retrying
            const isNetworkError = 
                error.code === 'ENOTFOUND' || 
                error.code === 'ETIMEDOUT' || 
                error.code === 'ECONNRESET' ||
                error.status === 429 || // Rate limit
                error.status >= 500;    // Server errors

            if (isNetworkError && attempt < maxRetries) {
                if (onRetry) onRetry(error, attempt);
                else console.warn(`[Retry] Attempt ${attempt} failed: ${error.message}. Retrying in ${delayMs}ms...`);
                
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}
