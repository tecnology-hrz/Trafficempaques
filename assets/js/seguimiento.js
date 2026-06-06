import { db, doc, getDoc } from "./auth.js";

const params = new URLSearchParams(window.location.search);
const ordenId = params.get("id");

if (!ordenId) {
    document.getElementById("mainCard").innerHTML = `
        <div class="error-state">
            <i class="bi bi-exclamation-circle"></i>
            <h2>Orden no encontrada</h2>
            <p>El link no es valido o ha expirado.</p>
        </div>`;
}

const PASOS = [
    { key: "recibido",    icon: "bi-inbox",         title: "Pedido recibido",     desc: "Tu orden fue recibida y confirmada" },
    { key: "diseno",      icon: "bi-brush",         title: "En diseño",           desc: "Estamos trabajando en el diseño de tu producto" },
    { key: "produccion",  icon: "bi-gear",          title: "En producción",       desc: "Tu producto esta siendo fabricado" },
    { key: "calidad",     icon: "bi-check2-square", title: "Control de calidad",  desc: "Verificando que todo este perfecto" },
    { key: "terminado",   icon: "bi-bag-check",     title: "Terminado",           desc: "Tu pedido esta listo para recoger" }
];

async function cargarSeguimiento() {
    if (!ordenId) return;

    try {
        const docSnap = await getDoc(doc(db, "produccion", ordenId));
        if (!docSnap.exists()) {
            document.getElementById("mainCard").innerHTML = `
                <div class="error-state">
                    <i class="bi bi-exclamation-circle"></i>
                    <h2>Orden no encontrada</h2>
                    <p>Esta orden no existe o fue eliminada.</p>
                </div>`;
            return;
        }

        const orden = docSnap.data();
        renderSeguimiento(orden);
    } catch (err) {
        console.error(err);
        document.getElementById("mainCard").innerHTML = `
            <div class="error-state">
                <i class="bi bi-exclamation-triangle"></i>
                <h2>Error</h2>
                <p>No se pudo cargar el seguimiento.</p>
            </div>`;
    }
}

function renderSeguimiento(orden) {
    document.getElementById("ordenNumero").textContent = orden.numero || "Orden";
    document.getElementById("ordenSubtitle").textContent = "Seguimiento de tu pedido";
    document.getElementById("segCliente").textContent = orden.cliente || "-";
    document.getElementById("segTipo").textContent = (orden.tipo || "-").charAt(0).toUpperCase() + (orden.tipo || "").slice(1);

    // Fecha pedido
    if (orden.fechaEnvio) {
        const f = new Date(orden.fechaEnvio);
        document.getElementById("segFechaPedido").textContent = f.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    }

    // Fecha entrega
    if (orden.fechaEntrega) {
        document.getElementById("segFechaEntrega").textContent = orden.fechaEntrega;
    }

    // Determinar paso actual
    const seguimiento = orden.seguimiento || {};
    const pasoActual = orden.pasoActual || "recibido";
    const idxActual = PASOS.findIndex(p => p.key === pasoActual);

    const timeline = document.getElementById("timeline");
    timeline.innerHTML = "";

    PASOS.forEach((paso, idx) => {
        let estado;
        if (idx < idxActual) {
            estado = "completado";
        } else if (idx === idxActual) {
            estado = "activo";
        } else {
            estado = "pendiente";
        }

        const fechaPaso = seguimiento[paso.key] ? new Date(seguimiento[paso.key]).toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

        const stepEl = document.createElement("div");
        stepEl.className = `timeline-step ${estado}`;
        stepEl.innerHTML = `
            <div class="timeline-dot"><i class="bi ${estado === "completado" ? "bi-check-lg" : paso.icon}"></i></div>
            <div class="timeline-content">
                <div class="timeline-title">${paso.title}</div>
                <div class="timeline-desc">${paso.desc}</div>
                ${fechaPaso ? `<div class="timeline-date">${fechaPaso}</div>` : ""}
            </div>
        `;
        timeline.appendChild(stepEl);
    });

    // Banner terminado
    if (pasoActual === "terminado") {
        const banner = document.getElementById("terminadoBanner");
        banner.style.display = "block";
        banner.innerHTML = `
            <div class="terminado-banner">
                <i class="bi bi-check-circle-fill"></i>
                <h3>¡Tu pedido esta listo!</h3>
                <p>Ya puedes pasar a recoger tu orden. Gracias por tu confianza.</p>
            </div>
        `;
    }
}

cargarSeguimiento();
