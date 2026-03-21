import fs from 'fs';

import path from 'path';
import bodyParser from 'body-parser';

/**
 * Middleware de compatibilidad para Polka.
 * Agrega métodos comunes de Express como res.status, res.json, res.send y res.sendFile.
 */
export const compatibilityLayer = (req: any, res: any, next: () => void) => {
    res.status = (code: number) => { 
        res.statusCode = code; 
        return res; 
    };

    res.send = (body: any) => {
        if (res.headersSent) return res;
        if (typeof body === 'object') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(body || null));
        } else {
            res.end(body || '');
        }
        return res;
    };

    res.json = (data: any) => {
        if (res.headersSent) return res;
        try {
            const body = JSON.stringify(data || null);
            res.setHeader('Content-Type', 'application/json');
            res.end(body);
        } catch (e) {
            console.error('🔥 Error serializing JSON response:', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: 'Internal JSON Serialization Error' }));
        }
        return res;
    };

    res.sendFile = (filepath: string) => {
        if (res.headersSent) return;
        try {
            if (fs.existsSync(filepath)) {
                const ext = path.extname(filepath).toLowerCase();
                const mimeTypes: Record<string, string> = {
                    '.html': 'text/html',
                    '.js': 'application/javascript',
                    '.css': 'text/css',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.svg': 'image/svg+xml',
                    '.json': 'application/json',
                    '.pdf': 'application/pdf'
                };
                res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
                fs.createReadStream(filepath)
                    .on('error', (err) => {
                        console.error(`[ERROR] Stream error in sendFile (${filepath}):`, err);
                        if (!res.headersSent) {
                            res.statusCode = 500;
                            res.end('Internal Server Error');
                        }
                    })
                    .pipe(res);
            } else {
                res.statusCode = 404;
                res.end('Not Found');
            }
        } catch (e) {
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end('Internal Error');
            }
        }
    };

    next();
};

/**
 * Middleware de logging y redirección de raíz.
 */
export const rootRedirect = (req: any, res: any, next: () => void) => {
    try {
        if (req.url === "/" || req.url === "" || req.url === "/index.html") {
            res.writeHead(302, { 'Location': '/dashboard' });
            return res.end();
        }
        next();
    } catch (err) {
        if (!res.headersSent) {
            res.statusCode = 500;
            res.end('Internal Server Error');
        }
    }
};

/**
 * Body parser inteligente que evita consumir el stream si es multipart/form-data.
 * Esto es CRÍTICO para que Multer funcione correctamente en las rutas posteriores.
 */
export const smartBodyParser = (req: any, res: any, next: () => void) => {
    // Si la ruta ya fue manejada por un parser específico o es una ruta de envío de archivos, saltar
    if (req.url.startsWith('/api/backoffice/send-message')) {
        return next(); 
    }

    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
        // NO procesar body-parser si es multipart, dejar que Multer lo haga
        return next();
    }

    // Procesar JSON y URL-encoded para el resto
    bodyParser.json({ limit: '50mb' })(req, res, (err) => {
        if (err) return next(); // O manejar error
        bodyParser.urlencoded({ limit: '50mb', extended: true })(req, res, next);
    });
};
