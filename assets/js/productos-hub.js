/* =======================================================
   productos.html - selector de linea (Empaques / Digital)
   + categorias de empaques desde el catalogo
   ======================================================= */

import { initLayout } from "./tienda-layout.js";
import {
    getCatalogo, agruparPorCategoria, getCategoriaInfo, escapeHtml, whatsappLink
} from "./tienda-core.js";
import { urlCategoria } from "./tienda-cards.js";

initLayout("productos");

const grid       = document.getElementById("categoriasGrid");
const breadcrumb = document.getElementById("breadcrumb");
const subtitulo  = document.getElementById("lineaSubtitulo");

const TABS = {
    empaques: {
        tab: document.getElementById("tabEmpaques"),
        panel: document.getElementById("panelEmpaques"),
        titulo: "Empaques",
        subtitulo: "Cajas, bolsas, vasos y papeles personalizados con tu marca."
    },
    digital: {
        tab: document.getElementById("tabDigital"),
        panel: document.getElementById("panelDigital"),
        titulo: "Digital",
        subtitulo: "Marca, contenido y publicidad digital. Linea en preparacion."
    }
};

/* ---------- Selector de linea ---------- */
function mostrarLinea(linea, { actualizarUrl = true } = {}) {
    if (!TABS[linea]) linea = "empaques";

    for (const [clave, ref] of Object.entries(TABS)) {
        const activa = clave === linea;
        ref.tab.classList.toggle("is-active", activa);
        ref.tab.setAttribute("aria-selected", String(activa));
        ref.panel.hidden = !activa;
    }

    const info = TABS[linea];
    subtitulo.textContent = info.subtitulo;
    document.title = `${info.titulo} | Traffic Empaques`;
    breadcrumb.innerHTML = `
        <a href="index.html">Inicio</a><span>/</span>
        <a href="productos.html">Productos</a><span>/</span>
        <span>${escapeHtml(info.titulo)}</span>`;

    if (actualizarUrl) {
        const url = new URL(location.href);
        url.searchParams.set("linea", linea);
        history.replaceState(null, "", url);
    }
}

Object.entries(TABS).forEach(([clave, ref]) => {
    ref.tab.addEventListener("click", () => mostrarLinea(clave));
});

document.querySelectorAll("[data-ir-empaques]").forEach(btn => {
    btn.addEventListener("click", () => {
        mostrarLinea("empaques");
        document.querySelector(".linea-switch")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
});

document.getElementById("btnDigitalWa").href =
    whatsappLink("Hola, quiero informacion sobre la linea Digital de Traffic Empaques.");

// Linea inicial: ?linea=digital o empaques por defecto
mostrarLinea(new URLSearchParams(location.search).get("linea"), { actualizarUrl: false });

/* ---------- Categorias de empaques ---------- */
(async function main() {
    let productos = [];
    try {
        productos = await getCatalogo();
    } catch (err) {
        console.error("[productos] error cargando catalogo", err);
    }

    if (!productos.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <i class="bi bi-wifi-off"></i>No pudimos cargar el catalogo en este momento.</div>`;
        return;
    }

    const porCategoria = agruparPorCategoria(productos);

    grid.innerHTML = [...porCategoria.entries()].map(([cat, items]) => {
        const info = getCategoriaInfo(cat);
        return `
        <a class="catcard" href="${urlCategoria(cat)}">
            <div class="catcard__media">
                <img src="${escapeHtml(items[0]?.imagen || "")}" alt="${escapeHtml(cat)}" loading="lazy">
            </div>
            <div class="catcard__body">
                <h3 class="catcard__title">${escapeHtml(cat)}</h3>
                <p class="catcard__text">${escapeHtml(info.descripcion)}</p>
                ${info.usos ? `<p class="catcard__text" style="font-size:.82rem;opacity:.8">${escapeHtml(info.usos)}</p>` : ""}
                <span class="catcard__meta">${items.length} referencia${items.length === 1 ? "" : "s"}</span>
            </div>
        </a>`;
    }).join("");
})();
