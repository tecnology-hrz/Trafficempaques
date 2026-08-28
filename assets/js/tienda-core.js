/* =======================================================
   TRAFFIC EMPAQUES - Nucleo de la tienda publica
   - Carga el catalogo desde Firestore (coleccion "catalogo")
   - Fallback a CATALOGO_DATA local si Firestore esta vacio o falla
   - Carrito en localStorage (solicitud de cotizacion, sin precios)
   - Utilidades UI compartidas: header, toast, zoom, whatsapp
   ======================================================= */

import { db, collection, getDocs, doc, getDoc } from "./auth.js";
import { CATALOGO_DATA } from "./catalogo-data.js";

/* -------------------------------------------------------
   CONFIGURACION DE MARCA
   ------------------------------------------------------- */
export const EMPRESA = {
    nombre: "Traffic Empaques",
    whatsapp: "573001234567",          // TODO: reemplazar por el numero real
    email: "comercial@trafficempaques.com",
    instagram: "https://instagram.com/",
    facebook: "https://facebook.com/"
};

/* Orden y metadatos de las categorias de la linea EMPAQUES.
   Las descripciones vienen de CATALOGO_DATA; aqui solo el orden. */
export const CATEGORIAS_ORDEN = [
    "Comidas Principales",
    "Completos y Compartidos",
    "Street Food",
    "Snacks y Acompañamientos",
    "Exhibicion y Servicio",
    "Vasos",
    "Otros"
];

/* -------------------------------------------------------
   HELPERS
   ------------------------------------------------------- */
export function slug(text) {
    return String(text || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

/** Medidas legibles: "Alto 10 cm · Largo 12 cm · Ancho 12 cm" */
export function formatMedidas(p) {
    const partes = [];
    if (p.alto && p.alto !== "-")  partes.push(`Alto ${p.alto}`);
    if (p.largo && p.largo !== "-") partes.push(`Largo ${p.largo}`);
    if (p.ancho && p.ancho !== "-") partes.push(`Ancho ${p.ancho}`);
    return partes.length ? partes.join(" · ") : "Medidas a consultar";
}

const PLACEHOLDER_IMG =
    "data:image/svg+xml;utf8," + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">
           <rect width="300" height="300" fill="#f1f2f4"/>
           <text x="150" y="155" font-family="sans-serif" font-size="16" fill="#a5a9b0"
                 text-anchor="middle">Sin imagen</text>
         </svg>`);

export function imgOrPlaceholder(url) {
    return url && String(url).trim() ? url : PLACEHOLDER_IMG;
}

/* -------------------------------------------------------
   CATALOGO
   ------------------------------------------------------- */
let _catalogoCache = null;

/**
 * Devuelve el catalogo normalizado:
 * [{ sku, nombre, categoria, alto, largo, ancho, imagen, orden, origen }]
 */
export async function getCatalogo() {
    if (_catalogoCache) return _catalogoCache;

    let productos = [];

    try {
        const snap = await getDocs(collection(db, "catalogo"));
        snap.forEach(d => {
            const data = d.data() || {};
            if (!data.nombre) return;
            productos.push(normalizar(data, "firestore", d.id));
        });
    } catch (err) {
        console.warn("[tienda] No se pudo leer Firestore, se usa el catalogo local.", err);
    }

    if (productos.length === 0) {
        productos = fallbackLocal();
    }

    // Orden: por posicion de categoria, luego por campo orden/id, luego nombre
    productos.sort((a, b) => {
        const ca = CATEGORIAS_ORDEN.indexOf(a.categoria);
        const cb = CATEGORIAS_ORDEN.indexOf(b.categoria);
        if (ca !== cb) return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb);
        if ((a.orden || 0) !== (b.orden || 0)) return (a.orden || 0) - (b.orden || 0);
        return a.nombre.localeCompare(b.nombre, "es");
    });

    // Evitar SKUs duplicados
    const vistos = new Map();
    productos.forEach(p => {
        const n = (vistos.get(p.sku) || 0) + 1;
        vistos.set(p.sku, n);
        if (n > 1) p.sku = `${p.sku}-${n}`;
    });

    _catalogoCache = productos;
    return productos;
}

function normalizar(data, origen, docId) {
    const categoria = data.categoria || "Otros";
    const nombre = data.nombre;
    return {
        sku: `${slug(categoria)}--${slug(nombre)}`,
        docId: docId || null,
        nombre,
        categoria,
        alto:  data.alto  ?? "-",
        largo: data.largo ?? "-",
        ancho: data.ancho ?? "-",
        imagen: imgOrPlaceholder(data.imagen),
        orden: Number(data.orden ?? data.id ?? 0),
        // Precio unitario base y escalas por cantidad, administrados desde el
        // panel (Catalogo > producto). Si precio es 0 el producto se muestra
        // como "a cotizar" y no suma al total.
        precio: Number(data.precio) || 0,
        tiers: normalizarTiers(data.tiers),
        // Descuento administrado desde el panel (Catalogo > producto).
        // Solo cuenta como descuento si hay porcentaje: un booleano sin
        // porcentaje seria una promesa vacia en la tarjeta.
        descuento: Boolean(data.descuento) && Number(data.descuentoPct) > 0,
        descuentoPct: Number(data.descuentoPct) || 0,
        origen
    };
}

/* -------------------------------------------------------
   PRECIOS
   Un producto puede tener:
   - precio: valor unitario base (desde 1 unidad)
   - tiers:  escalas por cantidad [{ min, precio }], donde "precio" es el
             valor unitario a partir de "min" unidades.
   Se elige la escala mas alta cuyo "min" no supere la cantidad pedida.
   ------------------------------------------------------- */
function normalizarTiers(tiers) {
    if (!Array.isArray(tiers)) return [];
    return tiers
        .map(t => ({ min: parseInt(t?.min) || 0, precio: Number(t?.precio) || 0 }))
        .filter(t => t.min > 0 && t.precio > 0)
        .sort((a, b) => a.min - b.min);
}

/** true si el producto tiene algun precio publicable. */
export function tienePrecio(p) {
    return (Number(p?.precio) || 0) > 0 || normalizarTiers(p?.tiers).length > 0;
}

/** Valor unitario ANTES de descuento, segun la cantidad pedida. */
export function precioUnitarioBase(p, cantidad) {
    const cant = Math.max(1, parseInt(cantidad) || 1);
    let valor = Number(p?.precio) || 0;
    normalizarTiers(p?.tiers).forEach(t => {
        if (cant >= t.min) valor = t.precio;
    });
    return Math.round(valor);
}

/** Valor unitario final (con descuento aplicado si el producto lo tiene). */
export function precioUnitario(p, cantidad) {
    const base = precioUnitarioBase(p, cantidad);
    if (!base) return 0;
    const pct = p?.descuento && Number(p.descuentoPct) > 0 ? Number(p.descuentoPct) : 0;
    return pct > 0 ? Math.round(base * (1 - pct / 100)) : base;
}

/** Formato de moneda colombiana sin decimales: $1.250 */
export function formatCOP(valor) {
    const num = Math.round(Number(valor) || 0);
    return "$" + num.toLocaleString("es-CO");
}

/** Texto de la escala vigente, para mostrar debajo del precio. */
export function textoEscala(p, cantidad) {
    const tiers = normalizarTiers(p?.tiers);
    if (tiers.length === 0) return "";
    const cant = Math.max(1, parseInt(cantidad) || 1);
    let vigente = null;
    tiers.forEach(t => { if (cant >= t.min) vigente = t; });
    const siguiente = tiers.find(t => t.min > cant);
    if (siguiente) {
        return `Desde ${siguiente.min.toLocaleString("es-CO")} und: ${formatCOP(siguiente.precio)} c/u`;
    }
    return vigente ? `Precio por volumen (desde ${vigente.min.toLocaleString("es-CO")} und)` : "";
}

/** Precio "desde" para mostrar en tarjetas sin cantidad elegida. */
export function precioDesde(p) {
    const tiers = normalizarTiers(p?.tiers);
    const candidatos = [Number(p?.precio) || 0, ...tiers.map(t => t.precio)].filter(v => v > 0);
    if (candidatos.length === 0) return 0;
    const min = Math.min(...candidatos);
    const pct = p?.descuento && Number(p.descuentoPct) > 0 ? Number(p.descuentoPct) : 0;
    return pct > 0 ? Math.round(min * (1 - pct / 100)) : min;
}

/** Productos con descuento activo, en el orden del catalogo. */
export function productosEnDescuento(productos) {
    return (productos || []).filter(p => p.descuento && p.descuentoPct > 0);
}

function fallbackLocal() {
    const out = [];
    for (const [categoria, info] of Object.entries(CATALOGO_DATA)) {
        (info.productos || []).forEach(p => {
            out.push(normalizar({ ...p, categoria, orden: p.id }, "local", null));
        });
    }
    return out;
}

/** Metadatos (icono, descripcion, usos) de una categoria. */
export function getCategoriaInfo(categoria) {
    const meta = CATALOGO_DATA[categoria] || {};
    return {
        nombre: categoria,
        slug: slug(categoria),
        icon: meta.icon || "bi-box2",
        descripcion: meta.descripcion || "Empaques personalizados para tu marca",
        usos: meta.usos || ""
    };
}

/** Agrupa el catalogo por categoria respetando CATEGORIAS_ORDEN. */
export function agruparPorCategoria(productos) {
    const mapa = new Map();
    CATEGORIAS_ORDEN.forEach(c => mapa.set(c, []));
    productos.forEach(p => {
        if (!mapa.has(p.categoria)) mapa.set(p.categoria, []);
        mapa.get(p.categoria).push(p);
    });
    // Quitar categorias sin productos
    for (const [k, v] of mapa) if (v.length === 0) mapa.delete(k);
    return mapa;
}

export function buscarPorSku(productos, sku) {
    return productos.find(p => p.sku === sku) || null;
}

export function categoriaDesdeSlug(valor) {
    if (!valor) return null;
    return CATEGORIAS_ORDEN.find(c => slug(c) === slug(valor))
        || Object.keys(CATALOGO_DATA).find(c => slug(c) === slug(valor))
        || null;
}

/* -------------------------------------------------------
   CARRITO (localStorage)
   ------------------------------------------------------- */
const CART_KEY = "traffic_carrito_v1";

export function getCarrito() {
    try {
        const raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
        return Array.isArray(raw) ? raw.filter(i => i && i.sku) : [];
    } catch {
        return [];
    }
}

function guardarCarrito(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    document.dispatchEvent(new CustomEvent("carrito:cambio", { detail: items }));
    pintarBadgeCarrito();
}

export function agregarAlCarrito(producto, cantidad = 1) {
    const cant = Math.max(1, parseInt(cantidad) || 1);
    const items = getCarrito();
    const existente = items.find(i => i.sku === producto.sku);

    if (existente) {
        existente.cantidad += cant;
    } else {
        items.push({
            sku: producto.sku,
            nombre: producto.nombre,
            categoria: producto.categoria,
            imagen: producto.imagen,
            alto: producto.alto,
            largo: producto.largo,
            ancho: producto.ancho,
            // Precio vigente al agregar. En el carrito se refresca contra el
            // catalogo actual, asi que esto es solo un respaldo.
            precio: Number(producto.precio) || 0,
            tiers: Array.isArray(producto.tiers) ? producto.tiers : [],
            // Se guarda el descuento vigente al agregar, para que la
            // solicitud de cotizacion llegue con ese dato al equipo
            descuento: Boolean(producto.descuento),
            descuentoPct: Number(producto.descuentoPct) || 0,
            cantidad: cant
        });
    }
    guardarCarrito(items);
    return items;
}

export function actualizarCantidad(sku, cantidad) {
    const items = getCarrito();
    const item = items.find(i => i.sku === sku);
    if (!item) return items;
    const cant = parseInt(cantidad) || 0;
    if (cant <= 0) return quitarDelCarrito(sku);
    item.cantidad = cant;
    guardarCarrito(items);
    return items;
}

export function quitarDelCarrito(sku) {
    const items = getCarrito().filter(i => i.sku !== sku);
    guardarCarrito(items);
    return items;
}

export function vaciarCarrito() {
    guardarCarrito([]);
}

export function totalUnidades() {
    return getCarrito().reduce((acc, i) => acc + (parseInt(i.cantidad) || 0), 0);
}

export function pintarBadgeCarrito() {
    const total = totalUnidades();
    document.querySelectorAll("[data-cart-count]").forEach(el => {
        el.textContent = total;
        el.style.display = total > 0 ? "flex" : "none";
    });
}

/* -------------------------------------------------------
   UI COMPARTIDA
   ------------------------------------------------------- */
export function toast(mensaje, tipo = "ok") {
    let stack = document.querySelector(".toast-stack");
    if (!stack) {
        stack = document.createElement("div");
        stack.className = "toast-stack";
        document.body.appendChild(stack);
    }
    const el = document.createElement("div");
    el.className = `toast${tipo === "error" ? " toast--error" : ""}`;
    el.setAttribute("role", "status");
    el.innerHTML = `<i class="bi ${tipo === "error" ? "bi-exclamation-circle" : "bi-check-circle"}"></i>
                    <span>${escapeHtml(mensaje)}</span>`;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 2800);
}

/** Header: sombra al hacer scroll + menu movil. */
export function initHeader() {
    const header = document.querySelector(".site-header");
    const toggle = document.querySelector(".nav-toggle");
    const mobile = document.querySelector(".nav-mobile");

    if (header) {
        const onScroll = () => header.classList.toggle("site-header--solid", window.scrollY > 20);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
    }

    if (toggle && mobile) {
        const icono = toggle.querySelector("i");

        const cerrar = () => {
            mobile.classList.remove("is-open");
            toggle.setAttribute("aria-expanded", "false");
            document.body.style.overflow = "";
            if (icono) icono.className = "bi bi-list";
        };

        toggle.addEventListener("click", () => {
            const abierto = mobile.classList.toggle("is-open");
            toggle.setAttribute("aria-expanded", String(abierto));
            // Evita el scroll del fondo mientras el panel esta abierto
            document.body.style.overflow = abierto ? "hidden" : "";
            if (icono) icono.className = abierto ? "bi bi-x-lg" : "bi bi-list";
        });

        // Cerrar al navegar dentro de la misma pagina (anclas) o con Escape
        mobile.querySelectorAll("a").forEach(a => a.addEventListener("click", cerrar));
        document.addEventListener("keydown", e => { if (e.key === "Escape") cerrar(); });
    }

    pintarBadgeCarrito();
}

/** Modal de zoom de imagen reutilizable. */
export function initZoom() {
    let modal = document.querySelector(".zoom-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.className = "zoom-modal";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-label", "Vista ampliada del producto");
        modal.innerHTML = `
            <button class="zoom-modal__close" aria-label="Cerrar vista ampliada">
                <i class="bi bi-x"></i>
            </button>
            <img src="" alt="Producto ampliado">`;
        document.body.appendChild(modal);
    }
    const img = modal.querySelector("img");
    const cerrar = () => { modal.classList.remove("is-open"); document.body.style.overflow = ""; };

    modal.querySelector(".zoom-modal__close").addEventListener("click", cerrar);
    modal.addEventListener("click", e => { if (e.target === modal) cerrar(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") cerrar(); });

    return function abrirZoom(src, alt = "Producto ampliado") {
        img.src = src;
        img.alt = alt;
        modal.classList.add("is-open");
        document.body.style.overflow = "hidden";
    };
}

export function whatsappLink(mensaje, numero) {
    return `https://wa.me/${numero || EMPRESA.whatsapp}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * Numero de WhatsApp a usar. Permite sobreescribir el constante desde
 * Firestore (config/landing campo "whatsapp") sin tocar codigo.
 * Nunca lanza: si algo falla devuelve el numero por defecto.
 */
let _whatsappCache = null;
export async function getWhatsappNumero() {
    if (_whatsappCache) return _whatsappCache;
    try {
        const snap = await getDoc(doc(db, "config", "landing"));
        const num = snap.exists() ? String(snap.data().whatsapp || "").replace(/[^0-9]/g, "") : "";
        _whatsappCache = num || EMPRESA.whatsapp;
    } catch {
        _whatsappCache = EMPRESA.whatsapp;
    }
    return _whatsappCache;
}

/** Marca el enlace de navegacion activo segun data-nav. */
export function marcarNav(clave) {
    document.querySelectorAll(`[data-nav]`).forEach(el => {
        el.classList.toggle("is-active", el.dataset.nav === clave);
    });
}
