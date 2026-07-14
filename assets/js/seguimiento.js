import { db, doc, getDoc, setDoc } from "./auth.js";
import { validarComprobante, mostrarAlertaComprobante } from "./comprobante-validador.js";

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

const PASOS_IMPRENTA = [
    { key: "recibido",    icon: "bi-inbox",         title: "Pedido recibido",     desc: "Tu orden fue recibida y confirmada" },
    { key: "diseno",      icon: "bi-brush",         title: "En diseño",           desc: "Estamos trabajando en el diseño de tu producto" },
    { key: "guillotina",  icon: "bi-scissors",      title: "Guillotina",          desc: "Tu producto esta en corte de guillotina" },
    { key: "impresion",   icon: "bi-printer",       title: "Impresión",           desc: "Tu producto esta siendo impreso" },
    { key: "troquelado",  icon: "bi-hexagon",       title: "Troquelado",          desc: "Tu producto esta en proceso de troquelado" },
    { key: "vasos",       icon: "bi-cup-straw",     title: "Vasos",               desc: "Tu producto esta en el area de vasos" },
    { key: "empaques",    icon: "bi-box-seam",      title: "Empaques",            desc: "Tu producto esta siendo empacado" },
    { key: "terminado",   icon: "bi-bag-check",     title: "Terminado",           desc: "Tu pedido esta listo para recoger" }
];

const PASOS_DIGITAL = [
    { key: "recibido",    icon: "bi-inbox",         title: "Pedido recibido",     desc: "Tu orden fue recibida y confirmada" },
    { key: "diseno",      icon: "bi-brush",         title: "En diseño",           desc: "Estamos creando el diseño digital" },
    { key: "revision",    icon: "bi-eye",           title: "Revisión",            desc: "El diseño esta en revision para aprobacion" },
    { key: "ajustes",     icon: "bi-pencil-square", title: "Ajustes",             desc: "Realizando ajustes solicitados" },
    { key: "entrega",     icon: "bi-send",          title: "Entrega",             desc: "Archivos listos para entrega" },
    { key: "terminado",   icon: "bi-bag-check",     title: "Terminado",           desc: "Tu pedido digital fue entregado" }
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

        // Si no tiene negocio, buscarlo de la cotización
        if (!orden.negocio && orden.cotizacionId) {
            try {
                const cotSnap = await getDoc(doc(db, "cotizaciones", orden.cotizacionId));
                if (cotSnap.exists()) {
                    orden.negocio = cotSnap.data().negocio || "";
                }
            } catch (e) { /* ignorar */ }
        }

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

    // Mostrar negocio si existe, si no el cliente
    const nombreDisplay = orden.negocio || orden.cliente || "-";
    document.getElementById("segCliente").textContent = nombreDisplay;

    const tipoText = orden.tipo === "digital" ? "Digital" : "Imprenta";
    document.getElementById("segTipo").textContent = tipoText;

    // Badge tipo
    const tipoEl = document.getElementById("segTipo");
    if (tipoEl) {
        tipoEl.className = "seg-tipo-badge " + (orden.tipo || "imprenta");
    }

    // Fecha pedido
    if (orden.fechaEnvio) {
        const f = new Date(orden.fechaEnvio);
        document.getElementById("segFechaPedido").textContent = f.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    }

    // Fecha entrega
    if (orden.fechaEntrega) {
        document.getElementById("segFechaEntrega").textContent = orden.fechaEntrega;
    }

    // Seleccionar pasos según tipo de orden
    const PASOS = orden.tipo === "digital" ? PASOS_DIGITAL : PASOS_IMPRENTA;

    const timeline = document.getElementById("timeline");
    timeline.innerHTML = "";

    const items = orden.items || [];
    const itemsSeg = orden.itemsSeguimiento || {};
    const hayPorProducto = items.length > 0 && Object.keys(itemsSeg).length > 0;

    // Helper: renderiza un timeline para un paso actual dado
    function renderTimeline(pasoActual, seguimiento) {
        const idxActual = PASOS.findIndex(p => p.key === pasoActual);
        const frag = document.createDocumentFragment();
        PASOS.forEach((paso, idx) => {
            let estado;
            if (idx < idxActual) estado = "completado";
            else if (idx === idxActual) estado = "activo";
            else estado = "pendiente";

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
            frag.appendChild(stepEl);
        });
        return frag;
    }

    if (hayPorProducto) {
        // Un timeline independiente por cada producto
        const estadoLabels = { recibido: "Recibido", diseno: "En diseño", guillotina: "Guillotina", impresion: "Impresión", troquelado: "Troquelado", vasos: "Vasos", empaques: "Empaques", terminado: "Terminado", revision: "Revisión", ajustes: "Ajustes", entrega: "Entrega" };
        items.forEach((item, idx) => {
            const entry = itemsSeg[idx] || {};
            const pasoItem = entry.pasoActual || orden.pasoActual || "recibido";
            const seguimientoItem = entry.seguimiento || {};

            const bloque = document.createElement("div");
            bloque.className = "producto-track";
            const nombreProd = `${item.cantidad || 1}x ${item.producto || "Producto " + (idx + 1)}`;
            bloque.innerHTML = `
                <div class="producto-track-header">
                    <span class="producto-track-nombre"><i class="bi bi-box"></i> ${nombreProd}</span>
                    <span class="producto-track-estado">${estadoLabels[pasoItem] || pasoItem}</span>
                </div>
                <div class="timeline producto-track-timeline"></div>
            `;
            timeline.appendChild(bloque);
            bloque.querySelector(".producto-track-timeline").appendChild(renderTimeline(pasoItem, seguimientoItem));
        });
    } else {
        // Timeline global (compatibilidad)
        timeline.appendChild(renderTimeline(orden.pasoActual || "recibido", orden.seguimiento || {}));
    }

    const pasoActual = orden.pasoActual || "recibido";

    // Banner terminado
    if (pasoActual === "terminado") {
        const banner = document.getElementById("terminadoBanner");
        banner.style.display = "block";
        banner.innerHTML = `
            <div class="terminado-banner">
                <i class="bi bi-check-circle-fill"></i>
                <h3>¡Tu pedido esta listo!</h3>
                <p>Selecciona como deseas recibir tu pedido.</p>
            </div>
        `;

        // Mostrar opciones de entrega
        renderEntregaOpciones(orden);

        // Verificar si tiene saldo pendiente
        renderPagoRestante(orden);
    }
}

function renderEntregaOpciones(orden) {
    const section = document.getElementById("entregaSection");

    // Si ya eligió método de entrega, mostrar confirmación
    if (orden.metodoEntrega) {
        section.style.display = "block";
        const esDomicilio = orden.metodoEntrega === "domicilio";
        section.innerHTML = `
            <div class="entrega-section">
                <div class="entrega-confirmada">
                    <i class="bi ${esDomicilio ? 'bi-geo-alt-fill' : 'bi-shop'}"></i>
                    <h3>${esDomicilio ? 'Domicilio confirmado' : 'Recoger en punto'}</h3>
                    <p>${esDomicilio ? 'Tu pedido sera enviado a la direccion proporcionada.' : 'Puedes pasar a recoger tu pedido en nuestro punto de entrega.'}</p>
                    ${esDomicilio && orden.entregaDireccion ? `<p style="margin-top:8px;font-weight:600;">📍 ${orden.entregaDireccion}</p>` : ''}
                    ${esDomicilio && orden.entregaUbicacionUrl ? `<div class="mapa-preview" style="margin-top:12px;"><a href="${orden.entregaUbicacionUrl}" target="_blank" style="color:#fff;text-decoration:underline;font-size:12px;">Ver en Google Maps</a></div>` : ''}
                </div>
            </div>
        `;
        return;
    }

    section.style.display = "block";
    section.innerHTML = `
        <div class="entrega-section">
            <div class="entrega-card">
                <h3><i class="bi bi-box2-heart"></i> ¿Como deseas recibir tu pedido?</h3>
                <p>Selecciona si prefieres recogerlo en nuestro punto o recibirlo a domicilio.</p>

                <div class="entrega-opciones">
                    <div class="entrega-opcion" data-metodo="recoger">
                        <i class="bi bi-shop"></i>
                        <div class="opcion-titulo">Recoger en punto</div>
                        <div class="opcion-desc">Paso por el directamente</div>
                    </div>
                    <div class="entrega-opcion" data-metodo="domicilio">
                        <i class="bi bi-geo-alt"></i>
                        <div class="opcion-titulo">Domicilio</div>
                        <div class="opcion-desc">Enviar a mi direccion</div>
                    </div>
                </div>

                <div class="entrega-ubicacion" id="entregaUbicacion">
                    <label>Direccion de entrega</label>
                    <input type="text" id="entregaDireccion" placeholder="Escribe tu direccion completa...">
                    <button class="btn-ubicacion" id="btnCompartirUbicacion">
                        <i class="bi bi-geo-alt-fill"></i> Compartir mi ubicacion actual
                    </button>
                    <div id="mapaPreview" style="margin-top:10px;"></div>
                </div>

                <button class="btn-confirmar-entrega" id="btnConfirmarEntrega" disabled>
                    <i class="bi bi-check-circle"></i> Confirmar metodo de entrega
                </button>
            </div>
        </div>
    `;

    setupEntregaOpciones(orden);
}

function setupEntregaOpciones(orden) {
    let metodoSeleccionado = "";
    let ubicacionLat = null;
    let ubicacionLng = null;
    let ubicacionUrl = "";

    const opciones = document.querySelectorAll(".entrega-opcion");
    const ubicacionSection = document.getElementById("entregaUbicacion");
    const btnConfirmar = document.getElementById("btnConfirmarEntrega");

    opciones.forEach(op => {
        op.addEventListener("click", () => {
            opciones.forEach(o => o.classList.remove("selected"));
            op.classList.add("selected");
            metodoSeleccionado = op.dataset.metodo;

            if (metodoSeleccionado === "domicilio") {
                ubicacionSection.classList.add("visible");
            } else {
                ubicacionSection.classList.remove("visible");
            }
            validarEntrega();
        });
    });

    // Compartir ubicación
    const btnUbicacion = document.getElementById("btnCompartirUbicacion");
    btnUbicacion.addEventListener("click", () => {
        if (!navigator.geolocation) {
            alert("Tu navegador no soporta geolocalizacion.");
            return;
        }
        btnUbicacion.disabled = true;
        btnUbicacion.innerHTML = '<span class="spinner-seg"></span> Obteniendo ubicacion...';

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                ubicacionLat = pos.coords.latitude;
                ubicacionLng = pos.coords.longitude;
                ubicacionUrl = `https://www.google.com/maps?q=${ubicacionLat},${ubicacionLng}`;

                btnUbicacion.innerHTML = '<i class="bi bi-check-circle"></i> Ubicacion obtenida';
                btnUbicacion.style.background = "#16a34a";

                // Mostrar preview del mapa
                const preview = document.getElementById("mapaPreview");
                preview.innerHTML = `
                    <div class="mapa-preview">
                        <iframe src="https://maps.google.com/maps?q=${ubicacionLat},${ubicacionLng}&z=16&output=embed"></iframe>
                    </div>
                    <p style="font-size:11px;color:#666;margin-top:6px;">📍 Lat: ${ubicacionLat.toFixed(6)}, Lng: ${ubicacionLng.toFixed(6)}</p>
                `;

                // Auto-fill dirección si está vacía
                const inputDireccion = document.getElementById("entregaDireccion");
                if (!inputDireccion.value) {
                    inputDireccion.value = `Lat: ${ubicacionLat.toFixed(6)}, Lng: ${ubicacionLng.toFixed(6)}`;
                }

                validarEntrega();
            },
            (err) => {
                console.error(err);
                btnUbicacion.disabled = false;
                btnUbicacion.innerHTML = '<i class="bi bi-geo-alt-fill"></i> Compartir mi ubicacion actual';
                alert("No se pudo obtener tu ubicacion. Asegurate de permitir el acceso a la ubicacion.");
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });

    // Validar
    function validarEntrega() {
        if (metodoSeleccionado === "recoger") {
            btnConfirmar.disabled = false;
        } else if (metodoSeleccionado === "domicilio") {
            const direccion = document.getElementById("entregaDireccion").value.trim();
            btnConfirmar.disabled = !direccion;
        } else {
            btnConfirmar.disabled = true;
        }
    }

    // Input dirección valida en tiempo real
    const inputDireccion = document.getElementById("entregaDireccion");
    inputDireccion.addEventListener("input", validarEntrega);

    // Confirmar
    btnConfirmar.addEventListener("click", async () => {
        btnConfirmar.disabled = true;
        btnConfirmar.innerHTML = '<span class="spinner-seg"></span> Guardando...';

        try {
            const ref = doc(db, "produccion", orden.id);
            const snap = await getDoc(ref);
            const data = snap.data();

            const entregaData = {
                metodoEntrega: metodoSeleccionado,
                entregaFecha: new Date().toISOString()
            };

            if (metodoSeleccionado === "domicilio") {
                entregaData.entregaDireccion = document.getElementById("entregaDireccion").value.trim();
                if (ubicacionLat && ubicacionLng) {
                    entregaData.entregaLat = ubicacionLat;
                    entregaData.entregaLng = ubicacionLng;
                    entregaData.entregaUbicacionUrl = ubicacionUrl;
                }
            }

            await setDoc(ref, { ...data, ...entregaData });

            // Mostrar confirmación
            const section = document.getElementById("entregaSection");
            const esDomicilio = metodoSeleccionado === "domicilio";
            section.innerHTML = `
                <div class="entrega-section">
                    <div class="entrega-confirmada">
                        <i class="bi ${esDomicilio ? 'bi-geo-alt-fill' : 'bi-shop'}"></i>
                        <h3>${esDomicilio ? '¡Domicilio confirmado!' : '¡Recoger en punto confirmado!'}</h3>
                        <p>${esDomicilio ? 'Tu pedido sera enviado a la direccion proporcionada.' : 'Ya puedes pasar a recoger tu pedido en nuestro punto.'}</p>
                        ${esDomicilio && entregaData.entregaDireccion ? `<p style="margin-top:8px;font-weight:600;">📍 ${entregaData.entregaDireccion}</p>` : ''}
                    </div>
                </div>
            `;
        } catch (err) {
            console.error(err);
            alert("Error al guardar. Intenta de nuevo.");
            btnConfirmar.disabled = false;
            btnConfirmar.innerHTML = '<i class="bi bi-check-circle"></i> Confirmar metodo de entrega';
        }
    });
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

        if (!metodoSeleccionado) {
            mostrarAlertaComprobante("Primero selecciona el metodo de pago antes de subir el comprobante.", "Falta el metodo de pago");
            inputFile.value = "";
            return;
        }

        // ===== Verificacion inteligente del comprobante (OCR) =====
        btnUpload.disabled = true;
        btnUpload.innerHTML = '<span class="spinner-seg"></span> Verificando...';
        const resultado = await validarComprobante(file, {
            entidad: metodoSeleccionado,
            montoEsperado: saldoRestante,
            onProgreso: (p) => {
                btnUpload.innerHTML = '<span class="spinner-seg"></span> Verificando... ' + Math.round(p * 100) + '%';
            }
        });
        if (!resultado.ok) {
            mostrarAlertaComprobante(resultado.mensaje);
            btnUpload.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> Subir comprobante';
            btnUpload.disabled = false;
            inputFile.value = "";
            comprobanteRestanteUrl = "";
            validarPagoRestante();
            return;
        }

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

            const fechaPagoRestante = new Date().toISOString();
            const nuevoMontoPagado = (parseInt(data.montoPagado) || 0) + saldoRestante;

            await setDoc(ref, {
                ...data,
                pagoRestanteCompletado: true,
                pagoRestanteMetodo: metodoSeleccionado,
                pagoRestanteComprobante: comprobanteRestanteUrl,
                pagoRestanteFecha: fechaPagoRestante,
                pagoRestanteMonto: saldoRestante,
                montoPagado: nuevoMontoPagado
            });

            // Actualizar tambien la cotizacion para que finanzas refleje el pago completado
            const cotizacionId = data.cotizacionId;
            if (cotizacionId) {
                try {
                    const cotRef = doc(db, "cotizaciones", cotizacionId);
                    const cotSnap = await getDoc(cotRef);
                    if (cotSnap.exists()) {
                        const cotData = cotSnap.data();
                        const totalCot = parseInt(cotData.total) || 0;
                        await setDoc(cotRef, {
                            ...cotData,
                            montoPagado: totalCot,
                            pagoRestanteCompletado: true,
                            pagoRestanteMetodo: metodoSeleccionado,
                            pagoRestanteComprobante: comprobanteRestanteUrl,
                            pagoRestanteFecha: fechaPagoRestante,
                            pagoRestanteMonto: saldoRestante
                        });
                    }
                } catch (errCot) {
                    console.warn("No se pudo actualizar la cotizacion:", errCot);
                }
            }

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
