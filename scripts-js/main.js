// main.js - Comportamiento compartido

document.addEventListener('DOMContentLoaded', () => {
    iniciarMenu();
    iniciarRevelar();
    iniciarWhatsApp();
});

function iniciarMenu() {
    const toggle = document.getElementById('menu-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
        const abierto = document.body.classList.toggle('menu-abierto');
        toggle.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    });

    document.querySelectorAll('.nav-links a').forEach((a) => {
        a.addEventListener('click', () => {
            document.body.classList.remove('menu-abierto');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });
}

function iniciarRevelar() {
    const elementos = document.querySelectorAll('.revelar');

    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        elementos.forEach((e) => e.classList.add('visible'));
        return;
    }

    const observador = new IntersectionObserver(
        (entradas) => {
            entradas.forEach((entrada) => {
                if (entrada.isIntersecting) {
                    entrada.target.classList.add('visible');
                    observador.unobserve(entrada.target);
                }
            });
        },
        { threshold: 0.1 }
    );

    elementos.forEach((e) => observador.observe(e));
}

function iniciarWhatsApp() {
    const url = 'https://wa.me/5493515920391?text=' + encodeURIComponent('Hola Marcela, quiero solicitar un turno.');
    const enlace = document.createElement('a');
    enlace.className = 'whatsapp-flotante';
    enlace.href = url;
    enlace.target = '_blank';
    enlace.rel = 'noopener';
    enlace.setAttribute('aria-label', 'Solicitar turno por WhatsApp');
    enlace.innerHTML =
        '<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" role="img">' +
        '<path d="M16.003 2.5C8.554 2.5 2.5 8.554 2.5 16.003c0 2.56.67 5.06 1.94 7.262L2.5 29.5l6.405-1.903a13.39 13.39 0 0 0 7.098 2.022h.006c7.448 0 13.503-6.055 13.503-13.503C29.512 8.555 23.45 2.5 16.003 2.5z" />' +
        '<path fill="#fff" d="M16.003 4.5c6.345 0 11.508 5.162 11.509 11.51 0 6.346-5.163 11.51-11.51 11.51a11.4 11.4 0 0 1-5.84-1.61l-.42-.25-3.72 1.1 1.11-3.62-.27-.44a11.42 11.42 0 0 1-1.76-6.14c.002-6.347 5.164-11.51 11.91-11.51zm0-2a13.4 13.4 0 0 0-9.51 3.94A13.39 13.39 0 0 0 4.5 16c0 2.32.6 4.59 1.73 6.6L4.5 29.5l7.13-1.68a13.36 13.36 0 0 0 6.37 1.68h.01c7.4 0 13.5-6.1 13.5-13.5 0-3.6-1.4-7-3.95-9.55A13.4 13.4 0 0 0 16.003 2.5z" />' +
        '<path fill="#fff" d="M22.53 18.85c-.28-.14-1.66-.82-1.92-.91-.26-.1-.45-.15-.63.14-.19.28-.72.91-.89 1.1-.16.19-.33.21-.6.07-.28-.14-1.18-.43-2.24-1.38-.83-.74-1.39-1.66-1.55-1.94-.16-.28-.02-.43.12-.57.13-.13.28-.33.42-.5.14-.16.19-.28.28-.47.09-.19.05-.35-.02-.5-.07-.14-.63-1.52-.86-2.08-.23-.55-.46-.47-.63-.48h-.53c-.19 0-.49.07-.75.35-.26.28-1 .98-1 2.38s1.02 2.76 1.16 2.95c.14.19 2 3.05 4.84 4.28.68.29 1.2.47 1.61.6.68.22 1.29.19 1.78.12.54-.09 1.66-.68 1.9-1.33.23-.66.23-1.22.16-1.33-.07-.12-.25-.19-.53-.33z" />' +
        '</svg>';
    document.body.appendChild(enlace);
}

function escaparHTML(texto) {
    if (!texto) return '';
    const div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
}
