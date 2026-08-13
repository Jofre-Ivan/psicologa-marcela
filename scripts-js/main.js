// main.js - Comportamiento compartido

document.addEventListener('DOMContentLoaded', () => {
    iniciarMenu();
    iniciarRevelar();
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

function escaparHTML(texto) {
    if (!texto) return '';
    const div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
}
