/* =======================================================
   Landing publica (index.html)
   ======================================================= */

import { initLayout } from "./tienda-layout.js";
import {
    getCatalogo, agruparPorCategoria, getCategoriaInfo,
    escapeHtml, initZoom, whatsappLink, toast, EMPRESA
} from "./tienda-core.js";
import { urlCategoria } from "./tienda-cards.js";
import {
    getLandingConfig, portadaGaleria, embedVideo,
    urlBanner, keyCategoria, keyDigital, DIGITAL_CATEGORIAS
} from "./landing-config.js";

/* Marcas del carrusel. Si mas adelante hay logos, agrega
   { nombre: "...", logo: "https://..." } y se pinta la imagen. */
const MARCAS = [
    { nombre: "Jhonny Wings" },
    { nombre: "Sixxta" },
    { nombre: "Godo Pardo" },
    { nombre: "Brolate" },
    { nombre: "El Menor" },
    { nombre: "Vacchi" },
    { nombre: "Koi Koi" },
    { nombre: "Clucks" }
];

initLayout("inicio");
const abrirZoom = initZoom();

const catGrid = document.getElementById("catGrid");
const catCta  = document.getElementById("catCta");

/* ---------- Nuestros Productos: tarjetas por linea ---------- */
(async function nuestrosProductos() {
    let productos = [];
    let cfg = { banners: {} };

    try {
        [productos, cfg] = await Promise.all([getCatalogo(), getLandingConfig()]);
    } catch (err) {
        console.error("[landing] error cargando productos", err);
    }

    const porCategoria = productos.length ? agruparPorCategoria(productos) : new Map();

    /* --- Empaques: foto administrable, si no hay usa la primera referencia --- */
    function tilesEmpaques() {
        if (!porCategoria.size) {
            return `<div class="empty-state" style="grid-column:1/-1">
                <i class="bi bi-wifi-off"></i>No pudimos cargar el catalogo en este momento.</div>`;
        }
        return [...porCategoria.entries()].map(([cat, items]) => {
            const info  = getCategoriaInfo(cat);
            const foto  = urlBanner(cfg, keyCategoria(cat)) || items[0]?.imagen || "";
            return tileHTML({
                href: urlCategoria(cat),
                nombre: cat,
                foto,
                icon: info.icon,
                extra: `<span class="cat-tile__count">${items.length} ref.</span>`
            });
        }).join("");
    }

    /* --- Digital: todas las tarjetas en estado proximamente --- */
    function tilesDigital() {
        return DIGITAL_CATEGORIAS.map(d => tileHTML({
            href: null,
            nombre: d.nombre,
            foto: urlBanner(cfg, keyDigital(d.nombre)),
            icon: d.icon,
            soon: true
        })).join("");
    }

    function tileHTML({ href, nombre, foto, icon, extra = "", soon = false }) {
        const clases = ["cat-tile"];
        if (!foto) clases.push("cat-tile--sinfoto");
        if (soon)  clases.push("cat-tile--soon");

        const interior = `
            ${foto ? `<img src="${escapeHtml(foto)}" alt="${escapeHtml(nombre)}" loading="lazy">`
                   : `<i class="bi ${escapeHtml(icon)} cat-tile__icono"></i>`}
            ${extra}
            <span class="cat-tile__pill">${escapeHtml(nombre)}</span>
            ${soon ? '<span class="cat-tile__soon">Proximamente</span>' : ""}`;

        return href
            ? `<a class="${clases.join(" ")}" href="${href}">${interior}</a>`
            : `<div class="${clases.join(" ")}" role="group" aria-label="${escapeHtml(nombre)} - proximamente">${interior}</div>`;
    }

    function mostrar(linea) {
        const esDigital = linea === "digital";
        catGrid.innerHTML = esDigital ? tilesDigital() : tilesEmpaques();
        catCta.innerHTML = esDigital
            ? `<a class="btn btn--outline btn--lg" href="productos.html?linea=digital">Conocer la linea digital</a>`
            : `<a class="btn btn--outline btn--lg" href="catalogo.html">Ver todos los empaques</a>`;

        document.querySelectorAll(".cat-switch__btn").forEach(btn => {
            const activo = btn.dataset.linea === linea;
            btn.classList.toggle("is-active", activo);
            btn.setAttribute("aria-selected", String(activo));
        });
    }

    document.querySelectorAll(".cat-switch__btn").forEach(btn => {
        btn.addEventListener("click", () => mostrar(btn.dataset.linea));
    });

    mostrar("empaques");
})();

/* ---------- Carrusel infinito de marcas ---------- */
(function marcasMarquee() {
    const track = document.getElementById("marcasTrack");
    if (!track) return;

    const chip = m => m.logo
        ? `<div class="brand-chip"><img src="${escapeHtml(m.logo)}" alt="${escapeHtml(m.nombre)}" loading="lazy"></div>`
        : `<div class="brand-chip">${escapeHtml(m.nombre)}</div>`;

    // Una copia visible + una copia clon: al desplazar el 50% del track
    // el resultado es identico al punto de partida, sin salto ni reinicio.
    const copia = MARCAS.map(chip).join("");
    track.innerHTML = copia + copia;

    const items = track.children;
    for (let i = MARCAS.length; i < items.length; i++) {
        items[i].setAttribute("aria-hidden", "true");
    }

    track.style.setProperty("--marquee-duration", `${Math.max(18, MARCAS.length * 4.5)}s`);
})();

/* ---------- Contacto ---------- */
(function contacto() {
    const form = document.getElementById("contactoForm");
    if (!form) return;

    // Enlaces directos
    const wa = document.getElementById("contactoWa");
    wa.href = whatsappLink("Hola, quiero cotizar empaques personalizados.");
    document.getElementById("contactoWaNum").textContent = "+" + EMPRESA.whatsapp;

    const mail = document.getElementById("contactoMail");
    mail.href = `mailto:${EMPRESA.email}`;
    document.getElementById("contactoMailTxt").textContent = EMPRESA.email;

    form.addEventListener("submit", e => {
        e.preventDefault();

        const nombre   = document.getElementById("ctNombre").value.trim();
        const telefono = document.getElementById("ctTelefono").value.trim();
        const interes  = document.getElementById("ctInteres").value;
        const mensaje  = document.getElementById("ctMensaje").value.trim();

        if (!nombre || !telefono) {
            toast("Completa nombre y telefono para continuar", "error");
            return;
        }

        const texto =
            `*Contacto desde la web - ${EMPRESA.nombre}*\n\n` +
            `Nombre: ${nombre}\n` +
            `Telefono: ${telefono}\n` +
            `Interes: ${interes}\n` +
            (mensaje ? `\nMensaje: ${mensaje}\n` : "");

        window.open(whatsappLink(texto), "_blank", "noopener");
    });
})();

/* ---------- Galeria de imagenes y videos ---------- */
const abrirVideo = crearVisorVideo();

(async function galeria() {
    const seccion = document.getElementById("galeria");
    const grid    = document.getElementById("galeriaGrid");
    if (!seccion || !grid) return;

    const cfg   = await getLandingConfig();
    const items = (cfg.galeria || []).filter(i => i && i.url);

    // Sin contenido cargado, la seccion no se muestra
    if (!items.length) return;

    document.getElementById("galeriaTitulo").textContent = cfg.galeriaTitulo;
    const texto = document.getElementById("galeriaTexto");
    texto.textContent = cfg.galeriaTexto || "";
    texto.hidden = !cfg.galeriaTexto;

    grid.innerHTML = items.map((item, i) => {
        const esVideo  = item.tipo === "video";
        const portada  = portadaGaleria(item);
        const destacado = i === 0 && items.length > 2 ? " galeria-item--destacado" : "";
        const titulo   = item.titulo || (esVideo ? "Video" : "Galeria");

        return `
        <button class="galeria-item${destacado}" type="button" data-idx="${i}"
                aria-label="${esVideo ? "Reproducir" : "Ampliar"}: ${escapeHtml(titulo)}">
            <div class="galeria-item__media">
                <img src="${escapeHtml(portada)}" alt="${escapeHtml(titulo)}" loading="lazy">
                <span class="galeria-item__tipo">
                    <i class="bi ${esVideo ? "bi-play-circle-fill" : "bi-image"}"></i>
                    ${esVideo ? "Video" : "Foto"}
                </span>
                ${esVideo ? '<span class="galeria-item__play"><i class="bi bi-play-fill"></i></span>' : ""}
                <div class="galeria-item__caption">
                    <span class="galeria-item__titulo">${escapeHtml(titulo)}</span>
                    ${item.texto ? `<span class="galeria-item__texto">${escapeHtml(item.texto)}</span>` : ""}
                </div>
            </div>
        </button>`;
    }).join("");

    seccion.hidden = false;

    grid.querySelectorAll(".galeria-item").forEach(btn => {
        btn.addEventListener("click", () => {
            const item = items[Number(btn.dataset.idx)];
            if (!item) return;
            if (item.tipo === "video") abrirVideo(item.url);
            else abrirZoom(item.url, item.titulo || "Galeria");
        });
    });
})();

/** Visor de video en modal. Soporta YouTube, Vimeo y archivos mp4. */
function crearVisorVideo() {
    const modal = document.createElement("div");
    modal.className = "video-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Reproductor de video");
    modal.innerHTML = `
        <button class="video-modal__close" aria-label="Cerrar video"><i class="bi bi-x"></i></button>
        <div class="video-modal__frame"></div>`;
    document.body.appendChild(modal);

    const frame = modal.querySelector(".video-modal__frame");

    function cerrar() {
        modal.classList.remove("is-open");
        frame.innerHTML = "";              // detiene la reproduccion
        document.body.style.overflow = "";
    }

    modal.querySelector(".video-modal__close").addEventListener("click", cerrar);
    modal.addEventListener("click", e => { if (e.target === modal) cerrar(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") cerrar(); });

    return function abrir(url) {
        const embed = embedVideo(url);
        frame.innerHTML = embed
            ? `<iframe src="${embed}" title="Video" allow="accelerometer; autoplay; clipboard-write;
                   encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
            : `<video src="${url}" controls autoplay playsinline></video>`;
        modal.classList.add("is-open");
        document.body.style.overflow = "hidden";
    };
}
