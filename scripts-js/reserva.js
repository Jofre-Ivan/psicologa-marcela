// reserva.js - Flujo de reserva simplificado (sin OTP)

document.addEventListener('DOMContentLoaded', () => {
    const state = {
        tipoCobertura: null,
        servicio: null,
        fecha: null,
        hora: null,
        turnoId: null
    };

    let fechaCargada = '';

    // Paso 1: Cobertura
    document.querySelectorAll('.cobertura-opcion').forEach(btn => {
        btn.addEventListener('click', () => {
            state.tipoCobertura = btn.dataset.tipo;
            avanzar(2);
            cargarServicioYCalendario();
        });
    });

    async function cargarServicioYCalendario() {
        const res = await fetch('/api/servicios');
        const servicios = await res.json();
        state.servicio = servicios[0];
        armarCalendario();
    }

    function armarCalendario() {
        const hoy = new Date();
        const mes = hoy.getMonth();
        const anio = hoy.getFullYear();
        const mesStr = `${anio}-${String(mes + 1).padStart(2, '0')}`;
        const primerDia = new Date(anio, mes, 1).getDay();
        const diasEnMes = new Date(anio, mes + 1, 0).getDate();

        const nombresDom = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        let html = nombresDom.map(n => `<div class="calendario-header">${n}</div>`).join('');

        for (let i = 0; i < primerDia; i++) {
            html += '<div class="calendario-dia vacio"></div>';
        }

        for (let d = 1; d <= diasEnMes; d++) {
            const fecha = `${mesStr}-${String(d).padStart(2, '0')}`;
            const diaSemana = new Date(`${fecha}T00:00:00`).getDay();
            const esPasado = new Date(fecha) < new Date(hoy.toDateString());
            const esFinDeSemana = diaSemana === 0 || diaSemana === 6;

            let clase = 'calendario-dia';
            if (esPasado) clase += ' pasado';
            else if (esFinDeSemana) clase += ' sin-horarios';

            html += `<div class="${clase}" data-fecha="${fecha}">${d}</div>`;
        }

        document.getElementById('calendario').innerHTML = html;

        fetch(`/api/disponibilidad?mes=${mesStr}&servicioId=${state.servicio.id}`)
            .then(r => r.json())
            .then(conCupo => {
                document.querySelectorAll('.calendario-dia[data-fecha]').forEach(celda => {
                    const fecha = celda.dataset.fecha;
                    const numDia = Number(fecha.split('-')[2]);
                    const diaSemana = new Date(`${fecha}T00:00:00`).getDay();
                    const esPasado = celda.classList.contains('pasado');
                    const esFinDeSemana = diaSemana === 0 || diaSemana === 6;

                    if (!esPasado && !esFinDeSemana && !conCupo.includes(numDia)) {
                        celda.style.opacity = '0.3';
                        celda.style.cursor = 'not-allowed';
                    }

                    celda.addEventListener('click', () => {
                        if (celda.classList.contains('pasado') ||
                            celda.classList.contains('sin-horarios') ||
                            celda.style.opacity === '0.3') return;
                        document.querySelectorAll('.calendario-dia').forEach(c => c.classList.remove('seleccionado'));
                        celda.classList.add('seleccionado');
                        elegirFecha(celda.dataset.fecha);
                    });
                });
            });
    }

    function elegirFecha(fecha) {
        state.fecha = fecha;
        fechaCargada = '';
        avanzar(3);
        cargarHorarios(fecha);
    }

    function cargarHorarios(fecha) {
        if (!state.servicio || fechaCargada === fecha) return;
        fechaCargada = fecha;

        const [a, m, d] = fecha.split('-');
        document.getElementById('fecha-elegida').textContent = `Para el ${d}/${m}/${a}`;
        document.getElementById('horarios').innerHTML = '<p class="texto-suave texto-centrado">Cargando...</p>';

        fetch(`/api/horarios?fecha=${fecha}&servicioId=${state.servicio.id}`)
            .then(r => r.json())
            .then(horarios => {
                const cont = document.getElementById('horarios');
                if (!horarios.length) {
                    cont.innerHTML = '<p class="texto-suave texto-centrado">No hay horarios libres.</p>';
                    return;
                }
                cont.innerHTML = horarios.map(h =>
                    `<button type="button" class="horario" data-hora="${h}">${h}</button>`
                ).join('');

                cont.querySelectorAll('.horario').forEach(btn => {
                    btn.addEventListener('click', () => {
                        cont.querySelectorAll('.horario').forEach(b => b.classList.remove('seleccionado'));
                        btn.classList.add('seleccionado');
                        state.hora = btn.dataset.hora;
                        reservarTurno();
                    });
                });
            });
    }

    async function reservarTurno() {
        try {
            const res = await fetch('/api/turnos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    servicioId: state.servicio.id,
                    tipoCobertura: state.tipoCobertura,
                    fecha: state.fecha,
                    hora: state.hora
                })
            });

            if (res.ok) {
                const data = await res.json();
                state.turnoId = data.turnoId;
                avanzar(4);
            } else {
                const err = await res.json();
                alert(err.error || 'Error al reservar');
                avanzar(3);
                cargarHorarios(state.fecha);
            }
        } catch (e) {
            alert('Error de conexión');
        }
    }

    // Datos del paciente (sin OTP)
    document.getElementById('form-datos')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const mensaje = document.getElementById('mensaje-datos');

        const datos = {
            nombre: document.getElementById('nombre').value.trim(),
            dni: document.getElementById('dni').value.trim(),
            telefono: document.getElementById('telefono').value.trim(),
            email: document.getElementById('email').value.trim(),
            consentimiento: document.getElementById('consentimiento').checked
        };

        if (!datos.consentimiento) {
            mensaje.innerHTML = '<div class="mensaje mensaje-error">Debés aceptar la política de privacidad</div>';
            return;
        }

        try {
            const res = await fetch(`/api/turnos/${state.turnoId}/verificar`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });

            if (res.ok) {
                avanzar(5);
            } else {
                const err = await res.json();
                mensaje.innerHTML = `<div class="mensaje mensaje-error">${escaparHTML(err.error)}</div>`;
            }
        } catch (e) {
            mensaje.innerHTML = '<div class="mensaje mensaje-error">Error de conexión</div>';
        }
    });

    // Pagos
    document.getElementById('btn-mercadopago')?.addEventListener('click', () => crearPago('mercadopago'));
    document.getElementById('btn-paypal')?.addEventListener('click', () => crearPago('paypal'));

    async function crearPago(proveedor) {
        const mensaje = document.getElementById('mensaje-pago');

        try {
            const res = await fetch('/api/pagos/crear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ turnoId: state.turnoId, proveedor })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.initPoint) {
                    window.location.href = data.initPoint;
                } else if (data.approveUrl) {
                    window.location.href = data.approveUrl;
                }
            } else {
                const err = await res.json();
                mensaje.innerHTML = `<div class="mensaje mensaje-error">${escaparHTML(err.error)}</div>`;
            }
        } catch (e) {
            mensaje.innerHTML = '<div class="mensaje mensaje-error">Error procesando el pago</div>';
        }
    }

    function avanzar(nro) {
        for (let i = 1; i <= 5; i++) {
            const paso = document.getElementById(`paso-${i}`);
            if (paso) paso.classList.toggle('oculto', i !== nro);
        }
        actualizarPasos(nro);
    }

    function actualizarPasos(nro) {
        document.querySelectorAll('.paso').forEach(p => {
            const n = Number(p.dataset.paso);
            p.classList.toggle('activo', n === nro);
            p.classList.toggle('hecho', n < nro);
        });
    }

    function escaparHTML(texto) {
        if (!texto) return '';
        const div = document.createElement('div');
        div.textContent = texto;
        return div.innerHTML;
    }
});
