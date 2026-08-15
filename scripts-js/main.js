/* ============================================================
   main.js — Comportamiento del sitio
   Lic. Marcela Rolón — Psicóloga Clínica Gestalt
   JS vanilla, sin dependencias. Todo el movimiento respeta
   `prefers-reduced-motion: reduce` y nunca bloquea el render.
   ============================================================ */

(() => {
  'use strict';

  /* ---------------- Constantes ---------------- */

  const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOVER_FINO = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Número institucional de WhatsApp. No modificar.
  const URL_WHATSAPP =
    'https://wa.me/5493515920391?text=' +
    encodeURIComponent('Hola Marcela, quiero solicitar un turno.');

  // Glifo oficial de WhatsApp (simple-icons, viewBox 32). Se inyecta por JS
  // para no duplicar el SVG en las tres páginas.
  const GLIFO_WHATSAPP =
    '<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" role="img">' +
    '<path d="M16.003 2.5C8.554 2.5 2.5 8.554 2.5 16.003c0 2.56.67 5.06 1.94 7.262L2.5 29.5l6.405-1.903a13.39 13.39 0 0 0 7.098 2.022h.006c7.448 0 13.503-6.055 13.503-13.503C29.512 8.555 23.45 2.5 16.003 2.5z" />' +
    '<path fill="#fff" d="M16.003 4.5c6.345 0 11.508 5.162 11.509 11.51 0 6.346-5.163 11.51-11.51 11.51a11.4 11.4 0 0 1-5.84-1.61l-.42-.25-3.72 1.1 1.11-3.62-.27-.44a11.42 11.42 0 0 1-1.76-6.14c.002-6.347 5.164-11.51 11.91-11.51zm0-2a13.4 13.4 0 0 0-9.51 3.94A13.39 13.39 0 0 0 4.5 16c0 2.32.6 4.59 1.73 6.6L4.5 29.5l7.13-1.68a13.36 13.36 0 0 0 6.37 1.68h.01c7.4 0 13.5-6.1 13.5-13.5 0-3.6-1.4-7-3.95-9.55A13.4 13.4 0 0 0 16.003 2.5z" />' +
    '<path fill="#fff" d="M22.53 18.85c-.28-.14-1.66-.82-1.92-.91-.26-.1-.45-.15-.63.14-.19.28-.72.91-.89 1.1-.16.19-.33.21-.6.07-.28-.14-1.18-.43-2.24-1.38-.83-.74-1.39-1.66-1.55-1.94-.16-.28-.02-.43.12-.57.13-.13.28-.33.42-.5.14-.16.19-.28.28-.47.09-.19.05-.35-.02-.5-.07-.14-.63-1.52-.86-2.08-.23-.55-.46-.47-.63-.48h-.53c-.19 0-.49.07-.75.35-.26.28-1 .98-1 2.38s1.02 2.76 1.16 2.95c.14.19 2 3.05 4.84 4.28.68.29 1.2.47 1.61.6.68.22 1.29.19 1.78.12.54-.09 1.66-.68 1.9-1.33.23-.66.23-1.22.16-1.33-.07-.12-.25-.19-.53-.33z" />' +
    '</svg>';

  // La clase `js` activa los estados ocultos del CSS únicamente cuando hay JS.
  document.documentElement.classList.add('js');

  document.addEventListener('DOMContentLoaded', () => {
    iniciarMenu();
    iniciarRevelar();
    iniciarHero();
    iniciarParallax();
    iniciarMagnetico();
    iniciarNavbar();
    iniciarWhatsAppFlotante();
    inyectarIconoWhatsApp();
  });

  /* ---------------- Menú móvil ---------------- */

  function iniciarMenu() {
    const toggle = document.getElementById('menu-toggle');
    if (!toggle) return;

    const cerrar = () => {
      document.body.classList.remove('menu-abierto');
      toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', () => {
      const abierto = document.body.classList.toggle('menu-abierto');
      toggle.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    });

    document.querySelectorAll('.nav-links a').forEach((a) =>
      a.addEventListener('click', cerrar)
    );

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cerrar();
    });
  }

  /* ---------------- Reveal al hacer scroll ---------------- */

  function iniciarRevelar() {
    const elementos = document.querySelectorAll('.revelar');
    if (!elementos.length) return;

    if (REDUCE || !('IntersectionObserver' in window)) {
      elementos.forEach((e) => e.classList.add('visible'));
      return;
    }

    const observador = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((entrada) => {
          if (!entrada.isIntersecting) return;

          // Si el elemento vive en un grupo con data-stagger, se le asigna
          // un retraso creciente (máximo 450 ms).
          const grupo = entrada.target.closest('[data-stagger]');
          if (grupo) {
            const hijos = [...grupo.querySelectorAll('.revelar')];
            const indice = hijos.indexOf(entrada.target);
            entrada.target.style.setProperty(
              '--demora',
              `${Math.min(indice * 90, 450)}ms`
            );
          }

          entrada.target.classList.add('visible');
          observador.unobserve(entrada.target);
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );

    elementos.forEach((e) => observador.observe(e));
  }

  /* ---------------- Entrada del hero ---------------- */

  function iniciarHero() {
    const titulo = document.querySelector('.hero-split');
    const entradas = document.querySelectorAll('.hero-entrada');
    if (!titulo && !entradas.length) return;

    const mostrar = () => {
      entradas.forEach((el) => el.classList.add('visible'));
      if (titulo) titulo.classList.add('visible');
    };

    if (REDUCE) {
      mostrar();
      return;
    }

    try {
      if (titulo) dividirEnPalabras(titulo);

      // Etiqueta → descripción → acciones → emblema
      const demoras = [0, 0.12, 0.22, 0.34];
      entradas.forEach((el, i) => {
        el.style.setProperty('--demora', `${demoras[Math.min(i, demoras.length - 1)]}s`);
      });

      // Doble rAF: garantiza que el primer frame ya tenga el estado oculto.
      requestAnimationFrame(() => requestAnimationFrame(mostrar));
    } catch (error) {
      // Ante cualquier fallo, el contenido queda visible.
      mostrar();
    }
  }

  /* Separa el texto de un elemento en palabras animables. */
  function dividirEnPalabras(contenedor) {
    if (contenedor.querySelector('.palabra')) return;

    const procesar = (nodo) => {
      [...nodo.childNodes].forEach((hijo) => {
        if (hijo.nodeType === Node.TEXT_NODE) {
          const fragmento = document.createDocumentFragment();
          hijo.textContent.split(/(\s+)/).forEach((trozo) => {
            if (/^\s*$/.test(trozo)) {
              fragmento.appendChild(document.createTextNode(trozo));
              return;
            }
            const envoltorio = document.createElement('span');
            envoltorio.className = 'palabra';
            const interior = document.createElement('span');
            interior.className = 'palabra-inner';
            interior.textContent = trozo;
            envoltorio.appendChild(interior);
            fragmento.appendChild(envoltorio);
          });
          hijo.replaceWith(fragmento);
        } else if (hijo.nodeType === Node.ELEMENT_NODE) {
          procesar(hijo);
        }
      });
    };

    procesar(contenedor);

    contenedor.querySelectorAll('.palabra-inner').forEach((palabra, i) => {
      palabra.style.transitionDelay = `${0.06 + Math.min(i * 0.045, 0.45)}s`;
    });
  }

  /* ---------------- Parallax del emblema ---------------- */

  function iniciarParallax() {
    const emblema = document.querySelector('.hero-emblema');
    if (!emblema || REDUCE || window.matchMedia('(max-width: 768px)').matches) return;

    let rafId = null;

    const actualizar = () => {
      rafId = null;
      const y = window.scrollY;
      if (y < window.innerHeight * 1.6) {
        emblema.style.transform = `translate3d(0, ${(y * -0.05).toFixed(1)}px, 0)`;
      }
    };

    window.addEventListener(
      'scroll',
      () => {
        if (!rafId) rafId = requestAnimationFrame(actualizar);
      },
      { passive: true }
    );

    actualizar();
  }

  /* ---------------- Botones magnéticos (solo hover fino) ---------------- */

  function iniciarMagnetico() {
    if (REDUCE || !HOVER_FINO) return;

    document.querySelectorAll('.boton').forEach((boton) => {
      boton.addEventListener('mousemove', (e) => {
        const rect = boton.getBoundingClientRect();
        const dx = e.clientX - (rect.left + rect.width / 2);
        const desplazamiento = Math.max(-6, Math.min(6, dx * 0.12));
        boton.style.setProperty('--mx', `${desplazamiento.toFixed(2)}px`);
      });

      boton.addEventListener('mouseleave', () => {
        boton.style.setProperty('--mx', '0px');
      });
    });
  }

  /* ---------------- Navbar con estado al hacer scroll ---------------- */

  function iniciarNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    const actualizar = () => {
      navbar.classList.toggle('navbar-scrolled', window.scrollY > 8);
    };

    actualizar();
    window.addEventListener('scroll', actualizar, { passive: true });
  }

  /* ---------------- Botón flotante de WhatsApp ---------------- */

  function iniciarWhatsAppFlotante() {
    const enlace = document.createElement('a');
    enlace.className = 'whatsapp-flotante';
    enlace.href = URL_WHATSAPP;
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer';
    enlace.setAttribute('aria-label', 'Solicitar turno por WhatsApp');
    enlace.innerHTML =
      GLIFO_WHATSAPP +
      '<span class="whatsapp-tooltip">Escribinos por WhatsApp</span>';
    document.body.appendChild(enlace);
  }

  /* ---------------- Ícono de WhatsApp en las CTAs ---------------- */

  function inyectarIconoWhatsApp() {
    document.querySelectorAll('.boton-primario').forEach((boton) => {
      if (boton.querySelector('svg')) return;
      boton.insertAdjacentHTML('afterbegin', GLIFO_WHATSAPP);
    });
  }
})();
