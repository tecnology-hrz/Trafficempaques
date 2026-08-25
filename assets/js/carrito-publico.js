/* =======================================================
   carrito.html - solicitud de cotizacion
   ======================================================= */

import { initLayout } from "./tienda-layout.js";
import {
    getCarrito, actualizarCantidad, quitarDelCarrito, vaciarCarrito,
    formatMedidas, escapeHtml, toast, whatsappLink, initZoom, EMPRESA
} from "./tienda-core.js";

initLayout("");
const abrirZoom = initZoom();

const layout    = document.getElementById("carritoLayout");
const vacio     = document.getElementById("carritoVacio");
const lista     = document.getElementById("cartList");
const refsEl    = document.getElementById("resumenRefs");
const unidadesEl = document.getElementById("resumenUnidades");
const form      = document.getElementById("formCotizacion");

render();
document.addEventListener("carrito:cambio", render);

document.getElementById("btnVaciar").addEventListener("click", () => {
    if (!confirm("Seguro que quieres vaciar tu cotizacion?")) return;
    vaciarCarrito();
    toast("Cotizacion vaciada");
});

form.addEventListener("submit", e => {
    e.preventDefault();

    const items = getCarrito();
    if (!items.length) return;

    const nombre   = document.getElementById("clienteNombre").value.trim();
    const telefono = document.getElementById("clienteTelefono").value.trim();
    const correo   = document.getElementById("clienteCorreo").value.trim();
    const notas    = document.getElementById("clienteNotas").value.trim();

    if (!nombre || !telefono) {
        toast("Completa nombre y telefono para continuar", "error");
        return;
    }

    // El descuento viaja en el mensaje para que el asesor lo tenga presente
    const detalle = items.map((i, n) => {
        const off = i.descuento && i.descuentoPct ? ` [${i.descuentoPct}% OFF]` : "";
        return `${n + 1}. ${i.nombre} (${i.categoria}) - ${i.cantidad} und.${off}`;
    }).join("\n");

    const mensaje =
        `*Solicitud de cotizacion - ${EMPRESA.nombre}*\n\n` +
        `Cliente: ${nombre}\n` +
        `Telefono: ${telefono}\n` +
        (correo ? `Correo: ${correo}\n` : "") +
        `\n*Referencias:*\n${detalle}\n` +
        (notas ? `\n*Notas:* ${notas}\n` : "") +
        `\nEnviado desde la web.`;

    window.open(whatsappLink(mensaje), "_blank", "noopener");
});

function render() {
    const items = getCarrito();

    if (!items.length) {
        layout.style.display = "none";
        vacio.style.display = "";
        return;
    }

    vacio.style.display = "none";
    layout.style.display = "";

    lista.innerHTML = items.map(i => `
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
            </div>
            <div class="cart-item__side">
                <div class="qty-input">
                    <button type="button" data-menos aria-label="Disminuir cantidad"><i class="bi bi-dash"></i></button>
                    <input type="number" value="${parseInt(i.cantidad) || 1}" min="1" data-cant
                           aria-label="Cantidad de ${escapeHtml(i.nombre)}">
                    <button type="button" data-mas aria-label="Aumentar cantidad"><i class="bi bi-plus"></i></button>
                </div>
                <button class="cart-item__remove" type="button" data-quitar
                        aria-label="Quitar ${escapeHtml(i.nombre)}">
                    <i class="bi bi-trash3"></i>
                </button>
            </div>
        </article>`).join("");

    refsEl.textContent = items.length;
    unidadesEl.textContent = items.reduce((a, i) => a + (parseInt(i.cantidad) || 0), 0);

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
