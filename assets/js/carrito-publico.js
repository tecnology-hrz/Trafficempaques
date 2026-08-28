/* =======================================================
   carrito.html - solicitud de cotizacion
   Dos caminos de salida:
     1) WhatsApp: abre el chat con el detalle del carrito.
     2) Generar cotizacion: pide los datos del cliente y registra la
        cotizacion en Firestore (coleccion "cotizaciones"), la misma que
        lee el panel interno, y avisa al cliente por correo.
   ======================================================= */

import { initLayout } from "./tienda-layout.js";
import {
    getCarrito, actualizarCantidad, quitarDelCarrito, vaciarCarrito,
    formatMedidas, escapeHtml, toast, whatsappLink, initZoom, EMPRESA,
    getCatalogo, buscarPorSku, getWhatsappNumero,
    tienePrecio, precioUnitario, precioUnitarioBase, formatCOP
} from "./tienda-core.js";
import { crearCotizacion } from "./cotizador.js";
import { EMAILJS_CONFIG } from "../../config/emailjs-config.js";

initLayout("");
const abrirZoom = initZoom();

const layout     = document.getElementById("carritoLayout");
const vacio      = document.getElementById("carritoVacio");
const lista      = document.getElementById("cartList");
const refsEl     = document.getElementById("resumenRefs");
const unidadesEl = document.getElementById("resumenUnidades");
const totalEl    = document.getElementById("resumenTotal");
const totalRow   = document.getElementById("resumenTotalRow");
const notaEl     = document.getElementById("resumenNota");

// Catalogo vigente, para refrescar precios de items guardados hace tiempo
let catalogo = [];
let whatsappNum = EMPRESA.whatsapp;

if (window.emailjs && EMAILJS_CONFIG.publicKey) {
    window.emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
}

(async function init() {
    try {
        catalogo = await getCatalogo();
    } catch (err) {
        console.warn("[carrito] no se pudo cargar el catalogo para precios", err);
    }
    try {
        whatsappNum = await getWhatsappNumero();
    } catch { /* se queda el numero por defecto */ }
    render();
})();

document.addEventListener("carrito:cambio", render);

/* -------------------------------------------------------
   PRECIOS DEL CARRITO
   El item guardado en localStorage puede estar desactualizado, asi que el
   precio se toma del catalogo vigente usando el sku y solo se cae al valor
   guardado si la referencia ya no existe.
   ------------------------------------------------------- */
function resolverItem(item) {
    const actual = buscarPorSku(catalogo, item.sku);
    const fuente = actual || item;
    const cantidad = Math.max(1, parseInt(item.cantidad) || 1);
    const conPrecio = tienePrecio(fuente);
    const unit = conPrecio ? precioUnitario(fuente, cantidad) : 0;
    const unitBase = conPrecio ? precioUnitarioBase(fuente, cantidad) : 0;
    return {
        ...item,
        cantidad,
        conPrecio,
        precioUnit: unit,
        precioUnitBase: unitBase,
        precioTotal: unit * cantidad,
        descuento: Boolean(fuente.descuento),
        descuentoPct: Number(fuente.descuentoPct) || 0
    };
}

function itemsResueltos() {
    return getCarrito().map(resolverItem);
}

function totalesCarrito(items) {
    return {
        refs: items.length,
        unidades: items.reduce((a, i) => a + i.cantidad, 0),
        total: items.reduce((a, i) => a + i.precioTotal, 0),
        sinPrecio: items.filter(i => !i.conPrecio).length
    };
}

/* -------------------------------------------------------
   RENDER
   ------------------------------------------------------- */
function render() {
    const items = itemsResueltos();

    if (!items.length) {
        layout.style.display = "none";
        vacio.style.display = "";
        return;
    }

    vacio.style.display = "none";
    layout.style.display = "";

    lista.innerHTML = items.map(i => {
        const precioHtml = i.conPrecio
            ? `<div class="cart-item__price">
                   ${i.precioUnitBase > i.precioUnit
                       ? `<span class="cart-item__price-old">${formatCOP(i.precioUnitBase)}</span>` : ""}
                   <span class="cart-item__price-unit">${formatCOP(i.precioUnit)} c/u</span>
                   <strong class="cart-item__price-total">${formatCOP(i.precioTotal)}</strong>
               </div>`
            : `<div class="cart-item__price cart-item__price--sin">Precio a cotizar</div>`;

        return `
        <article class="cart-item" data-sku="${escapeHtml(i.sku)}">
            <div class="cart-item__img">
                <img src="${escapeHtml(i.imagen)}" alt="${escapeHtml(i.nombre)}" loading="lazy" data-zoom>
            </div>
            <div>
                <span class="cart-item__cat">${escapeHtml(i.categoria)}</span>
                <h2 class="cart-item__name">
                    <a href="producto.html?sku=${encodeURIComponent(i.sku)}">${escapeHtml(i.nombre)}</a>
                </h2>
                <p class="cart-item__dims">${escapeHtml(formatMedidas(i))}</p>
                ${i.descuento && i.descuentoPct
                    ? `<span class="cart-item__off"><i class="bi bi-tag-fill"></i> ${i.descuentoPct}% OFF</span>`
                    : ""}
                ${precioHtml}
            </div>
            <div class="cart-item__side">
                <div class="qty-input">
                    <button type="button" data-menos aria-label="Disminuir cantidad"><i class="bi bi-dash"></i></button>
                    <input type="number" value="${i.cantidad}" min="1" data-cant
                           aria-label="Cantidad de ${escapeHtml(i.nombre)}">
                    <button type="button" data-mas aria-label="Aumentar cantidad"><i class="bi bi-plus"></i></button>
                </div>
                <button class="cart-item__remove" type="button" data-quitar
                        aria-label="Quitar ${escapeHtml(i.nombre)}">
                    <i class="bi bi-trash3"></i>
                </button>
            </div>
        </article>`;
    }).join("");

    const t = totalesCarrito(items);
    refsEl.textContent = t.refs;
    unidadesEl.textContent = t.unidades.toLocaleString("es-CO");
    totalEl.textContent = formatCOP(t.total);
    totalRow.style.display = t.total > 0 ? "" : "none";

    notaEl.textContent = t.sinPrecio > 0
        ? `${t.sinPrecio} referencia(s) se cotizan a medida, por eso no suman al subtotal. El valor final se confirma segun material y numero de tintas.`
        : "Subtotal estimado con los precios publicados. El valor final se confirma segun material y numero de tintas.";

    lista.querySelectorAll(".cart-item").forEach(card => {
        const sku = card.dataset.sku;
        const input = card.querySelector("[data-cant]");

        card.querySelector("[data-mas]").addEventListener("click", () =>
            actualizarCantidad(sku, (parseInt(input.value) || 0) + 1));

        card.querySelector("[data-menos]").addEventListener("click", () =>
            actualizarCantidad(sku, (parseInt(input.value) || 0) - 1));

        input.addEventListener("change", () =>
            actualizarCantidad(sku, parseInt(input.value) || 1));

        card.querySelector("[data-quitar]").addEventListener("click", () => {
            quitarDelCarrito(sku);
            toast("Referencia retirada");
        });

        card.querySelector("[data-zoom]").addEventListener("click", e =>
            abrirZoom(e.target.src, e.target.alt));
    });
}

document.getElementById("btnVaciar").addEventListener("click", () => {
    if (!confirm("Seguro que quieres vaciar tu cotizacion?")) return;
    vaciarCarrito();
    toast("Cotizacion vaciada");
});

/* -------------------------------------------------------
   CAMINO 1: WHATSAPP
   ------------------------------------------------------- */
document.getElementById("btnWhatsapp").addEventListener("click", () => {
    const items = itemsResueltos();
    if (!items.length) return;
    const t = totalesCarrito(items);

    const detalle = items.map((i, n) => {
        const off = i.descuento && i.descuentoPct ? ` [${i.descuentoPct}% OFF]` : "";
        const val = i.conPrecio
            ? ` - ${formatCOP(i.precioUnit)} c/u = ${formatCOP(i.precioTotal)}`
            : " - a cotizar";
        return `${n + 1}. ${i.nombre} (${i.categoria}) - ${i.cantidad} und.${val}${off}`;
    }).join("\n");

    const mensaje =
        `*Solicitud de cotizacion - ${EMPRESA.nombre}*\n\n` +
        `*Referencias:*\n${detalle}\n` +
        (t.total > 0 ? `\n*Subtotal estimado:* ${formatCOP(t.total)}\n` : "") +
        `*Unidades totales:* ${t.unidades}\n` +
        `\nEnviado desde la web.`;

    window.open(whatsappLink(mensaje, whatsappNum), "_blank", "noopener");
});

/* -------------------------------------------------------
   CAMINO 2: GENERAR COTIZACION REGISTRADA
   ------------------------------------------------------- */
const cotModal   = document.getElementById("cotModal");
const cotForm    = document.getElementById("formCotizacion");
const cotOk      = document.getElementById("cotModalOk");
const cotError   = document.getElementById("cotModalError");
const cotEnviar  = document.getElementById("cotModalEnviar");

let tipoPersona = "natural";

function abrirCotModal() {
    const items = itemsResueltos();
    if (!items.length) {
        toast("Agrega referencias antes de cotizar", "error");
        return;
    }

    const t = totalesCarrito(items);
    document.getElementById("cotModalResumen").innerHTML = `
        <div class="cot-modal__resumen-row">
            <span>${t.refs} referencia(s) · ${t.unidades.toLocaleString("es-CO")} unidades</span>
            ${t.total > 0 ? `<strong>${formatCOP(t.total)}</strong>` : `<strong>A cotizar</strong>`}
        </div>`;

    cotForm.hidden = false;
    cotOk.hidden = true;
    cotError.hidden = true;
    cotModal.classList.add("is-open");
    document.body.style.overflow = "hidden";
    document.getElementById("cotNombre").focus();
}

function cerrarCotModal() {
    cotModal.classList.remove("is-open");
    document.body.style.overflow = "";
}

document.getElementById("btnGenerarCotizacion").addEventListener("click", abrirCotModal);
document.getElementById("cotModalClose").addEventListener("click", cerrarCotModal);
cotModal.addEventListener("click", e => { if (e.target === cotModal) cerrarCotModal(); });
document.addEventListener("keydown", e => {
    if (e.key === "Escape" && cotModal.classList.contains("is-open")) cerrarCotModal();
});

// Persona natural vs empresa: cambia la etiqueta y el documento sugerido
document.querySelectorAll("#cotTipoPersona .cot-tipo-opt").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#cotTipoPersona .cot-tipo-opt")
            .forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        tipoPersona = btn.dataset.tipo;

        const esEmpresa = tipoPersona === "juridica";
        document.getElementById("cotNombreLabel").textContent =
            esEmpresa ? "Razon social *" : "Nombre completo *";
        document.getElementById("cotTipoDoc").value = esEmpresa ? "NIT" : "CC";
    });
});

function mostrarError(msg) {
    cotError.textContent = msg;
    cotError.hidden = false;
    cotError.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

cotForm.addEventListener("submit", async e => {
    e.preventDefault();
    cotError.hidden = true;

    const items = itemsResueltos();
    if (!items.length) {
        mostrarError("Tu cotizacion esta vacia.");
        return;
    }

    const nombre    = document.getElementById("cotNombre").value.trim();
    const tipoDoc   = document.getElementById("cotTipoDoc").value;
    const documento = document.getElementById("cotDocumento").value.trim();
    const negocio   = document.getElementById("cotNegocio").value.trim();
    const telefono  = document.getElementById("cotTelefono").value.trim();
    const correo    = document.getElementById("cotCorreo").value.trim();
    const ciudad    = document.getElementById("cotCiudad").value.trim();
    const direccion = document.getElementById("cotDireccion").value.trim();
    const notas     = document.getElementById("cotNotas").value.trim();

    if (!nombre)    return mostrarError("Escribe tu nombre o razon social.");
    if (!documento) return mostrarError("Escribe tu numero de documento.");
    if (!telefono)  return mostrarError("Escribe un telefono de contacto.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        return mostrarError("Escribe un correo valido, ahi te enviamos la cotizacion.");
    }
    if (!ciudad) return mostrarError("Escribe tu ciudad.");

    cotEnviar.disabled = true;
    cotEnviar.innerHTML = '<i class="bi bi-hourglass-split"></i> Registrando...';

    try {
        // Items con la forma que espera el panel interno y el PDF
        const itemsCot = items.map(i => ({
            tipo: "imprenta",
            producto: i.nombre,
            descripcion: `${i.categoria} · ${formatMedidas(i)}`,
            cantidad: i.cantidad,
            terminados: [],
            colores: [],
            materiales: [],
            planchas: [],
            precioUnit: i.precioUnit,
            precioTotal: i.precioTotal
        }));

        const subtotal = itemsCot.reduce((s, i) => s + i.precioTotal, 0);

        const resultado = await crearCotizacion({
            cliente: nombre,
            tipoPersona,
            // El panel muestra este campo como "NIT / Cedula"
            nit: `${tipoDoc} ${documento}`,
            negocio,
            telefono,
            direccion,
            ciudad,
            tipo: "imprenta",
            modalidadPago: "contado",
            items: itemsCot,
            subtotal,
            aplicarIva: false,
            iva: 0,
            total: subtotal,
            notas: [
                notas,
                `Correo del cliente: ${correo}`,
                "Cotizacion generada por el cliente desde la web."
            ].filter(Boolean).join(" | "),
            fechaActual: new Date().toISOString().slice(0, 10),
            fechaEntrega: "",
            creadoPor: "Cotizador web",
            creadoPorEmail: correo,
            origen: "web"
        });

        const link = new URL(`cotizacion.html?id=${resultado.id}`, window.location.href).href;

        // Aviso por correo. Si falla, la cotizacion ya quedo registrada.
        let correoEnviado = false;
        try {
            await enviarCorreoCotizacion({
                correo, nombre, numero: resultado.numero,
                items, subtotal, link, telefono
            });
            correoEnviado = true;
        } catch (err) {
            console.warn("[carrito] no se pudo enviar el correo de la cotizacion", err);
        }

        // Confirmacion
        document.getElementById("cotOkNumero").textContent = resultado.numero;
        document.getElementById("cotOkCorreo").textContent = correoEnviado
            ? `Te enviamos el detalle a ${correo}.`
            : `Guarda este link: no pudimos enviar el correo a ${correo}.`;
        document.getElementById("cotOkLink").href = link;
        document.getElementById("cotOkWa").href = whatsappLink(
            `Hola, acabo de generar la cotizacion ${resultado.numero} desde la web ` +
            `a nombre de ${nombre}. Quedo atento.`,
            whatsappNum
        );

        cotForm.hidden = true;
        cotOk.hidden = false;

        vaciarCarrito();
        toast(`Cotizacion ${resultado.numero} registrada`);
    } catch (err) {
        console.error("[carrito] error registrando la cotizacion", err);
        mostrarError("No pudimos registrar la cotizacion. Intenta de nuevo o escribenos por WhatsApp.");
    } finally {
        cotEnviar.disabled = false;
        cotEnviar.innerHTML = '<i class="bi bi-send"></i> Enviar cotizacion';
    }
});

/* -------------------------------------------------------
   CORREO AL CLIENTE (EmailJS, plantilla generica existente)
   ------------------------------------------------------- */
async function enviarCorreoCotizacion({ correo, nombre, numero, items, subtotal, link, telefono }) {
    if (!window.emailjs) throw new Error("EmailJS no disponible");

    const filasTexto = items.map((i, n) =>
        `${n + 1}. ${i.nombre} - ${i.cantidad} und. ` +
        (i.conPrecio ? `- ${formatCOP(i.precioUnit)} c/u = ${formatCOP(i.precioTotal)}` : "- a cotizar")
    ).join("\n");

    const filasHtml = items.map(i => `
        <tr>
            <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(i.nombre)}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.cantidad}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">
                ${i.conPrecio ? formatCOP(i.precioUnit) : "A cotizar"}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">
                ${i.conPrecio ? formatCOP(i.precioTotal) : "-"}</td>
        </tr>`).join("");

    const cuerpoTexto = [
        `Hola ${nombre},`,
        "",
        `Recibimos tu solicitud y registramos la cotizacion ${numero}.`,
        "",
        "Detalle:",
        filasTexto,
        "",
        subtotal > 0 ? `Subtotal estimado: ${formatCOP(subtotal)}` : "Subtotal: a confirmar",
        "",
        `Puedes verla y aprobarla aqui: ${link}`,
        "",
        "El valor final se confirma segun material y numero de tintas.",
        "",
        "Gracias,",
        EMPRESA.nombre
    ].join("\n");

    const cuerpoHtml = `
        <div style="font-family:Arial,sans-serif;color:#222;max-width:600px">
            <h2 style="color:#29ABE2;margin-bottom:4px">Cotizacion ${escapeHtml(numero)}</h2>
            <p>Hola ${escapeHtml(nombre)}, recibimos tu solicitud desde la web. Este es el detalle:</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
                <thead>
                    <tr style="background:#f4f6f8">
                        <th style="padding:8px;text-align:left">Producto</th>
                        <th style="padding:8px;text-align:center">Cant.</th>
                        <th style="padding:8px;text-align:right">Unitario</th>
                        <th style="padding:8px;text-align:right">Total</th>
                    </tr>
                </thead>
                <tbody>${filasHtml}</tbody>
            </table>
            <p style="font-size:16px;margin-top:16px">
                <strong>Subtotal estimado: ${subtotal > 0 ? formatCOP(subtotal) : "a confirmar"}</strong>
            </p>
            <p style="margin:24px 0">
                <a href="${link}" style="background:#29ABE2;color:#fff;padding:12px 22px;
                   border-radius:8px;text-decoration:none;font-weight:bold">Ver y aprobar cotizacion</a>
            </p>
            <p style="color:#777;font-size:13px">
                El valor final se confirma segun material y numero de tintas.<br>
                ${escapeHtml(EMPRESA.nombre)} - Empaques y Publicidad
            </p>
        </div>`;

    return window.emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
        to_email: correo,
        subject: `Tu cotizacion ${numero} - ${EMPRESA.nombre}`,
        from_name: EMPRESA.nombre,
        orden: numero,
        cliente: nombre,
        producto: `${items.length} referencia(s)`,
        colores: "-",
        tipo_plancha: "-",
        disenador: "-",
        observaciones: telefono ? `Telefono: ${telefono}` : "-",
        documento_url: link,
        documento_nombre: `Cotizacion ${numero}`,
        documento_preview: "",
        message: cuerpoTexto,
        message_html: cuerpoHtml
    });
}
