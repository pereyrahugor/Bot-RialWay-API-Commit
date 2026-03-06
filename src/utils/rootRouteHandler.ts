/**
 * Middleware para manejar la ruta raíz /
 * SIEMPRE redirige a /webchat para evitar conflictos con Sherpa
 */
export function handleRootRoute(req: any, res: any) {
    console.log('[RootRoute] Redirigiendo / a /webchat');
    res.writeHead(301, { 'Location': '/webchat' });
    res.end();
}
