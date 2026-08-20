/* =======================================================
   Header, menu movil, footer y boton flotante compartidos.
   Se inyectan en los contenedores:
     <div data-layout="header"></div>
     <div data-layout="footer"></div>
   ======================================================= */

import { EMPRESA, CATEGORIAS_ORDEN, slug, initHeader, marcarNav, whatsappLink } from "./tienda-core.js";
import { getLandingConfig, aplicarBanners } from "./landing-config.js";

const NAV = [
    { clave: "inicio",    texto: "Inicio",    href: "index.html",          icon: "bi-house-door" },
    { clave: "productos", texto: "Productos", href: "productos.html",      icon: "bi-box-seam" },
    { clave: "contacto",  texto: "Contacto",  href: "index.html#contacto", icon: "bi-chat-dots" }
];

function headerHTML() {
    const links = NAV.map(n =>
        `<a class="nav-link" data-nav="${n.clave}" href="${n.href}">${n.texto}</a>`).join("");

    const linksMovil = NAV.map(n =>
        `<a data-nav-movil="${n.clave}" href="${n.href}">
            <i class="bi ${n.icon}"></i> ${n.texto}
         </a>`).join("");

    return `
    <header class="site-header">
        <div class="container header-inner">
            <button class="nav-toggle" type="button" aria-label="Abrir menu" aria-expanded="false">
                <i class="bi bi-list"></i>
            </button>
            <nav class="nav-main" aria-label="Navegacion principal">${links}</nav>

            <a class="header-logo" href="index.html" aria-label="Traffic Empaques - Inicio">
                <img src="public/img/logo.png" alt="Traffic Empaques">
            </a>

            <div class="header-actions">
                <a class="cart-button" href="carrito.html" aria-label="Ver carrito de cotizacion">
                    <i class="bi bi-cart3"></i>
                    <span class="cart-count" data-cart-count style="display:none">0</span>
                </a>
                <a class="login-button" href="login.html" title="Acceso para el equipo Traffic">
                    <i class="bi bi-person-circle"></i>
                    <span>Iniciar sesion</span>
                </a>
            </div>
        </div>
    </header>
    <nav class="nav-mobile" aria-label="Navegacion movil">
        ${linksMovil}
        <a href="carrito.html"><i class="bi bi-cart3"></i> Mi cotizacion</a>
        <a class="nav-mobile__login" href="login.html">
            <i class="bi bi-person-circle"></i> Iniciar sesion
        </a>
    </nav>`;
}

function footerHTML() {
    const cats = CATEGORIAS_ORDEN.map(c =>
        `<li><a href="catalogo.html?cat=${encodeURIComponent(slug(c))}">
            <i class="bi bi-chevron-right"></i>${c}</a></li>`).join("");

    return `
    <footer class="site-footer" id="pie">
        <div class="container">
            <div class="cta-bar">
                <div>
                    <span class="cta-bar__eyebrow">${EMPRESA.nombre}</span>
                    <h2 class="cta-bar__title">Listo para realizar tu orden?</h2>
                </div>
                <div class="cta-bar__actions">
                    <a class="btn btn--ghost-light" href="productos.html">Realizar orden</a>
                    <a class="btn btn--primary" href="${whatsappLink("Hola, quiero informacion sobre empaques personalizados.")}"
                       target="_blank" rel="noopener">Contacto</a>
                </div>
            </div>

            <div class="footer-grid">
                <div class="footer-col">
                    <h4>Productos</h4>
                    <ul>${cats}</ul>
                </div>
                <div class="footer-col">
                    <h4>Lineas</h4>
                    <ul>
                        <li><a href="productos.html?linea=empaques"><i class="bi bi-chevron-right"></i>Empaques</a></li>
                        <li><a href="productos.html?linea=digital"><i class="bi bi-chevron-right"></i>Digital (proximamente)</a></li>
                        <li><a href="catalogo.html"><i class="bi bi-chevron-right"></i>Todos los empaques</a></li>
                        <li><a href="carrito.html"><i class="bi bi-chevron-right"></i>Mi cotizacion</a></li>
                    </ul>
                </div>
                <div class="footer-col">
                    <h4>Nosotros</h4>
                    <ul>
                        <li><a href="index.html#equipo"><i class="bi bi-chevron-right"></i>Equipo</a></li>
                        <li><a href="index.html#marcas"><i class="bi bi-chevron-right"></i>Clientes</a></li>
                        <li><a href="index.html#beneficios"><i class="bi bi-chevron-right"></i>Por que nosotros</a></li>
                        <li><a href="login.html"><i class="bi bi-chevron-right"></i>Acceso equipo</a></li>
                    </ul>
                </div>
                <div class="footer-col">
                    <h4>Contactanos</h4>
                    <div class="social-row">
                        <a href="${EMPRESA.facebook}" target="_blank" rel="noopener" aria-label="Facebook"><i class="bi bi-facebook"></i></a>
                        <a href="${EMPRESA.instagram}" target="_blank" rel="noopener" aria-label="Instagram"><i class="bi bi-instagram"></i></a>
                        <a href="${whatsappLink("Hola, quiero cotizar empaques.")}" target="_blank" rel="noopener" aria-label="WhatsApp"><i class="bi bi-whatsapp"></i></a>
                        <a href="mailto:${EMPRESA.email}" aria-label="Correo electronico"><i class="bi bi-envelope-fill"></i></a>
                    </div>
                </div>
            </div>

            <div class="footer-bottom">
                <span>&copy; ${new Date().getFullYear()} ${EMPRESA.nombre} - Publicidad. Todos los derechos reservados.</span>
                <span>Desarrollado por <a href="#">TECNOLOGIA HRZ</a></span>
            </div>
        </div>
    </footer>

    <a class="wa-float" href="${whatsappLink("Hola, quiero realizar un pedido.")}"
       target="_blank" rel="noopener" aria-label="Escribenos por WhatsApp" title="WhatsApp">
        <i class="bi bi-whatsapp"></i>
    </a>`;
}

export function initLayout(navActivo = "") {
    const slotHeader = document.querySelector('[data-layout="header"]');
    const slotFooter = document.querySelector('[data-layout="footer"]');

    if (slotHeader) slotHeader.outerHTML = headerHTML();
    if (slotFooter) slotFooter.outerHTML = footerHTML();

    initHeader();
    if (navActivo) marcarNav(navActivo);

    // Banners administrables (config/landing). No bloquea el render.
    getLandingConfig().then(cfg => aplicarBanners(cfg));
}
