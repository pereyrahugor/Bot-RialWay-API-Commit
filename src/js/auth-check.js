(function() {
    const token = localStorage.getItem('backoffice_token');
    if (!token && window.location.pathname !== '/login') {
        window.location.href = '/login';
    }
})();
