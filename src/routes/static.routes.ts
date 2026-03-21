import path from 'path';
import fs from 'fs';
import serve from 'serve-static';

/**
 * Registra las rutas de servicio de HTML y archivos estáticos.
 */
export const registerStaticRoutes = (app: any, { __dirname }: { __dirname: string }) => {

    const serveHtmlPage = (route: string, filename: string) => {
        const handler = (req: any, res: any) => {
            try {
                const possiblePaths = [
                    path.join(process.cwd(), 'src', 'html', filename),
                    path.join(process.cwd(), filename),
                    path.join(process.cwd(), 'src', filename),
                    path.join(__dirname, 'html', filename),
                    path.join(__dirname, filename),
                    path.join(__dirname, '..', 'src', 'html', filename)
                ];

                let htmlPath = null;
                for (const p of possiblePaths) {
                    if (fs.existsSync(p) && fs.lstatSync(p).isFile()) {
                        htmlPath = p;
                        break;
                    }
                }

                if (htmlPath) {
                    let htmlContent = fs.readFileSync(htmlPath, 'utf8');
                    const botName = process.env.ASSISTANT_NAME || process.env.RAILWAY_PROJECT_NAME || "Neurolinks";
                    
                    console.log(`[Static] Sirviendo ${filename} para ${route}. botName=${botName}`);

                    // Reemplazo universal de placeholders
                    htmlContent = htmlContent.replace(/{{BOT_NAME}}/g, botName);
                    htmlContent = htmlContent.replace(/{{ASSISTANT_NAME}}/g, botName);
                    
                    res.setHeader('Content-Type', 'text/html');
                    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                    res.end(htmlContent);
                } else {
                    res.status(404).send('HTML no encontrado en el servidor');
                }
            } catch (err) {
                res.status(500).send('Error interno al servir HTML');
            }
        };
        app.get(route, handler);
        if (route !== "/") app.get(route + '/', handler);
    };

    // Registrar páginas HTML
    serveHtmlPage("/dashboard", "dashboard.html");
    serveHtmlPage("/webchat", "webchat.html");
    serveHtmlPage("/webreset", "webreset.html");
    serveHtmlPage("/variables", "variables.html");
    serveHtmlPage("/login", "login.html");
    serveHtmlPage("/backoffice", "backoffice.html");

    // Servir archivos estáticos
    app.use("/js", serve(path.join(process.cwd(), "src", "js")));
    app.use("/style", serve(path.join(process.cwd(), "src", "style")));
    app.use("/assets", serve(path.join(process.cwd(), "src", "assets")));
    app.use("/uploads", serve(path.join(process.cwd(), "uploads")));

    // QR específico
    app.get("/qr.png", (req: any, res: any) => {
        const qrPath = path.join(process.cwd(), 'bot.qr.png');
        if (fs.existsSync(qrPath)) {
            res.setHeader('Content-Type', 'image/png');
            fs.createReadStream(qrPath).pipe(res);
        } else {
            res.status(404).send('QR not found');
        }
    });

};
