// scripts-js/login-admin.js - Login de administrador

document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mensaje = document.getElementById('mensaje-login');
    mensaje.innerHTML = '';

    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: document.getElementById('username').value,
                password: document.getElementById('password').value,
                totpToken: document.getElementById('totp').value
            })
        });

        if (res.ok) {
            window.location.href = '/admin/panel';
        } else {
            const err = await res.json();
            mensaje.innerHTML = `<div class="mensaje mensaje-error">${err.error || 'Error de autenticación'}</div>`;
        }
    } catch {
        mensaje.innerHTML = '<div class="mensaje mensaje-error">Error de conexión</div>';
    }
});
