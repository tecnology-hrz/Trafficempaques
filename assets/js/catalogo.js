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

// Renderizar grid de imágenes de una categoría
function renderCategoria(cat) {
    const info = CATALOGO[cat];
    if (!info) return;

    // Construir lista de URLs
    zoomImagenes = [];
    for (let i = 1; i <= info.count; i++) {
        zoomImagenes.push(`${info.basePath}/${i}.png`);
    }

    catalogoBody.innerHTML = `<div class="catalogo-grid" id="catalogoGrid"></div>`;
    const grid = document.getElementById("catalogoGrid");

    zoomImagenes.forEach((src, idx) => {
        const item = document.createElement("div");
        item.className = "catalogo-item";
        item.innerHTML = `
            <img src="${src}" alt="Producto ${idx + 1}" loading="lazy">
            <div class="catalogo-item-overlay"><i class="bi bi-zoom-in"></i></div>
        `;
        item.addEventListener("click", () => abrirZoom(idx));
        grid.appendChild(item);
    });
}

// Zoom
function abrirZoom(idx) {
    zoomIndex = idx;
    catalogoZoomImg.src = zoomImagenes[idx];
    catalogoImgZoom.classList.add("show");
    actualizarNavZoom();
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
    }
});

catalogoZoomNext.addEventListener("click", () => {
    if (zoomIndex < zoomImagenes.length - 1) {
        zoomIndex++;
        catalogoZoomImg.src = zoomImagenes[zoomIndex];
        actualizarNavZoom();
    }
});

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
