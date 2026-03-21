
-- Tabla para manejar sesiones de WhatsApp multi-tenant
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    project_id TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT 'default', -- Por si quieres múltiples sesiones por proyecto
    key_id TEXT NOT NULL, -- El nombre del "archivo" (creds, app-state-sync keys, etc)
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (project_id, session_id, key_id)
);

-- Index opcional para busquedas rapidas por proyecto
CREATE INDEX IF NOT EXISTS idx_sessions_project ON whatsapp_sessions(project_id, session_id);

-- Función RPC para escribir (Upsert) data de sesión
CREATE OR REPLACE FUNCTION save_whatsapp_session(
    p_project_id TEXT,
    p_session_id TEXT,
    p_key_id TEXT,
    p_data JSONB
) RETURNS VOID AS $$
BEGIN
    INSERT INTO whatsapp_sessions (project_id, session_id, key_id, data, updated_at)
    VALUES (p_project_id, p_session_id, p_key_id, p_data, NOW())
    ON CONFLICT (project_id, session_id, key_id)
    DO UPDATE SET data = p_data, updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función RPC para leer data de sesión
CREATE OR REPLACE FUNCTION get_whatsapp_session(
    p_project_id TEXT,
    p_session_id TEXT
) RETURNS TABLE(key_id TEXT, data JSONB) AS $$
BEGIN
    RETURN QUERY 
    SELECT s.key_id, s.data
    FROM whatsapp_sessions s
    WHERE s.project_id = p_project_id AND s.session_id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función RPC para borrar sesión
CREATE OR REPLACE FUNCTION delete_whatsapp_session(
    p_project_id TEXT,
    p_session_id TEXT
) RETURNS VOID AS $$
BEGIN
    DELETE FROM whatsapp_sessions
    WHERE project_id = p_project_id AND session_id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Asegurarnos que existe exec_sql generic para mantenimiento si hace falta (Write)
CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE query;
END;
$$;

-- Función RPC para leer data arbitraria (SELECT)
CREATE OR REPLACE FUNCTION exec_sql_read(query text)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    -- Ejecutar la consulta y convertir el resultado a JSON
    EXECUTE 'SELECT json_agg(t) FROM (' || query || ') t' INTO result;
    
    -- Si no hay resultados, devolver array vacío en lugar de null para evitar errores en cliente
    IF result IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    RETURN result;
END;
$$;
