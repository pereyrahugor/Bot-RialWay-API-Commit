
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Cargar variables de entorno
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // Usamos SERVICE ROLE KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Faltan credenciales de Supabase en .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function applyMigration() {
    console.log('🚀 Iniciando migración de tabla de sesiones...');

    try {
        const sqlPath = path.join(process.cwd(), 'scripts', 'add_bot_name_column.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');

        // Supabase no tiene endpoint directo para ejecutar raw SQL desde el cliente JS estándar
        // a menos que tengamos una función RPC previa como 'exec_sql'.
        // Asumimos que 'exec_sql' (generic write) existe o intentamos llamar a nuestro 'exec_sql'
        // que creamos en scripts anteriores, PERO ese era 'exec_sql_read' (read only).
        // Si no existe 'exec_sql' de escritura, fallará.
        // INTENTAREMOS usar la API REST de POSTGREST si permite raw query? No.
        // La mejor opción es esperar que el usuario tenga acceso a SQL Editor o 
        // tener un RPC 'exec_sql' de escritura.

        // Como plan de contingencia, intentaremos usar la función 'exec_sql_read' PERO
        // esa función suele estar marcada como VOLATILE/READONLY o devuelve JSON.
        // Si necesitamos crear funciones, necesitamos privilegios de superusuario o exec_sql.
        
        // Vamos a intentar llamar a una rpc llamada 'exec_sql' (la original que intentamos fixear).
        // Si no funciona, esto fallará y avisaremos al usuario.
        
        console.log('📡 Ejecutando SQL vía RPC exec_sql...');
        const { error } = await supabase.rpc('exec_sql', { query: sqlContent });

        if (error) {
            console.error('❌ Error ejecutando migración:', error);
            // Fallback: Si el error es que la función no existe, imprimimos instructions
            console.log('\n⚠️ SI LA FUNCIÓN exec_sql NO EXISTE EN SUPABASE:');
            console.log('Debes ejecutar el contenido de scripts/create_session_table.sql manualmente en el SQL Editor de Supabase Dashboard.');
        } else {
            console.log('✅ Migración aplicada correctamente.');
        }

    } catch (err) {
        console.error('❌ Error inesperado:', err);
    }
}

applyMigration();
