import { db, doc, getDoc, setDoc } from "./auth.js";

const params = new URLSearchParams(window.location.search);
const cotId  = params.get("id");

if (!cotId) {
    document.body.innerHTML = '<div style="text-align:center;padding:60px;font-family:sans-serif;"><h2>Cotizacion no encontrada</h2><p>El link no es valido.</p></div>';
}

function formatMoney(value) {
    const num = parseInt(value) || 0;
    return num.toLocaleString("en-US");
}

let cotizacion = null;

async function cargarCotizacion() {
    try {
        const docSnap = await getDoc(doc(db, "cotizaciones", cotId));
        if (!docSnap.exists()) {
            document.body.innerHTML = '<div style="text-align:center;padding:60px;font-family:sans-serif;"><h2>Cotizacion no encontrada</h2><p>Esta cotizacion no existe o fue eliminada.</p></div>';
            return;
        }
        cotizacion = docSnap.data();
        renderCotizacion();
    } catch (err) {
        console.error(err);
        document.body.innerHTML = '<div style="text-align:center;padding:60px;font-family:sans-serif;"><h2>Error</h2><p>No se pudo cargar la cotizacion.</p></div>';
    }
}

function renderCotizacion() {
    document.getElementById("cotNumero").textContent  = cotizacion.numero;
    document.getElementById("cotCliente").textContent = cotizacion.cliente;
    document.getElementById("cotNit").textContent     = cotizacion.nit || "-";
    document.getElementById("cotTelefono").textContent = cotizacion.telefono || "-";
    const tipoLabel = cotizacion.tipo === "ambas" ? "Imprenta y Digital" : (cotizacion.tipo.charAt(0).toUpperCase() + cotizacion.tipo.slice(1));
    document.getElementById("cotTipo").textContent    = tipoLabel;

    // Nuevos campos
    const elNegocio = document.getElementById("cotNegocio");
    if (elNegocio) elNegocio.textContent = cotizacion.negocio || "-";
    const elDireccion = document.getElementById("cotDireccion");
    if (elDireccion) elDireccion.textContent = cotizacion.direccion || "-";
    const elCiudad = document.getElementById("cotCiudad");
    if (elCiudad) elCiudad.textContent = cotizacion.ciudad || "-";

    // Fecha
    const fecha = new Date(cotizacion.fechaCreacion);
    const fechaStr = fecha.toLocaleDateString("es-MX", {
        day: "numeric", month: "long", year: "numeric"
    });
    document.getElementById("cotFecha").textContent       = fechaStr;
    document.getElementById("cotFechaCliente").textContent = fechaStr;

    // Items con ID
    const tbody = document.getElementById("cotItemsBody");
    tbody.innerHTML = "";
    cotizacion.items.forEach((item, idx) => {
        const tr = document.createElement("tr");
        const tipoBadge = item.tipo === "digital"
            ? '<span class="tipo-badge digital"><i class="bi bi-display"></i> Digital</span>'
            : '<span class="tipo-badge imprenta"><i class="bi bi-printer"></i> Imprenta</span>';

        tr.innerHTML = `
            <td><strong>${item.id || (idx + 1)}</strong></td>
            <td>${tipoBadge}</td>
            <td>${item.producto}</td>
            <td>${item.cantidad}</td>
            <td>${item.terminados ? (Array.isArray(item.terminados) ? (item.terminados.length > 0 ? item.terminados.join(", ") : "-") : item.terminados) : (item.terminado || "-")}</td>
            <td>${item.colores ? (Array.isArray(item.colores) ? (item.colores.length > 0 ? item.colores.join(", ") : "-") : item.colores) : (item.color || "-")}</td>
            <td>${item.materiales ? (Array.isArray(item.materiales) ? (item.materiales.length > 0 ? item.materiales.join(", ") : "-") : item.materiales) : "-"}</td>
            <td>${item.planchas ? (Array.isArray(item.planchas) ? (item.planchas.length > 0 ? item.planchas.join(", ") : "-") : item.planchas) : "-"}</td>
            <td>$${formatMoney(item.precioUnit)}</td>
            <td><strong>$${formatMoney(item.precioTotal)}</strong></td>
        `;
        tbody.appendChild(tr);
    });

    // Total
    document.getElementById("cotTotal").textContent = "$" + formatMoney(cotizacion.total);

    // Estado
    if (cotizacion.estado === "aprobada") {
        mostrarAprobada();
    } else if (cotizacion.estado === "rechazada") {
        mostrarRechazada();
    }
}

// ===== DECISION: APROBAR / RECHAZAR =====
const btnAprobarCot  = document.getElementById("btnAprobarCot");
const btnRechazarCot = document.getElementById("btnRechazarCot");

btnAprobarCot.addEventListener("click", () => {
    btnAprobarCot.classList.add("selected");
    btnRechazarCot.classList.remove("selected");
    document.getElementById("decisionPago").style.display = "block";
    document.getElementById("seccionDatosPago").style.display = "flex";
});

btnRechazarCot.addEventListener("click", () => {
    btnRechazarCot.classList.add("selected");
    btnAprobarCot.classList.remove("selected");
    document.getElementById("decisionPago").style.display = "none";
    document.getElementById("seccionDatosPago").style.display = "none";
});

// ===== TIPO DE PAGO (completo / abono) =====
const tipoPagoRadios = document.querySelectorAll('input[name="tipoPago"]');
const abonoInput     = document.getElementById("abonoInput");
const montoAbonoInp  = document.getElementById("montoAbono");

// Formato de miles para el monto
montoAbonoInp.addEventListener("input", () => {
    let raw = montoAbonoInp.value.replace(/[^0-9]/g, "");
    let num = parseInt(raw) || 0;
    montoAbonoInp.value = num > 0 ? num.toLocaleString("en-US") : "";
    checkCanApprove();
});

tipoPagoRadios.forEach(r => {
    r.addEventListener("change", () => {
        if (r.value === "abono") {
            abonoInput.style.display = "block";
        } else {
            abonoInput.style.display = "none";
            montoAbonoInp.value = "";
        }
        checkCanApprove();
    });
});

// ===== METODO DE PAGO =====
const radios = document.querySelectorAll('input[name="metodoPago"]');
const datosDavi  = document.getElementById("datosDavivienda");
const datosBanco = document.getElementById("datosBancolombia");
const datosNequi = document.getElementById("datosNequi");

radios.forEach(radio => {
    radio.addEventListener("change", () => {
        datosDavi.style.display  = radio.value === "davivienda" ? "block" : "none";
        datosBanco.style.display = radio.value === "bancolombia" ? "block" : "none";
        datosNequi.style.display = radio.value === "nequi" ? "block" : "none";
        checkCanApprove();
    });
});

// ===== COMPROBANTE =====
const btnUploadComp = document.getElementById("uploadComprobante");
const inputComp     = document.getElementById("inputComprobante");
const compPreview   = document.getElementById("comprobantePreview");
let archivoComprobante = null;
let comprobanteUrl     = "";

const IMGBB_KEY = "85c1345ba9104ab223ed72e168bb111d";

btnUploadComp.addEventListener("click", () => inputComp.click());
inputComp.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    archivoComprobante = file;
    compPreview.innerHTML = '<span class="comp-status">Subiendo...</span>';
    btnUploadComp.disabled = true;

    try {
        const formData = new FormData();
        formData.append("image", file);

        const res = await fetch("https://api.imgbb.com/1/upload?key=" + IMGBB_KEY, {
            method: "POST",
            body: formData
        });

        const data = await res.json();
        if (data.success) {
            comprobanteUrl = data.data.url;
            compPreview.innerHTML = `
                <img src="${comprobanteUrl}" class="comp-thumb" alt="Comprobante" />
            `;
            // Cambiar boton a "Cambiar"
            btnUploadComp.innerHTML = '<i class="bi bi-arrow-repeat"></i> Cambiar';
            btnUploadComp.disabled = false;

            // Click en miniatura abre modal
            const thumb = compPreview.querySelector(".comp-thumb");
            thumb.addEventListener("click", () => {
                document.getElementById("imgModalImg").src = comprobanteUrl;
                document.getElementById("imgModal").classList.add("show");
            });

            checkCanApprove();
        } else {
            compPreview.innerHTML = '<span class="comp-status error">Error</span>';
            btnUploadComp.disabled = false;
            archivoComprobante = null;
        }
    } catch (err) {
        console.error(err);
        compPreview.innerHTML = '<span class="comp-status error">Error</span>';
        btnUploadComp.disabled = false;
        archivoComprobante = null;
    }
});

// Modal previsualizacion
const imgModal      = document.getElementById("imgModal");
const imgModalClose = document.getElementById("imgModalClose");
imgModalClose.addEventListener("click", () => imgModal.classList.remove("show"));
imgModal.addEventListener("click", (e) => {
    if (e.target === imgModal) imgModal.classList.remove("show");
});

// ===== VALIDAR =====
const btnAprobar = document.getElementById("btnAprobar");

function checkCanApprove() {
    const metodoPago = document.querySelector('input[name="metodoPago"]:checked');
    const tipoPago   = document.querySelector('input[name="tipoPago"]:checked');
    const aprobado   = btnAprobarCot.classList.contains("selected");
    const rechazado  = btnRechazarCot.classList.contains("selected");

    // Si es abono, validar monto
    let abonoValido = true;
    if (tipoPago && tipoPago.value === "abono") {
        const monto = parseInt(montoAbonoInp.value.replace(/,/g, "")) || 0;
        abonoValido = monto > 0;
    }

    if (rechazado) {
        btnAprobar.disabled = false;
        btnAprobar.innerHTML = '<i class="bi bi-x-circle"></i> Enviar rechazo';
        btnAprobar.className = "btn-aprobar btn-rechazar-final";
    } else if (aprobado && metodoPago && comprobanteUrl && abonoValido) {
        btnAprobar.disabled = false;
        btnAprobar.innerHTML = '<i class="bi bi-check-circle"></i> Aprobar y enviar cotizacion';
        btnAprobar.className = "btn-aprobar";
    } else {
        btnAprobar.disabled = true;
        btnAprobar.innerHTML = '<i class="bi bi-check-circle"></i> Aprobar y enviar cotizacion';
        btnAprobar.className = "btn-aprobar";
    }
}

// Escuchar cambios de decision para revalidar
btnAprobarCot.addEventListener("click", checkCanApprove);
btnRechazarCot.addEventListener("click", checkCanApprove);

// ===== ENVIAR =====
btnAprobar.addEventListener("click", async () => {
    btnAprobar.disabled = true;
    btnAprobar.innerHTML = '<span class="spinner"></span> Enviando...';

    const rechazado = btnRechazarCot.classList.contains("selected");

    try {
        const ref = doc(db, "cotizaciones", cotId);
        const snap = await getDoc(ref);
        const data = snap.data();

        if (rechazado) {
            await setDoc(ref, {
                ...data,
                estado: "rechazada",
                fechaAprobacion: new Date().toISOString()
            });
            mostrarRechazada();
        } else {
            const metodoPago = document.querySelector('input[name="metodoPago"]:checked').value;
            const tipoPago   = document.querySelector('input[name="tipoPago"]:checked').value;
            const montoAbono = tipoPago === "abono"
                ? (parseInt(montoAbonoInp.value.replace(/,/g, "")) || 0)
                : data.total;

            await setDoc(ref, {
                ...data,
                estado: "aprobada",
                metodoPago: metodoPago,
                tipoPago: tipoPago, // "completo" o "abono"
                montoPagado: montoAbono,
                comprobante: comprobanteUrl,
                comprobanteNombre: archivoComprobante ? archivoComprobante.name : "",
                fechaAprobacion: new Date().toISOString()
            });
            mostrarAprobada();
        }
    } catch (err) {
        console.error(err);
        alert("Error al enviar. Intenta de nuevo.");
        btnAprobar.disabled = false;
        btnAprobar.innerHTML = '<i class="bi bi-check-circle"></i> Aprobar y enviar cotizacion';
    }
});

function mostrarAprobada() {
    document.getElementById("seccionDecision").style.display = "none";
    document.getElementById("seccionAprobada").style.display = "block";

    const statusBar = document.getElementById("cotStatusBar");
    statusBar.className = "cot-status-bar aprobada";
    statusBar.querySelector("i").className = "bi bi-check-circle";
    document.getElementById("cotStatusText").textContent = "Cotizacion aprobada";
}

function mostrarRechazada() {
    document.getElementById("seccionDecision").style.display = "none";

    const statusBar = document.getElementById("cotStatusBar");
    statusBar.className = "cot-status-bar rechazada";
    statusBar.querySelector("i").className = "bi bi-x-circle";
    document.getElementById("cotStatusText").textContent = "Cotizacion rechazada";
}

// Spinner
const style = document.createElement("style");
style.textContent = `.spinner{display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`;
document.head.appendChild(style);

// ===== MODAL TERMINOS Y CONDICIONES =====
const terminosModal = document.getElementById("terminosModal");
const btnTerminos = document.getElementById("btnTerminosCot");
const terminosClose = document.getElementById("terminosModalClose");

btnTerminos.addEventListener("click", (e) => {
    e.preventDefault();
    terminosModal.classList.add("show");
});

terminosClose.addEventListener("click", () => {
    terminosModal.classList.remove("show");
});

terminosModal.addEventListener("click", (e) => {
    if (e.target === terminosModal) terminosModal.classList.remove("show");
});

cargarCotizacion();
