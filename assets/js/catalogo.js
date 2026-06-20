// Imágenes seleccionadas del catálogo para agregar a la cotización
let imagenesSeleccionadas = [];

// Callback que se llama cuando cambia la selección (lo implementa cotizacion-publica.js si existe)
window.onCatalogoSeleccionChange = window.onCatalogoSeleccionChange || null;

// Catálogo de productos - datos de cada categoría
const CATALOGO = {
    "Comidas Principales": {
        icon: "bi-egg-fried",
        count: 20,
        basePath: "caalogo/Pantallazos/Pantallazos/Comidas Principales"
    },
    "Completos y Compartidos": {
        icon: "bi-basket2",
        count: 9,
        basePath: "caalogo/Pantallazos/Pantallazos/Completos y Compartidos"
    },
    "Street Food": {
        icon: "bi-shop",
        count: 6,
        basePath: "caalogo/Pantallazos/Pantallazos/Street Food"
    },
    "Snacks y Acompañamientos": {
        icon: "bi-cup-straw",
        count: 11,
        basePath: "caalogo/Pantallazos/Pantallazos/Snacks y Acompañamientos"
    },
    "Exhibicion y Servicio": {
        icon: "bi-display",
        count: 6,
        basePath: "caalogo/Pantallazos/Pantallazos/Exhibicion y Servicio"
    },
    "Vasos": {
        icon: "bi-cup-hot",
        count: 4,
        basePath: "caalogo/Pantallazos/Pantallazos/Vasos"
    },
    "Otros": {
        icon: "bi-three-dots",
        count: 13,
        basePath: "caalogo/Pantallazos/Pantallazos/Otros"
    }
};

let categoriaActiva = "Comidas Principales";
let zoomIndex = 0;
let zoomImagenes = [];

// Elementos DOM
const btnVerCatalogo    = document.getElementById("btnVerCatalogo");
const catalogoModal     = document.getElementById("catalogoModal");
const catalogoModalClose = document.getElementById("catalogoModalClose");
const catalogoBody      = document.getElementById("catalogoBody");
const catalogoTabs      = document.getElementById("catalogoTabs");
const catalogoSelect    = document.getElementById("catalogoSelect");
const catalogoImgZoom   = document.getElementById("catalogoImgZoom");
const catalogoZoomClose = document.getElementById("catalogoZoomClose");
const catalogoZoomImg   = document.getElementById("catalogoZoomImg");
const catalogoZoomPrev  = document.getElementById("catalogoZoomPrev");
const catalogoZoomNext  = document.getElementById("catalogoZoomNext");

// Abrir modal
btnVerCatalogo.addEventListener("click", () => {
    catalogoModal.classList.add("show");
    document.body.style.overflow = "hidden";
    renderCategoria(categoriaActiva);
});

// Cerrar modal
catalogoModalClose.addEventListener("click", cerrarCatalogo);
catalogoModal.addEventListener("click", (e) => {
    if (e.target === catalogoModal) cerrarCatalogo();
});

function cerrarCatalogo() {
    catalogoModal.classList.remove("show");
    document.body.style.overflow = "";
}

// Tabs (desktop)
catalogoTabs.querySelectorAll(".catalogo-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        catalogoTabs.querySelectorAll(".catalogo-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        categoriaActiva = tab.dataset.cat;
        catalogoSelect.value = categoriaActiva;
        renderCategoria(categoriaActiva);
    });
});

// Select (móvil)
catalogoSelect.addEventListener("change", () => {
    categoriaActiva = catalogoSelect.value;
    catalogoTabs.querySelectorAll(".catalogo-tab").forEach(t => {
        t.classList.toggle("active", t.dataset.cat === categoriaActiva);
    });
    renderCategoria(categoriaActiva);
});

// Exportar función para obtener imágenes seleccionadas
window.getCatalogoSeleccionadas = () => [...imagenesSeleccionadas];

// Renderizar grid de imágenes de una categoría
function renderCategoria(cat) {
    const info = CATALOGO[cat];
    if (!info) return;

    zoomImagenes = [];
    for (let i = 1; i <= info.count; i++) {
        zoomImagenes.push(`${info.basePath}/${i}.png`);
    }

    catalogoBody.innerHTML = `<div class="catalogo-grid" id="catalogoGrid"></div>`;
    const grid = document.getElementById("catalogoGrid");

    zoomImagenes.forEach((src, idx) => {
        const item = document.createElement("div");
        const seleccionada = imagenesSeleccionadas.includes(src);
        item.className = "catalogo-item" + (seleccionada ? " seleccionada" : "");
        item.dataset.src = src;
        item.innerHTML = `
            <img src="${src}" alt="Producto ${idx + 1}" loading="lazy">
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
            // Agregar badge si no existe
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
        window.onCatalogoSeleccionChange(imagenesSeleccionadas);
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

// Zoom
function abrirZoom(idx) {
    zoomIndex = idx;
    const src = zoomImagenes[idx];
    catalogoZoomImg.src = src;
    catalogoImgZoom.classList.add("show");
    actualizarNavZoom();
    actualizarBtnZoomAgregar(src);
}

function actualizarBtnZoomAgregar(src) {
    const btn = document.getElementById("catalogoZoomBtnAgregar");
    if (!btn) return;
    const seleccionada = imagenesSeleccionadas.includes(src);
    btn.className = "catalogo-zoom-btn-agregar" + (seleccionada ? " agregada" : "");
    btn.innerHTML = seleccionada
        ? '<i class="bi bi-check-circle-fill"></i> Agregado para nueva cotización'
        : '<i class="bi bi-plus-circle"></i> Agregar para nueva cotización';
}

function cerrarZoom() {
    catalogoImgZoom.classList.remove("show");
}

function actualizarNavZoom() {
    catalogoZoomPrev.style.opacity = zoomIndex > 0 ? "1" : "0.3";
    catalogoZoomNext.style.opacity = zoomIndex < zoomImagenes.length - 1 ? "1" : "0.3";
}

catalogoZoomClose.addEventListener("click", cerrarZoom);
catalogoImgZoom.addEventListener("click", (e) => {
    if (e.target === catalogoImgZoom) cerrarZoom();
});

catalogoZoomPrev.addEventListener("click", () => {
    if (zoomIndex > 0) {
        zoomIndex--;
        catalogoZoomImg.src = zoomImagenes[zoomIndex];
        actualizarNavZoom();
        actualizarBtnZoomAgregar(zoomImagenes[zoomIndex]);
    }
});

catalogoZoomNext.addEventListener("click", () => {
    if (zoomIndex < zoomImagenes.length - 1) {
        zoomIndex++;
        catalogoZoomImg.src = zoomImagenes[zoomIndex];
        actualizarNavZoom();
        actualizarBtnZoomAgregar(zoomImagenes[zoomIndex]);
    }
});

// Botón agregar en el zoom
const catalogoZoomBtnAgregar = document.getElementById("catalogoZoomBtnAgregar");
if (catalogoZoomBtnAgregar) {
    catalogoZoomBtnAgregar.addEventListener("click", () => {
        const src = zoomImagenes[zoomIndex];
        // Buscar el itemEl en el grid actual (si existe)
        const grid = document.getElementById("catalogoGrid");
        const itemEl = grid ? grid.querySelector(`[data-src="${CSS.escape(src)}"]`) : null;
        toggleSeleccion(src, itemEl || { classList: { add: ()=>{}, remove: ()=>{} }, querySelector: ()=>null });
        actualizarBtnZoomAgregar(src);
    });
}

// Teclado: flechas y ESC
document.addEventListener("keydown", (e) => {
    if (catalogoImgZoom.classList.contains("show")) {
        if (e.key === "ArrowLeft")  catalogoZoomPrev.click();
        if (e.key === "ArrowRight") catalogoZoomNext.click();
        if (e.key === "Escape")     cerrarZoom();
    } else if (catalogoModal.classList.contains("show") && e.key === "Escape") {
        cerrarCatalogo();
    }
});
