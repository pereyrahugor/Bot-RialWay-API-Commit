import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

console.log("URL:", supabaseUrl);
console.log("Key (first 10 chars):", supabaseKey?.substring(0, 10));

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Faltan credenciales en .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setup() {
  console.log("🛠️ Intentando crear función RPC 'exec_sql_read' que retorne JSON...");

  // Definimos la nueva función asegurando que retorne JSON directamente
  const createFuncQuery = `
    CREATE OR REPLACE FUNCTION exec_sql_read(query text)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
        result JSONB;
    BEGIN
        EXECUTE 'SELECT json_agg(t) FROM (' || query || ') t' INTO result;
        
        IF result IS NULL THEN
            RETURN '[]'::jsonb;
        END IF;

        RETURN result;
    END;
    $$;
    `;

  // Usamos la función existente 'exec_sql' para crear la nueva.
  // Si 'exec_sql' funciona para DDL, debería permitir crear funciones.
  const { data, error } = await supabase.rpc('exec_sql', { query: createFuncQuery });

  if (error) {
    console.error("❌ Falló la creación de exec_sql_read:", error);
    console.log("💡 Si esto falla, por favor ejecuta el SQL anterior manualmente en el Dashboard de Supabase (SQL Editor).");
  } else {
    console.log("✅ Éxito: Función 'exec_sql_read' creada/actualizada.");
  }
}

setup();
