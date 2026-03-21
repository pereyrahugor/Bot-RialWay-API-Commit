
-- Agregar columna bot_name si no existe
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_sessions' AND column_name = 'bot_name') THEN
        ALTER TABLE whatsapp_sessions ADD COLUMN bot_name TEXT DEFAULT NULL;
    END IF;
END $$;

-- Actualizar función save_whatsapp_session para incluir bot_name
CREATE OR REPLACE FUNCTION save_whatsapp_session(
    p_project_id TEXT,
    p_session_id TEXT,
    p_key_id TEXT,
    p_data JSONB,
    p_bot_name TEXT DEFAULT NULL -- Nuevo parámetro
) RETURNS VOID AS $$
BEGIN
    INSERT INTO whatsapp_sessions (project_id, session_id, key_id, data, bot_name, updated_at)
    VALUES (p_project_id, p_session_id, p_key_id, p_data, p_bot_name, NOW())
    ON CONFLICT (project_id, session_id, key_id)
    DO UPDATE SET 
        data = p_data, 
        bot_name = COALESCE(p_bot_name, whatsapp_sessions.bot_name), -- Actualizar nombre solo si se provee
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
