// src/utils/JsonBlockFinder.ts

export class JsonBlockFinder {
    // Tipos válidos para este repositorio
    static tiposValidos = [
        "API1",
        "API2",
        "API3",
        "API4"
    ];

    static buscarBloquesJSONEnTexto(texto: string): any | null {
        // 1. Buscar bloques entre etiquetas [API]...[/API]
        const apiRegex = /\[API\]([\s\S]*?)\[\/API\]/g;
        let match;
        while ((match = apiRegex.exec(texto)) !== null) {
            try {
                const parsed = JSON.parse(match[1]);
                if (JsonBlockFinder.tiposValidos.includes(parsed.type)) {
                    return parsed;
                }
            } catch (e) {
                // No es JSON válido, sigue buscando
            }
        }
        // 2. Buscar bloques JSON sueltos en el texto
        const bloques = [...texto.matchAll(/\{[\s\S]*?\}/g)].map(m => m[0]);
        for (const block of bloques) {
            try {
                const parsed = JSON.parse(block);
                if (JsonBlockFinder.tiposValidos.includes(parsed.type)) {
                    return parsed;
                }
            } catch (e) {
                // No es JSON válido, sigue buscando
            }
        }
        return null;
    }

    static buscarBloquesJSONProfundo(obj: any): any | null {
        if (!obj) return null;
        if (typeof obj === 'string') {
            return JsonBlockFinder.buscarBloquesJSONEnTexto(obj);
        }
        if (typeof obj === 'object') {
            for (const key of Object.keys(obj)) {
                const encontrado = JsonBlockFinder.buscarBloquesJSONProfundo(obj[key]);
                if (encontrado) return encontrado;
            }
        }
          return null;
    }
}   