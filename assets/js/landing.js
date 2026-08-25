/* =======================================================
   Landing publica (index.html)
   ======================================================= */

import { initLayout } from "./tienda-layout.js";
import {
    getCatalogo, agruparPorCategoria, getCategoriaInfo, productosEnDescuento,
    escapeHtml, initZoom, whatsappLink, toast, EMPRESA
} from "./tienda-core.js";
import { urlCategoria, renderProductGrid } from "./tienda-cards.js";
import {
    getLandingConfig, portadaGaleria, embedVideo, getHeroTextos,
    urlBanner, urlsHero, keyCategoria, keyDigital, DIGITAL_CATEGORIAS,
    getMarcas, MARCAS_DEFAULT_TITULO
} from "./landing-config.js";

initLayout("inicio");
const abrirZoom = initZoom();

const catGrid = document.getElementById("catGrid");
const catCta  = document.getElementById("catCta");

/* ---------- Textos del banner principal ---------- */
(async function heroTextos() {
    const cfg = await getLandingConfig();
    const h   = getHeroTextos(cfg);

    const eyebrow = document.getElementById("heroEyebrow");
    const titulo  = document.getElementById("heroTitulo");
    const texto   = document.getElementById("heroTexto");
    const cta     = document.getElementById("heroCta");

    if (eyebrow) { eyebrow.textContent = h.eyebrow; eyebrow.hidden = !h.eyebrow; }
    if (titulo)  titulo.textContent = h.titulo;
    if (texto)   { texto.textContent = h.texto; texto.hidden = !h.texto; }
    if (cta)     { cta.textContent = h.ctaTexto; cta.href = h.ctaLink; }

    heroCarrusel(cfg);
})();

/* ---------- Carrusel del banner principal (hasta 5 imagenes) ---------- */
function heroCarrusel(cfg) {
    const cont = document.getElementById("heroSlides");
    const dots = document.getElementById("heroDots");
    if (!cont) return;

    const urls   = urlsHero(cfg);
    const slides = [...cont.querySelectorAll(".hero-slide")];

    // Una diapositiva por imagen configurada; las demas se descartan
    slides.forEach((slide, i) => {
        if (i < urls.length) slide.style.backgroundImage = `url('${urls[i]}')`;
        else slide.remove();
    });

    const activos = [...cont.querySelectorAll(".hero-slide")];
    if (!activos.length) return;

    activos.forEach((s, i) => s.classList.toggle("is-active", i === 0));

    // Con una sola imagen no hay nada que rotar
    if (activos.length < 2) return;

    let actual = 0;
    let timer  = null;

    function ir(i) {
        actual = (i + activos.length) % activos.length;
        activos.forEach((s, n) => s.classList.toggle("is-active", n === actual));
        dots?.querySelectorAll(".hero-dot").forEach((d, n) => {
            d.classList.toggle("is-active", n === actual);
            d.setAttribute("aria-selected", n === actual ? "true" : "false");
        });
    }

    if (dots) {
        dots.innerHTML = activos.map((_, i) => `
            <button class="hero-dot${i === 0 ? " is-active" : ""}" type="button" role="tab"
                    data-idx="${i}" aria-selected="${i === 0}"
                    aria-label="Ver imagen ${i + 1}"></button>`).join("");
        dots.hidden = false;
        dots.querySelectorAll(".hero-dot").forEach(btn => {
            btn.addEventListener("click", () => {
                ir(Number(btn.dataset.idx));
                reiniciar();
            });
        });
    }

    function arrancar() { timer = setInterval(() => ir(actual + 1), 6000); }
    function parar()    { clearInterval(timer); timer = null; }
    function reiniciar(){ parar(); arrancar(); }

    arrancar();

    // Pausa mientras el visitante interactua o la pestaña esta oculta
    const hero = cont.closest(".hero") || cont;
    hero.addEventListener("mouseenter", parar);
    hero.addEventListener("mouseleave", reiniciar);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) parar();
        else if (!timer) arrancar();
    });
}

/* ---------- Campaña del mes: imagenes administrables ---------- */
(async function campaniaMes() {
    const seccion = document.getElementById("campania");
    const grid    = document.getElementById("campaniaGrid");
    if (!seccion || !grid) return;

    const cfg   = await getLandingConfig();
    const items = cfg.campania || [];

    // Sin imagenes cargadas la seccion no se muestra
    if (!items.length) return;

    document.getElementById("campaniaTitulo").textContent = cfg.campaniaTitulo;
    const texto = document.getElementById("campaniaTexto");
    texto.textContent = cfg.campaniaTexto || "";
    texto.hidden = !cfg.campaniaTexto;

    grid.innerHTML = items.map((item, i) => {
        const esVideo    = item.tipo === "video";
        const tieneTexto = Boolean(item.titulo || item.texto);
        const clases     = "campania-item" + (tieneTexto ? " campania-item--texto" : "");
        const alt        = item.titulo || cfg.campaniaTitulo;
        // En video la miniatura es la portada propia o la de YouTube
        const media      = esVideo ? portadaGaleria(item) : item.url;

        const interior = `
            <div class="campania-item__media">
                ${media
                    ? `<img src="${escapeHtml(media)}" alt="${escapeHtml(alt)}" loading="lazy">`
                    : ""}
                ${esVideo ? `
                <span class="campania-item__tipo"><i class="bi bi-play-circle-fill"></i> Video</span>
                <span class="campania-item__play"><i class="bi bi-play-fill"></i></span>` : ""}
                ${tieneTexto ? `
                <div class="campania-item__caption">
                    ${item.titulo ? `<span class="campania-item__titulo">${escapeHtml(item.titulo)}</span>` : ""}
                    ${item.texto ? `<span class="campania-item__texto">${escapeHtml(item.texto)}</span>` : ""}
                    ${esVideo
                        ? '<span class="campania-item__link">Reproducir <i class="bi bi-play-fill"></i></span>'
                        : (item.link ? '<span class="campania-item__link">Ver mas <i class="bi bi-arrow-right"></i></span>' : "")}
                </div>` : ""}
            </div>`;

        // Video -> boton que abre el reproductor. Imagen con link -> enlace.
        if (esVideo) {
            return `<button class="${clases}" type="button" data-video-idx="${i}"
                            aria-label="Reproducir: ${escapeHtml(alt)}">${interior}</button>`;
        }
        return item.link
            ? `<a class="${clases}" href="${escapeHtml(item.link)}">${interior}</a>`
            : `<div class="${clases}" role="img" aria-label="${escapeHtml(alt)}">${interior}</div>`;
    }).join("");

    grid.querySelectorAll("[data-video-idx]").forEach(btn => {
        btn.addEventListener("click", () => {
            const item = items[Number(btn.dataset.videoIdx)];
            if (item) abrirVideo(item.url);
        });
    });

    seccion.hidden = false;
})();

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
            // Si la categoria tiene referencias en descuento se avisa en la tarjeta
            const enOferta = productosEnDescuento(items).length;
            return tileHTML({
                href: urlCategoria(cat),
                nombre: cat,
                foto,
                icon: info.icon,
                extra: `<span class="cat-tile__count">${items.length} ref.</span>` +
                       (enOferta
                            ? `<span class="cat-tile__off"><i class="bi bi-tag-fill"></i> ${enOferta} en descuento</span>`
                            : "")
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

    /* --- Productos en descuento ---
       Se reusa la misma tarjeta del catalogo, para que el badge, el zoom y
       el boton de agregar a la cotizacion se comporten igual en todo el sitio.
       Sin productos en descuento la seccion no se muestra. */
    const secOfertas  = document.getElementById("ofertas");
    const gridOfertas = document.getElementById("ofertasGrid");
    if (secOfertas && gridOfertas) {
        const ofertas = productosEnDescuento(productos);
        if (ofertas.length) {
            renderProductGrid(gridOfertas, ofertas, abrirZoom);
            secOfertas.hidden = false;
        }
    }
})();

/* ---------- Carrusel infinito de marcas ---------- */
/* Las marcas y el titulo se administran desde el panel (config/landing).
   Sin marcas configuradas se usan las de por defecto. */
(async function marcasMarquee() {
    const track = document.getElementById("marcasTrack");
    if (!track) return;

    const cfg    = await getLandingConfig();
    const marcas = getMarcas(cfg);

    const tituloEl = document.getElementById("marcasTitulo");
    if (tituloEl) tituloEl.textContent = cfg.marcasTitulo || MARCAS_DEFAULT_TITULO;

    // Sin marcas configuradas la seccion se retira por completo. Se fuerza el
    // display porque la clase .section define el suyo y ganaria al atributo hidden.
    const seccion = document.getElementById("marcas");
    if (!marcas.length) {
        if (seccion) seccion.style.display = "none";
        return;
    }

    // El nombre siempre va en el DOM: con logo queda oculto por CSS y sirve
    // de respaldo si la imagen falla, asi el chip nunca se ve vacio.
    const chip = m => `
        <div class="brand-chip${m.logo ? " brand-chip--logo" : ""}">
            ${m.logo
                ? `<img src="${escapeHtml(m.logo)}" alt="${escapeHtml(m.nombre)}" loading="lazy"
                        onerror="this.remove();this.closest('.brand-chip').classList.remove('brand-chip--logo')">`
                : ""}
            <span class="brand-chip__nombre">${escapeHtml(m.nombre)}</span>
        </div>`;

    // Una copia visible + una copia clon: al desplazar el 50% del track
    // el resultado es identico al punto de partida, sin salto ni reinicio.
    const copia = marcas.map(chip).join("");
    track.innerHTML = copia + copia;

    const items = track.children;
    for (let i = marcas.length; i < items.length; i++) {
        items[i].setAttribute("aria-hidden", "true");
    }

    track.style.setProperty("--marquee-duration", `${Math.max(18, marcas.length * 4.5)}s`);
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
