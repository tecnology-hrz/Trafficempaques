import { db, doc, getDoc, setDoc } from "./auth.js";

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

const IMGBB_KEY = "85c1345ba9104ab223ed72e168bb111d";

function formatMoney(value) {
    const num = parseInt(value) || 0;
    return num.toLocaleString("en-US");
}

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

        const orden = { id: docSnap.id, ...docSnap.data() };
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

        // Verificar si tiene saldo pendiente
        renderPagoRestante(orden);
    }
}

function renderPagoRestante(orden) {
    const section = document.getElementById("pagoRestanteSection");
    const total = parseInt(orden.total) || 0;
    const montoPagado = parseInt(orden.montoPagado) || 0;
    const saldoRestante = total - montoPagado;

    // Si ya pago todo o es credito sin saldo, no mostrar
    if (saldoRestante <= 0) {
        section.style.display = "none";
        return;
    }

    // Si ya pago el restante (campo pagoRestanteCompletado)
    if (orden.pagoRestanteCompletado) {
        section.style.display = "block";
        section.innerHTML = `
            <div class="pago-restante-section">
                <div class="pago-completado">
                    <i class="bi bi-check-circle-fill"></i>
                    <h3>Pago completado</h3>
                    <p>El saldo restante de $${formatMoney(saldoRestante)} fue pagado exitosamente. Ya puedes recoger tu pedido.</p>
                </div>
            </div>
        `;
        return;
    }

    section.style.display = "block";
    section.innerHTML = `
        <div class="pago-restante-section">
            <div class="pago-restante-card">
                <h3><i class="bi bi-exclamation-triangle-fill"></i> Saldo pendiente</h3>
                <p class="pago-info">Para recoger tu pedido, debes cancelar el saldo restante:</p>
                <div class="monto-pendiente">$${formatMoney(saldoRestante)}</div>
                <p class="pago-info">Abono inicial: $${formatMoney(montoPagado)} &bull; Total: $${formatMoney(total)}</p>

                <h4 style="font-size:13px;color:#78350f;margin-bottom:10px;font-weight:600;">Selecciona metodo de pago:</h4>
                <div class="pago-metodos">
                    <button class="pago-metodo-btn" data-metodo="davivienda"><i class="bi bi-bank"></i> Davivienda</button>
                    <button class="pago-metodo-btn" data-metodo="bancolombia"><i class="bi bi-bank"></i> Bancolombia</button>
                    <button class="pago-metodo-btn" data-metodo="nequi"><i class="bi bi-phone"></i> Nequi</button>
                </div>

                <div class="pago-datos-seg" id="datosDaviSeg">
                    <h4><i class="bi bi-bank"></i> Davivienda</h4>
                    <div class="dato"><span>Titular:</span> Sherley Sinisterra Tenorio</div>
                    <div class="dato"><span>Numero:</span> 4884 0653 5812</div>
                    <div class="dato"><span>Tipo:</span> Cuenta de Ahorros</div>
                </div>
                <div class="pago-datos-seg" id="datosBancoSeg">
                    <h4><i class="bi bi-bank"></i> Bancolombia</h4>
                    <div class="dato"><span>Titular:</span> Sherley Sinisterra Tenorio</div>
                    <div class="dato"><span>Numero:</span> 803-379806-98</div>
                    <div class="dato"><span>Tipo:</span> Cuenta de Ahorros</div>
                    <div class="dato"><span>Cedula:</span> 1143925013</div>
                </div>
                <div class="pago-datos-seg" id="datosNequiSeg">
                    <h4><i class="bi bi-phone"></i> Nequi</h4>
                    <div class="dato"><span>Titular:</span> Sherley Sinisterra Tenorio</div>
                    <div class="dato"><span>Numero:</span> 318 398 1777</div>
                </div>

                <div class="comp-upload-area">
                    <button class="btn-upload-seg" id="btnUploadRestante"><i class="bi bi-cloud-arrow-up"></i> Subir comprobante</button>
                    <input type="file" id="inputComprobanteRestante" accept="image/*,.pdf" hidden>
                    <div class="comp-preview-seg" id="compPreviewRestante"></div>
                </div>

                <button class="btn-confirmar-pago" id="btnConfirmarPagoRestante" disabled>
                    <i class="bi bi-check-circle"></i> Confirmar pago de saldo restante
                </button>
            </div>
        </div>
    `;

    setupPagoRestante(orden, saldoRestante);
}

function setupPagoRestante(orden, saldoRestante) {
    let metodoSeleccionado = "";
    let comprobanteRestanteUrl = "";

    // Botones metodo de pago
    const btnsMetodo = document.querySelectorAll(".pago-metodo-btn");
    btnsMetodo.forEach(btn => {
        btn.addEventListener("click", () => {
            btnsMetodo.forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            metodoSeleccionado = btn.dataset.metodo;

            // Mostrar datos correspondientes
            document.getElementById("datosDaviSeg").style.display = metodoSeleccionado === "davivienda" ? "block" : "none";
            document.getElementById("datosBancoSeg").style.display = metodoSeleccionado === "bancolombia" ? "block" : "none";
            document.getElementById("datosNequiSeg").style.display = metodoSeleccionado === "nequi" ? "block" : "none";

            validarPagoRestante();
        });
    });

    // Upload comprobante
    const btnUpload = document.getElementById("btnUploadRestante");
    const inputFile = document.getElementById("inputComprobanteRestante");
    const preview = document.getElementById("compPreviewRestante");

    btnUpload.addEventListener("click", () => inputFile.click());
    inputFile.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        btnUpload.disabled = true;
        btnUpload.innerHTML = '<span class="spinner-seg"></span> Subiendo...';

        try {
            const formData = new FormData();
            formData.append("image", file);

            const res = await fetch("https://api.imgbb.com/1/upload?key=" + IMGBB_KEY, {
                method: "POST",
                body: formData
            });

            const data = await res.json();
            if (data.success) {
                comprobanteRestanteUrl = data.data.url;
                preview.innerHTML = `<img src="${comprobanteRestanteUrl}" alt="Comprobante" />`;
                btnUpload.innerHTML = '<i class="bi bi-arrow-repeat"></i> Cambiar comprobante';
                btnUpload.disabled = false;
                validarPagoRestante();
            } else {
                btnUpload.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> Subir comprobante';
                btnUpload.disabled = false;
                alert("Error al subir la imagen. Intenta de nuevo.");
            }
        } catch (err) {
            console.error(err);
            btnUpload.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> Subir comprobante';
            btnUpload.disabled = false;
            alert("Error al subir. Intenta de nuevo.");
        }
    });

    // Validar que se pueda enviar
    function validarPagoRestante() {
        const btnConfirmar = document.getElementById("btnConfirmarPagoRestante");
        btnConfirmar.disabled = !(metodoSeleccionado && comprobanteRestanteUrl);
    }

    // Confirmar pago
    const btnConfirmar = document.getElementById("btnConfirmarPagoRestante");
    btnConfirmar.addEventListener("click", async () => {
        btnConfirmar.disabled = true;
        btnConfirmar.innerHTML = '<span class="spinner-seg"></span> Enviando...';

        try {
            const ref = doc(db, "produccion", orden.id);
            const snap = await getDoc(ref);
            const data = snap.data();

            await setDoc(ref, {
                ...data,
                pagoRestanteCompletado: true,
                pagoRestanteMetodo: metodoSeleccionado,
                pagoRestanteComprobante: comprobanteRestanteUrl,
                pagoRestanteFecha: new Date().toISOString(),
                pagoRestanteMonto: saldoRestante,
                montoPagado: (parseInt(data.montoPagado) || 0) + saldoRestante
            });

            // Mostrar confirmación
            const section = document.getElementById("pagoRestanteSection");
            section.innerHTML = `
                <div class="pago-restante-section">
                    <div class="pago-completado">
                        <i class="bi bi-check-circle-fill"></i>
                        <h3>¡Pago enviado!</h3>
                        <p>Tu comprobante por $${formatMoney(saldoRestante)} fue enviado correctamente. Ya puedes pasar a recoger tu pedido.</p>
                    </div>
                </div>
            `;
        } catch (err) {
            console.error(err);
            alert("Error al enviar el pago. Intenta de nuevo.");
            btnConfirmar.disabled = false;
            btnConfirmar.innerHTML = '<i class="bi bi-check-circle"></i> Confirmar pago de saldo restante';
        }
    });
}

cargarSeguimiento();
