/* =======================================================
   catalogo.html - listado con filtros, busqueda y orden
   ======================================================= */

import { initLayout } from "./tienda-layout.js";
import {
    getCatalogo, agruparPorCategoria, getCategoriaInfo, categoriaDesdeSlug,
    escapeHtml, slug, initZoom
} from "./tienda-core.js";
import { renderProductGrid } from "./tienda-cards.js";

initLayout("productos");
const abrirZoom = initZoom();

const grid        = document.getElementById("productGrid");
const filtrosBox  = document.getElementById("filtrosCategorias");
const countEl     = document.getElementById("shopCount");
const inputBuscar = document.getElementById("inputBuscar");
const tituloEl    = document.getElementById("catalogoTitulo");
const subtituloEl = document.getElementById("catalogoSubtitulo");
const breadcrumb  = document.getElementById("breadcrumb");

let todos = [];
let estado = {
    categoria: categoriaDesdeSlug(new URLSearchParams(location.search).get("cat")),
    busqueda: ""
};

(async function main() {
    try {
        todos = await getCatalogo();
    } catch (err) {
        console.error("[catalogo] error cargando catalogo", err);
    }

    if (!todos.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <i class="bi bi-wifi-off"></i>No pudimos cargar el catalogo en este momento.</div>`;
        countEl.textContent = "";
        return;
    }

    renderFiltros();
    aplicar();

    inputBuscar.addEventListener("input", () => {
        estado.busqueda = inputBuscar.value.trim().toLowerCase();
        aplicar();
    });
})();

function renderFiltros() {
    const porCategoria = agruparPorCategoria(todos);
    const items = [
        `<button class="shop-filter${!estado.categoria ? " is-active" : ""}" data-cat="">
            Todas <span>${todos.length}</span></button>`,
        ...[...porCategoria.entries()].map(([cat, arr]) =>
            `<button class="shop-filter${estado.categoria === cat ? " is-active" : ""}"
                     data-cat="${escapeHtml(cat)}">
                ${escapeHtml(cat)} <span>${arr.length}</span></button>`)
    ];
    filtrosBox.innerHTML = items.join("");

    filtrosBox.querySelectorAll(".shop-filter").forEach(btn => {
        btn.addEventListener("click", () => {
            estado.categoria = btn.dataset.cat || null;
            filtrosBox.querySelectorAll(".shop-filter").forEach(b => b.classList.remove("is-active"));
            btn.classList.add("is-active");

            const url = new URL(location.href);
            if (estado.categoria) url.searchParams.set("cat", slug(estado.categoria));
            else url.searchParams.delete("cat");
            history.replaceState(null, "", url);

            aplicar();
        });
    });
}

function aplicar() {
    let lista = todos.slice();

    if (estado.categoria) lista = lista.filter(p => p.categoria === estado.categoria);

    if (estado.busqueda) {
        lista = lista.filter(p =>
            p.nombre.toLowerCase().includes(estado.busqueda) ||
            p.categoria.toLowerCase().includes(estado.busqueda));
    }

    countEl.textContent = lista.length === 1
        ? "Mostrando 1 resultado"
        : `Mostrando ${lista.length} resultados`;

    renderCabecera();
    renderProductGrid(grid, lista, abrirZoom);
}

function renderCabecera() {
    if (estado.categoria) {
        const info = getCategoriaInfo(estado.categoria);
        tituloEl.textContent = estado.categoria;
        subtituloEl.textContent = info.descripcion;
        document.title = `${estado.categoria} | Traffic Empaques`;
        breadcrumb.innerHTML = `
            <a href="index.html">Inicio</a><span>/</span>
            <a href="productos.html">Productos</a><span>/</span>
            <a href="catalogo.html">Todos los empaques</a><span>/</span>
            <span>${escapeHtml(estado.categoria)}</span>`;
    } else {
        tituloEl.textContent = "Todos los empaques";
        subtituloEl.textContent = "Empaques personalizados con medidas reales de produccion.";
        document.title = "Catalogo de empaques | Traffic Empaques";
        breadcrumb.innerHTML = `
            <a href="index.html">Inicio</a><span>/</span>
            <a href="productos.html">Productos</a><span>/</span>
            <span>Todos los empaques</span>`;
    }
}
