/* =======================================================
   Tarjeta de producto reutilizable (listado y landing)
   ======================================================= */

import { escapeHtml, formatMedidas, slug, agregarAlCarrito, toast } from "./tienda-core.js";

export function urlProducto(p) {
    return `producto.html?sku=${encodeURIComponent(p.sku)}`;
}

export function urlCategoria(categoria) {
    return `catalogo.html?cat=${encodeURIComponent(slug(categoria))}`;
}

/** Sello de descuento. Vacio si el producto no tiene descuento activo. */
export function descuentoBadgeHTML(p) {
    if (!p?.descuento || !p.descuentoPct) return "";
    return `<span class="product-card__off" aria-label="Producto en descuento del ${p.descuentoPct} por ciento">
                <i class="bi bi-tag-fill"></i> ${p.descuentoPct}% OFF
            </span>`;
}

export function productCardHTML(p) {
    const enOferta = Boolean(p?.descuento && p.descuentoPct);
    return `
    <article class="product-card${enOferta ? " product-card--off" : ""}" data-sku="${escapeHtml(p.sku)}">
        <a class="product-card__media" href="${urlProducto(p)}" aria-label="Ver ${escapeHtml(p.nombre)}">
            <img src="${escapeHtml(p.imagen)}" alt="${escapeHtml(p.nombre)}" loading="lazy">
            ${descuentoBadgeHTML(p)}
        </a>
        <button class="product-card__zoom" type="button" data-zoom
                aria-label="Ampliar imagen de ${escapeHtml(p.nombre)}">
            <i class="bi bi-search"></i>
        </button>
        <div class="product-card__body">
            <span class="product-card__cat">${escapeHtml(p.categoria)}</span>
            <h3 class="product-card__name">
                <a href="${urlProducto(p)}">${escapeHtml(p.nombre)}</a>
            </h3>
            <p class="product-card__dims">${escapeHtml(formatMedidas(p))}</p>
            <div class="product-card__actions">
                <button class="btn-add" type="button" data-add>
                    <i class="bi bi-cart-plus"></i> Agregar
                </button>
                <a class="btn-view" href="${urlProducto(p)}" aria-label="Ver detalle de ${escapeHtml(p.nombre)}">
                    <i class="bi bi-eye"></i>
                </a>
            </div>
        </div>
    </article>`;
}

/**
 * Pinta una grilla de productos y conecta los botones.
 * @param {HTMLElement} contenedor
 * @param {Array} productos
 * @param {Function} abrirZoom
 */
export function renderProductGrid(contenedor, productos, abrirZoom) {
    if (!contenedor) return;

    if (!productos.length) {
        contenedor.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <i class="bi bi-inbox"></i>
                No encontramos referencias con ese criterio.
            </div>`;
        return;
    }

    contenedor.innerHTML = productos.map(productCardHTML).join("");

    contenedor.querySelectorAll(".product-card").forEach(card => {
        const sku = card.dataset.sku;
        const p = productos.find(x => x.sku === sku);
        if (!p) return;

        card.querySelector("[data-add]")?.addEventListener("click", () => {
            agregarAlCarrito(p, 1);
            toast(`${p.nombre} agregado a tu cotizacion`);
        });

        card.querySelector("[data-zoom]")?.addEventListener("click", () => {
            abrirZoom?.(p.imagen, p.nombre);
        });
    });
}
