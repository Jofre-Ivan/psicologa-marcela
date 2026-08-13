// admin.js - Panel de administración

document.addEventListener('DOMContentLoaded', () => {
    iniciarPanel();
});

let turnosGlobal = [];

async function iniciarPanel() {
    document.getElementById('cerrar-sesion').addEventListener('click', async () => {
        await fetch('/api/admin/logout', { method: 'POST' });
        window.location.href = '/admin';
    });

    await Promise.all([
        cargarEstadisticas(),
        cargarTurnos(),
        cargarAgenda()
    ]);

    document.getElementById('filtro').addEventListener('change', renderTurnos);
    document.getElementById('guardar-agenda').addEventListener('click', guardarAgenda);
}

async function cargarEstadisticas() {
    try {
        const res = await fetch('/api/admin/estadisticas');
        if (res.status === 401) {
            window.location.href = '/admin';
            return;
        }
        const stats = await res.json();

        document.getElementById('stat-turnos').textContent = stats.turnos.total;
        document.getElementById('stat-confirmados').textContent = stats.turnos.confirmados;
        document.getElementById('stat-cancelados').textContent = stats.turnos.cancelados;
        document.getElementById('stat-ingresos').textContent = '$' + stats.pagos.montoTotal.toLocaleString();
    } catch (e) {
        console.error('Error cargando estadísticas');
    }
}

async function cargarTurnos() {
    try {
        const res = await fetch('/api/admin/turnos');
        if (res.status === 401) {
            window.location.href = '/admin';
            return;
        }
        turnosGlobal = await res.json();
        renderTurnos();
    } catch {
        console.error('Error cargando turnos');
    }
}

function renderTurnos() {
    const filtro = document.getElementById('filtro').value;
    const cuerpo = document.getElementById('cuerpo-turnos');
    const sinTurnos = document.getElementById('sin-turnos');

    const lista = filtro === 'todos' ? turnosGlobal : turnosGlobal.filter(t => t.estado === filtro);

    if (!lista.length) {
        cuerpo.innerHTML = '';
        sinTurnos.style.display = 'block';
        return;
    }
    sinTurnos.style.display = 'none';

    cuerpo.innerHTML = lista.map(t => {
        const [a, m, d] = t.fecha.split('-');
        const estadoClase = {
            'pendiente_verificacion': 'estado-pendiente',
            'pendiente_pago': 'estado-pendiente',
            'confirmado': 'estado-confirmado',
            'cancelado': 'estado-cancelado'
        }[t.estado] || 'estado-pendiente';

        const estadoTexto = {
            'pendiente_verificacion': 'Pendiente Verif.',
            'pendiente_pago': 'Pendiente Pago',
            'confirmado': 'Confirmado',
            'cancelado': 'Cancelado'
        }[t.estado] || t.estado;

        const cobertura = t.tipo_cobertura === 'apross' ? 'Apross' : 'Particular';

        return `
        <tr>
            <td>${d}/${m}/${a}</td>
            <td>${t.hora}</td>
            <td>${t.servicio || '—'}</td>
            <td>${cobertura}</td>
            <td>$${t.monto?.toLocaleString() || '—'}</td>
            <td>${t.nombre || '—'}</td>
            <td>${t.telefono || '—'}</td>
            <td><span class="estado ${estadoClase}">${estadoTexto}</span></td>
            <td class="acciones">
                ${t.estado !== 'confirmado' && t.estado !== 'cancelado' ? `
                    <button class="boton-chico confirmar" data-id="${t.id}" data-estado="confirmado">Confirmar</button>
                    <button class="boton-chico cancelar" data-id="${t.id}" data-estado="cancelado">Cancelar</button>
                ` : '—'}
            </td>
        </tr>`;
    }).join('');

    cuerpo.querySelectorAll('.boton-chico').forEach(btn => {
        btn.addEventListener('click', () => cambiarEstado(btn.dataset.id, btn.dataset.estado));
    });
}

async function cambiarEstado(id, estado) {
    try {
        await fetch(`/api/admin/turnos/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado })
        });
        await cargarTurnos();
        await cargarEstadisticas();
    } catch {
        console.error('Error actualizando turno');
    }
}

let tramosAgenda = [];

async function cargarAgenda() {
    try {
        const res = await fetch('/api/admin/disponibilidad');
        tramosAgenda = await res.json();
        renderEditorAgenda();
    } catch {
        console.error('Error cargando agenda');
    }
}

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function renderEditorAgenda() {
    const editor = document.getElementById('editor-agenda');

    const porDia = {};
    for (let d = 0; d < 7; d++) porDia[d] = [];
    tramosAgenda.forEach(t => porDia[t.dia].push({ inicio: t.hora_inicio, fin: t.hora_fin }));

    let html = '';
    for (let d = 0; d < 7; d++) {
        const tramos = porDia[d];
        const activo = tramos.length > 0;

        html += `
        <div class="agenda-fila ${activo ? 'activo' : ''}" data-dia="${d}">
            <span class="nombre-dia">${DIAS[d]}</span>
            <label class="toggle">
                <input type="checkbox" class="toggle-dia" ${activo ? 'checked' : ''}>
                <span class="toggle-track"></span>
            </label>
            <div class="agenda-turnos" id="turnos-${d}" style="${activo ? '' : 'display:none'}">`;

        if (activo) {
            tramos.forEach((t, i) => {
                html += turnoHtml(t.inicio, t.fin, i);
            });
        }

        html += `</div>
            <button class="agregar-turno" data-dia="${d}" style="${activo ? '' : 'display:none'}">+ turno</button>
        </div>`;
    }

    editor.innerHTML = html;

    editor.querySelectorAll('.toggle-dia').forEach(chk => {
        chk.addEventListener('change', (e) => {
            const dia = Number(e.target.closest('.agenda-fila').dataset.dia);
            const fila = e.target.closest('.agenda-fila');
            const cont = document.getElementById(`turnos-${dia}`);
            const addBtn = fila.querySelector('.agregar-turno');

            if (e.target.checked) {
                fila.classList.add('activo');
                cont.style.display = '';
                addBtn.style.display = '';
                cont.innerHTML = turnoHtml('09:00', '12:00', 0);
            } else {
                fila.classList.remove('activo');
                cont.style.display = 'none';
                addBtn.style.display = 'none';
            }
        });
    });

    bindTurnoButtons();
}

function turnoHtml(ini, fin, idx) {
    return `
    <div class="turno">
        <span class="turno-label">${idx === 0 ? 'Mañana' : 'Tarde'}</span>
        <input type="time" value="${ini}" class="hora-ini">
        <span class="turno-guion">—</span>
        <input type="time" value="${fin}" class="hora-fin">
        <div class="turno-acciones">
            <button class="icono-btn quitar" title="Quitar">✕</button>
        </div>
    </div>`;
}

function bindTurnoButtons() {
    document.querySelectorAll('.agregar-turno').forEach(btn => {
        btn.onclick = () => {
            const dia = Number(btn.dataset.dia);
            const cont = document.getElementById(`turnos-${dia}`);
            const idx = cont.querySelectorAll('.turno').length;
            const div = document.createElement('div');
            div.innerHTML = turnoHtml('14:00', '18:00', idx);
            cont.appendChild(div.firstElementChild);
            bindTurnoButtons();
        };
    });

    document.querySelectorAll('.icono-btn.quitar').forEach(btn => {
        btn.onclick = () => {
            const turno = btn.closest('.turno');
            const cont = turno.parentElement;
            turno.remove();
            cont.querySelectorAll('.turno').forEach((t, i) => {
                t.querySelector('.turno-label').textContent = i === 0 ? 'Mañana' : 'Tarde';
            });
        };
    });
}

async function guardarAgenda() {
    const tramos = [];
    document.querySelectorAll('.agenda-fila').forEach(fila => {
        const dia = Number(fila.dataset.dia);
        if (!fila.querySelector('.toggle-dia').checked) return;

        fila.querySelectorAll('.turno').forEach(t => {
            const ini = t.querySelector('.hora-ini').value;
            const fin = t.querySelector('.hora-fin').value;
            if (ini && fin) tramos.push({ dia, hora_inicio: ini, hora_fin: fin });
        });
    });

    const mensaje = document.getElementById('mensaje-agenda');
    try {
        const res = await fetch('/api/admin/disponibilidad', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lista: tramos })
        });
        if (res.ok) {
            mensaje.innerHTML = '<div class="mensaje mensaje-exito">Agenda guardada correctamente</div>';
            setTimeout(() => (mensaje.innerHTML = ''), 2500);
            cargarAgenda();
        } else {
            mensaje.innerHTML = '<div class="mensaje mensaje-error">Error al guardar</div>';
        }
    } catch {
        mensaje.innerHTML = '<div class="mensaje mensaje-error">Error de conexión</div>';
    }
}
