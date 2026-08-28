/* =======================================================
   producto.html - detalle de referencia + agregar al carrito
   ======================================================= */

import { initLayout } from "./tienda-layout.js";
import {
    getCatalogo, buscarPorSku, getCategoriaInfo, formatMedidas,
    escapeHtml, slug, initZoom, agregarAlCarrito, toast, whatsappLink,
    tienePrecio, precioUnitario, precioUnitarioBase, formatCOP, textoEscala
} from "./tienda-core.js";
import { renderProductGrid } from "./tienda-cards.js";

initLayout("productos");
const abrirZoom = initZoom();

const cont = document.getElementById("detalleContenido");
const relSection = document.getElementById("relacionadosSection");
const relGrid = document.getElementById("relacionadosGrid");

const sku = new URLSearchParams(location.search).get("sku");

(async function main() {
    let productos = [];
    try {
        productos = await getCatalogo();
    } catch (err) {
        console.error("[producto] error cargando catalogo", err);
    }

    const p = sku ? buscarPorSku(productos, sku) : null;

    if (!p) {
        cont.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-box-seam"></i>
                <h2 style="color:var(--ink);margin-bottom:8px">No encontramos esta referencia</h2>
                <p style="margin-bottom:22px">Puede que haya cambiado de nombre o ya no este disponible.</p>
                <a class="btn btn--primary" href="catalogo.html">Ver catalogo</a>
            </div>`;
        return;
    }

    document.title = `${p.nombre} | Traffic Empaques`;
    render(p);

    const relacionados = productos
        .filter(x => x.categoria === p.categoria && x.sku !== p.sku)
        .slice(0, 4);

    if (relacionados.length) {
        relSection.style.display = "";
        renderProductGrid(relGrid, relacionados, abrirZoom);
    }
})();

function render(p) {
    const info = getCategoriaInfo(p.categoria);
    const notaOferta = p.descuento && p.descuentoPct
        ? ` Vi que tiene ${p.descuentoPct}% de descuento.`
        : "";
    const mensajeWa = `Hola, me interesa la referencia "${p.nombre}" (${p.categoria}).` +
                      ` Quisiera cotizarla personalizada.${notaOferta}`;

    cont.innerHTML = `
    <nav class="breadcrumb" aria-label="Ruta de navegacion">
        <a href="index.html">Inicio</a><span>/</span>
        <a href="productos.html">Productos</a><span>/</span>
        <a href="catalogo.html">Todos los empaques</a><span>/</span>
        <a href="catalogo.html?cat=${encodeURIComponent(slug(p.categoria))}">${escapeHtml(p.categoria)}</a><span>/</span>
        <span>${escapeHtml(p.nombre)}</span>
    </nav>

    <div class="detail-layout">
        <div class="detail-gallery">
            <div class="detail-gallery__main">
                <img id="imgPrincipal" src="${escapeHtml(p.imagen)}" alt="${escapeHtml(p.nombre)}">
                <button class="detail-gallery__zoom" type="button" id="btnZoom" aria-label="Ampliar imagen">
                    <i class="bi bi-search"></i>
                </button>
            </div>
            <div class="detail-gallery__thumbs">
                <button class="detail-thumb is-active" type="button" aria-label="Vista del producto">
                    <img src="${escapeHtml(p.imagen)}" alt="${escapeHtml(p.nombre)}">
                </button>
            </div>
        </div>

        <div class="detail-info">
            ${p.descuento && p.descuentoPct
                ? `<span class="detail-off"><i class="bi bi-tag-fill"></i> ${p.descuentoPct}% de descuento</span>`
                : ""}
            <h1 class="detail-title">${escapeHtml(p.nombre)}</h1>
            <div class="detail-rule"></div>
            <p class="detail-text">
                ${escapeHtml(info.descripcion)}. Se fabrica personalizado con el diseño de tu marca:
                impresion a una o varias tintas, material apto para contacto con alimentos y
                acabado resistente para domicilio.
            </p>

            <ul class="detail-specs">
                <li><strong>Categoria</strong><span>${escapeHtml(p.categoria)}</span></li>
                <li><strong>Medidas</strong><span>${escapeHtml(formatMedidas(p))}</span></li>
                <li><strong>Alto</strong><span>${escapeHtml(p.alto)}</span></li>
                <li><strong>Largo</strong><span>${escapeHtml(p.largo)}</span></li>
                <li><strong>Ancho</strong><span>${escapeHtml(p.ancho)}</span></li>
                <li><strong>Personalizacion</strong><span>Logo y diseño de tu marca</span></li>
                ${info.usos ? `<li><strong>Ideal para</strong><span>${escapeHtml(info.usos)}</span></li>` : ""}
            </ul>

            <div class="detail-price" id="detallePrecio"></div>

            <div class="qty-row">
                <span class="qty-label">Cantidad</span>
                <div class="qty-input">
                    <button type="button" id="btnMenos" aria-label="Disminuir cantidad"><i class="bi bi-dash"></i></button>
                    <input type="number" id="inputCantidad" value="100" min="1" step="1" aria-label="Cantidad de unidades">
                    <button type="button" id="btnMas" aria-label="Aumentar cantidad"><i class="bi bi-plus"></i></button>
                </div>
                <span style="color:var(--gray-500);font-size:.84rem">unidades</span>
            </div>

            <div class="detail-actions">
                <button class="btn btn--primary btn--lg" type="button" id="btnAgregar">
                    <i class="bi bi-cart-plus"></i> Agregar a la cotizacion
                </button>
                <a class="btn btn--outline btn--lg" href="${whatsappLink(mensajeWa)}" target="_blank" rel="noopener">
                    <i class="bi bi-whatsapp"></i> Consultar
                </a>
            </div>

            <div class="detail-note">
                <strong>Sobre el precio:</strong> ${tienePrecio(p)
                    ? `el valor unitario baja segun la cantidad. El total definitivo se confirma
                       en la cotizacion formal segun material y numero de tintas.`
                    : `esta referencia se cotiza a medida. Agregala y te enviamos el valor
                       segun cantidad, material y numero de tintas.`}
                ${p.descuento && p.descuentoPct
                    ? `<br><br><strong>Descuento activo:</strong> esta referencia tiene
                       ${p.descuentoPct}% de descuento. Lo aplicamos sobre el valor final
                       al enviarte la cotizacion.`
                    : ""}
            </div>
        </div>
    </div>`;

    // --- interacciones ---
    const input = document.getElementById("inputCantidad");
    const paso = () => (parseInt(input.value) || 0);

    // El precio se recalcula con la cantidad, porque las escalas por volumen
    // cambian el valor unitario.
    const precioEl = document.getElementById("detallePrecio");
    function pintarPrecio() {
        const cant = Math.max(1, paso() || 1);
        if (!tienePrecio(p)) {
            precioEl.innerHTML = `<span class="detail-price__sin">
                    <i class="bi bi-tag"></i> Precio a cotizar
                </span>`;
            return;
        }
        const unit  = precioUnitario(p, cant);
        const base  = precioUnitarioBase(p, cant);
        const escala = textoEscala(p, cant);
        precioEl.innerHTML = `
            <div class="detail-price__main">
                ${base > unit ? `<span class="detail-price__old">${formatCOP(base)}</span>` : ""}
                <strong class="detail-price__unit">${formatCOP(unit)}</strong>
                <span class="detail-price__per">por unidad</span>
            </div>
            <div class="detail-price__total">
                Total ${cant.toLocaleString("es-CO")} und:
                <strong>${formatCOP(unit * cant)}</strong>
            </div>
            ${escala ? `<div class="detail-price__escala"><i class="bi bi-arrow-down-circle"></i> ${escapeHtml(escala)}</div>` : ""}`;
    }
    pintarPrecio();

    document.getElementById("btnMas").addEventListener("click", () => {
        input.value = paso() + 1;
        pintarPrecio();
    });
    document.getElementById("btnMenos").addEventListener("click", () => {
        input.value = Math.max(1, paso() - 1);
        pintarPrecio();
    });
    input.addEventListener("input", pintarPrecio);
    input.addEventListener("change", () => {
        input.value = Math.max(1, paso() || 1);
        pintarPrecio();
    });

    document.getElementById("btnZoom").addEventListener("click", () => abrirZoom(p.imagen, p.nombre));
    document.getElementById("imgPrincipal").addEventListener("click", () => abrirZoom(p.imagen, p.nombre));

    document.getElementById("btnAgregar").addEventListener("click", () => {
        const cant = Math.max(1, paso() || 1);
        agregarAlCarrito(p, cant);
        toast(`${cant} und. de ${p.nombre} agregadas a tu cotizacion`);
    });
}
