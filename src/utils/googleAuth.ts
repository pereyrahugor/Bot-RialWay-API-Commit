import { google } from "googleapis";
import "dotenv/config";

/**
 * Obtiene la clave privada de Google limpia de las variables de entorno.
 * Maneja comillas circundantes y saltos de línea escapados.
 */
export const getGooglePrivateKey = (): string => {
    let rawKey = process.env.GOOGLE_PRIVATE_KEY || "";
    
    // 1. Quitar comillas si el string viene envuelto en ellas (común en Railway/Docker/.env)
    if (rawKey.startsWith('"') && rawKey.endsWith('"')) {
        rawKey = rawKey.slice(1, -1);
    }
    
    // 2. Reemplazar los saltos de línea literales '\n' por caracteres de salto de línea reales
    // y asegurar que no haya espacios extras al inicio/final de cada línea
    return rawKey.replace(/\\n/g, '\n').trim();
};

/**
 * Retorna las credenciales de Google configuradas.
 */
export const getGoogleCredentials = () => {
    return {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: getGooglePrivateKey(),
    };
};

/**
 * Crea una instancia de autenticación de Google con los scopes necesarios.
 * @param scopes Lista de scopes de Google API
 */
export const createGoogleAuth = (scopes: string[]) => {
    const creds = getGoogleCredentials();
    
    if (!creds.private_key) {
        console.warn("⚠️ [GoogleAuth] La clave privada de Google está vacía.");
    }

    return new google.auth.GoogleAuth({
        credentials: {
            client_email: creds.client_email,
            private_key: creds.private_key,
        },
        scopes: scopes,
    });
};
