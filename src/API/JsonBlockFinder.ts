export class JsonBlockFinder {
    static buscarBloquesJSONEnTexto(texto: string): any | null {
        // 1. Buscar bloques entre etiquetas [JSON-BUSCAR_PRODUCTO], [JSON-BUSCAR_CLIENTE], [JSON-ALTA_CLIENTE], [JSON-TOMA_PEDIDO]
        const etiquetas = [
            { tag: 'JSON-BUSCAR_PRODUCTO', type: '#BUSCAR_PRODUCTO#' },
            { tag: 'JSON-BUSCAR_CLIENTE', type: '#BUSCAR_CLIENTE#' },
            { tag: 'JSON-ALTA_CLIENTE', type: '#ALTA_CLIENTE#' },
            { tag: 'JSON-TOMA_PEDIDO', type: '#TOMA_PEDIDO#' },
            { tag: 'JSON-BUSCAR_PRODUCTO_LISTA', type: '#BUSCAR_PRODUCTO_LISTA#' },
            { tag: 'JSON-BUSCAR_CODIGO_LISTA', type: '#BUSCAR_CODIGO_LISTA#' }
        ];
        for (const { tag, type } of etiquetas) {
            // Corregido: buscar etiquetas literales [JSON-RESERVA], etc.
                const regex = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[/${tag}\\]`, 'g');
            let match;
            while ((match = regex.exec(texto)) !== null) {
                try {
                    const parsed = JSON.parse(match[1]);
                    if (parsed.type === type) {
                        return parsed;
                    }
                } catch (e) {
                    // No es JSON válido, sigue buscando
                }
            }
        }
        // 2. Buscar bloques JSON sueltos en el texto
        const bloques = [...texto.matchAll(/\{[\s\S]*?\}/g)].map(m => m[0]);
        for (const block of bloques) {
            try {
                const parsed = JSON.parse(block);
                if (["#BUSCAR_PRODUCTO#", "#BUSCAR_CLIENTE#", "#ALTA_CLIENTE#", "#TOMA_PEDIDO#", "#BUSCAR_PRODUCTO_LISTA#", "#BUSCAR_CODIGO_LISTA#"].includes(parsed.type)) {
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
