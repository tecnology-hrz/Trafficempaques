import { db, collection, getDocs, doc, setDoc, deleteDoc } from "./auth.js";
import { CATALOGO_DATA } from "./catalogo-data.js";

// ===== ESTADO =====
let catalogoFirestore = {};   // { categoria: [ {orden, nombre, alto, largo, ancho, imagen, ...} ] }
let imagenesSeleccionadas = [];
window.onCatalogoSeleccionChange = window.onCatalogoSeleccionChange || null;

const CATEGORIAS_ORDEN = [
    "Comidas Principales",
    "Completos y Compartidos",
    "Street Food",
    "Snacks y Acompañamientos",
    "Exhibicion y Servicio",
    "Vasos",
    "Otros"
];

// ===== CARGAR DESDE FIRESTORE =====
export async function cargarCatalogoFirestore() {
    const snap = await getDocs(collection(db, "catalogo"));
    catalogoFirestore = {};
    snap.forEach(d => {
        const data = d.data();
        if (!catalogoFirestore[data.categoria]) catalogoFirestore[data.categoria] = [];
        catalogoFirestore[data.categoria].push({ firestoreId: d.id, ...data });
    });
    // Ordenar cada categoría por orden
    for (const cat of Object.keys(catalogoFirestore)) {
        catalogoFirestore[cat].sort((a, b) => (a.orden || 0) - (b.orden || 0));
    }
    return catalogoFirestore;
}

// ===== FALLBACK: usar datos locales si Firestore vacío =====
function getCatData(categoria) {
    if (catalogoFirestore[categoria] && catalogoFirestore[categoria].length > 0) {
        return catalogoFirestore[categoria];
    }
    // Fallback a datos locales
    return (CATALOGO_DATA[categoria]?.productos || []).map(p => ({
        ...p,
        categoria,
        imagen: p.imagen
    }));
}

// ===== DOM =====
let categoriaActiva = "Comidas Principales";
let zoomIndex = 0;
let zoomItems = []; // [{nombre, imagen, alto, largo, ancho}]

const btnVerCatalogo     = document.getElementById("btnVerCatalogo");
const catalogoModal      = document.getElementById("catalogoModal");
const catalogoModalClose = document.getElementById("catalogoModalClose");
const catalogoBody       = document.getElementById("catalogoBody");
const catalogoTabs       = document.getElementById("catalogoTabs");
const catalogoSelect     = document.getElementById("catalogoSelect");
const catalogoImgZoom    = document.getElementById("catalogoImgZoom");
const catalogoZoomClose  = document.getElementById("catalogoZoomClose");
const catalogoZoomImg    = document.getElementById("catalogoZoomImg");
const catalogoZoomPrev   = document.getElementById("catalogoZoomPrev");
const catalogoZoomNext   = document.getElementById("catalogoZoomNext");

// Abrir modal
btnVerCatalogo.addEventListener("click", async () => {
    catalogoModal.classList.add("show");
    document.body.style.overflow = "hidden";
    if (Object.keys(catalogoFirestore).length === 0) {
        catalogoBody.innerHTML = '<div class="catalogo-loading"><i class="bi bi-arrow-repeat" style="animation:spin .7s linear infinite"></i> Cargando...</div>';
        await cargarCatalogoFirestore();
    }
    renderCategoria(categoriaActiva);
});

catalogoModalClose.addEventListener("click", cerrarCatalogo);
catalogoModal.addEventListener("click", (e) => { if (e.target === catalogoModal) cerrarCatalogo(); });

function cerrarCatalogo() {
    catalogoModal.classList.remove("show");
    document.body.style.overflow = "";
}

// Tabs
if (catalogoTabs) {
    catalogoTabs.querySelectorAll(".catalogo-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            catalogoTabs.querySelectorAll(".catalogo-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            categoriaActiva = tab.dataset.cat;
            if (catalogoSelect) catalogoSelect.value = categoriaActiva;
            renderCategoria(categoriaActiva);
        });
    });
}

if (catalogoSelect) {
    catalogoSelect.addEventListener("change", () => {
        categoriaActiva = catalogoSelect.value;
        if (catalogoTabs) {
            catalogoTabs.querySelectorAll(".catalogo-tab").forEach(t => {
                t.classList.toggle("active", t.dataset.cat === categoriaActiva);
            });
        }
        renderCategoria(categoriaActiva);
    });
}

// Exportar seleccionadas
window.getCatalogoSeleccionadas = () => [...imagenesSeleccionadas];

// ===== RENDER GRID =====
function renderCategoria(cat) {
    const productos = getCatData(cat);
    zoomItems = productos;

    catalogoBody.innerHTML = `<div class="catalogo-grid" id="catalogoGrid"></div>`;
    const grid = document.getElementById("catalogoGrid");

    productos.forEach((prod, idx) => {
        const src = prod.imagen;
        const seleccionada = imagenesSeleccionadas.includes(src);
        const item = document.createElement("div");
        item.className = "catalogo-item" + (seleccionada ? " seleccionada" : "");
        item.dataset.src = src;
        const descBadge = prod.descuento
            ? `<div class="catalogo-descuento-badge">-${prod.descuentoPct}%</div>`
            : "";
        item.innerHTML = `
            ${descBadge}
            <img src="${src}" alt="${prod.nombre}" loading="lazy">
            <div class="catalogo-item-overlay">
                <i class="bi bi-zoom-in catalogo-zoom-icon"></i>
            </div>
            ${seleccionada ? '<div class="catalogo-badge-agregada"><i class="bi bi-check-circle-fill"></i> Agregada</div>' : ''}
        `;
        item.addEventListener("click", () => abrirZoom(idx));
        grid.appendChild(item);
    });
}

function toggleSeleccion(src, itemEl) {
    const idx = imagenesSeleccionadas.indexOf(src);
    if (idx === -1) {
        imagenesSeleccionadas.push(src);
        if (itemEl && itemEl.classList) {
            itemEl.classList.add("seleccionada");
            if (!itemEl.querySelector(".catalogo-badge-agregada")) {
                const badge = document.createElement("div");
                badge.className = "catalogo-badge-agregada";
                badge.innerHTML = '<i class="bi bi-check-circle-fill"></i> Agregada';
                itemEl.appendChild(badge);
            }
        }
    } else {
        imagenesSeleccionadas.splice(idx, 1);
        if (itemEl && itemEl.classList) {
            itemEl.classList.remove("seleccionada");
            const badge = itemEl.querySelector(".catalogo-badge-agregada");
            if (badge) badge.remove();
        }
    }
    if (typeof window.onCatalogoSeleccionChange === "function") {
        window.onCatalogoSeleccionChange([...imagenesSeleccionadas]);
    }
    actualizarContadorCatalogo();
}

function actualizarContadorCatalogo() {
    const count = imagenesSeleccionadas.length;
    const existing = document.getElementById("catalogoSelCount");
    if (count > 0) {
        if (!existing) {
            const badge = document.createElement("span");
            badge.id = "catalogoSelCount";
            badge.className = "catalogo-sel-badge";
            badge.textContent = count;
            btnVerCatalogo.appendChild(badge);
        } else {
            existing.textContent = count;
        }
    } else if (existing) {
        existing.remove();
    }
}

// ===== ZOOM =====
function abrirZoom(idx) {
    zoomIndex = idx;
    const prod = zoomItems[idx];
    catalogoZoomImg.src = prod.imagen;

    // Nombre y medidas en el zoom
    const infoEl = document.getElementById("catalogoZoomInfo");
    if (infoEl) {
        const medidas = (prod.alto !== "-" && prod.largo !== "-")
            ? `<span class="zoom-medidas">ALTO: ${prod.alto} &nbsp; LARGO: ${prod.largo} &nbsp; ANCHO: ${prod.ancho}</span>`
            : "";
        infoEl.innerHTML = `<span class="zoom-nombre">${prod.nombre}</span>${medidas}`;
    }

    catalogoImgZoom.classList.add("show");
    actualizarNavZoom();
    actualizarBtnZoomAgregar(prod.imagen);
}

function actualizarBtnZoomAgregar(src) {
    const btn = document.getElementById("catalogoZoomBtnAgregar");
    if (!btn) return;
    const sel = imagenesSeleccionadas.includes(src);
    btn.className = "catalogo-zoom-btn-agregar" + (sel ? " agregada" : "");
    btn.innerHTML = sel
        ? '<i class="bi bi-check-circle-fill"></i> Agregado para nueva cotización'
        : '<i class="bi bi-plus-circle"></i> Agregar para nueva cotización';
}

function cerrarZoom() { catalogoImgZoom.classList.remove("show"); }

function actualizarNavZoom() {
    catalogoZoomPrev.style.opacity = zoomIndex > 0 ? "1" : "0.3";
    catalogoZoomNext.style.opacity = zoomIndex < zoomItems.length - 1 ? "1" : "0.3";
}

catalogoZoomClose.addEventListener("click", cerrarZoom);
catalogoImgZoom.addEventListener("click", (e) => { if (e.target === catalogoImgZoom) cerrarZoom(); });

catalogoZoomPrev.addEventListener("click", () => {
    if (zoomIndex > 0) { zoomIndex--; abrirZoom(zoomIndex); }
});
catalogoZoomNext.addEventListener("click", () => {
    if (zoomIndex < zoomItems.length - 1) { zoomIndex++; abrirZoom(zoomIndex); }
});

// Botón agregar en zoom
const catalogoZoomBtnAgregar = document.getElementById("catalogoZoomBtnAgregar");
if (catalogoZoomBtnAgregar) {
    catalogoZoomBtnAgregar.addEventListener("click", () => {
        const prod = zoomItems[zoomIndex];
        const src = prod.imagen;
        const grid = document.getElementById("catalogoGrid");
        const itemEl = grid ? grid.querySelector(`[data-src="${CSS.escape(src)}"]`) : null;
        toggleSeleccion(src, itemEl);
        actualizarBtnZoomAgregar(src);
    });
}

document.addEventListener("keydown", (e) => {
    if (catalogoImgZoom.classList.contains("show")) {
        if (e.key === "ArrowLeft")  catalogoZoomPrev.click();
        if (e.key === "ArrowRight") catalogoZoomNext.click();
        if (e.key === "Escape")     cerrarZoom();
    } else if (catalogoModal.classList.contains("show") && e.key === "Escape") {
        cerrarCatalogo();
    }
});

// Spinner CSS
const spinStyle = document.createElement("style");
spinStyle.textContent = `@keyframes spin{to{transform:rotate(360deg)}}`;
document.head.appendChild(spinStyle);
