import fs from "fs";
import { google } from "googleapis";
import path from "path";
import dotenv from "dotenv";
import OpenAI from "openai";
import * as glob from "glob";

dotenv.config();

// Variables de entorno para la hoja de cálculo y el vector store
const SHEET_ID = process.env.SHEET_ID_UPDATE_1 ?? "";
const SHEET_NAME_RAW = process.env.SHEET_NAME_UPDATE_1 ?? "";
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID ?? "";
// Si SHEET_NAME_RAW no contiene '!', agregar '!A1' para el range
const SHEET_RANGE = SHEET_NAME_RAW && !SHEET_NAME_RAW.includes('!') ? `${SHEET_NAME_RAW}!A1` : SHEET_NAME_RAW;
// Para archivos, solo usar el nombre de la hoja (sin !A1)
const SHEET_NAME = SHEET_NAME_RAW.replace(/!.*/, "");
const TXT_PATH = path.join("temp", `${SHEET_NAME}.json`);
let currentFileId: string | null = null;

// Verificar que las variables de entorno estén definidas
if (!SHEET_ID || !SHEET_NAME) {
    throw new Error("❌ Las variables de entorno SHEET_ID_UPDATE_1 y SHEET_NAME_UPDATE_1 deben estar definidas.");
}

// Construir credenciales desde variables de entorno
const credentials = {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const openai = new OpenAI();

// Función para obtener datos de Google Sheets
export async function updateSheet1() {
    try {
        console.log("📌 Obteniendo datos de Google Sheets...");



        // Paso 1: Obtener un rango grande para detectar la última fila y columna con datos
    const initialRange = `${SHEET_NAME}!A1:ZZ10000`;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: initialRange,
        });

        const rows = response.data.values;
        console.log("[DEBUG] rows:", JSON.stringify(rows));
        if (!rows || rows.length === 0) {
            console.warn("⚠️ No se encontraron datos en la hoja de cálculo.");
            return [];
        }

        // Calcular última fila y columna con datos reales
        let lastRow = rows.length;
        let lastCol = 0;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            // Si la fila está completamente vacía, no la contamos como parte del rango
            if (!row || row.every(cell => (cell === undefined || cell === null || String(cell).trim() === ""))) {
                lastRow = i;
                break;
            }
            if (row.length > lastCol) lastCol = row.length;
        }
        // Si no hay columnas, forzar al menos 1
        if (lastCol === 0) lastCol = 1;


        // Convertir número de columna a letra (A, B, ..., Z, AA, AB, ...)
        // Declaración local para cumplir lint y evitar error de referencia
        const colToLetter = (col: number) => {
            let temp = "";
            let n = col;
            while (n > 0) {
                const rem = (n - 1) % 26;
                temp = String.fromCharCode(65 + rem) + temp;
                n = Math.floor((n - 1) / 26);
            }
            return temp;
        };
        const lastColLetter = colToLetter(lastCol);
        const dynamicRange = `${SHEET_NAME}!A1:${lastColLetter}${lastRow}`;
        console.log(`[DEBUG] dynamicRange: ${dynamicRange}`);



        // Volver a pedir los datos usando el rango exacto
        const fullResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: dynamicRange,
        });
        const fullRows = fullResponse.data.values;
        if (!fullRows || fullRows.length === 0) {
            console.warn("⚠️ No se encontraron datos en el rango calculado.");
            return [];
        }
        // Validar headers
        const headers = fullRows[0].map((h: string) => (h || "").trim());
        console.log("[DEBUG] headers:", headers);
        const validHeaders = headers.filter(h => h.length > 0);
        if (validHeaders.length === 0) {
            console.warn("⚠️ La primera fila no contiene encabezados válidos.");
            return [];
        }

        // Formatear los datos obtenidos de forma flexible
        const formattedData = fullRows.slice(1)
            .filter(row => row && row.length > 0 && row.some(cell => (cell || "").trim() !== ""))
            .map((row) => {
                const obj: Record<string, string> = {};
                headers.forEach((header, idx) => {
                    obj[header] = (row[idx] || "").trim();
                });
                return obj;
            });

        console.log("[DEBUG] formattedData:", formattedData);
        console.log("✅ Datos obtenidos.");

        // Verificar que la carpeta "temp/data" exista
        const dirPath = path.join("temp");
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`📂 Carpeta creada: ${dirPath}`);
        }

        // Guardar los datos en un archivo de texto en formato JSON simple
        const jsonData = JSON.stringify(formattedData, null, 2);
        fs.writeFileSync(TXT_PATH, jsonData, "utf8");

        console.log(`📂 Datos guardados en archivo de texto: ${TXT_PATH}`);

        // Enviar el archivo de texto al vector store
        const success = await uploadDataToAssistant(TXT_PATH, "newStateId");
        if (!success) {
            console.error("❌ Error al enviar los datos al vector store.");
        }

        return formattedData;
    } catch (error) {
        console.error("❌ Error al obtener datos:", error.message);
        return null;
    }
}

// Función para subir datos al vector store de OpenAI
export async function uploadDataToAssistant(filePath: string, stateId: string) {
    try {
        // Verificar si el archivo actual está en uso
        if (currentFileId && stateId === currentFileId) {
            console.log("📂 Utilizando archivo existente con ID:", currentFileId);
            return true;
        }

        // Eliminar archivos anteriores
        await deleteOldFiles();

        console.log("🚀 Subiendo archivo al vector store...");

        // Subir el archivo al vector store
        const fileStream = fs.createReadStream(filePath);
        const response = await openai.files.create({
            file: fileStream,
            purpose: "assistants"
        });

        currentFileId = response.id;
        console.log(`📂 Archivo subido con ID: ${currentFileId}`);

        // Adjuntar el nuevo archivo al vector store
        const success = await attachFileToVectorStore(currentFileId);
        if (!success) {
            return false;
        }

        // Eliminar archivos temporales
        deleteTemporaryFiles();

        console.log("✅ Datos actualizados en el vector store.");

        // Agregar un delay antes de continuar
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 segundos de delay

        return true;
    } catch (error) {
        console.error("❌ Error al subir el archivo al vector store:", error.message);
        return false;
    }
}

// Función para adjuntar un archivo al vector store de OpenAI
async function attachFileToVectorStore(fileId: string) {
    try {
        console.log(`📡 Adjuntando archivo al vector store: ${fileId}`);
        const response = await openai.vectorStores.fileBatches.createAndPoll(VECTOR_STORE_ID, {
            file_ids: [fileId]
        });

        if (response && response.status === "completed") {
            console.log("✅ Confirmación recibida: Archivo adjuntado correctamente al vector store.");
            return true;
        } else {
            console.warn("⚠️ No se recibió una confirmación clara de OpenAI.");
            return false;
        }
    } catch (error) {
        console.error("❌ Error al adjuntar el archivo al vector store:", error.message);
        return false;
    }
}

// Función para eliminar archivos anteriores del vector store
async function deleteOldFiles() {
    try {
        console.log(`🗑️ Eliminando archivo anterior del vector store relacionado con ${SHEET_NAME}.json...`);
        const files = await openai.files.list();
        for (const file of files.data) {
            if (file.filename === `${SHEET_NAME}.json`) {
                await openai.files.del(file.id);
                console.log(`🗑️ Archivo eliminado: ${file.id}`);
            }
        }
    } catch (error) {
        console.error("❌ Error al eliminar archivo anterior del vector store:", error.message);
    }
}

// Función para eliminar archivos temporales
function deleteTemporaryFiles() {
    try {
        console.log("🗑️ Eliminando archivos temporales...");
        const files = glob.sync(path.join("temp", `${SHEET_NAME}.json`));
        for (const file of files) {
            fs.unlinkSync(file);
            console.log(`🗑️ Archivo temporal eliminado: ${file}`);
        }
    } catch (error) {
        console.error("❌ Error al eliminar archivos temporales:", error.message);
    }
}