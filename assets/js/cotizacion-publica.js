import { db, doc, getDoc, setDoc } from "./auth.js";
import { validarComprobante, mostrarAlertaComprobante } from "./comprobante-validador.js";

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

// ===== PRODUCTOS ADICIONALES PARA NUEVA COTIZACIÓN =====
const seccionReferencias = document.getElementById("seccionReferencias");
const referenciasGrid    = document.getElementById("referenciasGrid");

// Escuchar cambios de selección del catálogo
window.onCatalogoSeleccionChange = (seleccionadas) => {
    renderReferencias(seleccionadas);
};

function renderReferencias(seleccionadas) {
    if (!seleccionadas || seleccionadas.length === 0) {
        seccionReferencias.style.display = "none";
        referenciasGrid.innerHTML = "";
        return;
    }
    seccionReferencias.style.display = "block";
    referenciasGrid.innerHTML = "";
    seleccionadas.forEach(src => {
        const item = document.createElement("div");
        item.className = "referencia-item";
        item.innerHTML = `
            <img src="${src}" alt="Producto" loading="lazy">
            <button class="referencia-remove" title="Quitar"><i class="bi bi-x"></i></button>
        `;
        item.querySelector("img").addEventListener("click", () => {
            document.getElementById("imgModalRefImg").src = src;
            document.getElementById("imgModalRef").classList.add("show");
        });
        item.querySelector(".referencia-remove").addEventListener("click", () => {
            item.remove();
            if (referenciasGrid.querySelectorAll(".referencia-item").length === 0) {
                seccionReferencias.style.display = "none";
            }
        });
        referenciasGrid.appendChild(item);
    });
}

// Modal ver producto grande
const imgModalRef      = document.getElementById("imgModalRef");
const imgModalRefClose = document.getElementById("imgModalRefClose");
imgModalRefClose.addEventListener("click", () => imgModalRef.classList.remove("show"));
imgModalRef.addEventListener("click", (e) => {
    if (e.target === imgModalRef) imgModalRef.classList.remove("show");
});

// ===== COMENTARIO =====
const cotComentario = document.getElementById("cotComentario");
const cotComentarioCount = document.getElementById("cotComentarioCount");
cotComentario.addEventListener("input", () => {
    cotComentarioCount.textContent = cotComentario.value.length;
});

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

    // Asesor comercial que elaboro la cotizacion. Si la cotizacion es antigua
    // y no tiene el dato, se oculta el campo en lugar de mostrar un guion.
    const elAsesor  = document.getElementById("cotAsesor");
    const itemAsesor = document.getElementById("cotAsesorItem");
    if (elAsesor) {
        const asesor = (cotizacion.creadoPor || "").trim();
        elAsesor.textContent = asesor || "-";
        if (itemAsesor) itemAsesor.style.display = asesor ? "" : "none";
    }

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

    // Total (con desglose de IVA cuando aplique)
    if (cotizacion.aplicarIva && cotizacion.iva) {
        const subtotal = cotizacion.subtotal !== undefined ? cotizacion.subtotal : (cotizacion.total - cotizacion.iva);
        document.getElementById("cotSubtotal").textContent = "$" + formatMoney(subtotal);
        document.getElementById("cotIva").textContent = "$" + formatMoney(cotizacion.iva);
        document.getElementById("cotSubtotalRow").style.display = "flex";
        document.getElementById("cotIvaRow").style.display = "flex";
    }
    document.getElementById("cotTotal").textContent = "$" + formatMoney(cotizacion.total);

    // Modalidad de pago: si es credito, ocultar opciones de pago y comprobante
    const esCredito = cotizacion.modalidadPago === "credito";
    if (esCredito) {
        document.getElementById("decisionPago").style.display = "none";
        document.getElementById("seccionDatosPago").style.display = "none";
    }

    // Estado
    if (cotizacion.estado === "aprobada") {
        const total = parseInt(cotizacion.total) || 0;
        const pagado = parseInt(cotizacion.montoPagado) || 0;
        const esCredito = cotizacion.modalidadPago === "credito";
        // Si es contado y aun queda saldo, mantener el link vivo con la vista de abonos
        if (!esCredito && pagado < total) {
            mostrarAbonos();
        } else {
            mostrarAprobada();
        }
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
    // Si es credito, no mostrar opciones de pago
    const esCredito = cotizacion && cotizacion.modalidadPago === "credito";
    if (!esCredito) {
        document.getElementById("decisionPago").style.display = "block";
        document.getElementById("seccionDatosPago").style.display = "flex";
    }
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
const datosEfectivo = document.getElementById("datosEfectivo");

radios.forEach(radio => {
    radio.addEventListener("change", () => {
        datosDavi.style.display  = radio.value === "davivienda" ? "block" : "none";
        datosBanco.style.display = radio.value === "bancolombia" ? "block" : "none";
        datosNequi.style.display = radio.value === "nequi" ? "block" : "none";
        datosEfectivo.style.display = radio.value === "efectivo" ? "block" : "none";
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

// Calcula el monto que se va a pagar con el comprobante inicial.
function getMontoPagoInicial() {
    const total = parseInt(cotizacion && cotizacion.total) || 0;
    const tipoPago = document.querySelector('input[name="tipoPago"]:checked');
    if (tipoPago && tipoPago.value === "abono") {
        return parseInt((montoAbonoInp.value || "").replace(/,/g, "")) || 0;
    }
    return total;
}

btnUploadComp.addEventListener("click", () => inputComp.click());
inputComp.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const metodoSel = document.querySelector('input[name="metodoPago"]:checked');
    if (!metodoSel) {
        mostrarAlertaComprobante("Primero selecciona el metodo de pago antes de subir el comprobante.", "Falta el metodo de pago");
        inputComp.value = "";
        return;
    }
    const entidad = metodoSel.value;
    const montoEsperado = getMontoPagoInicial();

    if (entidad !== "efectivo" && montoEsperado <= 0) {
        mostrarAlertaComprobante("Indica el monto del abono antes de subir el comprobante.", "Falta el monto");
        inputComp.value = "";
        return;
    }

    // ===== Verificacion inteligente del comprobante (OCR) =====
    if (entidad !== "efectivo") {
        compPreview.innerHTML = '<span class="comp-status">Verificando comprobante...</span>';
        btnUploadComp.disabled = true;
        const resultado = await validarComprobante(file, {
            entidad,
            montoEsperado,
            onProgreso: (p) => {
                compPreview.innerHTML = '<span class="comp-status">Verificando comprobante... ' + Math.round(p * 100) + '%</span>';
            }
        });
        if (!resultado.ok) {
            mostrarAlertaComprobante(resultado.mensaje);
            compPreview.innerHTML = "";
            btnUploadComp.disabled = false;
            inputComp.value = "";
            archivoComprobante = null;
            comprobanteUrl = "";
            checkCanApprove();
            return;
        }
    }

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
    const esCredito  = cotizacion && cotizacion.modalidadPago === "credito";
    const esEfectivo = metodoPago && metodoPago.value === "efectivo";

    // Si es abono, validar monto
    let abonoValido = true;
    if (tipoPago && tipoPago.value === "abono") {
        const monto = parseInt(montoAbonoInp.value.replace(/,/g, "")) || 0;
        abonoValido = monto > 0;
    }

    // Efectivo no requiere comprobante
    const comprobanteOk = esEfectivo ? true : !!comprobanteUrl;

    if (rechazado) {
        btnAprobar.disabled = false;
        btnAprobar.innerHTML = '<i class="bi bi-x-circle"></i> Enviar rechazo';
        btnAprobar.className = "btn-aprobar btn-rechazar-final";
    } else if (aprobado && esCredito) {
        // Credito: no requiere metodo de pago ni comprobante
        btnAprobar.disabled = false;
        btnAprobar.innerHTML = '<i class="bi bi-check-circle"></i> Aprobar cotizacion';
        btnAprobar.className = "btn-aprobar";
    } else if (aprobado && metodoPago && comprobanteOk && abonoValido) {
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
                comentarioCliente: cotComentario.value.trim(),
                fechaAprobacion: new Date().toISOString()
            });
            mostrarRechazada();
        } else {
            const esCredito = cotizacion && cotizacion.modalidadPago === "credito";

            // Recoger productos adicionales seleccionados del catálogo
            const productosAdicionales = typeof window.getCatalogoSeleccionadas === "function"
                ? window.getCatalogoSeleccionadas()
                : [];

            const comentario = cotComentario.value.trim();

            if (esCredito) {
                // Credito: aprobar sin metodo de pago ni comprobante
                await setDoc(ref, {
                    ...data,
                    estado: "aprobada",
                    modalidadPago: "credito",
                    metodoPago: "",
                    tipoPago: "",
                    montoPagado: 0,
                    comprobante: "",
                    comprobanteNombre: "",
                    productosAdicionalesCotizar: productosAdicionales,
                    comentarioCliente: comentario,
                    fechaAprobacion: new Date().toISOString()
                });
            } else {
                // Contado: requiere metodo de pago y comprobante
                const metodoPago = document.querySelector('input[name="metodoPago"]:checked').value;
                const tipoPago   = document.querySelector('input[name="tipoPago"]:checked').value;
                const total      = parseInt(data.total) || 0;
                const montoAbono = tipoPago === "abono"
                    ? (parseInt(montoAbonoInp.value.replace(/,/g, "")) || 0)
                    : total;

                // Registrar el primer pago como un abono dentro del historial de abonos.
                const primerAbono = {
                    monto: montoAbono,
                    metodo: metodoPago,
                    comprobante: comprobanteUrl,
                    comprobanteNombre: archivoComprobante ? archivoComprobante.name : "",
                    fecha: new Date().toISOString()
                };

                await setDoc(ref, {
                    ...data,
                    estado: "aprobada",
                    metodoPago: metodoPago,
                    tipoPago: tipoPago,
                    montoPagado: montoAbono,
                    comprobante: comprobanteUrl,
                    comprobanteNombre: archivoComprobante ? archivoComprobante.name : "",
                    abonos: [primerAbono],
                    productosAdicionalesCotizar: productosAdicionales,
                    comentarioCliente: comentario,
                    fechaAprobacion: new Date().toISOString()
                });

                // Actualizar objeto local para reflejar en la vista de abonos
                cotizacion = { ...data, estado: "aprobada", montoPagado: montoAbono, total, abonos: [primerAbono] };

                // Si quedo saldo pendiente, mostrar la vista de abonos (link sigue vivo)
                if (montoAbono < total) {
                    mostrarAbonos();
                    return;
                }
            }
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

// ===== VISTA DE ABONOS (saldo pendiente, link sigue vivo) =====
let abonoComprobanteUrl = "";
let abonoArchivo = null;

function getAbonos() {
    // Compatibilidad: si no hay array de abonos pero hay montoPagado, crear uno virtual
    if (Array.isArray(cotizacion.abonos) && cotizacion.abonos.length > 0) {
        return cotizacion.abonos;
    }
    const pagado = parseInt(cotizacion.montoPagado) || 0;
    if (pagado > 0) {
        return [{
            monto: pagado,
            metodo: cotizacion.metodoPago || "",
            comprobante: cotizacion.comprobante || "",
            comprobanteNombre: cotizacion.comprobanteNombre || "",
            fecha: cotizacion.fechaAprobacion || ""
        }];
    }
    return [];
}

function mostrarAbonos() {
    document.getElementById("seccionDecision").style.display = "none";
    document.getElementById("seccionAprobada").style.display = "none";
    document.getElementById("seccionPagoCompleto").style.display = "none";

    const total = parseInt(cotizacion.total) || 0;
    const abonos = getAbonos();
    const pagado = abonos.reduce((s, a) => s + (parseInt(a.monto) || 0), 0);
    const saldo = Math.max(0, total - pagado);

    // Barra de estado
    const statusBar = document.getElementById("cotStatusBar");
    statusBar.className = "cot-status-bar aprobada";
    statusBar.querySelector("i").className = "bi bi-cash-coin";
    document.getElementById("cotStatusText").textContent = saldo > 0
        ? "Aprobada · Saldo pendiente $" + formatMoney(saldo)
        : "Aprobada · Pago completo";

    // Si ya no queda saldo, mostrar mensaje de pago completo
    if (saldo <= 0) {
        document.getElementById("seccionAbonos").style.display = "none";
        document.getElementById("seccionPagoCompleto").style.display = "block";
        return;
    }

    const seccion = document.getElementById("seccionAbonos");
    seccion.style.display = "block";

    // Resumen
    document.getElementById("abonosTotal").textContent  = "$" + formatMoney(total);
    document.getElementById("abonosPagado").textContent = "$" + formatMoney(pagado);
    document.getElementById("abonosSaldo").textContent  = "$" + formatMoney(saldo);
    const pct = total > 0 ? Math.min(100, Math.round((pagado / total) * 100)) : 0;
    document.getElementById("abonosProgressBar").style.width = pct + "%";

    // Historial de abonos
    renderHistorialAbonos(abonos);

    // Preparar formulario nuevo abono
    setupNuevoAbono(saldo);
}

function renderHistorialAbonos(abonos) {
    const cont = document.getElementById("abonosHistorial");
    if (!abonos || abonos.length === 0) { cont.innerHTML = ""; return; }

    cont.innerHTML = '<h4 class="abonos-historial-titulo"><i class="bi bi-clock-history"></i> Abonos realizados</h4>';
    abonos.forEach((a, i) => {
        const fecha = a.fecha ? new Date(a.fecha).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "-";
        const metodo = a.metodo ? (a.metodo.charAt(0).toUpperCase() + a.metodo.slice(1)) : "-";
        const item = document.createElement("div");
        item.className = "abono-item";
        item.innerHTML = `
            <div class="abono-item-info">
                <span class="abono-item-num">Abono ${i + 1}</span>
                <span class="abono-item-detalle">${metodo} &bull; ${fecha}</span>
            </div>
            <span class="abono-item-monto">$${formatMoney(a.monto)}</span>
            ${a.comprobante ? `<button class="abono-item-comp" data-url="${a.comprobante}"><i class="bi bi-receipt"></i></button>` : ""}
        `;
        cont.appendChild(item);
    });

    // Ver comprobante de cada abono
    cont.querySelectorAll(".abono-item-comp").forEach(btn => {
        btn.addEventListener("click", () => {
            document.getElementById("imgModalImg").src = btn.dataset.url;
            document.getElementById("imgModal").classList.add("show");
        });
    });
}

function setupNuevoAbono(saldo) {
    // Reset estado
    abonoComprobanteUrl = "";
    abonoArchivo = null;

    const montoInput = document.getElementById("montoNuevoAbono");
    const btnRegistrar = document.getElementById("btnRegistrarAbono");
    const preview = document.getElementById("abonoPreview");
    const btnUpload = document.getElementById("uploadAbono");
    const inputFile = document.getElementById("inputAbono");

    montoInput.value = "";
    preview.innerHTML = "";
    btnUpload.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> Subir comprobante';
    btnRegistrar.disabled = true;

    // Metodo de pago
    document.querySelectorAll('input[name="metodoAbono"]').forEach(r => {
        r.onchange = () => {
            document.getElementById("abonoDatosDavivienda").style.display = r.value === "davivienda" ? "block" : "none";
            document.getElementById("abonoDatosBancolombia").style.display = r.value === "bancolombia" ? "block" : "none";
            document.getElementById("abonoDatosNequi").style.display = r.value === "nequi" ? "block" : "none";
            document.getElementById("abonoDatosEfectivo").style.display = r.value === "efectivo" ? "block" : "none";
            validarNuevoAbono(saldo);
        };
    });

    // Monto: formato miles + tope al saldo
    montoInput.oninput = () => {
        let raw = montoInput.value.replace(/[^0-9]/g, "");
        let num = parseInt(raw) || 0;
        if (num > saldo) num = saldo;
        montoInput.value = num > 0 ? num.toLocaleString("en-US") : "";
        validarNuevoAbono(saldo);
    };

    // Boton abonar saldo total
    document.getElementById("btnAbonarSaldoTotal").onclick = () => {
        montoInput.value = saldo.toLocaleString("en-US");
        validarNuevoAbono(saldo);
    };

    // Upload comprobante
    btnUpload.onclick = () => inputFile.click();
    inputFile.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const metodoSel = document.querySelector('input[name="metodoAbono"]:checked');
        if (!metodoSel) {
            mostrarAlertaComprobante("Primero selecciona el metodo de pago antes de subir el comprobante.", "Falta el metodo de pago");
            inputFile.value = "";
            return;
        }
        const entidad = metodoSel.value;
        const montoAbonoEsperado = parseInt((montoInput.value || "").replace(/,/g, "")) || 0;

        if (entidad !== "efectivo" && montoAbonoEsperado <= 0) {
            mostrarAlertaComprobante("Indica el monto del abono antes de subir el comprobante.", "Falta el monto");
            inputFile.value = "";
            return;
        }

        // ===== Verificacion inteligente del comprobante (OCR) =====
        if (entidad !== "efectivo") {
            preview.innerHTML = '<span class="comp-status">Verificando comprobante...</span>';
            btnUpload.disabled = true;
            const resultado = await validarComprobante(file, {
                entidad,
                montoEsperado: montoAbonoEsperado,
                onProgreso: (p) => {
                    preview.innerHTML = '<span class="comp-status">Verificando comprobante... ' + Math.round(p * 100) + '%</span>';
                }
            });
            if (!resultado.ok) {
                mostrarAlertaComprobante(resultado.mensaje);
                preview.innerHTML = "";
                btnUpload.disabled = false;
                inputFile.value = "";
                abonoArchivo = null;
                abonoComprobanteUrl = "";
                validarNuevoAbono(saldo);
                return;
            }
        }

        abonoArchivo = file;
        preview.innerHTML = '<span class="comp-status">Subiendo...</span>';
        btnUpload.disabled = true;
        try {
            const formData = new FormData();
            formData.append("image", file);
            const res = await fetch("https://api.imgbb.com/1/upload?key=" + IMGBB_KEY, { method: "POST", body: formData });
            const data = await res.json();
            if (data.success) {
                abonoComprobanteUrl = data.data.url;
                preview.innerHTML = `<img src="${abonoComprobanteUrl}" class="comp-thumb" alt="Comprobante" />`;
                btnUpload.innerHTML = '<i class="bi bi-arrow-repeat"></i> Cambiar';
                btnUpload.disabled = false;
                preview.querySelector(".comp-thumb").addEventListener("click", () => {
                    document.getElementById("imgModalImg").src = abonoComprobanteUrl;
                    document.getElementById("imgModal").classList.add("show");
                });
                validarNuevoAbono(saldo);
            } else {
                preview.innerHTML = '<span class="comp-status error">Error</span>';
                btnUpload.disabled = false;
                abonoArchivo = null;
            }
        } catch (err) {
            console.error(err);
            preview.innerHTML = '<span class="comp-status error">Error</span>';
            btnUpload.disabled = false;
            abonoArchivo = null;
        }
    };

    // Registrar abono
    btnRegistrar.onclick = () => registrarAbono(saldo);
}

function validarNuevoAbono(saldo) {
    const metodo = document.querySelector('input[name="metodoAbono"]:checked');
    const monto = parseInt((document.getElementById("montoNuevoAbono").value || "").replace(/,/g, "")) || 0;
    const btn = document.getElementById("btnRegistrarAbono");
    const esEfectivo = metodo && metodo.value === "efectivo";
    const comprobanteOk = esEfectivo ? true : !!abonoComprobanteUrl;
    btn.disabled = !(metodo && monto > 0 && monto <= saldo && comprobanteOk);
}

async function registrarAbono(saldo) {
    const btn = document.getElementById("btnRegistrarAbono");
    const metodo = document.querySelector('input[name="metodoAbono"]:checked').value;
    const monto = parseInt(document.getElementById("montoNuevoAbono").value.replace(/,/g, "")) || 0;
    const esEfectivo = metodo === "efectivo";
    if (monto <= 0 || monto > saldo || (!esEfectivo && !abonoComprobanteUrl)) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Registrando...';

    try {
        const ref = doc(db, "cotizaciones", cotId);
        const snap = await getDoc(ref);
        const data = snap.data();

        const abonosPrevios = Array.isArray(data.abonos) ? data.abonos : getAbonos();
        const nuevoAbono = {
            monto,
            metodo,
            comprobante: abonoComprobanteUrl,
            comprobanteNombre: abonoArchivo ? abonoArchivo.name : "",
            fecha: new Date().toISOString()
        };
        const abonos = [...abonosPrevios, nuevoAbono];
        const nuevoMontoPagado = abonos.reduce((s, a) => s + (parseInt(a.monto) || 0), 0);
        const total = parseInt(data.total) || 0;
        const completado = nuevoMontoPagado >= total;

        await setDoc(ref, {
            ...data,
            abonos,
            montoPagado: nuevoMontoPagado,
            tipoPago: completado ? "completo" : "abono",
            pagoRestanteCompletado: completado ? true : (data.pagoRestanteCompletado || false),
            ...(completado ? { pagoRestanteFecha: new Date().toISOString() } : {})
        });

        // Actualizar objeto local y re-render
        cotizacion = { ...data, abonos, montoPagado: nuevoMontoPagado, total };
        mostrarAbonos();
    } catch (err) {
        console.error(err);
        alert("Error al registrar el abono. Intenta de nuevo.");
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle"></i> Registrar abono';
    }
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
