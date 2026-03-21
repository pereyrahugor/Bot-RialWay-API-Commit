async function login() {
    const token = document.getElementById('token').value;
    const errorDiv = document.getElementById('error');
    
    if (!token) return;

    try {
        const response = await fetch('/api/backoffice/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });

        const result = await response.json();
        if (result.success) {
            localStorage.setItem('backoffice_token', token);
            window.location.href = '/backoffice';
        } else {
            errorDiv.style.display = 'block';
        }
    } catch (e) {
        console.error('Error de autenticación:', e);
        errorDiv.innerText = 'Error al conectar con el servidor';
        errorDiv.style.display = 'block';
    }
}

document.getElementById('token')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});
