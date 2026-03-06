import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { updateAllSheets } from "../addModule/updateSheet";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn("⚠️ Supabase credentials missing during dbHandler init.");
}

const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

export async function executeDbQuery(sqlQuery: string): Promise<string> {
    if (!supabase) return "Error: Base de datos no configurada.";

    // Sanitización genérica de la query para evitar errores de sintaxis comunes (42601)
    let cleanQuery = sqlQuery
        .replace(/```sql/gi, '') // Quitar inicio de bloque de código
        .replace(/```/g, '')     // Quitar fin de bloque de código
        .trim();

    // Eliminar punto y coma final si existe, ya que algunos RPCs o drivers lo interpretan mal si se duplica
    if (cleanQuery.endsWith(';')) {
        cleanQuery = cleanQuery.slice(0, -1).trim();
    }

    console.log(`📡 Ejecutando Query SQL: ${cleanQuery}`);

    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
        attempts++;
        try {
            const isSelect = cleanQuery.trim().toUpperCase().startsWith('SELECT');
            const rpcName = isSelect ? 'exec_sql_read' : 'exec_sql';

            const { data, error } = await supabase.rpc(rpcName, { query: cleanQuery });

            console.log(`🐛 [dbHandler] RPC (${rpcName}) Response (Attempt ${attempts}):`, error ? "Error" : "Success");

            if (error) {
                // ... (manejo de errores existente)
                // Detectar error de tabla faltante (42P01) o columna faltante (42703)
                if ((error.code === '42P01' || error.code === '42703') && attempts === 1) {
                    const isMissingTable = error.code === '42P01';
                    console.warn(`⚠️ ${isMissingTable ? 'Tabla no encontrada' : 'Columna no encontrada'} (Error ${error.code}). Iniciando sincronización automática con Google Sheets...`);

                    try {
                        // Si falta columna (42703), forzamos recreación para actualizar esquema
                        await updateAllSheets({ forceRecreate: !isMissingTable });
                        console.log(`✅ Sincronización completada. Reintentando consulta...`);
                        continue; // Reintentar el loop
                    } catch (syncError: any) {
                        console.error("❌ Error crítico durante la sincronización automática:", syncError);
                        return `Error: Falló la sincronización automática: ${syncError.message}`;
                    }
                }

                console.error("❌ Error en RPC exec_sql:", error);
                return `Error en la consulta: ${error.message}`;
            }

            if (!data || !Array.isArray(data) || data.length === 0) {
                return "No se encontraron resultados.";
            }

            // Ordenar por created_at descendente (más reciente primero) y limitar a 10
            const sortedData = data.sort((a: any, b: any) => {
                const dateA = new Date(a.created_at || 0).getTime();
                const dateB = new Date(b.created_at || 0).getTime();
                return dateB - dateA;
            }).slice(0, 10);

            return JSON.stringify(sortedData, null, 2);

        } catch (err: any) {
            console.error("❌ Excepción en executeDbQuery:", err);
            return `Error procesando la consulta: ${err.message}`;
        }
    }
    return "Error desconocido tras reintentos.";
}
