import { updateSheet1 } from "./updateSheet1";
import { updateSheet2 } from "./updateSheet2";
import { updateSheet3 } from "./updateSheet3";

/**
 * Carga los datos de las tres hojas principales si las variables de entorno están definidas.
 * Devuelve un objeto con los arrays de cada hoja.
 */
export const updateMain = async () => {
    // Paso 2: Cargar datos desde la hoja de cálculo 1
    let sheet1 = [];
    if (
        process.env.SHEET_ID_UPDATE_1 &&
        process.env.SHEET_NAME_UPDATE_1 &&
        process.env.VECTOR_STORE_ID
    ) {
        sheet1 = await updateSheet1();
        if (!sheet1 || sheet1.length === 0) {
            console.warn("⚠️ No se encontraron datos en la hoja de cálculo de ventas. Continuando sin datos de  sheet 1...");
        } else {
            console.log("✅ Datos de sheet 1 cargados en memoria.");
        }
    } else {
        console.warn("⚠️ Variables de entorno faltantes para la sheet 1. No se cargó la sheet 1.");
    }

    // Paso 3: Cargar datos desde la hoja de cálculo 2
    let sheet2 = [];
    if (
        process.env.SHEET_ID_UPDATE_2 &&
        process.env.SHEET_NAME_UPDATE_2 &&
        process.env.VECTOR_STORE_ID
    ) {
        sheet2 = await updateSheet2();
        if (!sheet2 || sheet2.length === 0) {
            console.warn("⚠️ No se encontraron datos en la hoja de cálculo de sheet 2. Continuando sin datos de sheet 2...");
        } else {
            console.log("✅ Datos de sheet 2 cargados en memoria.");
        }
    } else {
        console.warn("⚠️ Variables de entorno faltantes para la hoja de sheet 2. No se cargó la hoja 2.");
    }

    // Paso 4: Cargar datos desde la hoja de cálculo 3
    let sheet3 = [];
    if (
        process.env.SHEET_ID_UPDATE_3 &&
        process.env.SHEET_NAME_UPDATE_3 &&
        process.env.VECTOR_STORE_ID
    ) {
        sheet3 = await updateSheet3();
        if (!sheet3 || sheet3.length === 0) {
            console.warn("⚠️ No se encontraron datos en la hoja de cálculo de sheet 3. Continuando sin datos de sheet 3...");
        } else {
            console.log("✅ Datos de sheet 3 cargados en memoria.");
        }
    } else {
        console.warn("⚠️ Variables de entorno faltantes para la hoja de sheet 3. No se cargó la hoja 3.");
    }
};
