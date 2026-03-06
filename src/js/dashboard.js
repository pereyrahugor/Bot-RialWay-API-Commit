async function fetchStatus() {
    try {
        const res = await fetch('/api/dashboard-status');
        const data = await res.json();
        
        const statusEl = document.getElementById('session-status');
        const qrSection = document.getElementById('qr-section');
        const sessionInfo = document.getElementById('session-info');
        const sessionError = document.getElementById('session-error');
        const wsLinkContainer = document.getElementById('whatsapp-link-container');
        const wsLink = document.getElementById('whatsapp-link');

        if (data.active) {
            qrSection.style.display = 'none';
            sessionInfo.style.display = '';
            
            if (data.source === 'connected') {
                statusEl.textContent = '✅ Conectado y Operativo';
                sessionInfo.textContent = 'El bot está vinculado a WhatsApp y funcionando correctamente.';
                sessionInfo.style.color = '#28a745';
                
                // Mostrar botón de WhatsApp si tenemos el número
                if (data.phoneNumber) {
                    wsLinkContainer.style.display = 'block';
                    wsLink.href = `https://wa.me/${data.phoneNumber}`;
                } else {
                    wsLinkContainer.style.display = 'none';
                }
            } else {
                statusEl.textContent = '✅ Sesión Local Detectada';
                sessionInfo.textContent = 'El bot tiene archivos de sesión. Si no responde en WhatsApp, intenta reiniciar.';
                sessionInfo.style.color = ''; 
                wsLinkContainer.style.display = 'none';
            }
        } else {
            qrSection.style.display = '';
            wsLinkContainer.style.display = 'none';
            
            if (data.hasRemote) {
                statusEl.textContent = '⏳ Restaurando...';
                sessionInfo.style.display = '';
                sessionInfo.textContent = data.message || 'Intentando recuperar sesión de la nube...';
                sessionInfo.style.color = '#ffc107';
            } else {
                statusEl.textContent = '⏳ Esperando Escaneo';
                sessionInfo.style.display = 'none';
            }
            
            // Intentar recargar el QR
            const qrImg = document.querySelector('.qr');
            qrImg.src = '/qr.png?t=' + Date.now();
            qrImg.style.display = 'inline-block';
            qrImg.nextElementSibling.style.display = 'none';
        }

        if (data.error) {
            sessionError.innerHTML = `<div class='error-box'>⚠️ Error al verificar sesión: ${data.error}</div>`;
        } else {
            sessionError.innerHTML = '';
        }
    } catch (e) {
        document.getElementById('session-status').textContent = 'Error';
        document.getElementById('session-error').innerHTML = `<div class='error-box'>No se pudo obtener el estado del bot.</div>`;
    }
}
fetchStatus();
setInterval(fetchStatus, 10000);

// Redirigir a /webreset al hacer click en el botón de reinicio
document.getElementById('go-reset').addEventListener('click', function() {
    window.location.href = '/webreset';
});
