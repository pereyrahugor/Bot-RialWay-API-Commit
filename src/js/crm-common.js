// Lógica de tema persistente
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

// Inicialización automática
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    
    // Si existe botón de tema, enlazarlo
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }
});

// Función común de cierre de sesión
function logout() {
    localStorage.removeItem('backoffice_token');
    window.location.href = '/login';
}
