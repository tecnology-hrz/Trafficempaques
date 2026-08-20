/* =======================================================
   Configuracion de la landing publica
   Documento Firestore: config/landing
   {
     banners: { hero_1: "https://...", ... },
     actualizado: "ISO date",
     actualizadoPor: "nombre"
   }

   Este modulo lo comparten el sitio publico y el panel de
   administracion, para que las claves de banner nunca se
   desincronicen entre ambos.
   ======================================================= */

import { db, doc, getDoc } from "./auth.js";

export const LANDING_DOC = { coleccion: "config", id: "landing" };

/**
 * Slots de banner disponibles.
 * key      -> clave guardada en Firestore
 * grupo    -> agrupacion visual en el panel
 * label    -> nombre visible
 * ayuda    -> recomendacion de medida / uso
 * fallback -> imagen local usada si no hay nada configurado
 */
export const BANNER_SLOTS = [
    {
        key: "hero_1", grupo: "Inicio", label: "Banner principal",
        ayuda: "Imagen unica del banner de inicio. Recomendado 1920 x 900 px, horizontal.",
        fallback: "public/img/hero-1.jpg"
    },
    {
        key: "linea_empaques", grupo: "Nuestras lineas", label: "Empaques - fondo",
        ayuda: "Fondo de la tarjeta de Empaques. Recomendado 1200 x 800 px.",
        fallback: "public/img/linea-empaques.jpg"
    },
    {
        key: "linea_empaques_icono", grupo: "Nuestras lineas", label: "Empaques - imagen pequeña",
        ayuda: "Miniatura cuadrada dentro de la tarjeta. Recomendado 300 x 300 px.",
        fallback: ""
    },
    {
        key: "linea_digital", grupo: "Nuestras lineas", label: "Digital - fondo",
        ayuda: "Fondo de la tarjeta de Digital. Recomendado 1200 x 800 px.",
        fallback: "public/img/linea-digital.jpg"
    },
    {
        key: "linea_digital_icono", grupo: "Nuestras lineas", label: "Digital - imagen pequeña",
        ayuda: "Miniatura cuadrada dentro de la tarjeta. Recomendado 300 x 300 px.",
        fallback: ""
    },
    {
        key: "equipo", grupo: "Inicio", label: "Foto del equipo",
        ayuda: "Imagen de la seccion Nuestro Equipo. Recomendado 1200 x 750 px.",
        fallback: "public/img/equipo.jpg"
    },
    {
        key: "productos_hero", grupo: "Paginas internas", label: "Banner de Productos",
        ayuda: "Encabezado de productos.html. Recomendado 1920 x 700 px.",
        fallback: "public/img/hero-2.jpg"
    },
    {
        key: "catalogo_hero", grupo: "Paginas internas", label: "Banner de Catalogo",
        ayuda: "Encabezado de catalogo.html. Recomendado 1920 x 700 px.",
        fallback: "public/img/hero-1.jpg"
    }
];

export const BANNER_GRUPOS = ["Inicio", "Nuestras lineas", "Paginas internas"];

export function slotPorKey(key) {
    return BANNER_SLOTS.find(s => s.key === key) || null;
}

/* -------------------------------------------------------
   GALERIA (seccion despues de Nuestro Equipo)
   Cada pieza: { id, tipo: "imagen"|"video", url, portada, titulo, texto }
   - imagen -> url de ImgBB
   - video  -> enlace de YouTube o Vimeo (portada opcional)
   ------------------------------------------------------- */
export const GALERIA_DEFAULT_TITULO = "Asi trabajamos";
export const GALERIA_DEFAULT_TEXTO =
    "Un recorrido por nuestra planta, los procesos y los empaques que salen cada dia.";

/** Extrae el id de un enlace de YouTube en sus formatos comunes. */
export function youtubeId(url = "") {
    const m = String(url).match(
        /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/
    );
    return m ? m[1] : null;
}

export function vimeoId(url = "") {
    const m = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? m[1] : null;
}

/** URL para incrustar en el reproductor, o null si no se reconoce. */
export function embedVideo(url) {
    const yt = youtubeId(url);
    if (yt) return `https://www.youtube.com/embed/${yt}?autoplay=1&rel=0`;
    const vm = vimeoId(url);
    if (vm) return `https://player.vimeo.com/video/${vm}?autoplay=1`;
    return null;
}

/** Miniatura de un item: portada propia o la de YouTube. */
export function portadaGaleria(item) {
    if (item?.portada) return item.portada;
    if (item?.tipo === "imagen") return item.url || "";
    const yt = youtubeId(item?.url);
    return yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : "";
}

export function esVideoValido(url) {
    return Boolean(embedVideo(url));
}

let _cache = null;

/** Lee la configuracion. Nunca lanza: si falla devuelve valores vacios. */
export async function getLandingConfig({ forzar = false } = {}) {
    if (_cache && !forzar) return _cache;
    try {
        const snap = await getDoc(doc(db, LANDING_DOC.coleccion, LANDING_DOC.id));
        const data = snap.exists() ? (snap.data() || {}) : {};
        _cache = {
            banners: data.banners || {},
            galeria: Array.isArray(data.galeria) ? data.galeria : [],
            galeriaTitulo: data.galeriaTitulo || GALERIA_DEFAULT_TITULO,
            galeriaTexto: data.galeriaTexto || GALERIA_DEFAULT_TEXTO,
            actualizado: data.actualizado || null
        };
    } catch (err) {
        console.warn("[landing-config] no se pudo leer config/landing", err);
        _cache = {
            banners: {}, galeria: [],
            galeriaTitulo: GALERIA_DEFAULT_TITULO,
            galeriaTexto: GALERIA_DEFAULT_TEXTO,
            actualizado: null
        };
    }
    return _cache;
}

/** URL final de un slot: la configurada o el fallback local. */
export function urlBanner(config, key) {
    const slot = slotPorKey(key);
    const url = config?.banners?.[key];
    return (url && String(url).trim()) ? url : (slot?.fallback || "");
}

/**
 * Aplica los banners al DOM.
 *  - [data-banner="key"]     -> background-image
 *  - [data-banner-img="key"] -> atributo src
 */
export function aplicarBanners(config, raiz = document) {
    raiz.querySelectorAll("[data-banner]").forEach(el => {
        const url = urlBanner(config, el.dataset.banner);
        if (url) el.style.backgroundImage = `url('${url}')`;
    });
    raiz.querySelectorAll("[data-banner-img]").forEach(el => {
        const url = urlBanner(config, el.dataset.bannerImg);
        if (!url) return;
        el.src = url;
        el.hidden = false;
        // Permite que el contenedor oculte su placeholder cuando hay imagen
        el.parentElement?.classList.add("has-img");
    });
}
