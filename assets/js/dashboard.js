import { db, collection, getDocs, doc, setDoc, getDoc, deleteDoc, storage, storageRef, uploadBytes, getDownloadURL, listAll, getMetadata, deleteObject } from "./auth.js";
import { onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    cargarCatalogos, crearCotizacion, obtenerCotizaciones, eliminarCotizacion,
    obtenerCotizacionesEliminadas, restaurarCotizacion, eliminarCotizacionDefinitivo,
    getProductosImprenta, getProductosDigital, getTerminados, getColores,
    getMateriales, getPlanchas,
    getFormatMoney, getParseMoney
} from "./cotizador.js";
import { CATALOGO_DATA } from "./catalogo-data.js";
import { EMAILJS_CONFIG } from "../../config/emailjs-config.js";
import {
    BANNER_SLOTS, BANNER_GRUPOS, LANDING_DOC, getLandingConfig,
    portadaGaleria, esVideoValido, GALERIA_DEFAULT_TITULO, GALERIA_DEFAULT_TEXTO,
    HERO_DEFAULT, getHeroTextos, PREVIEW_KEY,
    HERO_SLIDE_KEYS, CAMPANIA_MAX, CAMPANIA_DEFAULT_TITULO, CAMPANIA_DEFAULT_TEXTO,
    normalizarCampania,
    MARCAS_MAX, MARCAS_DEFAULT, MARCAS_DEFAULT_TITULO, normalizarMarcas
} from "./landing-config.js";

// Inicializar EmailJS (SDK cargado desde el CDN en dashboard.html)
if (window.emailjs && EMAILJS_CONFIG.publicKey) {
    window.emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
}

// Verificar sesion
const rol    = sessionStorage.getItem("userRol");
const nombre = sessionStorage.getItem("userName");

// Etapas que cada rol puede ver en el timeline de seguimiento.
// Si un rol no esta listado aqui, ve todas las etapas de la orden.
const PASOS_VISIBLES_POR_ROL = {
    digital: ["impresion", "empaques", "terminado"]
};

if (!rol || !nombre) {
    window.location.href = "login.html";
}

const formatMoney = getFormatMoney();
const parseMoney  = getParseMoney();

// ===== CLIPBOARD HELPER (fallback para contextos no seguros) =====
function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    // Fallback para HTTP / file://
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand("copy");
    } catch (e) {
        console.warn("No se pudo copiar al portapapeles", e);
    }
    document.body.removeChild(textarea);
    return Promise.resolve();
}

// ===== ESTADO: PRODUCCION DEL DIA =====
// Se declara aqui (antes de initDashboard) porque las funciones "pdia*" del
// final del archivo se invocan durante la inicializacion, y las variables
// declaradas con let/const no existen hasta que el modulo llega a su linea.
const PDIA_COL = "produccionDia";

let pdiaFechaActual   = pdiaHoyISO();
let pdiaPlanCache     = null;   // doc del dia actualmente visible
let pdiaOrdenesCache  = [];     // ordenes de la coleccion "produccion" (para el selector)
let pdiaSeleccion     = new Set();
let pdiaReagendarCtx  = null;   // { fecha, ordenId }

// ===== ESTADO: DESPACHOS DIARIOS =====
const PDESP_COL = "despachosDia";

let pdespDiasCache    = [];     // [{ fecha, despachos: [...] }] todos los dias
let pdespOrdenesCache = [];     // ordenes de "produccion" para el selector
let pdespOrdenSel     = null;   // orden elegida en el modal

initDashboard(rol, nombre);

async function initDashboard(rol, nombre) {
    const initials = nombre.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
    document.getElementById("userAvatar").textContent = initials;
    document.getElementById("userName").textContent   = nombre;
    document.getElementById("userRole").textContent   = rol;

    const badge = document.getElementById("roleBadge");
    badge.textContent = rol.charAt(0).toUpperCase() + rol.slice(1);
    badge.className   = "role-badge " + rol;

    const now = new Date();
    document.getElementById("currentDate").textContent = now.toLocaleDateString("es-MX", {
        weekday: "short", day: "numeric", month: "short"
    });


    // remisionFiltro: sel;

    if (rol !== "administrador" && rol !== "ventas" && rol !== "ordenes") {
        document.querySelectorAll("[data-role]").forEach(el => {
            const roles = el.dataset.role.split(",");
            if (!roles.includes(rol)) {
                el.style.display = "none";
            }
        });
        activateSection("ordenes");
    }

    // Rol ordenes: solo ve ordenes
    if (rol === "ordenes") {
        document.querySelectorAll("[data-role]").forEach(el => {
            const roles = el.dataset.role.split(",");
            if (!roles.includes("ordenes")) {
                el.style.display = "none";
            }
        });
        activateSection("ordenes");
    }

    // Roles de area (guillotina, impresion, troquelado, vasos, empaques): solo ven seguimiento
    const rolesArea = ["guillotina", "impresion", "troquelado", "vasos", "empaques"];
    if (rolesArea.includes(rol)) {
        activateSection("seguimiento");
    }

    // Rol jefe de produccion: arranca en Produccion del dia
    if (rol === "jefe_produccion") {
        activateSection("produccion-dia");
    }

    // Rol ventas: ocultar solo lo que no le corresponde
    if (rol === "ventas") {
        document.querySelectorAll("[data-role]").forEach(el => {
            const roles = el.dataset.role.split(",");
            if (!roles.includes("ventas")) {
                el.style.display = "none";
            }
        });
        activateSection("cotizador");
    }

    setupOrdenesByRole(rol);
    setupOrdenesFiltros(rol);
    setupNavigation();
    setupTabs();
    setupModal();
    setupConfirm();
    setupNotifModal();
    setupAccionesModal();
    loadConfig();
    setupOrdenDetalleModal(); // Modal detalle orden para todos los roles
    setupPacdoraModal(); // Modal Pacdora 3D preview

    // Cotizador (admin y ventas)
    if (rol === "administrador" || rol === "ventas") {
        await cargarCatalogos();
        setupCotizador();
        setupMultiSelectModal();
        setupProductoSelectModal();
        cargarListaCotizaciones();
        setupModalDetalle();
    }

    // Clientes: solo admin, ventas y ordenes (los roles de produccion no ven clientes)
    if (rol === "administrador" || rol === "ventas" || rol === "ordenes") {
        setupClientes();
        cargarClientes();
    }

    // Solo admin
    if (rol === "administrador") {
        setupUsuarios();
        cargarUsuarios();
        setupFinanzas();
        cargarFinanzas();
        setupCatalogoAdmin();
        setupLandingAdmin();
        setupPapelera();
        cargarPapelera();
        setupDocumentos();
        cargarDocumentos();
    }

    // Ventas: finanzas propias
    if (rol === "ventas") {
        setupFinanzas();
        cargarFinanzas();
    }

    // Inventario de carton: admin y guillotina
    if (rol === "administrador" || rol === "guillotina") {
        setupInventario();
        cargarInventario();
    }

    // Seguimiento: visible para todos los roles
    setupSeguimiento();
    setupSegCantidadModal();
    cargarSeguimiento();

    // Remision: admin, ventas, ordenes
    if (rol === "administrador" || rol === "ventas" || rol === "ordenes") {
        setupRemision();
        cargarRemision();
    }

    // Produccion del dia: admin (programa) y jefe de produccion (reporta)
    if (rol === "administrador" || rol === "jefe_produccion") {
        setupProduccionDia();
        cargarProduccionDia();
    }

    // Cargar ordenes para todos los roles
    cargarOrdenes(rol);
    cargarDisenosAprobados(rol);

    // Iniciar sistema de notificaciones
    setupNotificaciones();

    document.getElementById("btnLogout").addEventListener("click", () => {
        showConfirm("Cerrar sesion", "Estas seguro que deseas cerrar sesion?", logout);
    });
    document.getElementById("btnLogoutMobile").addEventListener("click", () => {
        showConfirm("Cerrar sesion", "Estas seguro que deseas cerrar sesion?", logout);
    });
}

// ===== ORDENES POR ROL =====
function setupOrdenesByRole(rol) {
    const tabBar      = document.getElementById("ordenesTabBar");
    const tabDigital  = document.getElementById("tab-digital");
    const tabImprenta = document.getElementById("tab-imprenta");
    const rolTabBar   = document.getElementById("ordenesRolTabBar");
    const tabPendientes = document.getElementById("tab-pendientes");
    const tabDisenosAprobados = document.getElementById("tab-disenosAprobados");

    const rolesArea = ["digital", "imprenta", "diseno", "guillotina", "impresion", "troquelado", "vasos", "empaques"];
    if (rolesArea.includes(rol)) {
        tabBar.style.display = "none";
        tabDigital.style.display = "none";
        tabDigital.classList.remove("active");
        tabImprenta.style.display = "none";
        // Mostrar tabs de rol
        rolTabBar.style.display = "flex";
        tabPendientes.classList.add("active");
    }
    // El rol "ordenes" ve ambos tabs igual que admin
}

// ===== FILTROS ORDENES (para todos los roles) =====
function setupOrdenesFiltros(rolUsuario) {
    const inputOrdenesBuscar = document.getElementById("ordenesBuscar");
    if (inputOrdenesBuscar) inputOrdenesBuscar.addEventListener("input", () => renderOrdenesConFiltro(ordenesRolCache || rolUsuario));
    const selectOrdenesEstado = document.getElementById("ordenesFiltroEstado");
    if (selectOrdenesEstado) selectOrdenesEstado.addEventListener("change", () => renderOrdenesConFiltro(ordenesRolCache || rolUsuario));

    const btnExcel = document.getElementById("btnOrdenesExcel");
    if (btnExcel) btnExcel.addEventListener("click", () => exportarOrdenesExcel(btnExcel));
}

// ===== EXPORTAR ORDENES A EXCEL =====
// Exporta exactamente lo que se esta viendo: el tab activo con los filtros
// de busqueda y estado ya aplicados.

// Tab visible -> contenedor donde se pintaron esas ordenes
const ORDENES_TAB_CONTENEDOR = {
    "tab-digital":    { contenedor: "ordenesDigitalLista",    etiqueta: "Digital" },
    "tab-imprenta":   { contenedor: "ordenesImprentaLista",   etiqueta: "Imprenta" },
    "tab-pendientes": { contenedor: "ordenesPendientesLista", etiqueta: "Pendientes" }
};

const COLUMNAS_ORDENES_EXCEL = [
    { campo: "numero",        titulo: "Orden",            ancho: 14 },
    { campo: "tipo",          titulo: "Tipo",             ancho: 10 },
    { campo: "cliente",       titulo: "Cliente",          ancho: 26 },
    { campo: "negocio",       titulo: "Negocio",          ancho: 26 },
    { campo: "ciudad",        titulo: "Ciudad",           ancho: 18 },
    { campo: "telefono",      titulo: "Telefono",         ancho: 16 },
    { campo: "direccion",     titulo: "Direccion",        ancho: 30 },
    { campo: "nit",           titulo: "NIT / Documento",  ancho: 18 },
    { campo: "estadoTiempo",  titulo: "Estado de tiempo", ancho: 16 },
    { campo: "estadoDiseno",  titulo: "Diseño",           ancho: 18 },
    { campo: "pasoActual",    titulo: "Etapa actual",     ancho: 16 },
    { campo: "fechaEnvio",    titulo: "Fecha de envio",   ancho: 15 },
    { campo: "fechaEntrega",  titulo: "Fecha de entrega", ancho: 15 },
    { campo: "referencias",   titulo: "Referencias",      ancho: 12 },
    { campo: "unidades",      titulo: "Unidades",         ancho: 12 },
    { campo: "total",         titulo: "Total",            ancho: 14 },
    { campo: "metodoPago",    titulo: "Metodo de pago",   ancho: 16 },
    { campo: "creadoPor",     titulo: "Creado por",       ancho: 22 }
];

const ETIQUETA_ESTADO_TIEMPO = {
    atiempo:  "A tiempo",
    pronto:   "Pronto",
    vencida:  "Vencida / Hoy",
    sinfecha: "Sin fecha limite"
};

/** Fecha ISO a dd/mm/aaaa. Deja pasar lo que ya viene en ese formato. */
function fechaCorta(valor) {
    if (!valor) return "";
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) return valor;
    const d = new Date(valor);
    if (isNaN(d)) return String(valor);
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Convierte una orden en la fila plana que va al Excel. */
function ordenAFilaExcel(orden) {
    const items = orden.items || [];
    const diseno = ordenesDisenoDB[orden.id + "-diseno"];

    let estadoDiseno = "Sin crear";
    if (diseno && diseno.estado === "respondida") estadoDiseno = "Respondido";
    else if (diseno) estadoDiseno = "Pendiente";
    else if (calcularEstadoOrden(orden) === "vencida") estadoDiseno = "Vencido sin crear";

    return {
        numero:       orden.numero || "",
        tipo:         orden.tipo === "digital" ? "Digital" : "Imprenta",
        cliente:      orden.cliente || "",
        negocio:      orden.negocio || "",
        ciudad:       orden.ciudad || "",
        telefono:     orden.telefono || "",
        direccion:    orden.direccion || "",
        nit:          orden.nit || "",
        estadoTiempo: ETIQUETA_ESTADO_TIEMPO[calcularEstadoOrden(orden)] || "",
        estadoDiseno,
        pasoActual:   orden.pasoActual || "",
        fechaEnvio:   fechaCorta(orden.fechaEnvio),
        fechaEntrega: fechaCorta(orden.fechaEntrega),
        referencias:  items.length,
        unidades:     items.reduce((s, i) => s + (parseInt(i.cantidad) || 0), 0),
        // Numerico, para que Excel pueda sumar y filtrar
        total:        parseInt(orden.total) || 0,
        metodoPago:   orden.metodoPago || "",
        creadoPor:    orden.creadoPor || ""
    };
}

async function exportarOrdenesExcel(btn) {
    if (typeof window.exportarExcel !== "function") {
        showNotifToast("El modulo de exportacion no esta disponible");
        return;
    }

    // Tab visible dentro de la seccion de ordenes
    const tabActivo = document.querySelector("#ordenesListaView .tab-content.active");
    const info = ORDENES_TAB_CONTENEDOR[tabActivo?.id];

    if (!info) {
        showNotifToast("Cambia a un listado de ordenes para exportar");
        return;
    }

    const ordenes = ordenesRenderizadas[info.contenedor] || [];
    if (!ordenes.length) {
        showNotifToast("No hay ordenes que coincidan con los filtros");
        return;
    }

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-arrow-repeat" style="animation:spin .7s linear infinite"></i> Exportando...';

    try {
        const filas = ordenes.map(ordenAFilaExcel);
        const { formato } = await window.exportarExcel(filas, COLUMNAS_ORDENES_EXCEL, {
            archivo: `ordenes_${info.etiqueta.toLowerCase()}`,
            hoja: `Ordenes ${info.etiqueta}`,
            titulo: `Ordenes ${info.etiqueta} - Traffic Empaques`
        });

        showNotifToast(
            formato === "csv"
                ? `${filas.length} ordenes exportadas en CSV (Excel no disponible)`
                : `${filas.length} ordenes exportadas a Excel`
        );
    } catch (err) {
        console.error("[ordenes] error exportando a Excel", err);
        showNotifToast("No se pudo generar el archivo");
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
}

// ===== FORMATO MONEDA =====
function formatMoneyLocal(value) {
    const num = parseInt(value) || 0;
    return num.toLocaleString("en-US");
}

function parseMoneyLocal(str) {
    return parseInt(String(str).replace(/,/g, "").replace(/[^0-9]/g, "")) || 0;
}

function formatInputMoney(input) {
    input.addEventListener("input", () => {
        let raw = input.value.replace(/[^0-9]/g, "");
        let num = parseInt(raw) || 0;
        input.value = num > 0 ? num.toLocaleString("en-US") : "";
    });
}

// ===== NAVEGACION =====
function setupNavigation() {
    const allNavItems = document.querySelectorAll("[data-section]");
    allNavItems.forEach(item => {
        item.addEventListener("click", () => {
            activateSection(item.dataset.section);
        });
    });
}

function activateSection(target) {
    const sections     = document.querySelectorAll(".section");
    const sidebarItems = document.querySelectorAll(".sidebar-nav .nav-item[data-section]");
    const bottomItems  = document.querySelectorAll(".bottom-nav-item[data-section]");

    sections.forEach(s => s.classList.remove("active"));
    const el = document.getElementById("section-" + target);
    if (el) el.classList.add("active");

    sidebarItems.forEach(n => n.classList.toggle("active", n.dataset.section === target));
    bottomItems.forEach(n => n.classList.toggle("active", n.dataset.section === target));

    const titles = { cotizador: "Cotizador", ordenes: "Ordenes", seguimiento: "Seguimiento", disenos: "Diseños", clientes: "Clientes", finanzas: "Finanzas", usuarios: "Usuarios", configuracion: "Configuracion", "catalogo-admin": "Catálogo", landing: "Landing Page", inventario: "Inventario", documentos: "Documentos", "produccion-dia": "Producción del día" };
    document.getElementById("topbarTitle").textContent = titles[target] || target;
}

// ===== TABS ORDENES =====
function setupTabs() {
    const allTabBars = document.querySelectorAll(".tab-bar");

    allTabBars.forEach(bar => {
        const btns = bar.querySelectorAll(".tab-btn");
        // Obtener el contenedor padre que agrupa este tab-bar con sus tab-content
        const parentContainer = bar.parentElement;
        btns.forEach(btn => {
            btn.addEventListener("click", () => {
                const target = btn.dataset.tab;
                // Desactivar solo los tabs de este bar
                btns.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                // Desactivar solo los tab-content dentro del mismo contenedor padre
                parentContainer.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
                const el = document.getElementById("tab-" + target);
                if (el) el.classList.add("active");
            });
        });
    });
}

// ===== MODAL CONFIG =====
let currentCollection = "";
let currentHasValue = false;
let editingId = null;

function setupModal() {
    const overlay   = document.getElementById("modalOverlay");
    const inputName = document.getElementById("modalInputName");
    const inputVal  = document.getElementById("modalInputValue");
    const btnSave   = document.getElementById("modalSave");
    const btnClose  = document.getElementById("modalClose");
    const btnCancel = document.getElementById("modalCancel");

    formatInputMoney(inputVal);

    document.getElementById("btnAddProductoImprenta").addEventListener("click", () => {
        openModal("Agregar Producto Imprenta", "productosImprenta", true, "", "");
    });
    document.getElementById("btnAddProductoDigital").addEventListener("click", () => {
        openModal("Agregar Producto Digital", "productosDigital", true, "", "");
    });
    document.getElementById("btnAddTerminado").addEventListener("click", () => {
        openModal("Agregar Terminado", "terminados", true, "", "0");
    });
    document.getElementById("btnAddColor").addEventListener("click", () => {
        openModal("Agregar Color", "colores", false, "", "");
    });
    document.getElementById("btnAddMaterial").addEventListener("click", () => {
        openModal("Agregar Material", "materiales", false, "", "");
    });
    document.getElementById("btnAddPlancha").addEventListener("click", () => {
        openModal("Agregar Plancha", "planchas", false, "", "");
    });

    btnSave.addEventListener("click", async () => {
        const name = inputName.value.trim();
        if (!name) return;

        let id = editingId || name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const data = { nombre: name };
        if (currentHasValue) data.valor = parseMoneyLocal(inputVal.value);

        await setDoc(doc(db, currentCollection, id), data);
        closeModal(true);
        loadConfig();
        await cargarCatalogos(); // Refrescar catalogos para cotizador

        // Si se estaba agregando desde multiselect, volver al modal multiselect
        if (multiSelectAddingNew && multiSelectSavedState) {
            multiSelectAddingNew = false;
            multiSelectType = multiSelectSavedState.type;
            multiSelectIdx = multiSelectSavedState.idx;
            multiSelectSelected = multiSelectSavedState.selected;
            // Auto-seleccionar el nuevo item
            if (!multiSelectSelected.includes(name)) {
                multiSelectSelected.push(name);
            }
            multiSelectSavedState = null;
            document.getElementById("multiSelectSearch").value = "";
            renderMultiSelectGrid();
            renderMultiSelectTags();
            document.getElementById("multiSelectOverlay").classList.add("show");
        }

        // Si se estaba agregando desde selector de producto, seleccionar el nuevo producto
        if (productoSelectAddingNew) {
            productoSelectAddingNew = false;
            const valor = currentHasValue ? parseMoneyLocal(inputVal.value) : 0;
            if (productoSelectSavedIdx >= 0 && productoSelectSavedIdx < cotItems.length) {
                cotItems[productoSelectSavedIdx].producto = name;
                cotItems[productoSelectSavedIdx].precioUnit = valor;
            }
            productoSelectSavedIdx = -1;
            renderCotItems();
            calcularTotales();
        }
    });

    btnClose.addEventListener("click", closeModal);
    btnCancel.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
}

function openModal(title, collectionName, hasValue, nameVal, valueVal, docId) {
    currentCollection = collectionName;
    currentHasValue   = hasValue;
    editingId         = docId || null;

    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalInputName").value   = nameVal || "";
    document.getElementById("modalInputValue").value  = valueVal ? formatMoneyLocal(valueVal) : "";
    document.getElementById("modalValueGroup").style.display = hasValue ? "block" : "none";

    const btnSave = document.getElementById("modalSave");
    btnSave.innerHTML = editingId
        ? '<i class="bi bi-check-lg"></i> Guardar cambios'
        : '<i class="bi bi-plus-lg"></i> Agregar';

    document.getElementById("modalOverlay").classList.add("show");
    setTimeout(() => document.getElementById("modalInputName").focus(), 100);
}

function closeModal(fromSave) {
    document.getElementById("modalOverlay").classList.remove("show");
    document.getElementById("modalOverlay").style.zIndex = "";
    editingId = null;
    // Si se cancela el modal mientras se agregaba desde multiselect, volver al multiselect
    // No hacer esto si se llama desde el save (fromSave=true) porque el save ya lo maneja
    if (!fromSave && multiSelectAddingNew && multiSelectSavedState) {
        multiSelectAddingNew = false;
        multiSelectType = multiSelectSavedState.type;
        multiSelectIdx = multiSelectSavedState.idx;
        multiSelectSelected = multiSelectSavedState.selected;
        multiSelectSavedState = null;
        renderMultiSelectGrid();
        renderMultiSelectTags();
        document.getElementById("multiSelectOverlay").classList.add("show");
    }
    // Si se cancela mientras se agregaba desde selector de producto, volver al selector
    if (!fromSave && productoSelectAddingNew) {
        productoSelectAddingNew = false;
        productoSelectIdx = productoSelectSavedIdx;
        productoSelectSavedIdx = -1;
        renderProductoSelectGrid();
        document.getElementById("productoSelectOverlay").classList.add("show");
    }
}

// ===== CONFIRM =====
let confirmCallback = null;

function setupConfirm() {
    const overlay = document.getElementById("confirmOverlay");
    const btnYes  = document.getElementById("confirmYes");
    const btnNo   = document.getElementById("confirmNo");
    const btnC    = document.getElementById("confirmClose");

    btnYes.addEventListener("click", () => { if (confirmCallback) confirmCallback(); closeConfirm(); });
    btnNo.addEventListener("click", closeConfirm);
    btnC.addEventListener("click", closeConfirm);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeConfirm(); });
}

function showConfirm(title, message, callback) {
    confirmCallback = callback;
    document.getElementById("confirmTitle").textContent   = title;
    document.getElementById("confirmMessage").textContent = message;
    document.getElementById("confirmOverlay").classList.add("show");
}

function closeConfirm() {
    document.getElementById("confirmOverlay").classList.remove("show");
    confirmCallback = null;
}

// ===== NOTIFICACION MODAL =====
function setupNotifModal() {
    const overlay = document.getElementById("notifOverlay");
    const btnClose = document.getElementById("notifClose");
    const btnOk = document.getElementById("notifOk");
    const btnCopy = document.getElementById("notifCopyLink");
    const btnCopyIcon = document.getElementById("notifCopyBtn");
    const btnWa = document.getElementById("notifWhatsapp");

    const cerrar = () => overlay.classList.remove("show");
    btnClose.addEventListener("click", cerrar);
    btnOk.addEventListener("click", cerrar);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });

    btnCopy.addEventListener("click", () => {
        const input = document.getElementById("notifLinkInput");
        copyToClipboard(input.value).then(() => {
            btnCopy.innerHTML = '<i class="bi bi-check-lg"></i> Copiado';
            setTimeout(() => { btnCopy.innerHTML = '<i class="bi bi-clipboard-check"></i> Copiar link'; }, 2000);
        });
    });

    btnCopyIcon.addEventListener("click", () => {
        const input = document.getElementById("notifLinkInput");
        copyToClipboard(input.value).then(() => {
            btnCopyIcon.innerHTML = '<i class="bi bi-check-lg"></i>';
            setTimeout(() => { btnCopyIcon.innerHTML = '<i class="bi bi-clipboard"></i>'; }, 2000);
        });
    });

    btnWa.addEventListener("click", () => {
        const input = document.getElementById("notifLinkInput");
        const texto = encodeURIComponent("Aqui esta tu cotizacion: " + input.value);
        window.open("https://wa.me/?text=" + texto, "_blank");
    });
}

function showNotif(title, message) {
    document.getElementById("notifTitle").textContent = title;
    document.getElementById("notifMessage").textContent = message;
    document.getElementById("notifLinkWrap").style.display = "none";
    document.getElementById("notifOverlay").classList.add("show");
}

function showLinkModal(title, message, link) {
    document.getElementById("notifTitle").textContent = title;
    document.getElementById("notifMessage").textContent = message;
    document.getElementById("notifLinkWrap").style.display = "block";
    document.getElementById("notifLinkInput").value = link;
    document.getElementById("notifOverlay").classList.add("show");
}

// ===== MODAL ACCIONES COTIZACION =====
function setupAccionesModal() {
    const overlay = document.getElementById("accionesOverlay");
    const btnClose = document.getElementById("accionesClose");
    btnClose.addEventListener("click", () => overlay.classList.remove("show"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("show"); });
}

// ===== CARGAR CONFIG =====
async function loadConfig() {
    await loadCollection("productosImprenta", "listaProductosImprenta", true);
    await loadCollection("productosDigital", "listaProductosDigital", true);
    await loadCollection("terminados", "listaTerminados", true);
    await loadCollection("colores", "listaColores", false);
    await loadCollection("materiales", "listaMateriales", false);
    await loadCollection("planchas", "listaPlanchas", false);
    setupConfigTabs();
}

function setupConfigTabs() {
    const tabs = document.querySelectorAll(".config-tab");
    const panels = document.querySelectorAll(".config-panel");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById("config-" + tab.dataset.config).classList.add("active");
        });
    });
}

async function loadCollection(collectionName, containerId, showValue) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const snapshot = await getDocs(collection(db, collectionName));
        if (snapshot.empty) {
            container.innerHTML = '<tr><td colspan="3" class="tabla-empty">Sin elementos</td></tr>';
            return;
        }

        container.innerHTML = "";
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const row = document.createElement("tr");
            const valueCell = showValue
                ? `<td>$${formatMoneyLocal(data.valor || 0)}</td>` : "";

            row.innerHTML = `
                <td>${data.nombre}</td>
                ${valueCell}
                <td class="tabla-acciones">
                    <button class="btn-icon btn-edit" data-id="${docSnap.id}" data-col="${collectionName}" data-name="${data.nombre}" data-value="${data.valor || 0}" data-hasvalue="${showValue}">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn-icon btn-delete" data-id="${docSnap.id}" data-col="${collectionName}" data-name="${data.nombre}">
                        <i class="bi bi-trash3"></i>
                    </button>
                </td>
            `;
            container.appendChild(row);
        });

        container.querySelectorAll(".btn-edit").forEach(btn => {
            btn.addEventListener("click", () => {
                const titles = { productosImprenta: "Editar Producto Imprenta", productosDigital: "Editar Producto Digital", terminados: "Editar Terminado", colores: "Editar Color", materiales: "Editar Material", planchas: "Editar Plancha" };
                openModal(titles[btn.dataset.col], btn.dataset.col, btn.dataset.hasvalue === "true", btn.dataset.name, btn.dataset.value, btn.dataset.id);
            });
        });

        container.querySelectorAll(".btn-delete").forEach(btn => {
            btn.addEventListener("click", () => {
                showConfirm("Eliminar", `Eliminar "${btn.dataset.name}"? Esta accion no se puede deshacer.`, async () => {
                    await deleteDoc(doc(db, btn.dataset.col, btn.dataset.id));
                    loadConfig();
                    await cargarCatalogos();
                });
            });
        });
    } catch (err) {
        console.error("Error cargando " + collectionName, err);
        container.innerHTML = '<tr><td colspan="3" class="tabla-empty"><i class="bi bi-exclamation-triangle"></i> Error al cargar</td></tr>';
    }
}
// ===== COTIZADOR =====
let cotItems = [];
let cargandoCotizacion = false;  // evita que setTipoPersona sobreescriba el IVA guardado al cargar

function setupCotizador() {
    const btnNueva  = document.getElementById("btnNuevaCotizacion");
    const btnVolver = document.getElementById("btnVolverLista");
    const btnAdd    = document.getElementById("btnAddItem");
    const btnGuardar = document.getElementById("btnGuardarCotizacion");
    const tipoSelect = document.getElementById("cotTipo");

    // Checkbox de IVA: recalcula totales al cambiar
    const chkIva = document.getElementById("cotAplicarIva");
    if (chkIva) chkIva.addEventListener("change", calcularTotales);

    // Filtros de cotizaciones
    const inputBuscar = document.getElementById("cotizacionesBuscar");
    const selectEstado = document.getElementById("cotizacionesFiltroEstado");
    const selectModalidad = document.getElementById("cotizacionesFiltroModalidad");
    if (inputBuscar) inputBuscar.addEventListener("input", () => renderListaCotizaciones());
    if (selectEstado) selectEstado.addEventListener("change", () => renderListaCotizaciones());
    if (selectModalidad) selectModalidad.addEventListener("change", () => renderListaCotizaciones());


    // Filtros de diseños
    const inputDisenosBuscar = document.getElementById("disenosBuscar");
    const selectDisenosEstado = document.getElementById("disenosFiltroEstado");
    if (inputDisenosBuscar) inputDisenosBuscar.addEventListener("input", () => renderDisenosFiltrados());
    if (selectDisenosEstado) selectDisenosEstado.addEventListener("change", () => renderDisenosFiltrados());

    btnNueva.addEventListener("click", () => {
        cotItems = [];
        document.getElementById("cotCliente").value  = "";
        document.getElementById("cotNit").value      = "";
        document.getElementById("cotNegocio").value  = "";
        document.getElementById("cotTelefono").value = "";
        document.getElementById("cotDireccion").value = "";
        document.getElementById("cotCiudad").value   = "";
        const cotFiltroTipoEl = document.getElementById("cotClienteFiltroTipo");
        if (cotFiltroTipoEl) cotFiltroTipoEl.value = "";
        actualizarSelectClientes();
        document.getElementById("cotClienteSelect").value = "";
        setTipoPersonaCotizador("natural");
        document.getElementById("cotTipo").value     = "imprenta";
        document.getElementById("cotNotas").value    = "";
        // Fecha actual auto
        const hoy = new Date();
        const dd = String(hoy.getDate()).padStart(2, "0");
        const mm = String(hoy.getMonth() + 1).padStart(2, "0");
        const yyyy = hoy.getFullYear();
        document.getElementById("cotFechaActual").value  = `${dd}/${mm}/${yyyy}`;
        document.getElementById("cotFechaEntrega").value = "";
        document.getElementById("cotModalidadPago").value = "contado";
        renderCotItems();
        calcularTotales();
        const papeleraView = document.getElementById("cotizadorPapelera");
        if (papeleraView) papeleraView.style.display = "none";
        document.getElementById("cotizadorLista").style.display = "none";
        document.getElementById("cotizadorForm").style.display  = "block";
    });

    btnVolver.addEventListener("click", () => {
        document.getElementById("cotizadorForm").style.display  = "none";
        document.getElementById("cotizadorLista").style.display = "block";
    });

    btnAdd.addEventListener("click", () => {
        cotItems.push({ producto: "", descripcion: "", cantidad: 1, terminados: [], colores: [], materiales: [], planchas: [], precioUnit: 0 });
        renderCotItems();
    });

    // Producto temporal
    const btnAddTemp = document.getElementById("btnAddTempItem");
    btnAddTemp.addEventListener("click", () => {
        openTempProductoModal();
    });

    btnGuardar.addEventListener("click", async () => {
        const cliente  = document.getElementById("cotCliente").value.trim();
        const tipoPersona = document.getElementById("cotTipoPersona").value || "natural";
        const nit      = document.getElementById("cotNit").value.trim();
        const negocio  = document.getElementById("cotNegocio").value.trim();
        const telefono = document.getElementById("cotTelefono").value.trim();
        const direccion = document.getElementById("cotDireccion").value.trim();
        const ciudad   = document.getElementById("cotCiudad").value.trim();
        const tipo     = document.getElementById("cotTipo").value;
        const fechaActual  = document.getElementById("cotFechaActual").value;
        const fechaEntregaRaw = document.getElementById("cotFechaEntrega").value; // yyyy-mm-dd
        // Convertir fecha entrega a dd/mm/yyyy
        let fechaEntrega = "";
        if (fechaEntregaRaw) {
            const [y, m, d] = fechaEntregaRaw.split("-");
            fechaEntrega = `${d}/${m}/${y}`;
        }
        const modalidadPago = document.getElementById("cotModalidadPago").value;
        const editId   = btnGuardar.dataset.editId || null;

        if (!cliente) { showNotif("Campo requerido", "Ingresa el nombre del cliente"); return; }
        if (cotItems.length === 0) { showNotif("Sin productos", "Agrega al menos un producto"); return; }

        const items = cotItems.map((item, idx) => ({
            id: idx + 1,
            tipo: item.tipo || (tipo === "ambas" ? "imprenta" : tipo),
            producto: item.producto,
            cantidad: item.cantidad,
            terminados: item.terminados || [],
            colores: item.colores || [],
            materiales: item.materiales || [],
            planchas: item.planchas || [],
            precioUnit: item.precioUnit,
            precioTotal: item.cantidad * item.precioUnit
        }));

        const subtotal = items.reduce((sum, i) => sum + i.precioTotal, 0);
        const aplicarIva = document.getElementById("cotAplicarIva")?.checked || false;
        const iva = aplicarIva ? Math.round(subtotal * IVA_RATE) : 0;
        const total = subtotal + iva;

        if (editId) {
            // Editar: actualizar sin cambiar el ID ni el link
            const ref = doc(db, "cotizaciones", editId);
            const snap = await getDoc(ref);
            const existing = snap.data();
            const notas = document.getElementById("cotNotas").value.trim();
            const cotActualizada = { ...existing, cliente, tipoPersona, nit, negocio, telefono, direccion, ciudad, tipo, items, subtotal, aplicarIva, iva, total, fechaActual, fechaEntrega, modalidadPago, notas };
            await setDoc(ref, cotActualizada);
            // Cascada: propagar cambios a produccion y ordenes de diseño existentes
            try {
                await actualizarCascadaCotizacion(editId, cotActualizada);
            } catch (errCascada) {
                console.error("Error al actualizar en cascada:", errCascada);
            }
            btnGuardar.dataset.editId = "";
            btnGuardar.innerHTML = '<i class="bi bi-check-lg"></i> Guardar y generar link';
            document.getElementById("formCotTitle").textContent = "Nueva Cotizacion";
            // Mostrar link para re-enviar al cliente
            const baseUrl = window.location.origin + window.location.pathname.replace("dashboard.html", "");
            const link = baseUrl + "cotizacion.html?id=" + editId;
            showLinkModal("Cotizacion actualizada", "Comparte este link actualizado con el cliente:", link);
            // Refrescar ordenes/diseños para reflejar la cascada
            cargarOrdenes(rol);
            cargarDisenosAprobados(rol);
        } else {
            // Crear nueva
            const notas = document.getElementById("cotNotas").value.trim();
            const result = await crearCotizacion({ cliente, tipoPersona, nit, negocio, telefono, direccion, ciudad, tipo, items, subtotal, aplicarIva, iva, total, fechaActual, fechaEntrega, modalidadPago, notas, creadoPor: sessionStorage.getItem("userName") || "", creadoPorEmail: sessionStorage.getItem("userEmail") || "" });
            // Guardar cliente en base de datos
            await guardarClienteDesdeCotzacion({ cliente, tipoPersona, nit, negocio, telefono, direccion, ciudad });
            const baseUrl = window.location.origin + window.location.pathname.replace("dashboard.html", "");
            const link = baseUrl + "cotizacion.html?id=" + result.id;
            showLinkModal("Cotizacion " + result.numero + " creada", "Comparte este link con el cliente:", link);
        }

        document.getElementById("cotizadorForm").style.display  = "none";
        document.getElementById("cotizadorLista").style.display = "block";
        cargarListaCotizaciones();
    });
}

function renderCotItems() {
    const container = document.getElementById("cotItemsContainer");
    const tipo = document.getElementById("cotTipo").value;
    const productosI = getProductosImprenta();
    const productosD = getProductosDigital();

    if (cotItems.length === 0) {
        container.innerHTML = '<div class="empty-state" id="cotItemsEmpty"><i class="bi bi-cart"></i><p>Agrega productos a la cotizacion</p></div>';
        return;
    }

    container.innerHTML = "";
    cotItems.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = tipo === "ambas" ? "cot-item has-tipo" : "cot-item";

        // Determinar productos a mostrar segun tipo
        let productos;
        if (tipo === "imprenta") {
            productos = productosI;
            item.tipo = "imprenta";
        } else if (tipo === "digital") {
            productos = productosD;
            item.tipo = "digital";
        } else {
            // ambas: usar el tipo del item
            const itemTipo = item.tipo || "imprenta";
            productos = itemTipo === "digital" ? productosD : productosI;
        }

        const prodOptions = productos.map(p =>
            `<option value="${p.nombre}" data-valor="${p.valor || 0}" ${item.producto === p.nombre ? "selected" : ""}>${p.nombre}</option>`
        ).join("");

        const precioTotal = item.cantidad * item.precioUnit;

        // Producto button text
        const productoText = item.producto || "Seleccionar";
        const productoIcon = item.producto ? "bi-box-seam" : "bi-box";

        // Terminados multi-select button
        const terminadosArr = item.terminados || [];
        const terminadosText = "Seleccionar";
        const terminadosCount = terminadosArr.length > 0 ? `<span class="btn-count">${terminadosArr.length}</span>` : "";

        // Colores multi-select button
        const coloresArr = item.colores || [];
        const coloresText = "Seleccionar";
        const coloresCount = coloresArr.length > 0 ? `<span class="btn-count">${coloresArr.length}</span>` : "";

        // Materiales multi-select button
        const materialesArr = item.materiales || [];
        const materialesText = "Seleccionar";
        const materialesCount = materialesArr.length > 0 ? `<span class="btn-count">${materialesArr.length}</span>` : "";

        // Planchas multi-select button
        const planchasArr = item.planchas || [];
        const planchasText = "Seleccionar";
        const planchasCount = planchasArr.length > 0 ? `<span class="btn-count">${planchasArr.length}</span>` : "";

        // Si es ambas, mostrar campo tipo
        const tipoField = tipo === "ambas" ? `
            <div class="form-field">
                <label>Tipo</label>
                <select class="cot-sel-tipo" data-idx="${idx}">
                    <option value="imprenta" ${item.tipo === "imprenta" ? "selected" : ""}>Imprenta</option>
                    <option value="digital" ${item.tipo === "digital" ? "selected" : ""}>Digital</option>
                </select>
            </div>
        ` : "";

        div.innerHTML = `
            ${item.temporal ? '<span class="cot-item-temp-badge"><i class="bi bi-clock-history"></i> Temporal</span>' : ''}
            ${tipoField}
            <div class="form-field">
                <label>Producto</label>
                <button type="button" class="cot-multiselect-btn cot-btn-producto" data-idx="${idx}">
                    <i class="bi ${productoIcon}"></i>
                    <span class="btn-text">${productoText}</span>
                </button>
            </div>
            <div class="form-field">
                <label>Cantidad</label>
                <input type="text" inputmode="numeric" class="cot-cantidad" data-idx="${idx}" value="${item.cantidad}" placeholder="0">
            </div>
            <div class="form-field">
                <label>Terminado</label>
                <button type="button" class="cot-multiselect-btn cot-btn-terminados" data-idx="${idx}">
                    <i class="bi bi-brush"></i>
                    <span class="btn-text">${terminadosText}</span>
                    ${terminadosCount}
                </button>
            </div>
            <div class="form-field">
                <label>Color</label>
                <button type="button" class="cot-multiselect-btn cot-btn-colores" data-idx="${idx}">
                    <i class="bi bi-palette"></i>
                    <span class="btn-text">${coloresText}</span>
                    ${coloresCount}
                </button>
            </div>
            <div class="form-field">
                <label>Material</label>
                <button type="button" class="cot-multiselect-btn cot-btn-materiales" data-idx="${idx}">
                    <i class="bi bi-layers"></i>
                    <span class="btn-text">${materialesText}</span>
                    ${materialesCount}
                </button>
            </div>
            <div class="form-field">
                <label>Plancha</label>
                <button type="button" class="cot-multiselect-btn cot-btn-planchas" data-idx="${idx}">
                    <i class="bi bi-grid-3x3"></i>
                    <span class="btn-text">${planchasText}</span>
                    ${planchasCount}
                </button>
            </div>
            <div class="form-field">
                <label>P. Unitario</label>
                <input type="text" class="cot-precio" data-idx="${idx}" value="${item.precioUnit > 0 ? formatMoneyLocal(item.precioUnit) : ''}">
            </div>
            <div class="form-field">
                <label>P. Total</label>
                <input type="text" class="cot-precio-total" value="${precioTotal > 0 ? '$' + formatMoneyLocal(precioTotal) : '$0'}" readonly>
            </div>
            <button class="cot-item-delete" data-idx="${idx}"><i class="bi bi-x-lg"></i></button>
        `;
        container.appendChild(div);
    });

    // Eventos
    container.querySelectorAll(".cot-sel-tipo").forEach(sel => {
        sel.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.idx);
            cotItems[idx].tipo = e.target.value;
            cotItems[idx].producto = "";
            cotItems[idx].precioUnit = 0;
            renderCotItems();
            calcularTotales();
        });
    });

    container.querySelectorAll(".cot-btn-producto").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.idx);
            openProductoSelectModal(idx);
        });
    });

    container.querySelectorAll(".cot-cantidad").forEach(inp => {
        inp.addEventListener("input", (e) => {
            const idx = parseInt(e.target.dataset.idx);
            cotItems[idx].cantidad = parseInt(e.target.value) || 1;
            // Actualizar precio total sin re-renderizar
            const totalInput = container.querySelectorAll(".cot-precio-total")[idx];
            const pt = cotItems[idx].cantidad * cotItems[idx].precioUnit;
            if (totalInput) totalInput.value = "$" + formatMoneyLocal(pt);
            calcularTotales();
        });
    });

    container.querySelectorAll(".cot-btn-terminados").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            openMultiSelectModal("terminados", idx);
        });
    });

    container.querySelectorAll(".cot-btn-colores").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            openMultiSelectModal("colores", idx);
        });
    });

    container.querySelectorAll(".cot-btn-materiales").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            openMultiSelectModal("materiales", idx);
        });
    });

    container.querySelectorAll(".cot-btn-planchas").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const idx = parseInt(btn.dataset.idx);
            openMultiSelectModal("planchas", idx);
        });
    });

    container.querySelectorAll(".cot-precio").forEach(inp => {
        formatInputMoney(inp);
        inp.addEventListener("input", (e) => {
            const idx = parseInt(e.target.dataset.idx);
            cotItems[idx].precioUnit = parseMoneyLocal(e.target.value);
            const totalInput = container.querySelectorAll(".cot-precio-total")[idx];
            const pt = cotItems[idx].cantidad * cotItems[idx].precioUnit;
            if (totalInput) totalInput.value = "$" + formatMoneyLocal(pt);
            calcularTotales();
        });
    });

    container.querySelectorAll(".cot-item-delete").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.idx);
            cotItems.splice(idx, 1);
            renderCotItems();
            calcularTotales();
        });
    });
}

const IVA_RATE = 0.19;

function calcularTotales() {
    const subtotal = cotItems.reduce((sum, item) => sum + (item.cantidad * item.precioUnit), 0);
    const aplicarIva = document.getElementById("cotAplicarIva")?.checked || false;
    const iva = aplicarIva ? Math.round(subtotal * IVA_RATE) : 0;
    const total = subtotal + iva;

    const subEl = document.getElementById("cotSubtotal");
    const ivaEl = document.getElementById("cotIva");
    if (subEl) subEl.textContent = "$" + formatMoneyLocal(subtotal);
    if (ivaEl) ivaEl.textContent = "$" + formatMoneyLocal(iva);
    document.getElementById("cotTotal").textContent = "$" + formatMoneyLocal(total);

    // Atenuar la linea de IVA cuando no esta aplicado
    const ivaLinea = document.querySelector(".cot-iva-linea");
    if (ivaLinea) ivaLinea.classList.toggle("iva-inactivo", !aplicarIva);
}

// ===== PRODUCTO TEMPORAL =====
function openTempProductoModal() {
    document.getElementById("tempProductoNombre").value = "";
    document.getElementById("tempProductoPrecio").value = "";
    document.getElementById("tempProductoCantidad").value = "1";
    document.getElementById("tempProductoOverlay").classList.add("show");
    setTimeout(() => document.getElementById("tempProductoNombre").focus(), 100);
}

function closeTempProductoModal() {
    document.getElementById("tempProductoOverlay").classList.remove("show");
}

(function setupTempProductoModal() {
    const overlay = document.getElementById("tempProductoOverlay");
    const btnClose = document.getElementById("tempProductoClose");
    const btnCancel = document.getElementById("tempProductoCancel");
    const btnAdd = document.getElementById("tempProductoAdd");
    const inputPrecio = document.getElementById("tempProductoPrecio");
    const inputCantidad = document.getElementById("tempProductoCantidad");

    if (!overlay) return;

    formatInputMoney(inputPrecio);

    btnClose.addEventListener("click", closeTempProductoModal);
    btnCancel.addEventListener("click", closeTempProductoModal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeTempProductoModal(); });

    btnAdd.addEventListener("click", () => {
        const nombre = document.getElementById("tempProductoNombre").value.trim();
        const precio = parseMoneyLocal(inputPrecio.value);
        const cantidad = parseInt(inputCantidad.value) || 1;

        if (!nombre) {
            document.getElementById("tempProductoNombre").focus();
            return;
        }

        const tipo = document.getElementById("cotTipo").value;
        cotItems.push({
            producto: nombre,
            cantidad: cantidad,
            precioUnit: precio,
            terminados: [],
            colores: [],
            materiales: [],
            planchas: [],
            tipo: tipo === "ambas" ? "imprenta" : tipo,
            temporal: true
        });

        closeTempProductoModal();
        renderCotItems();
        calcularTotales();
    });
})();

// ===== MODAL MULTISELECT (Terminados / Colores) =====
let multiSelectType = ""; // "terminados" o "colores"
let multiSelectIdx = -1;
let multiSelectSelected = [];
let multiSelectAddingNew = false;
let multiSelectSavedState = null;

function setupMultiSelectModal() {
    const overlay = document.getElementById("multiSelectOverlay");
    const btnClose = document.getElementById("multiSelectClose");
    const btnCancel = document.getElementById("multiSelectCancel");
    const btnConfirm = document.getElementById("multiSelectConfirm");
    const btnAddNew = document.getElementById("multiSelectAddNew");
    const searchInput = document.getElementById("multiSelectSearch");

    btnClose.addEventListener("click", closeMultiSelect);
    btnCancel.addEventListener("click", closeMultiSelect);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeMultiSelect(); });

    btnConfirm.addEventListener("click", () => {
        if (multiSelectIdx >= 0 && multiSelectIdx < cotItems.length) {
            cotItems[multiSelectIdx][multiSelectType] = [...multiSelectSelected];
        }
        closeMultiSelect();
        renderCotItems();
    });

    btnAddNew.addEventListener("click", () => {
        agregarNuevoDesdeMultiSelect();
    });

    searchInput.addEventListener("input", () => {
        renderMultiSelectGrid();
    });
}

async function agregarNuevoDesdeMultiSelect() {
    const collectionMap = {
        terminados: "terminados",
        colores: "colores",
        materiales: "materiales",
        planchas: "planchas"
    };
    const col = collectionMap[multiSelectType];
    if (!col) return;

    // Usar el valor de búsqueda como nombre sugerido
    const searchVal = document.getElementById("multiSelectSearch").value.trim();

    const titlesMap = {
        terminados: "Agregar Terminado",
        colores: "Agregar Color",
        materiales: "Agregar Material",
        planchas: "Agregar Plancha"
    };

    // Guardar estado del multiselect
    const savedType = multiSelectType;
    const savedIdx = multiSelectIdx;
    const savedSelected = [...multiSelectSelected];

    // Marcar que estamos agregando desde multiselect
    multiSelectAddingNew = true;
    multiSelectSavedState = { type: savedType, idx: savedIdx, selected: savedSelected };

    // Subir z-index del modal de configuracion para que aparezca encima del multiselect
    document.getElementById("modalOverlay").style.zIndex = "600";

    // Todos piden nombre y valor
    openModal(titlesMap[multiSelectType], col, true, searchVal, "0");
}

function openMultiSelectModal(type, idx) {
    multiSelectType = type;
    multiSelectIdx = idx;

    const titles = {
        terminados: "Seleccionar Terminados",
        colores: "Seleccionar Colores",
        materiales: "Seleccionar Materiales",
        planchas: "Seleccionar Planchas"
    };
    document.getElementById("multiSelectTitle").textContent = titles[type] || "Seleccionar";
    document.getElementById("multiSelectSearch").value = "";

    // Cargar seleccion actual
    multiSelectSelected = [...(cotItems[idx][type] || [])];

    renderMultiSelectGrid();
    renderMultiSelectTags();
    document.getElementById("multiSelectOverlay").classList.add("show");
    setTimeout(() => document.getElementById("multiSelectSearch").focus(), 100);
}

function closeMultiSelect() {
    document.getElementById("multiSelectOverlay").classList.remove("show");
    multiSelectType = "";
    multiSelectIdx = -1;
    multiSelectSelected = [];
}

function renderMultiSelectGrid() {
    const grid = document.getElementById("multiSelectGrid");
    const search = document.getElementById("multiSelectSearch").value.toLowerCase().trim();

    let items = [];
    if (multiSelectType === "terminados") {
        items = getTerminados();
    } else if (multiSelectType === "colores") {
        items = getColores();
    } else if (multiSelectType === "materiales") {
        items = getMateriales();
    } else if (multiSelectType === "planchas") {
        items = getPlanchas();
    }

    // Filtrar por busqueda
    if (search) {
        items = items.filter(item => item.nombre.toLowerCase().includes(search));
    }

    if (items.length === 0) {
        grid.innerHTML = `<div class="multiselect-empty"><i class="bi bi-search"></i><p>No se encontraron resultados</p></div>`;
        return;
    }

    grid.innerHTML = "";
    items.forEach(item => {
        const isSelected = multiSelectSelected.includes(item.nombre);
        const card = document.createElement("div");
        card.className = "multiselect-card" + (isSelected ? " selected" : "");
        card.dataset.nombre = item.nombre;

        const icons = { terminados: "bi-brush", colores: "bi-palette", materiales: "bi-layers", planchas: "bi-grid-3x3" };
        const icon = icons[multiSelectType] || "bi-tag";
        const valueHtml = item.valor ? `<span class="multiselect-card-value">$${formatMoneyLocal(item.valor)}</span>` : "";

        card.innerHTML = `
            <i class="bi ${icon} multiselect-card-icon"></i>
            <span class="multiselect-card-name">${item.nombre}</span>
            ${valueHtml}
        `;

        card.addEventListener("click", () => {
            toggleMultiSelectItem(item.nombre);
        });

        grid.appendChild(card);
    });
}

function toggleMultiSelectItem(nombre) {
    const idx = multiSelectSelected.indexOf(nombre);
    if (idx >= 0) {
        multiSelectSelected.splice(idx, 1);
    } else {
        multiSelectSelected.push(nombre);
    }
    renderMultiSelectGrid();
    renderMultiSelectTags();
}

function renderMultiSelectTags() {
    const bar = document.getElementById("multiSelectSelectedBar");
    const container = document.getElementById("multiSelectTags");

    if (multiSelectSelected.length === 0) {
        bar.classList.remove("has-items");
        container.innerHTML = "";
        return;
    }

    bar.classList.add("has-items");
    container.innerHTML = "";
    multiSelectSelected.forEach(nombre => {
        const tag = document.createElement("span");
        tag.className = "multiselect-tag";
        tag.innerHTML = `${nombre} <button class="tag-remove" data-nombre="${nombre}"><i class="bi bi-x"></i></button>`;
        tag.querySelector(".tag-remove").addEventListener("click", (e) => {
            e.stopPropagation();
            toggleMultiSelectItem(nombre);
        });
        container.appendChild(tag);
    });
}

// Escuchar cambio de tipo para refrescar productos
document.getElementById("cotTipo")?.addEventListener("change", () => {
    renderCotItems();
});

// ===== MODAL SELECTOR DE PRODUCTO =====
let productoSelectIdx = -1;
let productoSelectAddingNew = false;
let productoSelectSavedIdx = -1;

function setupProductoSelectModal() {
    const overlay = document.getElementById("productoSelectOverlay");
    const btnClose = document.getElementById("productoSelectClose");
    const btnCancel = document.getElementById("productoSelectCancel");
    const btnAddNew = document.getElementById("productoSelectAddNew");
    const searchInput = document.getElementById("productoSelectSearch");

    btnClose.addEventListener("click", closeProductoSelect);
    btnCancel.addEventListener("click", closeProductoSelect);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeProductoSelect(); });

    btnAddNew.addEventListener("click", () => {
        agregarNuevoProductoDesdeSelect();
    });

    searchInput.addEventListener("input", () => {
        renderProductoSelectGrid();
    });
}

function openProductoSelectModal(idx) {
    productoSelectIdx = idx;
    const tipo = document.getElementById("cotTipo").value;
    const itemTipo = cotItems[idx].tipo || (tipo === "ambas" ? "imprenta" : tipo);
    const titulo = itemTipo === "digital" ? "Seleccionar Producto Digital" : "Seleccionar Producto Imprenta";
    document.getElementById("productoSelectTitle").textContent = titulo;
    document.getElementById("productoSelectSearch").value = "";
    renderProductoSelectGrid();
    document.getElementById("productoSelectOverlay").classList.add("show");
    setTimeout(() => document.getElementById("productoSelectSearch").focus(), 100);
}

function closeProductoSelect() {
    document.getElementById("productoSelectOverlay").classList.remove("show");
    productoSelectIdx = -1;
}

function renderProductoSelectGrid() {
    const grid = document.getElementById("productoSelectGrid");
    const search = document.getElementById("productoSelectSearch").value.toLowerCase().trim();
    const tipo = document.getElementById("cotTipo").value;
    const itemTipo = productoSelectIdx >= 0 ? (cotItems[productoSelectIdx].tipo || (tipo === "ambas" ? "imprenta" : tipo)) : "imprenta";

    let productos = itemTipo === "digital" ? getProductosDigital() : getProductosImprenta();

    if (search) {
        productos = productos.filter(p => p.nombre.toLowerCase().includes(search));
    }

    if (productos.length === 0) {
        grid.innerHTML = `<div class="multiselect-empty"><i class="bi bi-search"></i><p>No se encontraron productos</p></div>`;
        return;
    }

    grid.innerHTML = "";
    const currentProducto = productoSelectIdx >= 0 ? cotItems[productoSelectIdx].producto : "";

    productos.forEach(p => {
        const isSelected = p.nombre === currentProducto;
        const card = document.createElement("div");
        card.className = "multiselect-card" + (isSelected ? " selected" : "");
        card.dataset.nombre = p.nombre;
        card.dataset.valor = p.valor || 0;

        card.innerHTML = `
            <i class="bi bi-box-seam multiselect-card-icon"></i>
            <span class="multiselect-card-name">${p.nombre}</span>
            <span class="multiselect-card-value">${formatMoneyLocal(p.valor || 0)}</span>
        `;

        card.addEventListener("click", () => {
            selectProducto(p.nombre, p.valor || 0);
        });

        grid.appendChild(card);
    });
}

function selectProducto(nombre, valor) {
    if (productoSelectIdx >= 0 && productoSelectIdx < cotItems.length) {
        cotItems[productoSelectIdx].producto = nombre;
        cotItems[productoSelectIdx].precioUnit = parseInt(valor) || 0;
    }
    closeProductoSelect();
    renderCotItems();
    calcularTotales();
}

async function agregarNuevoProductoDesdeSelect() {
    const tipo = document.getElementById("cotTipo").value;
    const itemTipo = productoSelectIdx >= 0 ? (cotItems[productoSelectIdx].tipo || (tipo === "ambas" ? "imprenta" : tipo)) : "imprenta";
    const col = itemTipo === "digital" ? "productosDigital" : "productosImprenta";
    const titulo = itemTipo === "digital" ? "Agregar Producto Digital" : "Agregar Producto Imprenta";

    const searchVal = document.getElementById("productoSelectSearch").value.trim();

    // Guardar estado
    productoSelectAddingNew = true;
    productoSelectSavedIdx = productoSelectIdx;

    // Subir z-index del modal de configuracion
    document.getElementById("modalOverlay").style.zIndex = "600";

    // Cerrar el modal de producto temporalmente
    document.getElementById("productoSelectOverlay").classList.remove("show");

    openModal(titulo, col, true, searchVal, "0");
}

// ===== LISTA COTIZACIONES =====
let cotizacionesListaCache = [];

async function cargarListaCotizaciones() {
    const container = document.getElementById("listaCotizaciones");
    try {
        // Si no es admin, filtrar por usuario
        let lista;
        if (rol === "administrador") {
            lista = await obtenerCotizaciones();
        } else {
            lista = await obtenerCotizaciones({ email: sessionStorage.getItem("userEmail"), nombre: sessionStorage.getItem("userName") });
        }

        cotizacionesListaCache = lista;
        renderListaCotizaciones();
    } catch (err) {
        console.error(err);
        container.innerHTML = '<div class="list-empty"><i class="bi bi-exclamation-triangle"></i> Error al cargar</div>';
    }
}

function renderListaCotizaciones() {
    const container = document.getElementById("listaCotizaciones");
    const busqueda = (document.getElementById("cotizacionesBuscar")?.value || "").trim().toLowerCase();
    const filtroEstado = document.getElementById("cotizacionesFiltroEstado")?.value || "";
    const filtroModalidad = document.getElementById("cotizacionesFiltroModalidad")?.value || "";

    let lista = cotizacionesListaCache;

    // Filtrar por búsqueda
    if (busqueda) {
        lista = lista.filter(c =>
            (c.cliente || "").toLowerCase().includes(busqueda) ||
            (c.numero || "").toLowerCase().includes(busqueda) ||
            (c.negocio || "").toLowerCase().includes(busqueda) ||
            (c.nit || "").toLowerCase().includes(busqueda) ||
            (c.tipo || "").toLowerCase().includes(busqueda)
        );
    }

    // Filtrar por estado
    if (filtroEstado) {
        lista = lista.filter(c => c.estado === filtroEstado);
    }

    // Filtrar por modalidad de pago (contado / credito)
    if (filtroModalidad) {
        lista = lista.filter(c => (c.modalidadPago || "contado") === filtroModalidad);
    }

    if (lista.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-file-earmark-text"></i><p>No se encontraron cotizaciones</p></div>';
        return;
    }

    container.innerHTML = "";
    lista.forEach(cot => {
            const baseUrl = window.location.origin + window.location.pathname.replace("dashboard.html", "");
            const link = baseUrl + "cotizacion.html?id=" + cot.id;
            const fecha = new Date(cot.fechaCreacion);
            const fechaStr = fecha.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

            const yaEnviada = (cot.estadoProduccion || "").trim().length > 0;
            const esAprobada = cot.estado === "aprobada";
            const modalidad = cot.modalidadPago || "contado";
            const esCredito = modalidad === "credito";
            // Credito aprobado sin comprobante registrado = pago pendiente por gestionar
            const pagoPendiente = esCredito && esAprobada && !cot.comprobante;

            // Badge de modalidad de pago (contado / credito)
            const badgeModalidad = `<span class="cot-modalidad ${modalidad}"><i class="bi ${esCredito ? "bi-hourglass-split" : "bi-cash-coin"}"></i> ${esCredito ? "Credito" : "Contado"}</span>`;
            const badgePagoPend = pagoPendiente ? `<span class="cot-pago-pend"><i class="bi bi-exclamation-circle"></i> Pago pendiente</span>` : "";

            // Boton enviar a produccion
            let btnEnviarHtml = "";
            if (esAprobada && !yaEnviada) {
                btnEnviarHtml = `<button class="btn-enviar-prod" data-id="${cot.id}"><i class="bi bi-send"></i> Enviar a produccion</button>`;
            } else if (esAprobada && yaEnviada) {
                btnEnviarHtml = `<span class="badge-enviada"><i class="bi bi-check-circle"></i> Enviada</span>`;
            }

            // Boton registrar pago (credito aprobado sin comprobante)
            const btnRegistrarPagoHtml = pagoPendiente
                ? `<button class="btn-registrar-pago" data-id="${cot.id}"><i class="bi bi-receipt-cutoff"></i> Registrar pago</button>`
                : "";

            // Asesor que elaboro la cotizacion (vacio en registros antiguos)
            const asesorTxt = (cot.creadoPor || "").trim()
                ? ` &bull; <i class="bi bi-person-badge"></i> ${cot.creadoPor}`
                : "";

            // Cotizaciones que el cliente genero desde la web publica
            const badgeWeb = cot.origen === "web"
                ? `<span class="cot-badge-web" title="Generada por el cliente desde la web"><i class="bi bi-globe2"></i> Web</span>`
                : "";

            const item = document.createElement("div");
            item.className = "cot-list-item" + (cot.origen === "web" ? " cot-list-item--web" : "");
            item.innerHTML = `
                <div class="cot-list-info">
                    <span class="cot-list-numero">${cot.numero} <span class="cot-estado ${cot.estado}">${cot.estado}</span> ${badgeModalidad} ${badgePagoPend} ${badgeWeb}</span>
                    <span class="cot-list-cliente">${cot.cliente} &bull; ${cot.tipo} &bull; ${fechaStr}${asesorTxt}</span>
                </div>
                <div class="cot-list-right">
                    <span class="cot-list-total">$${formatMoneyLocal(cot.total)}</span>
                    ${btnRegistrarPagoHtml}
                    ${btnEnviarHtml}
                    <button class="btn-copiar-link" data-link="${link}">
                        <i class="bi bi-link-45deg"></i> Copiar link
                    </button>
                    <button class="btn-mas-acciones" data-id="${cot.id}" data-name="${cot.numero}">
                        <i class="bi bi-gear"></i> Mas acciones
                    </button>
                </div>
            `;
            container.appendChild(item);
    });

    // Enviar a produccion
    container.querySelectorAll(".btn-enviar-prod").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            await abrirDetalleAprobada(id);
        });
    });

    // Registrar pago (credito) - abre el detalle y enfoca la seccion de pago
    container.querySelectorAll(".btn-registrar-pago").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            await abrirDetalleAprobada(id);
            const seccion = document.getElementById("cotDetalleRegistroPago");
            if (seccion && seccion.style.display !== "none") {
                seccion.scrollIntoView({ behavior: "smooth", block: "center" });
                seccion.classList.add("registro-pago-resaltado");
                setTimeout(() => seccion.classList.remove("registro-pago-resaltado"), 1600);
            }
        });
    });

    // Copiar link
    container.querySelectorAll(".btn-copiar-link").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            copyToClipboard(btn.dataset.link).then(() => {
                btn.innerHTML = '<i class="bi bi-check-lg"></i> Copiado';
                setTimeout(() => { btn.innerHTML = '<i class="bi bi-link-45deg"></i> Copiar link'; }, 2000);
            });
        });
    });

    // Mas acciones - abre modal con editar/eliminar
    container.querySelectorAll(".btn-mas-acciones").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const name = btn.dataset.name;
            abrirModalAcciones(id, name);
        });
    });
}

function abrirModalAcciones(cotId, cotName) {
    const overlay = document.getElementById("accionesOverlay");
    document.getElementById("accionesTitulo").textContent = cotName;

    const btnPDF = document.getElementById("btnAccionPDF");
    if (btnPDF) {
        btnPDF.onclick = async () => {
            overlay.classList.remove("show");
            const docSnap = await getDoc(doc(db, "cotizaciones", cotId));
            if (!docSnap.exists()) return;
            const cot = { id: docSnap.id, ...docSnap.data() };
            if (typeof window.exportarCotizacionPDF === "function") {
                window.exportarCotizacionPDF(cot);
            }
        };
    }

    document.getElementById("btnAccionEditar").onclick = async () => {
        overlay.classList.remove("show");
        const docSnap = await getDoc(doc(db, "cotizaciones", cotId));
        if (!docSnap.exists()) return;
        const cot = docSnap.data();

        cargandoCotizacion = true;
        document.getElementById("cotCliente").value  = cot.cliente || "";
        document.getElementById("cotNit").value      = cot.nit || "";
        document.getElementById("cotNegocio").value  = cot.negocio || "";
        document.getElementById("cotTelefono").value = cot.telefono || "";
        document.getElementById("cotDireccion").value = cot.direccion || "";
        document.getElementById("cotCiudad").value   = cot.ciudad || "";
        setTipoPersonaCotizador(cot.tipoPersona || "natural");
        // Restaurar estado del IVA guardado (si el campo no existe, usar segun tipo de persona)
        const chkIvaEdit = document.getElementById("cotAplicarIva");
        if (chkIvaEdit) {
            chkIvaEdit.checked = (cot.aplicarIva !== undefined)
                ? !!cot.aplicarIva
                : (cot.tipoPersona === "juridica");
        }
        cargandoCotizacion = false;
        document.getElementById("cotTipo").value     = cot.tipo || "imprenta";
        document.getElementById("cotFechaActual").value = cot.fechaActual || "";
        document.getElementById("cotModalidadPago").value = cot.modalidadPago || "contado";
        if (cot.fechaEntrega) {
            const [d, m, y] = cot.fechaEntrega.split("/");
            document.getElementById("cotFechaEntrega").value = `${y}-${m}-${d}`;
        } else {
            document.getElementById("cotFechaEntrega").value = "";
        }

        cotItems = (cot.items || []).map(i => ({
            tipo:       i.tipo || cot.tipo,
            producto:   i.producto,
            cantidad:   i.cantidad,
            terminados: i.terminados || (i.terminado ? [i.terminado] : []),
            colores:    i.colores || (i.color ? [i.color] : []),
            materiales: i.materiales || [],
            planchas:   i.planchas || [],
            precioUnit: i.precioUnit
        }));

        renderCotItems();
        calcularTotales();

        // Cargar notas
        document.getElementById("cotNotas").value = cot.notas || "";

        const btnGuardar = document.getElementById("btnGuardarCotizacion");
        btnGuardar.dataset.editId = cotId;
        btnGuardar.innerHTML = '<i class="bi bi-check-lg"></i> Guardar cambios';
        document.getElementById("formCotTitle").textContent = "Editar " + cotName;
        const papeleraViewEdit = document.getElementById("cotizadorPapelera");
        if (papeleraViewEdit) papeleraViewEdit.style.display = "none";
        document.getElementById("cotizadorLista").style.display = "none";
        document.getElementById("cotizadorForm").style.display  = "block";
    };

    document.getElementById("btnAccionEliminar").onclick = () => {
        overlay.classList.remove("show");
        showConfirm("Enviar a papelera", `Enviar ${cotName} a la papelera? Podras restaurarla despues.`, async () => {
            await eliminarCotizacion(cotId, {
                nombre: sessionStorage.getItem("userName") || "",
                email: sessionStorage.getItem("userEmail") || ""
            });
            cargarListaCotizaciones();
            cargarPapelera();
        });
    };

    overlay.classList.add("show");
}
// ===== USUARIOS (solo admin) =====
let editingUserId = null;

function setupUsuarios() {
    const overlay   = document.getElementById("usuarioOverlay");
    const inputNom  = document.getElementById("usuarioNombre");
    const inputMail = document.getElementById("usuarioEmail");
    const inputPass = document.getElementById("usuarioPassword");
    const selectRol = document.getElementById("usuarioRol");
    const rolSelector = document.getElementById("usuarioRolSelector");
    const btnSave   = document.getElementById("usuarioSave");
    const btnClose  = document.getElementById("usuarioClose");
    const btnCancel = document.getElementById("usuarioCancel");
    const btnNuevo  = document.getElementById("btnNuevoUsuario");

    // Selector visual de rol
    rolSelector.querySelectorAll(".rol-option").forEach(btn => {
        btn.addEventListener("click", () => {
            rolSelector.querySelectorAll(".rol-option").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            selectRol.value = btn.dataset.rol;
        });
    });

    function setRolActivo(rol) {
        selectRol.value = rol;
        rolSelector.querySelectorAll(".rol-option").forEach(b => {
            b.classList.toggle("active", b.dataset.rol === rol);
        });
    }

    btnNuevo.addEventListener("click", () => {
        editingUserId = null;
        document.getElementById("usuarioModalTitle").textContent = "Nuevo Usuario";
        inputNom.value = "";
        inputMail.value = "";
        inputPass.value = "";
        inputMail.disabled = false;
        setRolActivo("digital");
        overlay.classList.add("show");
        setTimeout(() => inputNom.focus(), 100);
    });

    btnSave.addEventListener("click", async () => {
        const nombre   = inputNom.value.trim();
        const email    = inputMail.value.trim();
        const password = inputPass.value;
        const rol      = selectRol.value;

        if (!nombre || !email || !password) {
            showNotif("Campos incompletos", "Completa todos los campos");
            return;
        }

        try {
            const id = editingUserId || email.split("@")[0].replace(/[^a-z0-9]/gi, "").toLowerCase();
            await setDoc(doc(db, "usuarios", id), { nombre, email, password, rol });
            overlay.classList.remove("show");
            cargarUsuarios();
        } catch (err) {
            console.error(err);
            showNotif("Error", "Error al guardar el usuario");
        }
    });

    btnClose.addEventListener("click", () => overlay.classList.remove("show"));
    btnCancel.addEventListener("click", () => overlay.classList.remove("show"));
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.classList.remove("show");
    });
}

async function cargarUsuarios() {
    const container = document.getElementById("listaUsuarios");
    if (!container) return;

    try {
        const snap = await getDocs(collection(db, "usuarios"));

        if (snap.empty) {
            container.innerHTML = '<div class="empty-state"><i class="bi bi-people"></i><p>No hay usuarios registrados</p></div>';
            return;
        }

        container.innerHTML = "";
        snap.forEach(docSnap => {
            const u = docSnap.data();
            const initials = (u.nombre || u.email).split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();

            const item = document.createElement("div");
            item.className = "user-item";
            item.innerHTML = `
                <div class="user-item-avatar ${u.rol}">${initials}</div>
                <div class="user-item-info">
                    <span class="user-item-name">${u.nombre || u.email}</span>
                    <span class="user-item-email">${u.email}</span>
                </div>
                <span class="user-item-role role-${u.rol}">${u.rol}</span>
                <div class="user-item-actions">
                    <button class="btn-icon btn-edit" data-id="${docSnap.id}" title="Editar">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn-icon btn-delete" data-id="${docSnap.id}" data-name="${u.nombre || u.email}" title="Eliminar">
                        <i class="bi bi-trash3"></i>
                    </button>
                </div>
            `;
            container.appendChild(item);
        });

        // Editar
        container.querySelectorAll(".btn-edit").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                const docSnap = await getDoc(doc(db, "usuarios", id));
                if (!docSnap.exists()) return;
                const u = docSnap.data();

                editingUserId = id;
                document.getElementById("usuarioModalTitle").textContent = "Editar Usuario";
                document.getElementById("usuarioNombre").value   = u.nombre || "";
                document.getElementById("usuarioEmail").value    = u.email;
                document.getElementById("usuarioEmail").disabled = true;
                document.getElementById("usuarioPassword").value = u.password || "";
                document.getElementById("usuarioRol").value      = u.rol;
                // Activar boton de rol visual
                document.getElementById("usuarioRolSelector").querySelectorAll(".rol-option").forEach(b => {
                    b.classList.toggle("active", b.dataset.rol === u.rol);
                });
                document.getElementById("usuarioOverlay").classList.add("show");
            });
        });

        // Eliminar
        container.querySelectorAll(".btn-delete").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                const name = btn.dataset.name;
                showConfirm("Eliminar usuario", `Eliminar "${name}"? Esta accion no se puede deshacer.`, async () => {
                    await deleteDoc(doc(db, "usuarios", id));
                    cargarUsuarios();
                });
            });
        });

    } catch (err) {
        console.error(err);
        container.innerHTML = '<div class="list-empty"><i class="bi bi-exclamation-triangle"></i> Error al cargar</div>';
    }
}

// ===== ORDENES (cotizaciones aprobadas) =====
let ordenesDisenoDB = {}; // Cache de ordenes de diseño existentes
let ordenesCache = []; // Cache de ordenes para filtrado
let ordenesRolCache = ""; // Rol usado al cargar
// Ordenes realmente pintadas en cada contenedor, ya con todos los filtros
// aplicados. Es la fuente de la exportacion a Excel: se exporta lo visible.
let ordenesRenderizadas = {};

/** Texto o guion, para celdas que pueden venir vacias (negocio en persona natural). */
function textoODash(valor) {
    const v = (valor ?? "").toString().trim();
    return v ? v : "-";
}

// Calcula el estado de tiempo de una orden segun su fecha limite de diseño
// (prioritaria) o su fecha de entrega. Devuelve: atiempo | pronto | vencida | sinfecha
// Dias maximos para crear la orden de diseño desde que la orden entra a produccion.
const DIAS_LIMITE_DISENO = 15;

// Devuelve un objeto Date con la fecha limite para crear la orden de diseño.
// Usa el campo guardado orden.fechaLimiteDiseno (yyyy-mm-dd) o lo calcula
// sumando DIAS_LIMITE_DISENO a la fecha de envio a produccion.
function obtenerFechaLimiteDiseno(orden) {
    if (orden.fechaLimiteDiseno) {
        const [y, m, d] = orden.fechaLimiteDiseno.split("-");
        return new Date(y, m - 1, d);
    }
    if (orden.fechaEnvio) {
        const base = new Date(orden.fechaEnvio);
        if (!isNaN(base)) {
            base.setDate(base.getDate() + DIAS_LIMITE_DISENO);
            return base;
        }
    }
    return null;
}

// Dias que faltan para que venza el plazo de creacion de la orden de diseño.
// Devuelve null si no aplica (ya existe la orden de diseño o no hay fecha).
function diasRestantesDiseno(orden) {
    const disenoId = orden.id + "-diseno";
    if (ordenesDisenoDB[disenoId]) return null;
    const fechaRef = obtenerFechaLimiteDiseno(orden);
    if (!fechaRef || isNaN(fechaRef)) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    fechaRef.setHours(0, 0, 0, 0);
    return Math.round((fechaRef - hoy) / (1000 * 60 * 60 * 24));
}

function calcularEstadoOrden(orden) {
    const disenoId = orden.id + "-diseno";
    const diseno = ordenesDisenoDB[disenoId];

    let fechaRef = null;
    // Prioridad 1: la orden de diseño ya existe y tiene fecha limite propia (yyyy-mm-dd)
    if (diseno && diseno.fechaLimite) {
        const [y, m, d] = diseno.fechaLimite.split("-");
        fechaRef = new Date(y, m - 1, d);
    } else if (!diseno) {
        // Prioridad 2: la orden de diseño AUN NO se ha creado -> aplica el plazo
        // maximo para crearla (fechaEnvio + DIAS_LIMITE_DISENO). Si se vence, la
        // orden se marca como vencida aunque no exista todavia la orden de diseño.
        fechaRef = obtenerFechaLimiteDiseno(orden);
    }

    // Prioridad 3: fecha de entrega (dd/mm/yyyy) si no hubo referencia previa
    if ((!fechaRef || isNaN(fechaRef)) && orden.fechaEntrega) {
        const [d, m, y] = orden.fechaEntrega.split("/");
        fechaRef = new Date(y, m - 1, d);
    }

    if (!fechaRef || isNaN(fechaRef)) return "sinfecha";

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    fechaRef.setHours(0, 0, 0, 0);
    const diffDias = Math.round((fechaRef - hoy) / (1000 * 60 * 60 * 24));

    if (diffDias <= 0) return "vencida";
    if (diffDias <= 2) return "pronto";
    return "atiempo";
}

// Actualiza en la base de datos las ordenes que aun no tienen fechaLimiteDiseno.
// Calcula la fecha como fechaEnvio + DIAS_LIMITE_DISENO (yyyy-mm-dd) y la persiste.
// Muta el array recibido para que el render use el valor ya calculado.
async function migrarFechasLimiteDiseno(ordenes) {
    const pendientes = ordenes.filter(o => !o.fechaLimiteDiseno && o.fechaEnvio);
    if (pendientes.length === 0) return;

    await Promise.all(pendientes.map(async (orden) => {
        const base = new Date(orden.fechaEnvio);
        if (isNaN(base)) return;
        base.setDate(base.getDate() + DIAS_LIMITE_DISENO);
        const fechaLimiteDiseno = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
        orden.fechaLimiteDiseno = fechaLimiteDiseno;
        try {
            const ref = doc(db, "produccion", orden.id);
            const snap = await getDoc(ref);
            if (snap.exists()) {
                await setDoc(ref, { ...snap.data(), fechaLimiteDiseno });
            }
        } catch (err) {
            console.warn("No se pudo migrar fechaLimiteDiseno de", orden.id, err);
        }
    }));
}

async function cargarOrdenes(rolUsuario) {
    try {
        // Leer de la coleccion "produccion" que el admin crea al enviar
        const snap = await getDocs(collection(db, "produccion"));
        const ordenes = [];
        snap.forEach(d => ordenes.push({ id: d.id, ...d.data() }));
        // Excluir ordenes en papelera
        const ordenesActivas = ordenes.filter(o => !o.eliminado);
        ordenesActivas.sort((a, b) => (b.fechaEnvio || "").localeCompare(a.fechaEnvio || ""));

        // Migracion: asignar fecha limite de diseño a ordenes antiguas que no la tienen.
        // Se calcula como fechaEnvio + DIAS_LIMITE_DISENO y se guarda en la base de datos.
        await migrarFechasLimiteDiseno(ordenesActivas);

        // Cargar ordenes de diseño existentes
        const snapDiseno = await getDocs(collection(db, "ordenesDiseno"));
        ordenesDisenoDB = {};
        snapDiseno.forEach(d => { ordenesDisenoDB[d.id] = { id: d.id, ...d.data() }; });

        ordenesCache = ordenesActivas;
        ordenesRolCache = rolUsuario;
        renderOrdenesConFiltro(rolUsuario);
    } catch (err) {
        console.error("Error al cargar ordenes:", err);
    }
}

function renderOrdenesConFiltro(rolUsuario) {
    const busqueda = (document.getElementById("ordenesBuscar")?.value || "").trim().toLowerCase();
    const filtroEstado = document.getElementById("ordenesFiltroEstado")?.value || "";
    let ordenes = ordenesCache;

    // Filtrar por búsqueda
    if (busqueda) {
        ordenes = ordenes.filter(o =>
            (o.cliente || "").toLowerCase().includes(busqueda) ||
            (o.numero || "").toLowerCase().includes(busqueda) ||
            (o.negocio || "").toLowerCase().includes(busqueda) ||
            (o.tipo || "").toLowerCase().includes(busqueda)
        );
    }

    // Filtrar por estado de tiempo (a tiempo / pronto / vencida / sin fecha)
    if (filtroEstado) {
        ordenes = ordenes.filter(o => calcularEstadoOrden(o) === filtroEstado);
    }

    if (rolUsuario === "administrador" || rolUsuario === "ordenes") {
        renderOrdenesPorTipo(ordenes, "digital", "ordenesDigitalLista", rolUsuario);
        renderOrdenesPorTipo(ordenes, "imprenta", "ordenesImprentaLista", rolUsuario);
    } else if (rolUsuario === "ventas") {
        const currentUser = sessionStorage.getItem("userName") || "";
        const currentEmail = sessionStorage.getItem("userEmail") || "";
        const misOrdenes = ordenes.filter(o =>
            o.creadoPor === currentUser || o.creadoPorEmail === currentEmail ||
            (!o.creadoPor && !o.creadoPorEmail)
        );
        renderOrdenesPorTipo(misOrdenes, "digital", "ordenesDigitalLista", rolUsuario);
        renderOrdenesPorTipo(misOrdenes, "imprenta", "ordenesImprentaLista", rolUsuario);
    } else if (["diseno", "guillotina", "impresion", "troquelado", "vasos", "empaques"].includes(rolUsuario)) {
        // Roles de area: ven TODAS las ordenes en solo lectura (sin filtrar por tipo)
        renderOrdenesSoloLectura(ordenes, "ordenesPendientesLista");
        // Mostrar todos los diseños existentes para que las areas puedan verlos
        const disenosArea = [];
        ordenes.forEach(orden => {
            const disenoId = orden.id + "-diseno";
            const diseno = ordenesDisenoDB[disenoId];
            if (diseno) disenosArea.push({ orden, diseno });
        });
        renderDisenosRespondidos(disenosArea, "ordenesDisenosLista", rolUsuario);
    } else {
        const tipoRol = rolUsuario;
        const misOrdenes = ordenes.filter(o => o.tipo === tipoRol);
        const currentUser = sessionStorage.getItem("userName") || "";
        const currentEmail = sessionStorage.getItem("userEmail") || "";
        const pendientes = [];
        const respondidas = [];

        misOrdenes.forEach(orden => {
            const disenoId = orden.id + "-diseno";
            const diseno = ordenesDisenoDB[disenoId];
            if (diseno && diseno.estado === "respondida") {
                const sinAsignar = !diseno.creadoPor && !diseno.creadoPorEmail;
                const esMio = sinAsignar || diseno.creadoPor === currentUser || diseno.creadoPorEmail === currentEmail;
                if (!esMio) { pendientes.push(orden); return; }
                const tieneAprobada = (diseno.items || []).some(item =>
                    (item.imagenes || []).some(img => img.estado === "aprobada")
                );
                if (tieneAprobada) { respondidas.push({ orden, diseno }); }
                else { pendientes.push(orden); }
            } else if (diseno && diseno.estado === "pendiente") {
                const sinAsignar = !diseno.creadoPor && !diseno.creadoPorEmail;
                const esMio = sinAsignar || diseno.creadoPor === currentUser || diseno.creadoPorEmail === currentEmail;
                if (esMio) { pendientes.push(orden); }
            } else {
                pendientes.push(orden);
            }
        });

        renderOrdenesPorTipo(pendientes, tipoRol, "ordenesPendientesLista", rolUsuario);
        renderDisenosRespondidos(respondidas, "ordenesDisenosLista", rolUsuario);
    }
}

function renderDisenosRespondidos(items, containerId, rolUsuario) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-brush"></i><p>No hay diseños respondidos aun</p></div>';
        return;
    }

    let html = '<div class="disenos-lista">';

    items.forEach(({ orden, diseno }) => {
        const fecha = new Date(diseno.fechaCreacion || "");
        const fechaStr = isNaN(fecha) ? "-" : fecha.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

        // Contar aprobadas y rechazadas
        let aprobadas = 0, rechazadas = 0;
        (diseno.items || []).forEach(item => {
            (item.imagenes || []).forEach(img => {
                if (img.estado === "aprobada") aprobadas++;
                if (img.estado === "rechazada") rechazadas++;
            });
        });

        const estadoBadge = diseno.estado === "respondida"
            ? `<span class="diseno-estado-badge respondida"><i class="bi bi-check-circle"></i> ${aprobadas} aprobadas, ${rechazadas} rechazadas</span>`
            : `<span class="diseno-estado-badge pendiente"><i class="bi bi-clock"></i> Pendiente</span>`;

        html += `
            <div class="diseno-lista-item">
                <div class="diseno-lista-info">
                    <div class="diseno-lista-top">
                        <strong>${orden.numero}</strong>
                        ${estadoBadge}
                    </div>
                    <span class="diseno-lista-sub">${orden.cliente} &bull; ${fechaStr}</span>
                </div>
                <button class="btn-ver-diseno" data-id="${diseno.id}">
                    <i class="bi bi-eye"></i> Ver diseños
                </button>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;

    // Eventos
    container.querySelectorAll(".btn-ver-diseno").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            const item = items.find(i => i.diseno.id === id);
            if (item) abrirModalVerDisenos(item.diseno);
        });
    });
}

function renderOrdenesPorTipo(ordenes, tipo, containerId, rolUsuario) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Si es admin u ordenes, filtrar por tipo. Si es ventas, filtrar por tipo y por propiedad.
    let filtradas;
    if (rolUsuario === "administrador" || rolUsuario === "ordenes") {
        filtradas = ordenes.filter(o => o.tipo === tipo);
    } else if (rolUsuario === "ventas") {
        // Ventas ya recibe solo sus órdenes desde cargarOrdenes, solo filtrar por tipo
        filtradas = ordenes.filter(o => o.tipo === tipo);
    } else {
        filtradas = ordenes;
    }

    // Registrar lo visible antes de cualquier salida temprana
    ordenesRenderizadas[containerId] = filtradas;

    if (filtradas.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i><p>No hay ordenes de ${tipo} aun</p></div>`;
        return;
    }

    const esRolProduccion = rolUsuario === "imprenta" || rolUsuario === "digital";

    // Leyenda de colores
    let html = `
        <div class="ordenes-leyenda">
            <span class="leyenda-item"><span class="leyenda-dot leyenda-verde"></span> A tiempo (3+ dias)</span>
            <span class="leyenda-item"><span class="leyenda-dot leyenda-amarillo"></span> Pronto (1-2 dias)</span>
            <span class="leyenda-item"><span class="leyenda-dot leyenda-rojo"></span> Vencida / Hoy</span>
        </div>
        <div class="ordenes-tabla-wrap">
        <table class="ordenes-tabla">
            <thead>
                <tr>
                    <th>Orden</th>
                    <th>Cliente</th>
                    <th>Negocio</th>
                    <th>Ciudad</th>
                    <th>Asesor</th>
                    <th>Entrega</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
    `;

    filtradas.forEach(orden => {
        const fecha = new Date(orden.fechaEnvio || "");
        const fechaStr = isNaN(fecha) ? "-" : fecha.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

        // Semaforo segun fecha limite de diseño (o fecha de entrega)
        const estadoOrden = calcularEstadoOrden(orden);
        let filaClass = "fila-verde";
        if (estadoOrden === "vencida") filaClass = "fila-rojo";
        else if (estadoOrden === "pronto") filaClass = "fila-amarillo";
        else if (estadoOrden === "atiempo") filaClass = "fila-verde";
        else filaClass = "fila-verde"; // sin fecha

        const fechaMostrar = orden.fechaEntrega || fechaStr;

        // Verificar si ya existe orden de diseño
        const disenoId = orden.id + "-diseno";
        const tieneDiseno = !!ordenesDisenoDB[disenoId];
        const disenoData = ordenesDisenoDB[disenoId];
        const btnDisenoLabel = tieneDiseno
            ? '<i class="bi bi-pencil"></i> Editar orden de diseño'
            : '<i class="bi bi-brush"></i> Crear orden de diseño';
        const btnDisenoClass = tieneDiseno ? "btn-crear-diseno btn-editar-diseno" : "btn-crear-diseno";

        // Badge de estado de diseño
        let disenoEstadoBadge = "";
        if (disenoData && disenoData.estado === "respondida") {
            disenoEstadoBadge = `<span class="diseno-estado-inline respondida"><i class="bi bi-check-circle"></i> Diseño respondido</span>`;
        } else if (tieneDiseno) {
            disenoEstadoBadge = `<span class="diseno-estado-inline pendiente"><i class="bi bi-clock"></i> Diseño pendiente</span>`;
        } else if (estadoOrden === "vencida") {
            // No se creo la orden de diseño dentro del plazo -> vencida
            disenoEstadoBadge = `<span class="diseno-estado-inline vencida"><i class="bi bi-exclamation-triangle"></i> Diseño vencido</span>`;
        } else if (estadoOrden === "pronto") {
            const dias = diasRestantesDiseno(orden);
            disenoEstadoBadge = `<span class="diseno-estado-inline pendiente"><i class="bi bi-hourglass-split"></i> ${dias === 0 ? "Vence hoy" : "Vence en " + dias + (dias === 1 ? " dia" : " dias")}</span>`;
        }

        // Boton copiar link solo si ya existe orden de diseño
        const btnCopyLink = tieneDiseno
            ? `<button class="btn-copiar-link-diseno" data-id="${orden.id}"><i class="bi bi-link-45deg"></i> Copiar link</button>`
            : "";

        // El rol "ordenes" solo ve, no crea/edita diseños
        const btnDisenoHtml = rolUsuario === "ordenes" ? "" : `<button class="${btnDisenoClass}" data-id="${orden.id}">${btnDisenoLabel}</button>`;

        html += `
            <tr class="${filaClass}">
                <td><strong>${orden.numero}</strong> ${disenoEstadoBadge}</td>
                <td>${orden.cliente}</td>
                <td>${textoODash(orden.negocio)}</td>
                <td>${textoODash(orden.ciudad)}</td>
                <td>${textoODash(orden.creadoPor)}</td>
                <td>${fechaMostrar}</td>
                <td>
                    <div class="orden-acciones">
                        <button class="btn-ver-orden" data-id="${orden.id}">
                            <i class="bi bi-eye"></i> Ver mas
                        </button>
                        ${btnCopyLink}
                        ${btnDisenoHtml}
                    </div>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;

    // Eventos "Ver mas"
    container.querySelectorAll(".btn-ver-orden").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            const orden = filtradas.find(o => o.id === id);
            if (orden) abrirModalOrden(orden, esRolProduccion);
        });
    });

    // Eventos "Crear orden de diseño"
    container.querySelectorAll(".btn-crear-diseno").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            const orden = filtradas.find(o => o.id === id);
            if (orden) crearOrdenDiseno(orden);
        });
    });

    // Eventos "Copiar link de diseño"
    container.querySelectorAll(".btn-copiar-link-diseno").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            const disenoId = id + "-diseno";
            const baseUrl = window.location.origin + window.location.pathname.replace("dashboard.html", "");
            const link = baseUrl + "diseno.html?id=" + disenoId;
            copyToClipboard(link).then(() => {
                btn.innerHTML = '<i class="bi bi-check-lg"></i> Copiado';
                btn.classList.add("copiado");
                setTimeout(() => {
                    btn.innerHTML = '<i class="bi bi-link-45deg"></i> Copiar link';
                    btn.classList.remove("copiado");
                }, 2000);
            });
        });
    });
}

let ordenDetalleActual = null;

/* Muestra el asesor que origino la orden en el encabezado del modal.
   Las ordenes creadas antes de este campo simplemente no lo muestran. */
function pintarAsesorOrden(creadoPor) {
    const wrap = document.getElementById("ordenDetalleAsesor");
    const nom  = document.getElementById("ordenDetalleAsesorNombre");
    if (!wrap || !nom) return;
    const asesor = (creadoPor || "").trim();
    nom.textContent = asesor ? "Asesor: " + asesor : "";
    wrap.style.display = asesor ? "" : "none";
}

function abrirModalOrden(orden, esRolProduccion) {
    const overlay = document.getElementById("ordenDetalleOverlay");
    const items = orden.items || [];
    ordenDetalleActual = orden;

    document.getElementById("ordenDetalleNumero").textContent = orden.numero;
    // Cliente + negocio + ciudad, omitiendo los que vengan vacios
    document.getElementById("ordenDetalleCliente").textContent =
        [orden.cliente, orden.negocio, orden.ciudad]
            .map(v => (v ?? "").toString().trim())
            .filter(Boolean)
            .join(" · ");

    pintarAsesorOrden(orden.creadoPor);

    // Ocultar botones de diseño (solo se muestran en abrirModalVerDisenos)
    document.getElementById("ordenDetalleCopyLink").style.display = "none";
    document.getElementById("ordenDetalleRedisenar").style.display = "none";

    // Boton de descarga PDF de la orden
    const btnPDFOrden = document.getElementById("ordenDetallePDF");
    if (btnPDFOrden) {
        btnPDFOrden.style.display = "";
        btnPDFOrden.onclick = () => {
            if (typeof window.exportarOrdenPDF === "function" && ordenDetalleActual) {
                window.exportarOrdenPDF(ordenDetalleActual);
            }
        };
    }

    const itemsHtml = items.map(i => {
        const terminadosDisplay = i.terminados ? (Array.isArray(i.terminados) ? (i.terminados.length > 0 ? i.terminados.join(", ") : "-") : i.terminados) : (i.terminado || "-");
        const coloresDisplay = i.colores ? (Array.isArray(i.colores) ? (i.colores.length > 0 ? i.colores.join(", ") : "-") : i.colores) : (i.color || "-");
        const materialesDisplay = i.materiales ? (Array.isArray(i.materiales) ? (i.materiales.length > 0 ? i.materiales.join(", ") : "-") : i.materiales) : "-";
        const planchasDisplay = i.planchas ? (Array.isArray(i.planchas) ? (i.planchas.length > 0 ? i.planchas.join(", ") : "-") : i.planchas) : "-";
        return `
        <tr>
            <td><strong>${i.cantidad}x</strong></td>
            <td>${i.producto}</td>
            <td>${terminadosDisplay}</td>
            <td>${coloresDisplay}</td>
            <td>${materialesDisplay}</td>
            <td>${planchasDisplay}</td>
        </tr>
    `;
    }).join("");

    document.getElementById("ordenDetalleItems").innerHTML = itemsHtml || `<tr><td colspan="6">Sin productos</td></tr>`;

    overlay.classList.add("show");
}

// ===== ORDENES EN SOLO LECTURA (roles de area: diseno, guillotina, impresion, etc.) =====
// Estos roles ven todas las ordenes pero sin acciones de edicion/creacion de diseño.
function renderOrdenesSoloLectura(ordenes, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    ordenesRenderizadas[containerId] = ordenes || [];

    if (!ordenes || ordenes.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i><p>No hay ordenes aun</p></div>`;
        return;
    }

    let html = `
        <div class="ordenes-tabla-wrap">
        <table class="ordenes-tabla">
            <thead>
                <tr>
                    <th>Orden</th>
                    <th>Cliente</th>
                    <th>Negocio</th>
                    <th>Ciudad</th>
                    <th>Tipo</th>
                    <th>Asesor</th>
                    <th>Entrega</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
    `;

    ordenes.forEach(orden => {
        const fecha = new Date(orden.fechaEnvio || "");
        const fechaStr = isNaN(fecha) ? "-" : fecha.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
        const fechaMostrar = orden.fechaEntrega || fechaStr;
        const tipoLabel = orden.tipo === "digital" ? "Digital" : "Imprenta";

        html += `
            <tr>
                <td><strong>${orden.numero}</strong></td>
                <td>${orden.cliente}</td>
                <td>${textoODash(orden.negocio)}</td>
                <td>${textoODash(orden.ciudad)}</td>
                <td>${tipoLabel}</td>
                <td>${textoODash(orden.creadoPor)}</td>
                <td>${fechaMostrar}</td>
                <td>
                    <div class="orden-acciones">
                        <button class="btn-ver-orden" data-id="${orden.id}">
                            <i class="bi bi-eye"></i> Ver mas
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;

    container.querySelectorAll(".btn-ver-orden").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            const orden = ordenes.find(o => o.id === id);
            if (orden) abrirModalOrden(orden, false);
        });
    });
}

async function crearOrdenDiseno(orden) {
    const disenoId = orden.id + "-diseno";

    // Sincronizar con la cotizacion actual antes de abrir, para corregir ordenes
    // que quedaron desactualizadas (productos agregados en ediciones previas).
    let ordenActualizada = orden;
    try {
        const cotId = orden.cotizacionId || orden.id.replace(/-(digital|imprenta)$/, "");
        const cotSnap = await getDoc(doc(db, "cotizaciones", cotId));
        if (cotSnap.exists()) {
            const cot = cotSnap.data();
            await actualizarCascadaCotizacion(cotId, cot);
            // Releer la orden de produccion ya sincronizada
            const prodSnap = await getDoc(doc(db, "produccion", orden.id));
            if (prodSnap.exists()) {
                ordenActualizada = { id: orden.id, ...prodSnap.data() };
                ordenesCache = ordenesCache.map(o => o.id === orden.id ? ordenActualizada : o);
            }
        }
    } catch (err) {
        console.warn("No se pudo sincronizar la orden de diseño con la cotizacion:", err);
    }

    // Releer la orden de diseño (ya sincronizada si existia)
    let existente = ordenesDisenoDB[disenoId] || null;
    try {
        const disenoSnap = await getDoc(doc(db, "ordenesDiseno", disenoId));
        if (disenoSnap.exists()) {
            existente = { id: disenoId, ...disenoSnap.data() };
            ordenesDisenoDB[disenoId] = existente;
        }
    } catch (err) {
        console.warn("No se pudo releer la orden de diseño:", err);
    }

    abrirVistaDisenoOrden(ordenActualizada, existente);
}

// ===== VISTA ORDEN DE DISEÑO (inline) =====
const IMGBB_KEY = "85c1345ba9104ab223ed72e168bb111d";
let disenoOrdenActual = null;
let disenoEditando = null; // null = crear, objeto = editar

function abrirVistaDisenoOrden(orden, existente) {
    disenoOrdenActual = orden;
    disenoEditando = existente;

    // Ocultar lista, mostrar vista diseño
    document.getElementById("ordenesListaView").style.display = "none";
    document.getElementById("ordenDisenoView").style.display = "block";

    // Llenar info
    document.getElementById("disenoOrdenNum").textContent = orden.numero;
    document.getElementById("disenoCliente").textContent = orden.cliente;
    document.getElementById("disenoTelefono").textContent = orden.telefono || "-";
    document.getElementById("disenoTipo").textContent = orden.tipo || "-";

    // Fecha limite de diseño (yyyy-mm-dd para el input date)
    const inputFechaLimite = document.getElementById("disenoFechaLimite");
    if (inputFechaLimite) {
        inputFechaLimite.value = (existente && existente.fechaLimite) ? existente.fechaLimite : "";
    }

    if (existente) {
        document.getElementById("disenoViewTitle").innerHTML = `<i class="bi bi-pencil"></i> Editar Orden de Diseño - ${orden.numero}`;
        document.getElementById("btnGuardarDiseno").innerHTML = '<i class="bi bi-check-lg"></i> Guardar cambios y copiar link';
    } else {
        document.getElementById("disenoViewTitle").innerHTML = `<i class="bi bi-brush"></i> Orden de Diseño - ${orden.numero}`;
        document.getElementById("btnGuardarDiseno").innerHTML = '<i class="bi bi-check-lg"></i> Guardar y generar link';
    }

    // Renderizar productos (con imagenes existentes si es edicion)
    const itemsParaRender = existente ? existente.items : (orden.items || []);
    renderDisenoProductos(itemsParaRender, !!existente);

    // Boton volver (con confirmacion)
    document.getElementById("btnVolverOrdenes").onclick = () => {
        showConfirm(
            "Salir sin guardar",
            "¿Estas seguro que deseas salir? Los cambios no guardados se perderan.",
            () => {
                document.getElementById("ordenDisenoView").style.display = "none";
                document.getElementById("ordenesListaView").style.display = "block";
                // Re-activar tab por defecto de ordenes
                const tabDigital = document.getElementById("tab-digital");
                if (tabDigital && !tabDigital.classList.contains("active")) {
                    document.querySelectorAll("#ordenesListaView .tab-content").forEach(c => c.classList.remove("active"));
                    tabDigital.classList.add("active");
                    document.querySelectorAll("#ordenesTabBar .tab-btn").forEach(b => b.classList.remove("active"));
                    const btnDigital = document.querySelector('#ordenesTabBar .tab-btn[data-tab="digital"]');
                    if (btnDigital) btnDigital.classList.add("active");
                }
                cargarOrdenes(rol);
                cargarDisenosAprobados(rol);
            }
        );
    };

    // Boton guardar
    document.getElementById("btnGuardarDiseno").onclick = () => guardarOrdenDiseno(orden);
}

function renderDisenoProductos(items, esEdicion) {
    const container = document.getElementById("disenoProductosContainer");
    container.innerHTML = "";

    items.forEach((item, idx) => {
        const card = document.createElement("div");
        card.className = "card diseno-producto-card";
        card.innerHTML = `
            <div class="card-header">
                <span class="card-title">
                    <i class="bi bi-box"></i>
                    <strong>${item.cantidad}x</strong> ${item.producto}
                    ${item.terminados ? (Array.isArray(item.terminados) ? item.terminados.map(t => `<span class="diseno-tag">${t}</span>`).join("") : (item.terminados ? `<span class="diseno-tag">${item.terminados}</span>` : "")) : (item.terminado ? `<span class="diseno-tag">${item.terminado}</span>` : "")}
                    ${item.colores ? (Array.isArray(item.colores) ? item.colores.map(c => `<span class="diseno-tag">${c}</span>`).join("") : (item.colores ? `<span class="diseno-tag">${item.colores}</span>` : "")) : (item.color ? `<span class="diseno-tag">${item.color}</span>` : "")}
                    ${item.materiales ? (Array.isArray(item.materiales) ? item.materiales.map(m => `<span class="diseno-tag">${m}</span>`).join("") : "") : ""}
                    ${item.planchas ? (Array.isArray(item.planchas) ? item.planchas.map(p => `<span class="diseno-tag">${p}</span>`).join("") : "") : ""}
                </span>
            </div>
            <div class="card-body padded">
                <div class="diseno-imagenes" id="disenoImagenes-${idx}"></div>
                <div class="diseno-upload-row">
                    <button class="btn-upload-diseno" data-idx="${idx}">
                        <i class="bi bi-cloud-arrow-up"></i> Subir imagen
                    </button>
                    <button class="btn-add-link-diseno" data-idx="${idx}">
                        <i class="bi bi-link-45deg"></i> Agregar link Pacdora
                    </button>
                </div>
                <input type="file" class="diseno-file-input" data-idx="${idx}" accept="image/*" multiple hidden>
                <div class="diseno-links-container" id="disenoLinks-${idx}"></div>
                ${renderPlanchaOrdenHTML(item, idx)}
            </div>
        `;
        container.appendChild(card);

        // Configurar eventos de la orden de planchas de este producto
        setupPlanchaOrden(card, idx, item);

        // Si es edicion, cargar imagenes existentes
        if (esEdicion && item.imagenes && item.imagenes.length > 0) {
            const imgContainer = card.querySelector(`#disenoImagenes-${idx}`);
            item.imagenes.forEach(img => {
                const imgItem = document.createElement("div");
                imgItem.className = "diseno-img-item";
                imgItem.innerHTML = `
                    <img src="${img.url}" alt="Diseño" class="diseno-thumb" data-url="${img.url}">
                    <button class="diseno-img-remove" data-url="${img.url}" data-idx="${idx}">
                        <i class="bi bi-x"></i>
                    </button>
                `;
                imgContainer.appendChild(imgItem);

                // Click para ver grande
                imgItem.querySelector(".diseno-thumb").addEventListener("click", () => {
                    document.getElementById("imgModalDashImg").src = img.url;
                    document.getElementById("imgModalDash").classList.add("show");
                });

                // Eliminar
                imgItem.querySelector(".diseno-img-remove").addEventListener("click", () => {
                    imgItem.remove();
                });
            });
        }

        // Si es edicion, cargar links existentes
        if (esEdicion && item.pacdoraLinks && item.pacdoraLinks.length > 0) {
            const linksContainer = card.querySelector(`#disenoLinks-${idx}`);
            item.pacdoraLinks.forEach(link => {
                agregarLinkItem(linksContainer, link);
            });
        }

        // Evento subir imagenes
        const btnUpload = card.querySelector(".btn-upload-diseno");
        const fileInput = card.querySelector(".diseno-file-input");

        btnUpload.addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", (e) => subirImagenesDiseno(e, idx));

        // Evento agregar link
        const btnAddLink = card.querySelector(".btn-add-link-diseno");
        btnAddLink.addEventListener("click", () => {
            const linksContainer = card.querySelector(`#disenoLinks-${idx}`);
            agregarLinkItem(linksContainer, "");
        });
    });
}

// ===== ORDEN DE PLANCHAS (por producto/diseño) =====
// Opciones de la orden de plancha segun el formato solicitado.
const PLANCHA_COLORES = ["C", "M", "Y", "K", "4x4"];
const PLANCHA_TIPOS = [
    { key: "ridNormal", label: "Rid Normal" },
    { key: "ridDoblePinza", label: "Rid Doble Pinza" },
    { key: "plancha14", label: "Plancha 1/4" },
    { key: "plancha12", label: "Plancha 1/2" },
    { key: "planchaPliego", label: "Plancha Pliego" }
];

function renderPlanchaOrdenHTML(item, idx) {
    const p = item.ordenPlancha || {};
    const colores = p.colores || {};
    const tipos = p.tipos || {};

    const coloresHtml = PLANCHA_COLORES.map(c => `
        <label class="plancha-check">
            <input type="checkbox" class="plancha-color-check" data-idx="${idx}" data-color="${c}" ${colores[c] ? "checked" : ""}>
            <span class="plancha-check-dot"></span>
            <span class="plancha-check-label">${c}</span>
        </label>
    `).join("");

    const tiposHtml = PLANCHA_TIPOS.map(t => `
        <label class="plancha-check plancha-check-row">
            <span class="plancha-check-label">${t.label}</span>
            <input type="checkbox" class="plancha-tipo-check" data-idx="${idx}" data-tipo="${t.key}" ${tipos[t.key] ? "checked" : ""}>
            <span class="plancha-check-dot"></span>
        </label>
    `).join("");

    return `
        <div class="plancha-orden" id="planchaOrden-${idx}">
            <div class="plancha-orden-header">
                <i class="bi bi-layers-half"></i> Orden de Planchas
            </div>
            <div class="plancha-orden-body">
                <div class="plancha-grupo">
                    <span class="plancha-grupo-title">Colores</span>
                    <div class="plancha-checks plancha-checks-inline">
                        ${coloresHtml}
                    </div>
                </div>
                <div class="plancha-grupo">
                    <span class="plancha-grupo-title">Tipo de plancha</span>
                    <div class="plancha-checks">
                        ${tiposHtml}
                    </div>
                </div>
                <div class="plancha-grupo plancha-grupo-full">
                    <span class="plancha-grupo-title">Observaciones</span>
                    <textarea class="plancha-observaciones" data-idx="${idx}" rows="2" placeholder="Notas u observaciones para esta plancha...">${p.observaciones || ""}</textarea>
                </div>
                <div class="plancha-grupo plancha-grupo-full">
                    <span class="plancha-grupo-title">Disenador / Proveedor</span>
                    <input type="text" class="plancha-disenador" data-idx="${idx}" placeholder="Nombre del disenador o proveedor" value="${p.disenador || ""}">
                </div>
                <div class="plancha-grupo plancha-grupo-full">
                    <span class="plancha-grupo-title">Correo destino</span>
                    <input type="email" class="plancha-correo" data-idx="${idx}" placeholder="correo@proveedor.com" value="${p.correo || ""}">
                </div>
                <div class="plancha-grupo plancha-grupo-full">
                    <span class="plancha-grupo-title">Documento (PDF o imagen)</span>
                    <div class="plancha-doc-row">
                        <button type="button" class="btn-upload-plancha-doc" data-idx="${idx}">
                            <i class="bi bi-cloud-arrow-up"></i> Subir documento
                        </button>
                        <input type="file" class="plancha-doc-file" data-idx="${idx}" accept=".pdf,image/*" hidden>
                    </div>
                    <div class="plancha-doc-preview" id="planchaDocPreview-${idx}">${renderPlanchaDocChip(idx, p.documento)}</div>
                    <input type="hidden" class="plancha-doc-url" data-idx="${idx}" value="${p.documento && p.documento.url ? p.documento.url : ""}">
                    <input type="hidden" class="plancha-doc-name" data-idx="${idx}" value="${p.documento && p.documento.name ? p.documento.name : ""}">
                    <span class="plancha-doc-hint"><i class="bi bi-info-circle"></i> Sube un PDF o imagen (max 20 MB); el proveedor podra descargarlo desde el correo.</span>
                </div>
                <div class="plancha-grupo plancha-grupo-full">
                    <button type="button" class="btn-enviar-plancha" data-idx="${idx}">
                        <i class="bi bi-envelope-arrow-up"></i> Enviar orden de plancha por correo
                    </button>
                </div>
            </div>
        </div>
    `;
}

function setupPlanchaOrden(card, idx, item) {
    // Boton enviar por correo
    const btnEnviar = card.querySelector(`.btn-enviar-plancha[data-idx="${idx}"]`);
    if (btnEnviar) {
        btnEnviar.addEventListener("click", () => enviarOrdenPlanchaCorreo(idx, item));
    }

    // Subida de documento a Firebase Storage
    const btnDoc = card.querySelector(`.btn-upload-plancha-doc[data-idx="${idx}"]`);
    const fileDoc = card.querySelector(`.plancha-doc-file[data-idx="${idx}"]`);
    if (btnDoc && fileDoc) {
        btnDoc.addEventListener("click", () => fileDoc.click());
        fileDoc.addEventListener("change", (e) => subirDocumentoPlancha(e, idx));
    }

    // Conectar boton de eliminar del chip inicial (si viene documento guardado)
    conectarQuitarDocPlancha(idx);
}

// Genera el "chip" que muestra el documento subido con opciones ver/quitar.
function renderPlanchaDocChip(idx, documento) {
    if (!documento || !documento.url) return "";
    const nombre = documento.name || "Documento";
    return `
        <a href="${documento.url}" target="_blank" class="plancha-doc-link" title="${nombre}">
            <i class="bi bi-file-earmark-arrow-down"></i> ${nombre}
        </a>
        <button type="button" class="plancha-doc-remove" data-idx="${idx}" title="Quitar documento">
            <i class="bi bi-x"></i>
        </button>`;
}

// Conecta el boton de quitar documento del chip actual.
function conectarQuitarDocPlancha(idx) {
    const preview = document.getElementById(`planchaDocPreview-${idx}`);
    if (!preview) return;
    const btnRemove = preview.querySelector(".plancha-doc-remove");
    if (btnRemove) {
        btnRemove.addEventListener("click", () => {
            preview.innerHTML = "";
            const urlInput = document.querySelector(`.plancha-doc-url[data-idx="${idx}"]`);
            const nameInput = document.querySelector(`.plancha-doc-name[data-idx="${idx}"]`);
            if (urlInput) urlInput.value = "";
            if (nameInput) nameInput.value = "";
        });
    }
}

// Sube el documento seleccionado a Firebase Storage (carpeta planchas/) y
// guarda la URL de descarga en los inputs ocultos.
async function subirDocumentoPlancha(e, idx) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const MAX = 20 * 1024 * 1024; // 20 MB (coincide con storage.rules)
    if (file.size > MAX) {
        showNotif("Archivo muy grande", "El documento supera los 20 MB. Comprimelo o usa uno mas liviano.");
        e.target.value = "";
        return;
    }

    const btn = document.querySelector(`.btn-upload-plancha-doc[data-idx="${idx}"]`);
    const btnHtml = btn ? btn.innerHTML : "";
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Subiendo...';
    }

    try {
        // Nombre unico para evitar colisiones
        const limpio = file.name.replace(/[^\w.\-]+/g, "_");
        const ruta = `planchas/${Date.now()}_${limpio}`;
        const ref = storageRef(storage, ruta);
        // Las imagenes se dejan "inline" para que se vea la vista previa en el correo.
        // Los PDF y demas documentos se marcan como "attachment" para que el boton
        // "Descargar documento" realmente descargue el archivo (y no solo lo abra).
        const esImg = (file.type || "").startsWith("image/");
        const metadata = {
            contentType: file.type || "application/octet-stream",
            contentDisposition: esImg
                ? `inline; filename="${limpio}"`
                : `attachment; filename="${limpio}"`
        };
        await uploadBytes(ref, file, metadata);
        const url = await getDownloadURL(ref);

        // Guardar en inputs ocultos
        const urlInput = document.querySelector(`.plancha-doc-url[data-idx="${idx}"]`);
        const nameInput = document.querySelector(`.plancha-doc-name[data-idx="${idx}"]`);
        if (urlInput) urlInput.value = url;
        if (nameInput) nameInput.value = file.name;

        // Mostrar chip con el documento
        const preview = document.getElementById(`planchaDocPreview-${idx}`);
        if (preview) {
            preview.innerHTML = renderPlanchaDocChip(idx, { url, name: file.name });
            conectarQuitarDocPlancha(idx);
        }

        showNotif("Documento subido", "El documento quedo guardado y se incluira en el correo.");
    } catch (err) {
        console.error("Error subiendo documento de plancha:", err);
        const detalle = (err && (err.message || err.code)) || "Intenta de nuevo.";
        showNotif("No se pudo subir", detalle);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = btnHtml || '<i class="bi bi-cloud-arrow-up"></i> Subir documento';
        }
        e.target.value = "";
    }
}

// Recolecta los datos de la orden de plancha de un producto desde el DOM
function recogerOrdenPlancha(idx) {
    const colores = {};
    document.querySelectorAll(`.plancha-color-check[data-idx="${idx}"]`).forEach(chk => {
        if (chk.checked) colores[chk.dataset.color] = true;
    });
    const tipos = {};
    document.querySelectorAll(`.plancha-tipo-check[data-idx="${idx}"]`).forEach(chk => {
        if (chk.checked) tipos[chk.dataset.tipo] = true;
    });
    const observaciones = (document.querySelector(`.plancha-observaciones[data-idx="${idx}"]`)?.value || "").trim();
    const disenador = (document.querySelector(`.plancha-disenador[data-idx="${idx}"]`)?.value || "").trim();
    const correo = (document.querySelector(`.plancha-correo[data-idx="${idx}"]`)?.value || "").trim();
    const docUrl = (document.querySelector(`.plancha-doc-url[data-idx="${idx}"]`)?.value || "").trim();
    const docName = (document.querySelector(`.plancha-doc-name[data-idx="${idx}"]`)?.value || "").trim();
    const documento = docUrl ? { url: docUrl, name: docName || "Documento" } : null;

    return { colores, tipos, observaciones, disenador, correo, documento };
}

// Construye el cuerpo HTML de la orden de plancha para el correo
function construirHtmlOrdenPlancha({ orden, item, coloresSel, tiposSel, datos, remitente }) {
    const fila = (etiqueta, valor) => `
        <tr>
            <td style="padding:8px 12px;background:#f0f9ff;font-weight:600;color:#334;border:1px solid #e3e8f0;width:38%;vertical-align:top;word-break:break-word;">${etiqueta}</td>
            <td style="padding:8px 12px;color:#222;border:1px solid #e3e8f0;word-break:break-word;">${valor || "-"}</td>
        </tr>`;

    const obsHtml = datos.observaciones
        ? `<div style="margin-top:18px;">
               <p style="margin:0 0 6px;font-weight:600;color:#334;">Observaciones</p>
               <p style="margin:0;padding:10px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;color:#444;white-space:pre-wrap;">${datos.observaciones}</p>
           </div>`
        : "";

    const docUrl = (datos.documento && datos.documento.url) ? datos.documento.url : "";
    const docNombre = (datos.documento && datos.documento.name) ? datos.documento.name : "";
    // Vista previa solo si el documento es una imagen (Firebase sirve la URL directa).
    const esImagen = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(docNombre) || /\.(png|jpe?g|gif|webp|bmp|svg)/i.test(docUrl);
    const docPreview = esImagen ? docUrl : "";
    const previewHtml = docPreview
        ? `<div style="margin-top:18px;text-align:center;">
               <p style="margin:0 0 8px;font-weight:600;color:#334;text-align:left;">Vista previa</p>
               <a href="${docUrl}" target="_blank" style="display:inline-block;">
                   <img src="${docPreview}" alt="Vista previa del documento" style="max-width:100%;width:100%;height:auto;border:1px solid #e3e8f0;border-radius:8px;display:block;">
               </a>
           </div>`
        : "";
    const docHtml = docUrl
        ? `${previewHtml}
           <div style="margin-top:18px;">
               <a href="${docUrl}" target="_blank"
                  style="display:inline-block;background:#29ABE2;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">
                   Descargar documento
               </a>
           </div>`
        : "";

    return `
    <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e3e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:#29ABE2;padding:22px 24px;">
            <h1 style="margin:0;color:#fff;font-size:20px;">Orden de Planchas</h1>
            <p style="margin:4px 0 0;color:#e8f7fd;font-size:13px;">Traffic Empaques - Publicidad</p>
        </div>
        <div style="padding:24px;">
            <p style="margin:0 0 18px;color:#444;">Buen día,<br>Adjunto la orden de planchas con la siguiente información:</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
                ${fila("Orden", orden.numero)}
                ${fila("Cliente", orden.cliente)}
                ${fila("Producto", `${item.cantidad}x ${item.producto}`)}
                ${fila("Colores", coloresSel.join(", "))}
                ${fila("Tipo de plancha", tiposSel.join(", "))}
                ${datos.disenador ? fila("Diseñador / Proveedor", datos.disenador) : ""}
            </table>
            ${obsHtml}
            ${docHtml}
            <p style="margin:24px 0 0;color:#444;">Quedo atento a cualquier inquietud.</p>
            <p style="margin:16px 0 0;color:#444;">Saludos,<br><strong>${remitente}</strong><br>Traffic Empaques - Publicidad</p>
        </div>
    </div>`;
}

// Envia automaticamente la orden de plancha por correo usando EmailJS
async function enviarOrdenPlanchaCorreo(idx, item) {
    const datos = recogerOrdenPlancha(idx);

    if (!datos.correo) {
        showNotif("Falta el correo", "Ingresa el correo destino para enviar la orden de plancha.");
        return;
    }

    // Validar formato del correo antes de enviar (EmailJS rechaza direcciones invalidas)
    const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo);
    if (!correoValido) {
        showNotif("Correo invalido", `"${datos.correo}" no es una direccion valida. Revisa que tenga @ y el dominio (ej: nombre@gmail.com).`);
        return;
    }

    if (!window.emailjs) {
        showNotif("EmailJS no disponible", "No se pudo cargar el servicio de correo. Revisa tu conexion e intenta de nuevo.");
        return;
    }

    const orden = disenoOrdenActual;
    const coloresSel = PLANCHA_COLORES.filter(c => datos.colores[c]);
    const tiposSel = PLANCHA_TIPOS.filter(t => datos.tipos[t.key]).map(t => t.label);
    const remitente = sessionStorage.getItem("userName") || "Traffic Empaques";
    const asunto = `Orden de Planchas - ${orden.numero} - ${item.producto}`;

    const cuerpoHtml = construirHtmlOrdenPlancha({ orden, item, coloresSel, tiposSel, datos, remitente });

    // Cuerpo de texto plano como respaldo
    const lineas = [
        "Buen dia,",
        "",
        "Adjunto la orden de planchas con la siguiente informacion:",
        "",
        `Orden: ${orden.numero}`,
        `Cliente: ${orden.cliente}`,
        `Producto: ${item.cantidad}x ${item.producto}`,
        `Colores: ${coloresSel.join(", ") || "-"}`,
        `Tipo de plancha: ${tiposSel.join(", ") || "-"}`
    ];
    if (datos.disenador) lineas.push(`Disenador / Proveedor: ${datos.disenador}`);
    if (datos.observaciones) { lineas.push("", "Observaciones:", datos.observaciones); }
    const docUrlTexto = (datos.documento && datos.documento.url) ? datos.documento.url : "";
    if (docUrlTexto) { lineas.push("", "Documento:", docUrlTexto); }
    lineas.push("", "Quedo atento a cualquier inquietud.", "", "Saludos,", remitente, "Traffic Empaques - Publicidad");
    const cuerpoTexto = lineas.join("\n");

    // Parametros que recibe la plantilla de EmailJS
    const params = {
        to_email:     datos.correo,
        subject:      asunto,
        from_name:    remitente,
        orden:        orden.numero,
        cliente:      orden.cliente,
        producto:     `${item.cantidad}x ${item.producto}`,
        colores:      coloresSel.join(", ") || "-",
        tipo_plancha: tiposSel.join(", ") || "-",
        disenador:    datos.disenador || "-",
        observaciones: datos.observaciones || "-",
        documento_url: docUrlTexto,
        documento_nombre: (datos.documento && datos.documento.name) ? datos.documento.name : "",
        documento_preview: /\.(png|jpe?g|gif|webp|bmp|svg)/i.test(docUrlTexto) ? docUrlTexto : "",
        message:      cuerpoTexto,
        message_html: cuerpoHtml
    };

    // Feedback visual en el boton
    const btn = document.querySelector(`.btn-enviar-plancha[data-idx="${idx}"]`);
    const btnHtmlOriginal = btn ? btn.innerHTML : "";
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Enviando...';
    }

    try {
        await window.emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, params);
        showNotif("Correo enviado", `La orden de plancha se envio a ${datos.correo}.`);
    } catch (err) {
        console.error("Error enviando orden de plancha con EmailJS:", err);
        const detalle = (err && (err.text || err.message)) || "Revisa las credenciales de EmailJS.";
        showNotif("No se pudo enviar", detalle);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = btnHtmlOriginal || '<i class="bi bi-envelope-arrow-up"></i> Enviar orden de plancha por correo';
        }
    }
}

function agregarLinkItem(container, value) {
    const linkItem = document.createElement("div");
    linkItem.className = "diseno-link-item";
    linkItem.innerHTML = `
        <i class="bi bi-box-seam diseno-link-icon"></i>
        <input type="url" class="diseno-link-input" placeholder="https://www.pacdora.com/share/..." value="${value}">
        <button class="diseno-link-preview" title="Previsualizar 3D"><i class="bi bi-eye"></i></button>
        <button class="diseno-link-remove"><i class="bi bi-x"></i></button>
    `;
    container.appendChild(linkItem);

    linkItem.querySelector(".diseno-link-remove").addEventListener("click", () => {
        linkItem.remove();
    });

    linkItem.querySelector(".diseno-link-preview").addEventListener("click", () => {
        const url = linkItem.querySelector(".diseno-link-input").value.trim();
        if (url) abrirPacdoraModal(url);
    });
}

function abrirPacdoraModal(url) {
    const modal = document.getElementById("pacdoraModal");
    const iframe = document.getElementById("pacdoraIframe");
    const linkExternal = document.getElementById("pacdoraOpenExternal");
    iframe.src = url;
    linkExternal.href = url;
    modal.classList.add("show");
}

function setupPacdoraModal() {
    const modal = document.getElementById("pacdoraModal");
    const btnClose = document.getElementById("pacdoraModalClose");
    btnClose.addEventListener("click", () => {
        modal.classList.remove("show");
        document.getElementById("pacdoraIframe").src = "";
    });
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.remove("show");
            document.getElementById("pacdoraIframe").src = "";
        }
    });
}

async function subirImagenesDiseno(e, productoIdx) {
    const files = e.target.files;
    if (!files.length) return;

    const container = document.getElementById(`disenoImagenes-${productoIdx}`);

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const placeholder = document.createElement("div");
        placeholder.className = "diseno-img-item uploading";
        placeholder.innerHTML = `<div class="diseno-img-loading"><i class="bi bi-arrow-repeat spin"></i> Subiendo...</div>`;
        container.appendChild(placeholder);

        try {
            const formData = new FormData();
            formData.append("image", file);

            const res = await fetch("https://api.imgbb.com/1/upload?key=" + IMGBB_KEY, {
                method: "POST",
                body: formData
            });
            const data = await res.json();

            if (data.success) {
                const url = data.data.url;
                placeholder.classList.remove("uploading");
                placeholder.innerHTML = `
                    <img src="${url}" alt="Diseño" class="diseno-thumb" data-url="${url}">
                    <button class="diseno-img-remove" data-url="${url}" data-idx="${productoIdx}">
                        <i class="bi bi-x"></i>
                    </button>
                `;

                // Click para ver grande
                placeholder.querySelector(".diseno-thumb").addEventListener("click", () => {
                    document.getElementById("imgModalDashImg").src = url;
                    document.getElementById("imgModalDash").classList.add("show");
                });

                // Eliminar
                placeholder.querySelector(".diseno-img-remove").addEventListener("click", () => {
                    placeholder.remove();
                });
            } else {
                placeholder.innerHTML = `<div class="diseno-img-error"><i class="bi bi-exclamation-triangle"></i> Error</div>`;
                setTimeout(() => placeholder.remove(), 2000);
            }
        } catch (err) {
            console.error(err);
            placeholder.innerHTML = `<div class="diseno-img-error"><i class="bi bi-exclamation-triangle"></i> Error</div>`;
            setTimeout(() => placeholder.remove(), 2000);
        }
    }

    e.target.value = "";
}

async function guardarOrdenDiseno(orden) {
    const items = disenoEditando ? disenoEditando.items : (orden.items || []);
    const disenoItems = [];

    items.forEach((item, idx) => {
        const container = document.getElementById(`disenoImagenes-${idx}`);
        const imgs = container.querySelectorAll(".diseno-thumb");
        const imagenes = [];
        imgs.forEach(img => {
            imagenes.push({ url: img.dataset.url, estado: "pendiente" });
        });
        // Recoger links de Pacdora
        const linksContainer = document.getElementById(`disenoLinks-${idx}`);
        const linkInputs = linksContainer.querySelectorAll(".diseno-link-input");
        const pacdoraLinks = [];
        linkInputs.forEach(inp => {
            const val = inp.value.trim();
            if (val) pacdoraLinks.push(val);
        });
        disenoItems.push({
            producto: item.producto,
            cantidad: item.cantidad,
            terminados: item.terminados || (item.terminado ? [item.terminado] : []),
            colores: item.colores || (item.color ? [item.color] : []),
            materiales: item.materiales || [],
            planchas: item.planchas || [],
            terminado: item.terminado || "",
            color: item.color || "",
            tipo: item.tipo || "",
            precioUnit: item.precioUnit || 0,
            precioTotal: item.precioTotal || 0,
            imagenes: imagenes,
            pacdoraLinks: pacdoraLinks,
            ordenPlancha: recogerOrdenPlancha(idx)
        });
    });

    // Verificar que al menos un producto tenga imagen o link de Pacdora
    const tieneContenido = disenoItems.some(i => i.imagenes.length > 0 || i.pacdoraLinks.length > 0);
    if (!tieneContenido) {
        showNotif("Sin diseños", "Sube al menos una imagen o agrega un link de Pacdora para algun producto.");
        return;
    }

    const btnGuardar = document.getElementById("btnGuardarDiseno");
    btnGuardar.disabled = true;
    btnGuardar.innerHTML = '<span class="spinner-sm"></span> Guardando...';

    try {
        const disenoId = orden.id + "-diseno";
        const esEdicion = !!disenoEditando;

        const fechaLimite = document.getElementById("disenoFechaLimite")?.value || "";

        const dataToSave = {
            ordenId: orden.id,
            cotizacionId: orden.cotizacionId || orden.id,
            numero: orden.numero,
            cliente: orden.cliente,
            telefono: orden.telefono || "",
            tipo: orden.tipo,
            items: disenoItems,
            estado: "pendiente",
            fechaLimite: fechaLimite,
            creadoPor: sessionStorage.getItem("userName") || "",
            creadoPorEmail: sessionStorage.getItem("userEmail") || "",
            fechaCreacion: esEdicion ? (disenoEditando.fechaCreacion || new Date().toISOString()) : new Date().toISOString(),
            fechaActualizacion: new Date().toISOString()
        };

        await setDoc(doc(db, "ordenesDiseno", disenoId), dataToSave);

        // Actualizar cache local
        ordenesDisenoDB[disenoId] = { id: disenoId, ...dataToSave };

        // Generar link
        const baseUrl = window.location.origin + window.location.pathname.replace("dashboard.html", "");
        const link = baseUrl + "diseno.html?id=" + disenoId;

        const titulo = esEdicion ? "Orden de diseño actualizada" : "Orden de diseño creada";
        showLinkModal(
            titulo,
            "Comparte este link con el cliente para que apruebe los diseños:",
            link
        );

        // Volver a la lista y recargar
        document.getElementById("ordenDisenoView").style.display = "none";
        document.getElementById("ordenesListaView").style.display = "block";
        cargarOrdenes(rol);
    } catch (err) {
        console.error("Error guardando orden de diseño:", err);
        showNotif("Error", "No se pudo guardar la orden de diseño. Intenta de nuevo.");
    }

    btnGuardar.disabled = false;
    btnGuardar.innerHTML = disenoEditando
        ? '<i class="bi bi-check-lg"></i> Guardar cambios y copiar link'
        : '<i class="bi bi-check-lg"></i> Guardar y generar link';
}
// ===== SECCION DISEÑOS (ordenes de diseño con estado) =====
let disenosCache = [];
let disenosRolCache = "";

async function cargarDisenosAprobados(rolUsuario) {
    // Admin, ventas y ordenes usan esta seccion
    if (rolUsuario !== "administrador" && rolUsuario !== "ventas" && rolUsuario !== "ordenes") return;

    const containerDigital = document.getElementById("listaDisenosDigital");
    const containerImprenta = document.getElementById("listaDisenosImprenta");
    if (!containerDigital || !containerImprenta) return;

    try {
        const snap = await getDocs(collection(db, "ordenesDiseno"));
        let disenos = [];
        snap.forEach(d => disenos.push({ id: d.id, ...d.data() }));
        disenos.sort((a, b) => (b.fechaCreacion || "").localeCompare(a.fechaCreacion || ""));

        // Si no es administrador ni ordenes, filtrar solo las creadas por este usuario
        if (rolUsuario !== "administrador" && rolUsuario !== "ordenes") {
            const currentUser = sessionStorage.getItem("userName") || "";
            const currentEmail = sessionStorage.getItem("userEmail") || "";
            disenos = disenos.filter(d => {
                if (!d.creadoPor && !d.creadoPorEmail) return true;
                return d.creadoPor === currentUser || d.creadoPorEmail === currentEmail;
            });
        }

        disenosCache = disenos;
        disenosRolCache = rolUsuario;
        renderDisenosFiltrados();
    } catch (err) {
        console.error("Error cargando diseños:", err);
        containerDigital.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>Error al cargar</p></div>';
        containerImprenta.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>Error al cargar</p></div>';
    }
}

function renderDisenosFiltrados() {
    const containerDigital = document.getElementById("listaDisenosDigital");
    const containerImprenta = document.getElementById("listaDisenosImprenta");
    if (!containerDigital || !containerImprenta) return;

    let disenos = [...disenosCache];
    const busqueda = (document.getElementById("disenosBuscar")?.value || "").trim().toLowerCase();
    const filtroEstado = document.getElementById("disenosFiltroEstado")?.value || "";

    // Filtrar por búsqueda
    if (busqueda) {
        disenos = disenos.filter(d =>
            (d.cliente || "").toLowerCase().includes(busqueda) ||
            (d.numero || "").toLowerCase().includes(busqueda) ||
            (d.tipo || "").toLowerCase().includes(busqueda)
        );
    }

    // Filtrar por estado
    if (filtroEstado) {
        disenos = disenos.filter(d => d.estado === filtroEstado);
    }

    const digitales = disenos.filter(d => d.tipo === "digital");
    const imprenta = disenos.filter(d => d.tipo === "imprenta");

    renderDisenosEnContainer(digitales, containerDigital);
    renderDisenosEnContainer(imprenta, containerImprenta);
}

function renderDisenosEnContainer(filtrados, container) {
    if (filtrados.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-brush"></i><p>No hay ordenes de diseño aun</p></div>';
        return;
    }

    let html = '<div class="disenos-lista">';

    filtrados.forEach(diseno => {
        const fecha = new Date(diseno.fechaCreacion || "");
        const fechaStr = isNaN(fecha) ? "-" : fecha.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

        let estadoBadge = "";
        if (diseno.estado === "respondida") {
            let aprobadas = 0, rechazadas = 0;
            (diseno.items || []).forEach(item => {
                (item.imagenes || []).forEach(img => {
                    if (img.estado === "aprobada") aprobadas++;
                    if (img.estado === "rechazada") rechazadas++;
                });
            });
            estadoBadge = `<span class="diseno-estado-badge respondida"><i class="bi bi-check-circle"></i> Respondida (${aprobadas} aprobadas, ${rechazadas} rechazadas)</span>`;
        } else {
            estadoBadge = `<span class="diseno-estado-badge pendiente"><i class="bi bi-clock"></i> Pendiente</span>`;
        }

        html += `
            <div class="diseno-lista-item" data-id="${diseno.id}">
                <div class="diseno-lista-info">
                    <div class="diseno-lista-top">
                        <strong>${diseno.numero}</strong>
                        ${estadoBadge}
                    </div>
                    <span class="diseno-lista-sub">${diseno.cliente} &bull; ${fechaStr}</span>
                </div>
                <button class="btn-ver-diseno" data-id="${diseno.id}">
                    <i class="bi bi-eye"></i> Ver diseños
                </button>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;

    // Eventos
    container.querySelectorAll(".btn-ver-diseno").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            const diseno = filtrados.find(d => d.id === id);
            if (diseno) abrirModalVerDisenos(diseno);
        });
    });
}

function abrirModalVerDisenos(diseno) {
    const overlay = document.getElementById("ordenDetalleOverlay");
    document.getElementById("ordenDetalleNumero").textContent = diseno.numero + " - Diseños";
    document.getElementById("ordenDetalleCliente").textContent = diseno.cliente;
    pintarAsesorOrden(diseno.creadoPor);

    // Ocultar el boton PDF de orden en la vista de diseños (no aplica aqui)
    const btnPDFOrden = document.getElementById("ordenDetallePDF");
    if (btnPDFOrden) btnPDFOrden.style.display = "none";

    let html = "";
    (diseno.items || []).forEach((item, idx) => {
        html += `<tr><td colspan="4" style="padding:12px 0 6px;font-weight:700;border-bottom:none;"><i class="bi bi-box"></i> ${item.cantidad}x ${item.producto}</td></tr>`;

        (item.imagenes || []).forEach((img, imgIdx) => {
            let estadoHtml = "";
            if (img.estado === "aprobada") {
                estadoHtml = `<span class="diseno-img-estado aprobada"><i class="bi bi-check-circle-fill"></i> Aprobada</span>`;
            } else if (img.estado === "rechazada") {
                estadoHtml = `<span class="diseno-img-estado rechazada"><i class="bi bi-x-circle-fill"></i> Rechazada</span>`;
            } else {
                estadoHtml = `<span class="diseno-img-estado pendiente"><i class="bi bi-clock"></i> Pendiente</span>`;
            }

            html += `
                <tr>
                    <td style="width:60px;">
                        <img src="${img.url}" class="diseno-mini-thumb" data-url="${img.url}" style="width:50px;height:50px;object-fit:cover;border-radius:6px;cursor:pointer;">
                    </td>
                    <td>Diseño ${imgIdx + 1}</td>
                    <td>${estadoHtml}</td>
                    <td></td>
                </tr>
            `;
        });

        // Pacdora links
        (item.pacdoraLinks || []).forEach((link, lIdx) => {
            html += `
                <tr>
                    <td style="width:60px;text-align:center;">
                        <span class="diseno-pacdora-icon"><i class="bi bi-box-seam"></i></span>
                    </td>
                    <td colspan="2">
                        <button class="btn-pacdora-modal-preview" data-url="${link}">
                            <i class="bi bi-eye"></i> Ver Mockup 3D ${(item.pacdoraLinks.length > 1) ? "#" + (lIdx + 1) : ""}
                        </button>
                    </td>
                    <td>
                        <a href="${link}" target="_blank" rel="noopener noreferrer" class="btn-pacdora-external-sm">
                            <i class="bi bi-box-arrow-up-right"></i>
                        </a>
                    </td>
                </tr>
            `;
        });
    });

    document.getElementById("ordenDetalleItems").innerHTML = html || `<tr><td colspan="4">Sin diseños</td></tr>`;

    // Mostrar botones de copiar link y rediseñar
    const btnCopyLink = document.getElementById("ordenDetalleCopyLink");
    const btnRedisenar = document.getElementById("ordenDetalleRedisenar");
    btnCopyLink.style.display = "inline-flex";
    btnRedisenar.style.display = "inline-flex";

    // Copiar link
    const baseUrl = window.location.origin + window.location.pathname.replace("dashboard.html", "");
    const link = baseUrl + "diseno.html?id=" + diseno.id;

    btnCopyLink.onclick = () => {
        copyToClipboard(link).then(() => {
            btnCopyLink.innerHTML = '<i class="bi bi-check-lg"></i> Copiado';
            setTimeout(() => {
                btnCopyLink.innerHTML = '<i class="bi bi-link-45deg"></i> Copiar link';
            }, 2000);
        });
    };

    // Rediseñar: abre la vista de edición de diseño
    btnRedisenar.onclick = () => {
        overlay.classList.remove("show");
        // Activar la seccion de ordenes para que la vista de diseño sea visible
        activateSection("ordenes");
        // Buscar la orden original en produccion
        const ordenId = diseno.ordenId || diseno.id.replace("-diseno", "");
        // Abrir vista de diseño con los datos existentes para editar
        const ordenFake = {
            id: ordenId,
            numero: diseno.numero,
            cliente: diseno.cliente,
            telefono: diseno.telefono || "",
            tipo: diseno.tipo,
            items: diseno.items || []
        };
        abrirVistaDisenoOrden(ordenFake, diseno);
    };

    // Click en miniaturas
    setTimeout(() => {
        overlay.querySelectorAll(".diseno-mini-thumb").forEach(thumb => {
            thumb.addEventListener("click", () => {
                document.getElementById("imgModalDashImg").src = thumb.dataset.url;
                document.getElementById("imgModalDash").classList.add("show");
            });
        });
        // Click en botones Pacdora 3D
        overlay.querySelectorAll(".btn-pacdora-modal-preview").forEach(btn => {
            btn.addEventListener("click", () => {
                const url = btn.dataset.url;
                if (url) abrirPacdoraModal(url);
            });
        });
    }, 50);

    overlay.classList.add("show");
}

// ===== MODAL DETALLE ORDEN (para todos los roles) =====
function setupOrdenDetalleModal() {
    const ordenOverlay = document.getElementById("ordenDetalleOverlay");
    document.getElementById("ordenDetalleClose").addEventListener("click", () => ordenOverlay.classList.remove("show"));
    document.getElementById("ordenDetalleCancel").addEventListener("click", () => ordenOverlay.classList.remove("show"));
    ordenOverlay.addEventListener("click", (e) => { if (e.target === ordenOverlay) ordenOverlay.classList.remove("show"); });
}

// ===== MODAL DETALLE COTIZACION APROBADA =====
function setupModalDetalle() {
    const overlay = document.getElementById("cotDetalleOverlay");
    const btnClose = document.getElementById("cotDetalleClose");
    const imgModal = document.getElementById("imgModalDash");
    const imgModalClose = document.getElementById("imgModalDashClose");

    btnClose.addEventListener("click", () => overlay.classList.remove("show"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("show"); });

    imgModalClose.addEventListener("click", () => imgModal.classList.remove("show"));
    imgModal.addEventListener("click", (e) => { if (e.target === imgModal) imgModal.classList.remove("show"); });

    // Modal detalle orden
    const ordenOverlay = document.getElementById("ordenDetalleOverlay");
    document.getElementById("ordenDetalleClose").addEventListener("click", () => ordenOverlay.classList.remove("show"));
    document.getElementById("ordenDetalleCancel").addEventListener("click", () => ordenOverlay.classList.remove("show"));
    ordenOverlay.addEventListener("click", (e) => { if (e.target === ordenOverlay) ordenOverlay.classList.remove("show"); });
}

async function abrirDetalleAprobada(id) {
    const docSnap = await getDoc(doc(db, "cotizaciones", id));
    if (!docSnap.exists()) return;
    const cot = { id: docSnap.id, ...docSnap.data() };

    // Llenar datos
    document.getElementById("cotDetalleNumero").textContent  = cot.numero;
    document.getElementById("cotDetalleEstado").textContent  = cot.estado;
    document.getElementById("cotDetalleEstado").className    = "cot-estado " + cot.estado;
    document.getElementById("cotDetalleCliente").textContent = cot.cliente;
    document.getElementById("cotDetalleNit").textContent     = cot.nit || "-";
    document.getElementById("cotDetalleTelefono").textContent = cot.telefono || "-";
    document.getElementById("cotDetalleTipo").textContent    = cot.tipo === "ambas" ? "Imprenta y Digital" : (cot.tipo || "-");
    document.getElementById("cotDetalleTotal").textContent   = "$" + formatMoneyLocal(cot.total);

    const pagoLabel = cot.tipoPago === "abono"
        ? "Abono $" + formatMoneyLocal(cot.montoPagado || 0)
        : "Pago completo";
    document.getElementById("cotDetallePago").textContent = pagoLabel + (cot.metodoPago ? " · " + cot.metodoPago : "");

    // Acciones
    const acciones = document.getElementById("cotDetalleAcciones");
    acciones.innerHTML = "";

    // Ver comprobante
    if (cot.comprobante) {
        const btnComp = document.createElement("button");
        btnComp.className = "btn-accion btn-accion-comprobante";
        btnComp.innerHTML = `
            <i class="bi bi-receipt"></i>
            <div class="accion-desc">
                <span class="accion-title">Ver comprobante</span>
                <span class="accion-sub">Ver imagen del pago realizado</span>
            </div>
        `;
        btnComp.addEventListener("click", () => {
            document.getElementById("imgModalDashImg").src = cot.comprobante;
            document.getElementById("imgModalDash").classList.add("show");
        });
        acciones.appendChild(btnComp);
    }

    // Determinar a qué producción enviar
    const tiposProduccion = [];
    if (cot.tipo === "digital" || cot.tipo === "ambas") tiposProduccion.push("digital");
    if (cot.tipo === "imprenta" || cot.tipo === "ambas") tiposProduccion.push("imprenta");
    if (cot.tipo === "ambas") {
        // Revisar items
        const tiposItems = [...new Set((cot.items || []).map(i => i.tipo).filter(Boolean))];
        tiposProduccion.length = 0;
        tiposItems.forEach(t => tiposProduccion.push(t));
    }

    // Botones de produccion
    tiposProduccion.forEach(tipoProd => {
        const itemsProd = (cot.items || []).filter(i => {
            if (cot.tipo !== "ambas") return true;
            return i.tipo === tipoProd;
        });

        const icono = tipoProd === "digital" ? "bi-display" : "bi-printer";
        const clase  = tipoProd === "digital" ? "btn-accion-digital" : "btn-accion-imprenta";
        const label  = tipoProd === "digital" ? "Digital" : "Imprenta";
        const itemsResumen = itemsProd.map(i => i.cantidad + "x " + i.producto).join(", ");

        const btnProd = document.createElement("button");
        btnProd.className = "btn-accion " + clase;
        btnProd.innerHTML = `
            <i class="bi ${icono}"></i>
            <div class="accion-desc">
                <span class="accion-title">Enviar a produccion ${label}</span>
                <span class="accion-sub">${cot.numero} · ${itemsResumen}</span>
            </div>
        `;
        btnProd.addEventListener("click", () => {
            enviarAProduccion(cot, tipoProd, itemsProd);
        });
        acciones.appendChild(btnProd);
    });

    // Productos adicionales para nueva cotización
    const refContainer = document.getElementById("cotDetalleReferencias");
    if (refContainer) {
        const productos = cot.productosAdicionalesCotizar || cot.imagenesReferencia || [];
        if (productos.length > 0) {
            refContainer.style.display = "block";
            const grid = refContainer.querySelector(".detalle-ref-grid");
            grid.innerHTML = "";
            productos.forEach(src => {
                const img = document.createElement("img");
                img.src = src;
                img.className = "detalle-ref-img";
                img.alt = "Producto adicional";
                img.addEventListener("click", () => {
                    document.getElementById("imgModalDashImg").src = src;
                    document.getElementById("imgModalDash").classList.add("show");
                });
                grid.appendChild(img);
            });
        } else {
            refContainer.style.display = "none";
        }
    }

    // Comentario del cliente
    const comentarioEl = document.getElementById("cotDetalleComentario");
    if (comentarioEl) {
        if (cot.comentarioCliente && cot.comentarioCliente.trim()) {
            comentarioEl.style.display = "block";
            comentarioEl.querySelector(".detalle-comentario-text").textContent = cot.comentarioCliente;
        } else {
            comentarioEl.style.display = "none";
        }
    }

    // Notas internas del vendedor
    const notasEl = document.getElementById("cotDetalleNotas");
    if (notasEl) {
        if (cot.notas && cot.notas.trim()) {
            notasEl.style.display = "block";
            notasEl.querySelector(".detalle-notas-text").textContent = cot.notas;
        } else {
            notasEl.style.display = "none";
        }
    }

    // Registrar pago / comprobante (para cotizaciones a credito sin comprobante)
    configurarRegistroPago(cot);

    document.getElementById("cotDetalleOverlay").classList.add("show");
}

// Permite registrar el pago (metodo, monto y comprobante) de una cotizacion,
// util sobre todo para las cotizaciones a credito que se aprueban sin pago.
function configurarRegistroPago(cot) {
    const seccion = document.getElementById("cotDetalleRegistroPago");
    if (!seccion) return;

    const esCredito = (cot.modalidadPago || "contado") === "credito";
    // Mostrar solo cuando aun no hay comprobante registrado (credito o contado pendiente)
    if (cot.comprobante || !esCredito) {
        seccion.style.display = "none";
        return;
    }

    seccion.style.display = "block";

    const selMetodo = document.getElementById("cotRegistroMetodo");
    const inpMonto = document.getElementById("cotRegistroMonto");
    const btnUpload = document.getElementById("btnRegistroComprobante");
    const inputFile = document.getElementById("inputRegistroComprobante");
    const preview = document.getElementById("registroComprobantePreview");
    const btnGuardar = document.getElementById("btnGuardarPagoCredito");

    // Reset de estado
    selMetodo.value = "";
    inpMonto.value = cot.total ? formatMoneyLocal(cot.total) : "";
    preview.innerHTML = "";
    btnGuardar.disabled = true;
    let comprobanteUrl = "";

    // Formatear monto con separadores mientras se escribe
    inpMonto.oninput = () => {
        const num = parseInt((inpMonto.value || "").replace(/\D/g, "")) || 0;
        inpMonto.value = num ? formatMoneyLocal(num) : "";
        actualizarBtnGuardar();
    };
    selMetodo.onchange = actualizarBtnGuardar;

    function actualizarBtnGuardar() {
        const metodo = selMetodo.value;
        const monto = parseInt((inpMonto.value || "").replace(/\D/g, "")) || 0;
        btnGuardar.disabled = !(metodo && monto > 0 && comprobanteUrl);
    }

    btnUpload.onclick = () => inputFile.click();
    inputFile.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const metodo = selMetodo.value;
        if (!metodo) {
            showNotif("Falta el metodo", "Selecciona el metodo de pago antes de subir el comprobante");
            inputFile.value = "";
            return;
        }
        preview.innerHTML = '<span class="registro-status"><i class="bi bi-arrow-repeat"></i> Subiendo...</span>';
        btnUpload.disabled = true;
        try {
            const formData = new FormData();
            formData.append("image", file);
            const res = await fetch("https://api.imgbb.com/1/upload?key=" + IMGBB_KEY, {
                method: "POST",
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                comprobanteUrl = data.data.url;
                preview.innerHTML = `<img src="${comprobanteUrl}" class="registro-comp-img" alt="Comprobante"><span class="registro-comp-nombre">${file.name}</span>`;
            } else {
                preview.innerHTML = '<span class="registro-status registro-error">No se pudo subir. Intenta de nuevo.</span>';
            }
        } catch (err) {
            console.error(err);
            preview.innerHTML = '<span class="registro-status registro-error">Error al subir el comprobante.</span>';
        }
        btnUpload.disabled = false;
        inputFile.value = "";
        actualizarBtnGuardar();
    };

    btnGuardar.onclick = async () => {
        const metodo = selMetodo.value;
        const monto = parseInt((inpMonto.value || "").replace(/\D/g, "")) || 0;
        if (!metodo || monto <= 0 || !comprobanteUrl) return;

        btnGuardar.disabled = true;
        btnGuardar.innerHTML = '<i class="bi bi-arrow-repeat"></i> Guardando...';
        try {
            const ref = doc(db, "cotizaciones", cot.id);
            const snap = await getDoc(ref);
            const data = snap.data();
            const total = parseInt(data.total) || 0;
            const abono = {
                monto: monto,
                metodo: metodo,
                comprobante: comprobanteUrl,
                fecha: new Date().toISOString()
            };
            const abonosPrev = Array.isArray(data.abonos) ? data.abonos : [];
            await setDoc(ref, {
                ...data,
                metodoPago: metodo,
                tipoPago: monto >= total ? "completo" : "abono",
                montoPagado: monto,
                comprobante: comprobanteUrl,
                abonos: [...abonosPrev, abono]
            });
            showNotif("Pago registrado", "El comprobante quedo guardado en la cotizacion " + data.numero);
            document.getElementById("cotDetalleOverlay").classList.remove("show");
            // Refrescar la lista para reflejar el cambio
            cargarListaCotizaciones();
        } catch (err) {
            console.error(err);
            showNotif("Error", "No se pudo registrar el pago. Intenta de nuevo.");
            btnGuardar.disabled = false;
        }
        btnGuardar.innerHTML = '<i class="bi bi-check-circle"></i> Guardar pago';
    };
}

// Devuelve los items de una cotizacion que corresponden a un tipo de produccion.
// Si la cotizacion no es "ambas", todos los items van a esa produccion.
function itemsParaProduccion(cot, tipoProd) {
    return (cot.items || []).filter(i => {
        if (cot.tipo !== "ambas") return true;
        return (i.tipo || "imprenta") === tipoProd;
    });
}

// Combina los items nuevos de la cotizacion con los items previos de la orden de
// diseño, preservando las imagenes y links de Pacdora de los productos que ya
// existian. Los productos nuevos entran sin imagenes; los eliminados desaparecen.
function mergeDisenoItems(nuevosItems, itemsPrevios) {
    const previos = [...(itemsPrevios || [])];
    return nuevosItems.map(item => {
        // Buscar un item previo con el mismo producto que aun no haya sido usado
        const idx = previos.findIndex(p => (p.producto || "") === (item.producto || ""));
        let prev = null;
        if (idx !== -1) {
            prev = previos[idx];
            previos.splice(idx, 1); // consumir para no reutilizar en duplicados
        }
        return {
            producto: item.producto,
            cantidad: item.cantidad,
            terminados: item.terminados || (item.terminado ? [item.terminado] : []),
            colores: item.colores || (item.color ? [item.color] : []),
            materiales: item.materiales || [],
            planchas: item.planchas || [],
            terminado: item.terminado || "",
            color: item.color || "",
            tipo: item.tipo || "",
            precioUnit: item.precioUnit || 0,
            precioTotal: item.precioTotal || 0,
            imagenes: prev ? (prev.imagenes || []) : [],
            pacdoraLinks: prev ? (prev.pacdoraLinks || []) : []
        };
    });
}

// Propaga en cascada los cambios de una cotizacion editada hacia las ordenes de
// produccion y las ordenes de diseño ya existentes. Solo actualiza lo que ya existe.
async function actualizarCascadaCotizacion(cotId, cot) {
    const tipos = ["digital", "imprenta"];
    for (const tipoProd of tipos) {
        const prodId = `${cotId}-${tipoProd}`;
        const prodRef = doc(db, "produccion", prodId);
        const prodSnap = await getDoc(prodRef);
        if (!prodSnap.exists()) continue;

        const prodData = prodSnap.data();
        const itemsProd = itemsParaProduccion(cot, tipoProd);
        const totalProd = itemsProd.reduce((s, i) => s + (i.precioTotal || 0), 0);

        // Actualizar la orden de produccion preservando seguimiento, paso y fechas
        await setDoc(prodRef, {
            ...prodData,
            cliente:   cot.cliente,
            negocio:   cot.negocio || "",
            nit:       cot.nit || "",
            telefono:  cot.telefono || "",
            direccion: cot.direccion || "",
            ciudad:    cot.ciudad || "",
            items:     itemsProd,
            total:     totalProd,
            fechaEntrega: cot.fechaEntrega || prodData.fechaEntrega || ""
        });

        // Actualizar la orden de diseño si existe, preservando imagenes/links
        const disenoId = `${prodId}-diseno`;
        const disenoRef = doc(db, "ordenesDiseno", disenoId);
        const disenoSnap = await getDoc(disenoRef);
        if (disenoSnap.exists()) {
            const disenoData = disenoSnap.data();
            const mergedItems = mergeDisenoItems(itemsProd, disenoData.items);
            await setDoc(disenoRef, {
                ...disenoData,
                cliente:  cot.cliente,
                telefono: cot.telefono || "",
                items:    mergedItems,
                fechaActualizacion: new Date().toISOString()
            });
        }
    }
}

async function enviarAProduccion(cot, tipoProd, items) {
    // Guardar en coleccion "produccion" con el ID de la cotizacion
    const prodId = cot.id + "-" + tipoProd;
    // Fecha limite para crear la orden de diseño: hoy + DIAS_LIMITE_DISENO (yyyy-mm-dd)
    const limite = new Date();
    limite.setDate(limite.getDate() + DIAS_LIMITE_DISENO);
    const fechaLimiteDiseno = `${limite.getFullYear()}-${String(limite.getMonth() + 1).padStart(2, "0")}-${String(limite.getDate()).padStart(2, "0")}`;
    await setDoc(doc(db, "produccion", prodId), {
        cotizacionId: cot.id,
        numero:       cot.numero,
        cliente:      cot.cliente,
        negocio:      cot.negocio || "",
        nit:          cot.nit || "",
        telefono:     cot.telefono || "",
        direccion:    cot.direccion || "",
        ciudad:       cot.ciudad || "",
        tipo:         tipoProd,
        items:        items,
        total:        items.reduce((s, i) => s + (i.precioTotal || 0), 0),
        metodoPago:   cot.metodoPago || "",
        tipoPago:     cot.tipoPago || "completo",
        montoPagado:  cot.montoPagado || cot.total,
        comprobante:  cot.comprobante || "",
        estado:       "en_produccion",
        pasoActual:   "recibido",
        seguimiento:  { recibido: new Date().toISOString() },
        fechaEnvio:   new Date().toISOString(),
        fechaLimiteDiseno: fechaLimiteDiseno,
        fechaEntrega: cot.fechaEntrega || "",
        creadoPor:    cot.creadoPor || sessionStorage.getItem("userName") || "",
        creadoPorEmail: cot.creadoPorEmail || sessionStorage.getItem("userEmail") || ""
    });

    // Actualizar estado de la cotizacion
    const ref = doc(db, "cotizaciones", cot.id);
    const snap = await getDoc(ref);
    const data = snap.data();
    await setDoc(ref, { ...data, estadoProduccion: (data.estadoProduccion || "") + tipoProd + " " });

    document.getElementById("cotDetalleOverlay").classList.remove("show");
    showConfirm(
        "Enviado a produccion",
        `La orden ${cot.numero} fue enviada a ${tipoProd}. El usuario de ${tipoProd} la vera en su seccion de Ordenes.`,
        () => {}
    );
    document.getElementById("confirmYes").textContent = "Entendido";
    document.getElementById("confirmNo").style.display = "none";

    // Recargar ordenes
    cargarOrdenes(rol);
}

// ===== SEGUIMIENTO DE ORDENES =====
const PASOS_IMPRENTA_SEG = [
    { key: "recibido",    icon: "bi-inbox",         title: "Recibido" },
    { key: "diseno",      icon: "bi-brush",         title: "Diseño" },
    { key: "guillotina",  icon: "bi-scissors",      title: "Guillotina" },
    { key: "impresion",   icon: "bi-printer",       title: "Impresión" },
    { key: "troquelado",  icon: "bi-hexagon",       title: "Troquelado" },
    { key: "vasos",       icon: "bi-cup-straw",     title: "Vasos" },
    { key: "empaques",    icon: "bi-box-seam",      title: "Empaques" },
    { key: "terminado",   icon: "bi-bag-check",     title: "Terminado" }
];

const PASOS_DIGITAL_SEG = [
    { key: "recibido",    icon: "bi-inbox",         title: "Recibido" },
    { key: "diseno",      icon: "bi-brush",         title: "Diseño" },
    { key: "revision",    icon: "bi-eye",           title: "Revisión" },
    { key: "ajustes",     icon: "bi-pencil-square", title: "Ajustes" },
    { key: "entrega",     icon: "bi-send",          title: "Entrega" },
    { key: "terminado",   icon: "bi-bag-check",     title: "Terminado" }
];

function getPasosOrden(orden) {
    return orden.tipo === "digital" ? PASOS_DIGITAL_SEG : PASOS_IMPRENTA_SEG;
}

// Devuelve las etapas visibles del timeline segun el rol del usuario.
function getPasosVisibles(orden, rolUsuario) {
    const todos = getPasosOrden(orden);
    const permitidos = PASOS_VISIBLES_POR_ROL[rolUsuario];
    if (!permitidos) return todos;
    return todos.filter(p => permitidos.includes(p.key));
}

// Construye el HTML de los puntos del timeline. Solo dibuja las etapas
// "visibles" para el rol, pero calcula completado/activo usando la posicion
// real dentro de la secuencia completa de la orden.
function buildTimelineDots(pasosCompletos, pasosVisibles, pasoActual) {
    const idxActual = pasosCompletos.findIndex(p => p.key === pasoActual);
    let html = "";
    pasosVisibles.forEach((paso, i) => {
        const idxReal = pasosCompletos.findIndex(p => p.key === paso.key);
        const estado = idxReal < idxActual ? "completado" : idxReal === idxActual ? "activo" : "";
        html += `<div class="seg-step-dot ${estado}" title="${paso.title}"><i class="bi ${estado === "completado" ? "bi-check-lg" : paso.icon}"></i></div>`;
        if (i < pasosVisibles.length - 1) {
            html += `<div class="seg-step-line ${idxReal < idxActual ? "completado" : ""}"></div>`;
        }
    });
    return html;
}

// Devuelve el seguimiento de un producto (item) dentro de la orden.
// Si no existe aun, hereda el paso global de la orden (compatibilidad hacia atras).
function getItemSeguimiento(orden, idx) {
    const its = orden.itemsSeguimiento || {};
    const entry = its[idx];
    if (entry && entry.pasoActual) {
        return { pasoActual: entry.pasoActual, seguimiento: entry.seguimiento || {}, cantidades: entry.cantidades || {}, carton: entry.carton || null };
    }
    return { pasoActual: orden.pasoActual || "recibido", seguimiento: {}, cantidades: {}, carton: null };
}

// Devuelve el mapa de cantidades registradas por paso para un producto (o la orden global).
function getItemCantidades(orden, idx) {
    if (idx === undefined || idx === null || idx < 0) {
        return orden.cantidadesSeguimiento || {};
    }
    const its = orden.itemsSeguimiento || {};
    const entry = its[idx];
    return (entry && entry.cantidades) ? entry.cantidades : {};
}

// Calcula el paso global de la orden = el producto MENOS avanzado.
// (La orden completa solo llega a una etapa cuando todos sus productos la alcanzan.)
function getOrdenPasoGlobal(orden) {
    const PASOS = getPasosOrden(orden);
    const items = orden.items || [];
    if (items.length === 0) return orden.pasoActual || "recibido";
    let minIdx = PASOS.length - 1;
    items.forEach((_, idx) => {
        const seg = getItemSeguimiento(orden, idx);
        const i = PASOS.findIndex(p => p.key === seg.pasoActual);
        if (i >= 0 && i < minIdx) minIdx = i;
    });
    return PASOS[Math.max(0, minIdx)].key;
}

// Genera los botones de accion para un producto segun el rol y su paso actual.
function getAccionesItem(rolUsuario, pasoActual, PASOS, ordenId, idx) {
    const idxActual = PASOS.findIndex(p => p.key === pasoActual);
    let html = "";

    const btnAvanzar = (paso, title) => {
        const cls = paso === "terminado" ? "seg-btn-avanzar terminado" : "seg-btn-avanzar";
        const label = paso === "terminado" ? "Marcar Terminado" : title;
        return `<button class="${cls}" data-id="${ordenId}" data-idx="${idx}" data-paso="${paso}"><i class="bi bi-arrow-right"></i> ${label}</button>`;
    };
    const btnRetro = (paso, title) =>
        `<button class="seg-btn-retroceder" data-id="${ordenId}" data-idx="${idx}" data-paso="${paso}"><i class="bi bi-arrow-left"></i> ${title}</button>`;

    const siguiente = idxActual < PASOS.length - 1 ? PASOS[idxActual + 1] : null;
    const anterior  = idxActual > 0 ? PASOS[idxActual - 1] : null;

    if (rolUsuario === "administrador") {
        if (siguiente) html += btnAvanzar(siguiente.key, "Enviar a " + siguiente.title);
        if (anterior)  html += btnRetro(anterior.key, anterior.title);
    } else if (rolUsuario === "ordenes") {
        if (siguiente) html += btnAvanzar(siguiente.key, "Enviar a " + siguiente.title);
    } else if (rolUsuario === "ventas") {
        if (pasoActual === "recibido" && siguiente) html += btnAvanzar(siguiente.key, "Enviar a " + siguiente.title);
    } else if (rolUsuario === "diseno" || rolUsuario === "digital" || rolUsuario === "imprenta") {
        if (pasoActual === "diseno" && siguiente) html += btnAvanzar(siguiente.key, "Enviar a " + siguiente.title);
    } else if (rolUsuario === "guillotina") {
        if (pasoActual === "guillotina" && siguiente) html += btnAvanzar(siguiente.key, "Enviar a " + siguiente.title);
    } else if (rolUsuario === "impresion") {
        if (pasoActual === "impresion" && siguiente) html += btnAvanzar(siguiente.key, "Enviar a " + siguiente.title);
    } else if (rolUsuario === "troquelado") {
        if (pasoActual === "troquelado" && siguiente) html += btnAvanzar(siguiente.key, "Enviar a " + siguiente.title);
    } else if (rolUsuario === "vasos") {
        if (pasoActual === "vasos" && siguiente) html += btnAvanzar(siguiente.key, "Enviar a " + siguiente.title);
    } else if (rolUsuario === "empaques") {
        if (pasoActual === "empaques" && siguiente) html += btnAvanzar(siguiente.key, "Enviar a " + siguiente.title);
    }
    return html;
}

let seguimientoFiltro = "todos";
let seguimientoCache = [];

function setupSeguimiento() {
    // Ocultar botones de filtro de etapas que el rol no puede ver
    const permitidosRol = PASOS_VISIBLES_POR_ROL[rol];
    if (permitidosRol) {
        document.querySelectorAll(".seg-filtro-btn").forEach(btn => {
            const f = btn.dataset.filtro;
            if (f !== "todos" && !permitidosRol.includes(f)) {
                btn.style.display = "none";
            }
        });
    }

    const filtros = document.querySelectorAll(".seg-filtro-btn");
    filtros.forEach(btn => {
        btn.addEventListener("click", () => {
            filtros.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            seguimientoFiltro = btn.dataset.filtro;
            renderSeguimiento();
        });
    });
    // Buscador
    const inputBuscar = document.getElementById("seguimientoBuscar");
    if (inputBuscar) inputBuscar.addEventListener("input", () => renderSeguimiento());
}

async function cargarSeguimiento() {
    const container = document.getElementById("seguimientoLista");
    if (!container) return;

    try {
        const snap = await getDocs(collection(db, "produccion"));
        let ordenes = [];
        snap.forEach(d => ordenes.push({ id: d.id, ...d.data() }));
        // Excluir ordenes en papelera
        ordenes = ordenes.filter(o => !o.eliminado);
        ordenes.sort((a, b) => (b.fechaEnvio || "").localeCompare(a.fechaEnvio || ""));

        // Para ordenes sin negocio, buscarlo de la cotización
        const cotSnap = await getDocs(collection(db, "cotizaciones"));
        const cotizaciones = {};
        cotSnap.forEach(d => { cotizaciones[d.id] = d.data(); });

        ordenes.forEach(o => {
            if (!o.negocio && o.cotizacionId && cotizaciones[o.cotizacionId]) {
                o.negocio = cotizaciones[o.cotizacionId].negocio || "";
            }
        });

        // Asignar paso por defecto a órdenes sin seguimiento
        ordenes.forEach(o => {
            if (!o.pasoActual) o.pasoActual = "recibido";
        });

        seguimientoCache = ordenes;
        renderSeguimiento();
    } catch (err) {
        console.error("Error cargando seguimiento:", err);
    }
}

function renderSeguimiento() {
    const container = document.getElementById("seguimientoLista");
    if (!container) return;

    let ordenes = [...seguimientoCache];
    const busqueda = (document.getElementById("seguimientoBuscar")?.value || "").trim().toLowerCase();

    // Filtrar por búsqueda
    if (busqueda) {
        ordenes = ordenes.filter(o =>
            (o.cliente || "").toLowerCase().includes(busqueda) ||
            (o.numero || "").toLowerCase().includes(busqueda) ||
            (o.negocio || "").toLowerCase().includes(busqueda) ||
            (o.tipo || "").toLowerCase().includes(busqueda)
        );
    }

    // Filtrar por estado (coincide si CUALQUIER producto de la orden esta en ese paso)
    if (seguimientoFiltro !== "todos") {
        ordenes = ordenes.filter(o => {
            const items = o.items || [];
            if (items.length === 0) return (o.pasoActual || "recibido") === seguimientoFiltro;
            return items.some((_, idx) => getItemSeguimiento(o, idx).pasoActual === seguimientoFiltro);
        });
    }

    if (ordenes.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-truck"></i><p>No hay ordenes en este estado</p></div>';
        return;
    }

    container.innerHTML = "";
    ordenes.forEach(orden => {
            const card = document.createElement("div");
            card.className = "seg-orden-card";

            const PASOS_SEGUIMIENTO = getPasosOrden(orden);
            const PASOS_VISIBLES = getPasosVisibles(orden, rol);
            const items = orden.items || [];

            // Paso global = producto menos avanzado
            const pasoGlobal = getOrdenPasoGlobal(orden);

            const estadoLabels = { recibido: "Recibido", diseno: "En diseño", guillotina: "Guillotina", impresion: "Impresión", troquelado: "Troquelado", vasos: "Vasos", empaques: "Empaques", terminado: "Terminado", revision: "Revisión", ajustes: "Ajustes", entrega: "Entrega" };
            const estadoIcons = { recibido: "bi-inbox", diseno: "bi-brush", guillotina: "bi-scissors", impresion: "bi-printer", troquelado: "bi-hexagon", vasos: "bi-cup-straw", empaques: "bi-box-seam", terminado: "bi-bag-check", revision: "bi-eye", ajustes: "bi-pencil-square", entrega: "bi-send" };

            const fechaEnvio = orden.fechaEnvio ? new Date(orden.fechaEnvio).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "-";
            const nombreSeg = orden.negocio || orden.cliente;

            // ¿Todos los productos terminados?
            const todosTerminados = items.length > 0 && items.every((_, idx) => getItemSeguimiento(orden, idx).pasoActual === "terminado");

            // Construir bloque por producto
            let productosHtml = "";
            if (items.length === 0) {
                // Compatibilidad: orden sin items detallados -> timeline global
                const pasoActual = orden.pasoActual || "recibido";
                const timelineHtml = buildTimelineDots(PASOS_SEGUIMIENTO, PASOS_VISIBLES, pasoActual);
                const acciones = getAccionesItem(rol, pasoActual, PASOS_SEGUIMIENTO, orden.id, -1);
                productosHtml = `
                    <div class="seg-timeline-mini">${timelineHtml}</div>
                    <div class="seg-orden-actions">${acciones}</div>
                `;
            } else {
                items.forEach((item, idx) => {
                    const seg = getItemSeguimiento(orden, idx);
                    const pasoActual = seg.pasoActual;

                    const timelineHtml = buildTimelineDots(PASOS_SEGUIMIENTO, PASOS_VISIBLES, pasoActual);

                    const acciones = getAccionesItem(rol, pasoActual, PASOS_SEGUIMIENTO, orden.id, idx);
                    const nombreProd = `<strong>${item.cantidad || 1}x</strong> ${item.producto || "Producto " + (idx + 1)}`;

                    // Resumen de cantidades por etapa (lo que cada area realizo/envio)
                    const cantidadesHtml = buildCantidadesHtml(orden, idx, PASOS_SEGUIMIENTO, pasoActual, item);

                    productosHtml += `
                        <div class="seg-producto-item">
                            <div class="seg-producto-header">
                                <span class="seg-producto-nombre"><i class="bi bi-box"></i> ${nombreProd}</span>
                                <span class="seg-estado-badge ${pasoActual}"><i class="bi ${estadoIcons[pasoActual]}"></i> ${estadoLabels[pasoActual]}</span>
                            </div>
                            <div class="seg-timeline-mini">${timelineHtml}</div>
                            ${cantidadesHtml}
                            <div class="seg-orden-actions">${acciones}</div>
                        </div>
                    `;
                });
            }

            // Link cliente cuando toda la orden esta terminada
            let linkHtml = "";
            if (todosTerminados || pasoGlobal === "terminado") {
                linkHtml = `<div class="seg-orden-footer"><button class="seg-btn-link" data-id="${orden.id}"><i class="bi bi-link-45deg"></i> Copiar link cliente</button></div>`;
            }

            card.innerHTML = `
                <div class="seg-orden-header">
                    <div class="seg-orden-info">
                        <div class="seg-orden-numero">${orden.numero} <span style="font-weight:400;color:#888;font-size:12px;">&bull; ${orden.tipo}</span></div>
                        <div class="seg-orden-cliente">${nombreSeg} &bull; ${fechaEnvio}</div>
                    </div>
                    <span class="seg-estado-badge ${pasoGlobal}"><i class="bi ${estadoIcons[pasoGlobal]}"></i> ${estadoLabels[pasoGlobal]}</span>
                </div>
                <div class="seg-productos-lista">${productosHtml}</div>
                ${linkHtml}
            `;

            container.appendChild(card);
        });

        // Eventos avanzar: pedir cantidad realizada/enviada antes de pasar
        container.querySelectorAll(".seg-btn-avanzar").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                const paso = btn.dataset.paso;
                const idx = parseInt(btn.dataset.idx);
                abrirModalCantidad(id, paso, idx);
            });
        });

        // Eventos retroceder: directo, sin pedir cantidad
        container.querySelectorAll(".seg-btn-retroceder").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                const paso = btn.dataset.paso;
                const idx = parseInt(btn.dataset.idx);
                await actualizarPasoOrden(id, paso, idx);
            });
        });

        // Eventos copiar link
        container.querySelectorAll(".seg-btn-link").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                const baseUrl = window.location.origin + window.location.pathname.replace("dashboard.html", "");
                const link = baseUrl + "seguimiento.html?id=" + id;
                copyToClipboard(link).then(() => {
                    btn.innerHTML = '<i class="bi bi-check-lg"></i> Copiado';
                    setTimeout(() => { btn.innerHTML = '<i class="bi bi-link-45deg"></i> Copiar link cliente'; }, 2000);
                });
            });
        });
}

// Construye el bloque visual que muestra la cantidad registrada en cada etapa.
// Cada etapa (que produce/entrega) guarda cuanto realizo. La etapa siguiente lo ve
// como "cantidad recibida".
function buildCantidadesHtml(orden, idx, PASOS, pasoActual, item) {
    const cantidades = getItemCantidades(orden, idx);
    const ordenada = parseInt(item.cantidad) || 0;
    const idxActual = PASOS.findIndex(p => p.key === pasoActual);

    // Solo mostramos etapas de trabajo (no "recibido" ni "terminado") que ya tengan cantidad
    const filas = [];
    PASOS.forEach((paso, i) => {
        if (paso.key === "recibido" || paso.key === "terminado") return;
        const cant = cantidades[paso.key];
        if (cant === undefined || cant === null || cant === "") return;
        filas.push(`
            <div class="seg-cant-fila">
                <span class="seg-cant-etapa"><i class="bi ${paso.icon}"></i> ${paso.title}</span>
                <span class="seg-cant-valor">${cant}</span>
            </div>
        `);
    });

    // Cantidad que la etapa actual recibio de la anterior (para roles operativos)
    let recibidaHtml = "";
    const anterior = idxActual > 0 ? PASOS[idxActual - 1] : null;
    if (anterior && cantidades[anterior.key] !== undefined && cantidades[anterior.key] !== null && cantidades[anterior.key] !== "") {
        recibidaHtml = `<div class="seg-cant-recibida"><i class="bi bi-box-arrow-in-down"></i> Recibido de ${anterior.title}: <strong>${cantidades[anterior.key]}</strong></div>`;
    }

    // Carton usado en guillotina (si se registro)
    let cartonHtml = "";
    const cartonUsado = (idx === undefined || idx === null || idx < 0)
        ? (orden.cartonSeguimiento || null)
        : ((orden.itemsSeguimiento && orden.itemsSeguimiento[idx] && orden.itemsSeguimiento[idx].carton) || null);
    if (cartonUsado && cartonUsado.tipo) {
        cartonHtml = `<div class="seg-cant-carton"><i class="bi bi-boxes"></i> Cartón: <strong>${cartonUsado.tipo}${cartonUsado.tamano ? " (" + cartonUsado.tamano + ")" : ""}</strong> — ${cartonUsado.pliegos || 0} pliegos</div>`;
    }

    if (filas.length === 0 && !recibidaHtml && !cartonHtml) return "";

    return `
        <div class="seg-cantidades">
            ${recibidaHtml}
            ${filas.length > 0 ? `<div class="seg-cant-titulo">Cantidades por etapa (de ${ordenada} ordenadas)</div>${filas.join("")}` : ""}
            ${cartonHtml}
        </div>
    `;
}

// Estado temporal del modal de cantidad
let segCantidadCtx = null;

function abrirModalCantidad(ordenId, nuevoPaso, itemIdx) {
    const orden = seguimientoCache.find(o => o.id === ordenId);
    if (!orden) { actualizarPasoOrden(ordenId, nuevoPaso, itemIdx); return; }

    const PASOS = getPasosOrden(orden);
    const items = orden.items || [];
    const hayItem = !(itemIdx === undefined || itemIdx === null || isNaN(itemIdx) || itemIdx < 0 || items.length === 0);

    const seg = hayItem ? getItemSeguimiento(orden, itemIdx) : { pasoActual: orden.pasoActual || "recibido", carton: orden.cartonSeguimiento || null };
    const pasoActual = seg.pasoActual;
    const idxActual = PASOS.findIndex(p => p.key === pasoActual);
    const pasoActualObj = PASOS[idxActual] || { title: pasoActual };

    // Si el paso actual es "recibido" o el destino es un retroceso, no pedir cantidad
    // (los avances desde "recibido" son solo "enviar a diseño", sin produccion fisica).
    const item = hayItem ? items[itemIdx] : null;
    const ordenada = item ? (parseInt(item.cantidad) || 0) : 0;
    const cantidades = hayItem ? getItemCantidades(orden, itemIdx) : (orden.cantidadesSeguimiento || {});

    // Cantidad recibida de la etapa anterior
    const anterior = idxActual > 0 ? PASOS[idxActual - 1] : null;
    const recibida = anterior && cantidades[anterior.key] !== undefined ? cantidades[anterior.key] : null;

    // No pedir cantidad cuando el paso actual no implica produccion fisica (recibido, diseno en digital)
    // Solo pedimos cantidad para etapas operativas: guillotina, impresion, troquelado, vasos, empaques, diseno(imprenta), revision, ajustes, entrega.
    const pasosSinCantidad = ["recibido"];
    if (pasosSinCantidad.includes(pasoActual)) {
        actualizarPasoOrden(ordenId, nuevoPaso, itemIdx);
        return;
    }

    segCantidadCtx = { ordenId, nuevoPaso, itemIdx, pasoActual };

    document.getElementById("segCantidadTitulo").textContent = "Cantidad en " + (pasoActualObj.title || pasoActual);
    const prodNombre = item ? `${item.cantidad || 1}x ${item.producto || ""}` : orden.numero;
    document.getElementById("segCantidadDesc").textContent =
        `Registra la cantidad que realizaste/envias en la etapa de ${pasoActualObj.title || pasoActual} para ${prodNombre}.`;

    document.getElementById("segCantidadOrdenada").textContent = ordenada > 0 ? ordenada : "-";
    const recibidaWrap = document.getElementById("segCantidadRecibidaWrap");
    if (recibida !== null && recibida !== "") {
        recibidaWrap.style.display = "";
        document.getElementById("segCantidadRecibida").textContent = `${recibida} (de ${anterior.title})`;
    } else {
        recibidaWrap.style.display = "none";
    }

    // Prefill: cantidad ya registrada en este paso, o la recibida, o la ordenada
    const input = document.getElementById("segCantidadInput");
    const yaRegistrada = cantidades[pasoActual];
    input.value = (yaRegistrada !== undefined && yaRegistrada !== null && yaRegistrada !== "")
        ? yaRegistrada
        : (recibida !== null && recibida !== "" ? recibida : (ordenada > 0 ? ordenada : ""));

    // Bloque de seleccion de carton: solo en la etapa de guillotina
    prepararSegCarton(pasoActual, seg);

    document.getElementById("segCantidadOverlay").classList.add("show");
    setTimeout(() => { input.focus(); input.select(); }, 100);
}

// Prepara el bloque de seleccion de carton dentro del modal de cantidad.
// Solo se muestra cuando el paso operativo es "guillotina".
function prepararSegCarton(pasoActual, seg) {
    const box = document.getElementById("segCartonBox");
    if (!box) return;

    if (pasoActual !== "guillotina") {
        box.style.display = "none";
        return;
    }

    box.style.display = "";
    const select = document.getElementById("segCartonSelect");
    const pliegosInput = document.getElementById("segCartonPliegos");
    const alerta = document.getElementById("segCartonAlerta");
    const dispo = document.getElementById("segCartonDisponible");

    // Cargar opciones desde el inventario en memoria
    select.innerHTML = '<option value="">-- Selecciona un cartón del inventario --</option>';
    (inventarioDB || [])
        .slice()
        .sort((a, b) => (a.tipo || "").localeCompare(b.tipo || ""))
        .forEach(i => {
            const opt = document.createElement("option");
            opt.value = i.id;
            opt.textContent = `${i.tipo} - ${i.tamano} (${i.pliegos} pliegos)`;
            select.appendChild(opt);
        });

    // Prefill si ya se habia registrado carton para este item
    const cartonPrev = seg && seg.carton ? seg.carton : null;
    select.value = cartonPrev && cartonPrev.id ? cartonPrev.id : "";
    pliegosInput.value = cartonPrev && cartonPrev.pliegos != null ? cartonPrev.pliegos : "";
    alerta.style.display = "none";

    const mostrarDispo = () => {
        const item = inventarioDB.find(i => i.id === select.value);
        if (!item) { dispo.style.display = "none"; return; }
        const disponibles = Number(item.pliegos) || 0;
        dispo.style.display = "";
        dispo.className = "seg-carton-disponible" + (disponibles <= 0 ? " agotado" : "");
        dispo.innerHTML = disponibles > 0
            ? `<i class="bi bi-check-circle"></i> Disponible: <strong>${disponibles.toLocaleString("es-CO")}</strong> pliegos`
            : `<i class="bi bi-x-circle"></i> Sin stock disponible`;
        validarSegCarton();
    };

    select.onchange = mostrarDispo;
    pliegosInput.oninput = validarSegCarton;

    if (select.value) mostrarDispo();
}

// Valida que los pliegos a usar no superen lo disponible. Devuelve true si es valido.
function validarSegCarton() {
    const select = document.getElementById("segCartonSelect");
    const pliegosInput = document.getElementById("segCartonPliegos");
    const alerta = document.getElementById("segCartonAlerta");
    if (!select || !select.value) { alerta.style.display = "none"; return true; }

    const item = inventarioDB.find(i => i.id === select.value);
    const disponibles = item ? (Number(item.pliegos) || 0) : 0;
    const usar = parseInt(pliegosInput.value, 10);

    if (isNaN(usar) || usar <= 0) { alerta.style.display = "none"; return true; }

    if (usar > disponibles) {
        alerta.style.display = "";
        alerta.innerHTML = `<i class="bi bi-exclamation-triangle"></i> No hay suficiente. Solo quedan ${disponibles.toLocaleString("es-CO")} pliegos.`;
        return false;
    }
    alerta.style.display = "none";
    return true;
}

function setupSegCantidadModal() {
    const overlay = document.getElementById("segCantidadOverlay");
    if (!overlay) return;
    const cerrar = () => { overlay.classList.remove("show"); segCantidadCtx = null; };
    document.getElementById("segCantidadClose").addEventListener("click", cerrar);
    document.getElementById("segCantidadCancel").addEventListener("click", cerrar);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });

    document.getElementById("segCantidadConfirm").addEventListener("click", async () => {
        if (!segCantidadCtx) return;
        const input = document.getElementById("segCantidadInput");
        const cantidad = input.value === "" ? null : (parseInt(input.value) || 0);
        const { ordenId, nuevoPaso, itemIdx, pasoActual } = segCantidadCtx;

        // Si estamos en guillotina y se selecciono carton, validar stock
        let cartonInfo = null;
        if (pasoActual === "guillotina") {
            const select = document.getElementById("segCartonSelect");
            const pliegosInput = document.getElementById("segCartonPliegos");
            if (select && select.value) {
                if (!validarSegCarton()) return; // bloquea si no hay stock suficiente
                const item = inventarioDB.find(i => i.id === select.value);
                const usar = parseInt(pliegosInput.value, 10);
                cartonInfo = {
                    id: select.value,
                    tipo: item ? item.tipo : "",
                    tamano: item ? item.tamano : "",
                    pliegos: isNaN(usar) ? 0 : usar
                };
            }
        }

        cerrar();
        await actualizarPasoOrden(ordenId, nuevoPaso, itemIdx, { paso: pasoActual, cantidad, carton: cartonInfo });
    });

    const input = document.getElementById("segCantidadInput");
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("segCantidadConfirm").click();
    });
}

async function actualizarPasoOrden(ordenId, nuevoPaso, itemIdx, cantidadInfo) {
    try {
        const ref = doc(db, "produccion", ordenId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;

        const data = snap.data();
        const items = data.items || [];
        const PASOS = data.tipo === "digital" ? PASOS_DIGITAL_SEG : PASOS_IMPRENTA_SEG;

        // Si no hay indice de producto valido (orden sin items detallados): comportamiento global
        if (itemIdx === undefined || itemIdx === null || isNaN(itemIdx) || items.length === 0 || itemIdx < 0) {
            const seguimiento = data.seguimiento || {};
            seguimiento[nuevoPaso] = new Date().toISOString();
            const cantidadesSeguimiento = data.cantidadesSeguimiento || {};
            if (cantidadInfo && cantidadInfo.paso && cantidadInfo.cantidad !== null && cantidadInfo.cantidad !== undefined) {
                cantidadesSeguimiento[cantidadInfo.paso] = cantidadInfo.cantidad;
            }
            const nuevaData = { ...data, pasoActual: nuevoPaso, seguimiento, cantidadesSeguimiento };
            if (cantidadInfo && cantidadInfo.carton) {
                nuevaData.cartonSeguimiento = cantidadInfo.carton;
                await descontarCartonInventario(cantidadInfo.carton, data.cartonSeguimiento, {
                    numero: data.numero, id: ordenId, cotizacionId: data.cotizacionId || ordenId, cliente: data.cliente
                });
            }
            await setDoc(ref, nuevaData);
            cargarSeguimiento();
            return;
        }

        // Actualizar seguimiento del producto especifico
        const itemsSeguimiento = data.itemsSeguimiento || {};
        // Inicializar entradas faltantes heredando el paso global actual
        const pasoBase = data.pasoActual || "recibido";
        items.forEach((_, i) => {
            if (!itemsSeguimiento[i]) {
                itemsSeguimiento[i] = { pasoActual: pasoBase, seguimiento: {}, cantidades: {} };
            }
        });

        const entry = itemsSeguimiento[itemIdx];
        entry.pasoActual = nuevoPaso;
        entry.seguimiento = entry.seguimiento || {};
        entry.seguimiento[nuevoPaso] = new Date().toISOString();

        // Registrar la cantidad realizada/enviada en la etapa desde la que se avanza
        entry.cantidades = entry.cantidades || {};
        if (cantidadInfo && cantidadInfo.paso && cantidadInfo.cantidad !== null && cantidadInfo.cantidad !== undefined) {
            entry.cantidades[cantidadInfo.paso] = cantidadInfo.cantidad;
        }

        // Registrar el carton usado en guillotina y descontar del inventario
        if (cantidadInfo && cantidadInfo.carton) {
            await descontarCartonInventario(cantidadInfo.carton, entry.carton, {
                numero: data.numero, id: ordenId, cotizacionId: data.cotizacionId || ordenId, cliente: data.cliente
            });
            entry.carton = cantidadInfo.carton;
        }

        // Paso global de la orden = producto MENOS avanzado
        let minIdx = PASOS.length - 1;
        items.forEach((_, i) => {
            const p = itemsSeguimiento[i]?.pasoActual || pasoBase;
            const pi = PASOS.findIndex(x => x.key === p);
            if (pi >= 0 && pi < minIdx) minIdx = pi;
        });
        const pasoGlobal = PASOS[Math.max(0, minIdx)].key;

        // Mantener el mapa de fechas global (marca cuando TODOS alcanzan un paso)
        const seguimiento = data.seguimiento || {};
        if (!seguimiento[pasoGlobal]) seguimiento[pasoGlobal] = new Date().toISOString();

        await setDoc(ref, { ...data, itemsSeguimiento, pasoActual: pasoGlobal, seguimiento });
        cargarSeguimiento();
    } catch (err) {
        console.error("Error actualizando paso:", err);
    }
}

// ===== LOGOUT =====
function logout() {
    sessionStorage.clear();
    window.location.href = "login.html";
}

// ===== SECCION FINANZAS =====
function setupFinanzas() {
    const filtroMes = document.getElementById("finanzasFiltroMes");
    const filtroAnio = document.getElementById("finanzasFiltroAnio");
    const filtroVendedor = document.getElementById("finanzasFiltroVendedor");

    // Llenar años disponibles
    const anioActual = new Date().getFullYear();
    for (let y = anioActual; y >= anioActual - 3; y--) {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = y;
        filtroAnio.appendChild(opt);
    }

    // Seleccionar mes y año actual por defecto
    filtroMes.value = new Date().getMonth();
    filtroAnio.value = anioActual;

    filtroMes.addEventListener("change", cargarFinanzas);
    filtroAnio.addEventListener("change", cargarFinanzas);

    // Filtro por vendedor: solo lo ve el administrador (los vendedores solo ven lo suyo)
    if (filtroVendedor && rol === "administrador") {
        filtroVendedor.style.display = "";
        filtroVendedor.addEventListener("change", cargarFinanzas);
        poblarFiltroVendedores();
    }

    // Filtros de estado de pago en la tabla
    document.querySelectorAll(".finanzas-filtro-pago").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".finanzas-filtro-pago").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            cargarFinanzas();
        });
    });
}

// Llena el selector de vendedores del filtro de finanzas con los usuarios de rol
// "ventas" (y "administrador", por si generan cotizaciones). El valor de cada
// opcion es el email del usuario, que es el identificador estable de "creadoPorEmail".
async function poblarFiltroVendedores() {
    const filtroVendedor = document.getElementById("finanzasFiltroVendedor");
    if (!filtroVendedor) return;
    try {
        const snap = await getDocs(collection(db, "usuarios"));
        const vendedores = [];
        snap.forEach(docSnap => {
            const u = docSnap.data();
            if (u.rol === "ventas" || u.rol === "administrador") {
                vendedores.push({ nombre: u.nombre || u.email, email: u.email });
            }
        });
        vendedores.sort((a, b) => a.nombre.localeCompare(b.nombre));
        // Conservar la opcion "Todos" y agregar el resto
        filtroVendedor.innerHTML = '<option value="">Todos los vendedores</option>';
        vendedores.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v.email;
            opt.textContent = v.nombre;
            filtroVendedor.appendChild(opt);
        });
    } catch (err) {
        console.warn("No se pudieron cargar los vendedores para el filtro:", err);
    }
}

async function cargarFinanzas() {
    try {
        const snap = await getDocs(collection(db, "cotizaciones"));
        const todas = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.eliminado) return; // excluir las que estan en papelera
            todas.push({ id: d.id, ...data });
        });

        // Cruzar con produccion para recuperar pagos restantes antiguos
        // (cuando se pagaba el saldo restante solo se actualizaba produccion)
        try {
            const prodSnap = await getDocs(collection(db, "produccion"));
            const prodPorCotizacion = {};
            prodSnap.forEach(d => {
                const data = d.data();
                if (data.pagoRestanteCompletado && data.cotizacionId) {
                    // Si una cotizacion tiene varias producciones (ambas), nos quedamos con la primera con pago restante
                    if (!prodPorCotizacion[data.cotizacionId]) {
                        prodPorCotizacion[data.cotizacionId] = data;
                    }
                }
            });

            // Reconciliar y persistir si hace falta
            for (const cot of todas) {
                const prod = prodPorCotizacion[cot.id];
                if (!prod) continue;
                if (cot.pagoRestanteCompletado) continue; // ya esta sincronizado

                const totalCot = parseInt(cot.total) || 0;
                cot.montoPagado = totalCot;
                cot.pagoRestanteCompletado = true;
                cot.pagoRestanteMetodo = prod.pagoRestanteMetodo || "";
                cot.pagoRestanteComprobante = prod.pagoRestanteComprobante || "";
                cot.pagoRestanteFecha = prod.pagoRestanteFecha || "";
                cot.pagoRestanteMonto = prod.pagoRestanteMonto || 0;

                // Persistir el cambio en cotizaciones para que quede arreglado
                try {
                    await setDoc(doc(db, "cotizaciones", cot.id), {
                        ...cot,
                        montoPagado: totalCot,
                        pagoRestanteCompletado: true,
                        pagoRestanteMetodo: cot.pagoRestanteMetodo,
                        pagoRestanteComprobante: cot.pagoRestanteComprobante,
                        pagoRestanteFecha: cot.pagoRestanteFecha,
                        pagoRestanteMonto: cot.pagoRestanteMonto
                    });
                } catch (e) {
                    console.warn("No se pudo sincronizar cotizacion " + cot.id, e);
                }
            }
        } catch (errProd) {
            console.warn("No se pudo cruzar con produccion:", errProd);
        }

        // Si no es admin, filtrar solo las cotizaciones propias
        let cotizacionesBase = todas;
        if (rol !== "administrador") {
            const currentUser = sessionStorage.getItem("userName") || "";
            const currentEmail = sessionStorage.getItem("userEmail") || "";
            cotizacionesBase = todas.filter(c =>
                c.creadoPorEmail === currentEmail || c.creadoPor === currentUser
            );
        } else {
            // Admin: puede filtrar por vendedor (email de creadoPorEmail)
            const filtroVendedor = document.getElementById("finanzasFiltroVendedor");
            const vendedorEmail = filtroVendedor ? filtroVendedor.value : "";
            if (vendedorEmail) {
                // Buscar tambien el nombre asociado por si la cotizacion solo guardo creadoPor
                const opt = filtroVendedor.querySelector(`option[value="${vendedorEmail}"]`);
                const vendedorNombre = opt ? opt.textContent : "";
                cotizacionesBase = todas.filter(c =>
                    c.creadoPorEmail === vendedorEmail ||
                    (vendedorNombre && c.creadoPor === vendedorNombre)
                );
            }
        }

        // Filtrar por mes/año
        const filtroMes = document.getElementById("finanzasFiltroMes").value;
        const filtroAnio = document.getElementById("finanzasFiltroAnio").value;

        let filtradas = cotizacionesBase.filter(c => c.estado === "aprobada");

        if (filtroMes !== "" || filtroAnio !== "") {
            filtradas = filtradas.filter(c => {
                if (!c.fechaAprobacion) return false;
                const fecha = new Date(c.fechaAprobacion);
                if (isNaN(fecha)) return false;
                if (filtroMes !== "" && fecha.getMonth() !== parseInt(filtroMes)) return false;
                if (filtroAnio !== "" && fecha.getFullYear() !== parseInt(filtroAnio)) return false;
                return true;
            });
        }

        renderFinanzas(filtradas);
    } catch (err) {
        console.error("Error cargando finanzas:", err);
    }
}

function renderFinanzas(cotizaciones) {
    const fmtMoney = (v) => "$" + (parseInt(v) || 0).toLocaleString("en-US");

    // Calcular totales
    let totalIngresos = 0;
    let totalPagado = 0;
    let totalPendiente = 0;
    let totalImprenta = 0;
    let totalDigital = 0;
    let countImprenta = 0;
    let countDigital = 0;
    const productoIngresos = {};

    cotizaciones.forEach(cot => {
        const total = parseInt(cot.total) || 0;
        const pagado = parseInt(cot.montoPagado) || 0;
        totalIngresos += total;
        totalPagado += pagado;
        totalPendiente += (total - pagado);

        // Por tipo
        if (cot.tipo === "imprenta") {
            totalImprenta += total;
            countImprenta++;
        } else if (cot.tipo === "digital") {
            totalDigital += total;
            countDigital++;
        } else if (cot.tipo === "ambas") {
            // Separar por items
            (cot.items || []).forEach(item => {
                const itemTotal = parseInt(item.precioTotal) || 0;
                if (item.tipo === "imprenta") {
                    totalImprenta += itemTotal;
                } else {
                    totalDigital += itemTotal;
                }
            });
            countImprenta++;
            countDigital++;
        }

        // Por producto
        (cot.items || []).forEach(item => {
            const nombre = item.producto || "Sin nombre";
            const itemTotal = parseInt(item.precioTotal) || 0;
            if (!productoIngresos[nombre]) {
                productoIngresos[nombre] = { total: 0, cantidad: 0 };
            }
            productoIngresos[nombre].total += itemTotal;
            productoIngresos[nombre].cantidad += (parseInt(item.cantidad) || 0);
        });
    });

    // Resumen general
    document.getElementById("finanzasTotalIngresos").textContent = fmtMoney(totalIngresos);
    document.getElementById("finanzasTotalAprobadas").textContent = cotizaciones.length;
    document.getElementById("finanzasTotalPendiente").textContent = fmtMoney(totalPendiente);
    document.getElementById("finanzasTotalPagado").textContent = fmtMoney(totalPagado);

    // Por servicio
    document.getElementById("finanzasImprentaTotal").textContent = fmtMoney(totalImprenta);
    document.getElementById("finanzasImprentaCount").textContent = countImprenta + " cotizaciones";
    document.getElementById("finanzasDigitalTotal").textContent = fmtMoney(totalDigital);
    document.getElementById("finanzasDigitalCount").textContent = countDigital + " cotizaciones";

    // Detalle por servicio - top productos imprenta
    renderDetalleServicio("finanzasImprentaDetalle", cotizaciones.filter(c => c.tipo === "imprenta" || c.tipo === "ambas"), "imprenta");
    renderDetalleServicio("finanzasDigitalDetalle", cotizaciones.filter(c => c.tipo === "digital" || c.tipo === "ambas"), "digital");

    // Tabla de pagos
    renderTablaFinanzas(cotizaciones);

    // Productos
    renderProductosFinanzas(productoIngresos);
}

function renderDetalleServicio(containerId, cotizaciones, tipo) {
    const container = document.getElementById(containerId);
    const productoMap = {};

    cotizaciones.forEach(cot => {
        (cot.items || []).forEach(item => {
            if (tipo === "imprenta" && item.tipo !== "imprenta" && cot.tipo !== "imprenta") return;
            if (tipo === "digital" && item.tipo !== "digital" && cot.tipo !== "digital") return;
            const nombre = item.producto || "Otro";
            const itemTotal = parseInt(item.precioTotal) || 0;
            if (!productoMap[nombre]) productoMap[nombre] = 0;
            productoMap[nombre] += itemTotal;
        });
    });

    const sorted = Object.entries(productoMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

    if (sorted.length === 0) {
        container.innerHTML = '<span class="finanzas-no-data">Sin datos</span>';
        return;
    }

    const maxVal = sorted[0][1];
    container.innerHTML = sorted.map(([nombre, total]) => {
        const pct = maxVal > 0 ? Math.round((total / maxVal) * 100) : 0;
        return `
            <div class="finanzas-bar-item">
                <div class="finanzas-bar-label">
                    <span>${nombre}</span>
                    <span>$${total.toLocaleString("en-US")}</span>
                </div>
                <div class="finanzas-bar-track">
                    <div class="finanzas-bar-fill" style="width:${pct}%"></div>
                </div>
            </div>
        `;
    }).join("");
}

function renderTablaFinanzas(cotizaciones) {
    const tbody = document.getElementById("finanzasTablaBody");

    // Aplicar filtro de estado de pago
    const filtroPago = document.querySelector(".finanzas-filtro-pago.active")?.dataset.filtroPago || "todos";
    let cotsFiltradas = cotizaciones;
    if (filtroPago === "pendientes") {
        cotsFiltradas = cotizaciones.filter(c => {
            const total = parseInt(c.total) || 0;
            const pagado = parseInt(c.montoPagado) || 0;
            return (total - pagado) > 0;
        });
    } else if (filtroPago === "restante") {
        cotsFiltradas = cotizaciones.filter(c => !!c.pagoRestanteCompletado);
    } else if (filtroPago === "pagados") {
        cotsFiltradas = cotizaciones.filter(c => {
            const total = parseInt(c.total) || 0;
            const pagado = parseInt(c.montoPagado) || 0;
            return (total - pagado) <= 0;
        });
    } else if (filtroPago === "comp1") {
        cotsFiltradas = cotizaciones.filter(c => {
            const tieneInicial = !!c.comprobante;
            const tieneRestante = !!c.pagoRestanteComprobante;
            return (tieneInicial ? 1 : 0) + (tieneRestante ? 1 : 0) === 1;
        });
    } else if (filtroPago === "comp2") {
        cotsFiltradas = cotizaciones.filter(c => !!c.comprobante && !!c.pagoRestanteComprobante);
    }

    if (cotsFiltradas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="tabla-empty">No hay pagos registrados con este filtro</td></tr>';
        return;
    }

    // Ordenar por fecha más reciente
    const sorted = [...cotsFiltradas].sort((a, b) => (b.fechaAprobacion || "").localeCompare(a.fechaAprobacion || ""));

    tbody.innerHTML = sorted.map(cot => {
        const total = parseInt(cot.total) || 0;
        const pagado = parseInt(cot.montoPagado) || 0;
        const saldo = total - pagado;
        const fecha = cot.fechaAprobacion ? new Date(cot.fechaAprobacion).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "-";
        const tipoBadge = cot.tipo === "digital"
            ? '<span class="finanzas-tipo-badge digital"><i class="bi bi-display"></i> Digital</span>'
            : cot.tipo === "imprenta"
                ? '<span class="finanzas-tipo-badge imprenta"><i class="bi bi-printer"></i> Imprenta</span>'
                : '<span class="finanzas-tipo-badge ambas"><i class="bi bi-layers"></i> Ambas</span>';
        const metodo = cot.metodoPago || "-";
        const tieneRestante = !!cot.pagoRestanteCompletado;
        const numAbonos = Array.isArray(cot.abonos) ? cot.abonos.length : 0;
        let metodoTexto;
        if (numAbonos > 1) {
            metodoTexto = `${metodo.charAt(0).toUpperCase() + metodo.slice(1)} <span class="finanzas-metodo-extra">· ${numAbonos} abonos</span>`;
        } else if (tieneRestante && cot.pagoRestanteMetodo) {
            metodoTexto = `${metodo.charAt(0).toUpperCase() + metodo.slice(1)} <span class="finanzas-metodo-extra">+ ${cot.pagoRestanteMetodo.charAt(0).toUpperCase() + cot.pagoRestanteMetodo.slice(1)}</span>`;
        } else {
            metodoTexto = metodo.charAt(0).toUpperCase() + metodo.slice(1);
        }
        const estadoPago = saldo <= 0
            ? (tieneRestante
                ? '<span class="finanzas-estado-badge pagado"><i class="bi bi-check-circle"></i> Pago completado</span>'
                : '<span class="finanzas-estado-badge pagado"><i class="bi bi-check-circle"></i> Pagado</span>')
            : '<span class="finanzas-estado-badge pendiente"><i class="bi bi-clock"></i> Saldo pendiente</span>';

        // Comprobantes: si hay historial de abonos, mostrar uno por cada abono.
        // Si no, mantener compatibilidad con comprobante inicial + restante.
        let comprobantesHtml = '';
        const abonosCot = Array.isArray(cot.abonos) ? cot.abonos.filter(a => a && a.comprobante) : [];
        if (abonosCot.length > 0) {
            comprobantesHtml = '<div class="finanzas-comprobantes-cell">' +
                abonosCot.map((a, i) =>
                    `<button class="btn-ver-comprobante" data-url="${a.comprobante}" title="Abono ${i + 1}: $${(parseInt(a.monto) || 0).toLocaleString("en-US")}"><i class="bi bi-receipt-cutoff"></i> ${i + 1}</button>`
                ).join("") +
                '</div>';
        } else if (cot.comprobante && cot.pagoRestanteComprobante) {
            comprobantesHtml = `
                <div class="finanzas-comprobantes-cell">
                    <button class="btn-ver-comprobante" data-url="${cot.comprobante}" title="Comprobante inicial"><i class="bi bi-receipt-cutoff"></i> 1</button>
                    <button class="btn-ver-comprobante" data-url="${cot.pagoRestanteComprobante}" title="Comprobante saldo"><i class="bi bi-receipt-cutoff"></i> 2</button>
                </div>
            `;
        } else if (cot.comprobante) {
            comprobantesHtml = `<button class="btn-ver-comprobante" data-url="${cot.comprobante}"><i class="bi bi-receipt-cutoff"></i> Ver</button>`;
        } else if (cot.pagoRestanteComprobante) {
            comprobantesHtml = `<button class="btn-ver-comprobante" data-url="${cot.pagoRestanteComprobante}"><i class="bi bi-receipt-cutoff"></i> Ver</button>`;
        } else {
            comprobantesHtml = '<span class="finanzas-no-comp">\u2014</span>';
        }

        return `
            <tr>
                <td><strong>${cot.numero}</strong></td>
                <td>${cot.cliente}</td>
                <td>${tipoBadge}</td>
                <td>${total.toLocaleString("en-US")}</td>
                <td>${pagado.toLocaleString("en-US")}</td>
                <td class="${saldo > 0 ? 'finanzas-saldo-rojo' : ''}">${saldo.toLocaleString("en-US")}</td>
                <td>${metodoTexto}</td>
                <td>${fecha}</td>
                <td>${estadoPago}</td>
                <td>${comprobantesHtml}</td>
            </tr>
        `;
    }).join("");

    // Eventos de ver comprobante
    tbody.querySelectorAll(".btn-ver-comprobante").forEach(btn => {
        btn.addEventListener("click", () => {
            const url = btn.dataset.url;
            document.getElementById("imgModalDashImg").src = url;
            document.getElementById("imgModalDash").classList.add("show");
        });
    });
}

function renderProductosFinanzas(productoIngresos) {
    const container = document.getElementById("finanzasProductosGrid");
    const sorted = Object.entries(productoIngresos).sort((a, b) => b[1].total - a[1].total);

    if (sorted.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart"></i><p>No hay datos de productos</p></div>';
        return;
    }

    const maxVal = sorted[0][1].total;

    container.innerHTML = sorted.map(([nombre, data]) => {
        const pct = maxVal > 0 ? Math.round((data.total / maxVal) * 100) : 0;
        return `
            <div class="finanzas-producto-item">
                <div class="finanzas-producto-info">
                    <span class="finanzas-producto-nombre">${nombre}</span>
                    <span class="finanzas-producto-stats">${data.cantidad} unidades</span>
                </div>
                <div class="finanzas-producto-bar-wrap">
                    <div class="finanzas-producto-bar" style="width:${pct}%"></div>
                </div>
                <span class="finanzas-producto-total">$${data.total.toLocaleString("en-US")}</span>
            </div>
        `;
    }).join("");
}

// ===== SECCION CLIENTES =====
let clientesDB = [];
let clienteEditandoId = null;

function setupClientes() {
    const overlay = document.getElementById("clienteModalOverlay");
    const btnClose = document.getElementById("clienteModalClose");
    const btnCancel = document.getElementById("clienteModalCancel");
    const btnSave = document.getElementById("clienteModalSave");
    const btnNuevo = document.getElementById("btnNuevoCliente");
    const buscarInput = document.getElementById("clientesBuscar");
    const filtroTipo = document.getElementById("clientesFiltroTipo");

    btnNuevo.addEventListener("click", () => abrirModalCliente());
    btnClose.addEventListener("click", cerrarModalCliente);
    btnCancel.addEventListener("click", cerrarModalCliente);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrarModalCliente(); });

    btnSave.addEventListener("click", guardarCliente);

    buscarInput.addEventListener("input", () => {
        renderTablaClientes(buscarInput.value.trim().toLowerCase());
    });

    if (filtroTipo) {
        filtroTipo.addEventListener("change", () => {
            renderTablaClientes(buscarInput.value.trim().toLowerCase());
        });
    }

    // Selector visual de tipo de persona en el modal de cliente
    const tipoSelector = document.getElementById("clienteTipoSelector");
    if (tipoSelector) {
        tipoSelector.querySelectorAll(".tipo-persona-option").forEach(btn => {
            btn.addEventListener("click", () => {
                setTipoPersonaCliente(btn.dataset.tipo);
            });
        });
    }

    // Selector visual de tipo de persona en el cotizador
    const cotTipoSelector = document.getElementById("cotTipoPersonaSelector");
    if (cotTipoSelector) {
        cotTipoSelector.querySelectorAll(".tipo-persona-option").forEach(btn => {
            btn.addEventListener("click", () => {
                setTipoPersonaCotizador(btn.dataset.tipo);
            });
        });
    }

    // Filtro de tipo de cliente en el selector del cotizador
    const cotFiltroTipo = document.getElementById("cotClienteFiltroTipo");
    if (cotFiltroTipo) {
        cotFiltroTipo.addEventListener("change", () => {
            actualizarSelectClientes();
        });
    }

    // Selector de cliente en cotizador
    const selectCliente = document.getElementById("cotClienteSelect");
    if (selectCliente) {
        selectCliente.addEventListener("change", () => {
            const id = selectCliente.value;
            if (!id) {
                // Nuevo cliente - limpiar campos
                document.getElementById("cotCliente").value = "";
                document.getElementById("cotNit").value = "";
                document.getElementById("cotNegocio").value = "";
                document.getElementById("cotTelefono").value = "";
                document.getElementById("cotDireccion").value = "";
                document.getElementById("cotCiudad").value = "";
                setTipoPersonaCotizador("natural");
                return;
            }
            const cliente = clientesDB.find(c => c.id === id);
            if (cliente) {
                document.getElementById("cotCliente").value = cliente.nombre || "";
                document.getElementById("cotNit").value = cliente.nit || "";
                document.getElementById("cotNegocio").value = cliente.negocio || "";
                document.getElementById("cotTelefono").value = cliente.telefono || "";
                document.getElementById("cotDireccion").value = cliente.direccion || "";
                document.getElementById("cotCiudad").value = cliente.ciudad || "";
                setTipoPersonaCotizador(cliente.tipoPersona || "natural");
            }
        });
    }
}

// Cambia el tipo de persona seleccionado en el modal de cliente y ajusta las etiquetas
function setTipoPersonaCliente(tipo) {
    document.getElementById("clienteModalTipo").value = tipo;
    const selector = document.getElementById("clienteTipoSelector");
    if (selector) {
        selector.querySelectorAll(".tipo-persona-option").forEach(b => {
            b.classList.toggle("active", b.dataset.tipo === tipo);
        });
    }
    const nombreLabel = document.getElementById("clienteModalNombreLabel");
    const nitLabel = document.getElementById("clienteModalNitLabel");
    const nombreInput = document.getElementById("clienteModalNombre");
    const nitInput = document.getElementById("clienteModalNit");
    if (tipo === "juridica") {
        if (nombreLabel) nombreLabel.textContent = "Razon social *";
        if (nitLabel) nitLabel.textContent = "NIT";
        if (nombreInput) nombreInput.placeholder = "Nombre de la empresa";
        if (nitInput) nitInput.placeholder = "900.000.000-0";
    } else {
        if (nombreLabel) nombreLabel.textContent = "Nombre *";
        if (nitLabel) nitLabel.textContent = "Cedula";
        if (nombreInput) nombreInput.placeholder = "Nombre completo";
        if (nitInput) nitInput.placeholder = "1.000.000.000";
    }
}

// Cambia el tipo de persona seleccionado en el cotizador y ajusta las etiquetas
function setTipoPersonaCotizador(tipo) {
    document.getElementById("cotTipoPersona").value = tipo;
    const selector = document.getElementById("cotTipoPersonaSelector");
    if (selector) {
        selector.querySelectorAll(".tipo-persona-option").forEach(b => {
            b.classList.toggle("active", b.dataset.tipo === tipo);
        });
    }
    const nombreLabel = document.getElementById("cotClienteLabel");
    const nitLabel = document.getElementById("cotNitLabel");
    const nombreInput = document.getElementById("cotCliente");
    const nitInput = document.getElementById("cotNit");
    if (tipo === "juridica") {
        if (nombreLabel) nombreLabel.textContent = "Razon social";
        if (nitLabel) nitLabel.textContent = "NIT";
        if (nombreInput) nombreInput.placeholder = "Nombre de la empresa";
        if (nitInput) nitInput.placeholder = "900.000.000-0";
    } else {
        if (nombreLabel) nombreLabel.textContent = "Nombre del cliente";
        if (nitLabel) nitLabel.textContent = "Cedula";
        if (nombreInput) nombreInput.placeholder = "Nombre o empresa";
        if (nitInput) nitInput.placeholder = "1.000.000.000";
    }

    // El IVA se aplica por defecto para personas juridicas (con NIT).
    // Solo se ajusta automaticamente si no se esta editando/cargando una cotizacion existente.
    if (!cargandoCotizacion) {
        const chkIva = document.getElementById("cotAplicarIva");
        if (chkIva) {
            chkIva.checked = (tipo === "juridica");
            calcularTotales();
        }
    }
}

function abrirModalCliente(cliente) {
    clienteEditandoId = cliente ? cliente.id : null;
    document.getElementById("clienteModalTitle").textContent = cliente ? "Editar Cliente" : "Nuevo Cliente";
    document.getElementById("clienteModalSave").innerHTML = cliente
        ? '<i class="bi bi-check-lg"></i> Guardar cambios'
        : '<i class="bi bi-check-lg"></i> Guardar cliente';

    document.getElementById("clienteModalNombre").value = cliente ? cliente.nombre || "" : "";
    document.getElementById("clienteModalNit").value = cliente ? cliente.nit || "" : "";
    document.getElementById("clienteModalNegocio").value = cliente ? cliente.negocio || "" : "";
    document.getElementById("clienteModalTelefono").value = cliente ? cliente.telefono || "" : "";
    document.getElementById("clienteModalDireccion").value = cliente ? cliente.direccion || "" : "";
    document.getElementById("clienteModalCiudad").value = cliente ? cliente.ciudad || "" : "";
    setTipoPersonaCliente(cliente && cliente.tipoPersona ? cliente.tipoPersona : "natural");

    document.getElementById("clienteModalOverlay").classList.add("show");
    setTimeout(() => document.getElementById("clienteModalNombre").focus(), 100);
}

function cerrarModalCliente() {
    document.getElementById("clienteModalOverlay").classList.remove("show");
    clienteEditandoId = null;
}

async function guardarCliente() {
    const nombre = document.getElementById("clienteModalNombre").value.trim();
    if (!nombre) {
        showNotif("Campo requerido", "El nombre del cliente es obligatorio.");
        return;
    }

    const data = {
        nombre,
        tipoPersona: document.getElementById("clienteModalTipo").value || "natural",
        nit: document.getElementById("clienteModalNit").value.trim(),
        negocio: document.getElementById("clienteModalNegocio").value.trim(),
        telefono: document.getElementById("clienteModalTelefono").value.trim(),
        direccion: document.getElementById("clienteModalDireccion").value.trim(),
        ciudad: document.getElementById("clienteModalCiudad").value.trim(),
        fechaCreacion: clienteEditandoId ? undefined : new Date().toISOString()
    };

    // Remover undefined
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

    const id = clienteEditandoId || nombre.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now().toString(36);

    try {
        if (clienteEditandoId) {
            const ref = doc(db, "clientes", id);
            const snap = await getDoc(ref);
            if (snap.exists()) {
                await setDoc(ref, { ...snap.data(), ...data });
            }
        } else {
            data.fechaCreacion = new Date().toISOString();
            await setDoc(doc(db, "clientes", id), data);
        }
        cerrarModalCliente();
        cargarClientes();
    } catch (err) {
        console.error("Error guardando cliente:", err);
        showNotif("Error", "No se pudo guardar el cliente.");
    }
}

async function cargarClientes() {
    try {
        const snap = await getDocs(collection(db, "clientes"));
        clientesDB = [];
        snap.forEach(d => clientesDB.push({ id: d.id, ...d.data() }));
        clientesDB.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
        renderTablaClientes("");
        actualizarSelectClientes();
    } catch (err) {
        console.error("Error cargando clientes:", err);
    }
}

function actualizarSelectClientes() {
    const select = document.getElementById("cotClienteSelect");
    if (!select) return;
    const filtroTipo = document.getElementById("cotClienteFiltroTipo");
    const tipoSel = filtroTipo ? filtroTipo.value : "";
    const valorActual = select.value;
    select.innerHTML = '<option value="">-- Nuevo cliente --</option>';
    clientesDB
        .filter(c => !tipoSel || (c.tipoPersona || "natural") === tipoSel)
        .forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.id;
            const tipoTxt = (c.tipoPersona || "natural") === "juridica" ? "Juridica" : "Natural";
            opt.textContent = c.nombre + (c.negocio ? " - " + c.negocio : "") + " (" + tipoTxt + ")";
            select.appendChild(opt);
        });
    // Mantener el valor si sigue disponible en la lista filtrada
    if ([...select.options].some(o => o.value === valorActual)) {
        select.value = valorActual;
    } else {
        select.value = "";
    }
}

function renderTablaClientes(busqueda) {
    const tbody = document.getElementById("clientesTablaBody");
    const filtroTipo = document.getElementById("clientesFiltroTipo");
    const tipoSel = filtroTipo ? filtroTipo.value : "";
    let filtrados = clientesDB;

    if (tipoSel) {
        filtrados = filtrados.filter(c => (c.tipoPersona || "natural") === tipoSel);
    }

    if (busqueda) {
        filtrados = filtrados.filter(c =>
            (c.nombre || "").toLowerCase().includes(busqueda) ||
            (c.negocio || "").toLowerCase().includes(busqueda) ||
            (c.nit || "").toLowerCase().includes(busqueda) ||
            (c.telefono || "").toLowerCase().includes(busqueda) ||
            (c.ciudad || "").toLowerCase().includes(busqueda)
        );
    }

    if (filtrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="tabla-empty">No se encontraron clientes</td></tr>';
        return;
    }

    tbody.innerHTML = filtrados.map(c => {
        const tipo = c.tipoPersona || "natural";
        const tipoBadge = tipo === "juridica"
            ? '<span class="tipo-persona-badge juridica"><i class="bi bi-building"></i> Juridica</span>'
            : '<span class="tipo-persona-badge natural"><i class="bi bi-person"></i> Natural</span>';
        return `
            <tr>
                <td><strong>${c.nombre || "-"}</strong></td>
                <td>${tipoBadge}</td>
                <td>${c.nit || "-"}</td>
                <td>${c.negocio || "-"}</td>
                <td>${c.telefono || "-"}</td>
                <td>${c.ciudad || "-"}</td>
                <td><span class="clientes-cot-count">${c.cotizaciones || 0}</span></td>
                <td>
                    <div class="clientes-acciones">
                        <button class="btn-icon btn-edit-cliente" data-id="${c.id}"><i class="bi bi-pencil"></i></button>
                        <button class="btn-icon btn-delete-cliente" data-id="${c.id}" data-nombre="${c.nombre}"><i class="bi bi-trash3"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    // Eventos
    tbody.querySelectorAll(".btn-edit-cliente").forEach(btn => {
        btn.addEventListener("click", () => {
            const cliente = clientesDB.find(c => c.id === btn.dataset.id);
            if (cliente) abrirModalCliente(cliente);
        });
    });

    tbody.querySelectorAll(".btn-delete-cliente").forEach(btn => {
        btn.addEventListener("click", () => {
            showConfirm("Eliminar cliente", `¿Eliminar a "${btn.dataset.nombre}"? Esta accion no se puede deshacer.`, async () => {
                await deleteDoc(doc(db, "clientes", btn.dataset.id));
                cargarClientes();
            });
        });
    });
}

// Guardar cliente automaticamente al crear cotizacion
async function guardarClienteDesdeCotzacion(datos) {
    if (!datos.cliente) return;
    // Verificar si ya existe
    const existe = clientesDB.find(c =>
        c.nombre.toLowerCase() === datos.cliente.toLowerCase() &&
        (c.nit || "") === (datos.nit || "")
    );
    if (existe) {
        // Actualizar cotizaciones count
        const ref = doc(db, "clientes", existe.id);
        await setDoc(ref, { ...existe, cotizaciones: (existe.cotizaciones || 0) + 1 });
        return;
    }
    // Crear nuevo
    const id = datos.cliente.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now().toString(36);
    await setDoc(doc(db, "clientes", id), {
        nombre: datos.cliente,
        tipoPersona: datos.tipoPersona || "natural",
        nit: datos.nit || "",
        negocio: datos.negocio || "",
        telefono: datos.telefono || "",
        direccion: datos.direccion || "",
        ciudad: datos.ciudad || "",
        cotizaciones: 1,
        fechaCreacion: new Date().toISOString()
    });
    // Recargar
    await cargarClientes();
}

// ===== SECCION INVENTARIO GUILLOTINA (carton) =====
let inventarioDB = [];
let inventarioEditandoId = null;
let inventarioPliegosOriginal = 0; // pliegos antes de editar (para registrar ajuste manual)
let movimientosDB = [];
let movimientosCargados = false;

function setupInventario() {
    const overlay = document.getElementById("inventarioModalOverlay");
    const btnClose = document.getElementById("inventarioModalClose");
    const btnCancel = document.getElementById("inventarioModalCancel");
    const btnSave = document.getElementById("inventarioModalSave");
    const btnNuevo = document.getElementById("btnNuevoInventario");
    const buscarInput = document.getElementById("inventarioBuscar");

    if (btnNuevo) btnNuevo.addEventListener("click", () => abrirModalInventario());
    if (btnClose) btnClose.addEventListener("click", cerrarModalInventario);
    if (btnCancel) btnCancel.addEventListener("click", cerrarModalInventario);
    if (overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrarModalInventario(); });
    if (btnSave) btnSave.addEventListener("click", guardarInventario);

    if (buscarInput) {
        buscarInput.addEventListener("input", () => {
            renderTablaInventario(buscarInput.value.trim().toLowerCase());
        });
    }

    // Tabs de la seccion inventario (Existencias / Movimientos / Analisis)
    const tabBar = document.getElementById("inventarioTabBar");
    if (tabBar) {
        tabBar.querySelectorAll(".tab-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                if (btn.dataset.tab === "invMovimientos") cargarMovimientos();
                if (btn.dataset.tab === "invAnalisis") renderAnalisisInventario();
            });
        });
    }

    const movBuscar = document.getElementById("invMovBuscar");
    const movTipo = document.getElementById("invMovTipo");
    const movUsuario = document.getElementById("invMovUsuario");
    const movArea = document.getElementById("invMovArea");
    const movOrden = document.getElementById("invMovOrden");
    const movCarton = document.getElementById("invMovCarton");
    if (movBuscar) movBuscar.addEventListener("input", renderTablaMovimientos);
    if (movTipo) movTipo.addEventListener("change", renderTablaMovimientos);
    if (movUsuario) movUsuario.addEventListener("change", renderTablaMovimientos);
    if (movArea) movArea.addEventListener("change", renderTablaMovimientos);
    if (movOrden) movOrden.addEventListener("change", renderTablaMovimientos);
    if (movCarton) movCarton.addEventListener("change", renderTablaMovimientos);

    const btnLimpiar = document.getElementById("btnLimpiarFiltrosMov");
    if (btnLimpiar) btnLimpiar.addEventListener("click", limpiarFiltrosMovimientos);

    const periodoSel = document.getElementById("invAnalisisPeriodo");
    if (periodoSel) periodoSel.addEventListener("change", renderAnalisisInventario);
}

function abrirModalInventario(item) {
    inventarioEditandoId = item ? item.id : null;
    inventarioPliegosOriginal = item ? (Number(item.pliegos) || 0) : 0;
    document.getElementById("inventarioModalTitle").textContent = item ? "Editar Cartón" : "Agregar Cartón";
    document.getElementById("inventarioModalSave").innerHTML = item
        ? '<i class="bi bi-check-lg"></i> Guardar cambios'
        : '<i class="bi bi-check-lg"></i> Guardar cartón';

    document.getElementById("inventarioModalTipo").value = item ? item.tipo || "" : "";
    document.getElementById("inventarioModalTamano").value = item ? item.tamano || "" : "";
    document.getElementById("inventarioModalPliegos").value = item ? (item.pliegos ?? "") : "";
    document.getElementById("inventarioModalCosto").value = item ? (item.costo ?? "") : "";
    document.getElementById("inventarioModalMinimo").value = item ? (item.minimo ?? "") : "";
    document.getElementById("inventarioModalNotas").value = item ? item.notas || "" : "";

    // Sugerencias de tipos ya existentes
    const datalist = document.getElementById("inventarioTiposList");
    if (datalist) {
        const tipos = [...new Set(inventarioDB.map(i => i.tipo).filter(Boolean))];
        datalist.innerHTML = tipos.map(t => `<option value="${t}"></option>`).join("");
    }

    document.getElementById("inventarioModalOverlay").classList.add("show");
    setTimeout(() => document.getElementById("inventarioModalTipo").focus(), 100);
}

function cerrarModalInventario() {
    document.getElementById("inventarioModalOverlay").classList.remove("show");
    inventarioEditandoId = null;
}

let inventarioGuardando = false;

async function guardarInventario() {
    // Evitar doble creacion por doble clic mientras se guarda
    if (inventarioGuardando) return;

    const tipo = document.getElementById("inventarioModalTipo").value.trim();
    const tamano = document.getElementById("inventarioModalTamano").value.trim();
    const pliegosRaw = document.getElementById("inventarioModalPliegos").value.trim();
    const costoRaw = document.getElementById("inventarioModalCosto").value.trim();
    const minimoRaw = document.getElementById("inventarioModalMinimo").value.trim();
    const notas = document.getElementById("inventarioModalNotas").value.trim();

    if (!tipo || !tamano || pliegosRaw === "") {
        showNotif("Campos requeridos", "Completa tipo de cartón, tamaño y cantidad de pliegos.");
        return;
    }

    const pliegos = parseInt(pliegosRaw, 10);
    if (isNaN(pliegos) || pliegos < 0) {
        showNotif("Cantidad invalida", "La cantidad de pliegos debe ser un numero mayor o igual a 0.");
        return;
    }

    const costo = costoRaw === "" ? 0 : (parseFloat(costoRaw) || 0);
    const minimo = minimoRaw === "" ? 10 : (parseInt(minimoRaw, 10) || 0);

    const data = {
        tipo, tamano, pliegos, costo, minimo, notas,
        actualizadoPor: sessionStorage.getItem("userName") || "",
        fechaActualizacion: new Date().toISOString()
    };

    const id = inventarioEditandoId
        || (tipo + "-" + tamano).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now().toString(36);

    // Bloquear boton y marcar en curso
    inventarioGuardando = true;
    const btnSave = document.getElementById("inventarioModalSave");
    const btnHtml = btnSave ? btnSave.innerHTML : "";
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Guardando...';
    }

    try {
        if (inventarioEditandoId) {
            const ref = doc(db, "inventarioCarton", id);
            const snap = await getDoc(ref);
            data.fechaCreacion = snap.exists() ? (snap.data().fechaCreacion || data.fechaActualizacion) : data.fechaActualizacion;
        } else {
            data.fechaCreacion = data.fechaActualizacion;
        }
        await setDoc(doc(db, "inventarioCarton", id), data);

        // Registrar movimiento de trazabilidad
        const diff = pliegos - inventarioPliegosOriginal;
        if (!inventarioEditandoId) {
            // Alta de carton nuevo = entrada inicial
            if (pliegos > 0) {
                await registrarMovimientoInventario({
                    tipoMov: "entrada", cartonId: id, cartonTipo: tipo, cartonTamano: tamano,
                    pliegos, costoUnit: costo, motivo: "Alta de cartón en inventario"
                });
            }
        } else if (diff !== 0) {
            // Ajuste manual de stock (entrada si sube, ajuste si baja)
            await registrarMovimientoInventario({
                tipoMov: diff > 0 ? "entrada" : "ajuste", cartonId: id, cartonTipo: tipo, cartonTamano: tamano,
                pliegos: Math.abs(diff), costoUnit: costo,
                motivo: diff > 0 ? "Reposición / ajuste manual (+)" : "Ajuste manual de stock (-)"
            });
        }

        cerrarModalInventario();
        movimientosCargados = false;
        cargarInventario();
    } catch (err) {
        console.error("Error guardando inventario:", err);
        showNotif("Error", "No se pudo guardar el cartón.");
    } finally {
        inventarioGuardando = false;
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = btnHtml || '<i class="bi bi-check-lg"></i> Guardar cartón';
        }
    }
}

async function cargarInventario() {
    try {
        const snap = await getDocs(collection(db, "inventarioCarton"));
        inventarioDB = [];
        snap.forEach(d => inventarioDB.push({ id: d.id, ...d.data() }));
        inventarioDB.sort((a, b) =>
            (a.tipo || "").localeCompare(b.tipo || "") || (a.tamano || "").localeCompare(b.tamano || "")
        );
        const buscar = document.getElementById("inventarioBuscar");
        renderTablaInventario(buscar ? buscar.value.trim().toLowerCase() : "");
    } catch (err) {
        console.error("Error cargando inventario:", err);
    }
}

function renderResumenInventario() {
    const cont = document.getElementById("inventarioResumen");
    if (!cont) return;
    const totalPliegos = inventarioDB.reduce((s, i) => s + (Number(i.pliegos) || 0), 0);
    const totalTipos = new Set(inventarioDB.map(i => i.tipo).filter(Boolean)).size;
    const valorTotal = inventarioDB.reduce((s, i) => s + (Number(i.pliegos) || 0) * (Number(i.costo) || 0), 0);
    const bajoStock = inventarioDB.filter(i => (Number(i.pliegos) || 0) <= (i.minimo != null ? Number(i.minimo) : 10)).length;
    cont.innerHTML = `
        <div class="inventario-stat">
            <span class="inventario-stat-num">${totalPliegos.toLocaleString("es-CO")}</span>
            <span class="inventario-stat-label"><i class="bi bi-layers"></i> Pliegos en total</span>
        </div>
        <div class="inventario-stat">
            <span class="inventario-stat-num">${formatMoney(valorTotal)}</span>
            <span class="inventario-stat-label"><i class="bi bi-cash-stack"></i> Valor del inventario</span>
        </div>
        <div class="inventario-stat">
            <span class="inventario-stat-num">${totalTipos}</span>
            <span class="inventario-stat-label"><i class="bi bi-tags"></i> Tipos de cartón</span>
        </div>
        <div class="inventario-stat${bajoStock > 0 ? ' inventario-stat-alerta' : ''}">
            <span class="inventario-stat-num">${bajoStock}</span>
            <span class="inventario-stat-label"><i class="bi bi-exclamation-triangle"></i> Bajo stock</span>
        </div>
    `;
}

function renderTablaInventario(busqueda) {
    renderResumenInventario();
    const tbody = document.getElementById("inventarioTablaBody");
    if (!tbody) return;

    let filtrados = inventarioDB;
    if (busqueda) {
        filtrados = filtrados.filter(i =>
            (i.tipo || "").toLowerCase().includes(busqueda) ||
            (i.tamano || "").toLowerCase().includes(busqueda) ||
            (i.notas || "").toLowerCase().includes(busqueda)
        );
    }

    if (filtrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="tabla-empty">No hay cartón registrado</td></tr>';
        return;
    }

    tbody.innerHTML = filtrados.map(i => {
        const fecha = i.fechaActualizacion
            ? new Date(i.fechaActualizacion).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })
            : "-";
        const pliegos = Number(i.pliegos) || 0;
        const minimo = i.minimo != null ? Number(i.minimo) : 10;
        const costo = Number(i.costo) || 0;
        const valor = pliegos * costo;
        const bajo = pliegos <= minimo ? ' inventario-pliegos-bajo' : '';
        const notasHtml = i.notas ? `<div class="inventario-notas">${i.notas}</div>` : '';
        return `
            <tr>
                <td><strong>${i.tipo || "-"}</strong>${notasHtml}</td>
                <td>${i.tamano || "-"}</td>
                <td><span class="inventario-pliegos-badge${bajo}">${pliegos.toLocaleString("es-CO")}</span></td>
                <td>${costo > 0 ? formatMoney(costo) : "-"}</td>
                <td>${valor > 0 ? formatMoney(valor) : "-"}</td>
                <td>${fecha}</td>
                <td>
                    <div class="clientes-acciones">
                        <button class="btn-icon btn-edit-inventario" data-id="${i.id}"><i class="bi bi-pencil"></i></button>
                        <button class="btn-icon btn-delete-inventario" data-id="${i.id}" data-nombre="${i.tipo} ${i.tamano}"><i class="bi bi-trash3"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    tbody.querySelectorAll(".btn-edit-inventario").forEach(btn => {
        btn.addEventListener("click", () => {
            const item = inventarioDB.find(i => i.id === btn.dataset.id);
            if (item) abrirModalInventario(item);
        });
    });

    tbody.querySelectorAll(".btn-delete-inventario").forEach(btn => {
        btn.addEventListener("click", () => {
            showConfirm("Eliminar cartón", `¿Eliminar "${btn.dataset.nombre}" del inventario? Esta accion no se puede deshacer.`, async () => {
                await deleteDoc(doc(db, "inventarioCarton", btn.dataset.id));
                cargarInventario();
            });
        });
    });
}

// Descuenta pliegos del inventario cuando se usa carton en guillotina.
// Si ya se habia descontado antes (edicion), ajusta solo la diferencia.
// cartonNuevo: { id, pliegos, ... }  cartonPrevio: registro anterior (o undefined)
// orden: datos de trazabilidad { numero, id, cotizacionId, cliente }
async function descontarCartonInventario(cartonNuevo, cartonPrevio, orden) {
    if (!cartonNuevo || !cartonNuevo.id) return;
    try {
        const usarNuevo = Number(cartonNuevo.pliegos) || 0;

        // Si en la edicion previa se uso otro carton distinto, devolver esos pliegos
        if (cartonPrevio && cartonPrevio.id && cartonPrevio.id !== cartonNuevo.id) {
            await ajustarStockCarton(cartonPrevio.id, Number(cartonPrevio.pliegos) || 0); // devolver
            await ajustarStockCarton(cartonNuevo.id, -usarNuevo); // descontar
            await registrarConsumoCarton(cartonNuevo, usarNuevo, orden);
            return;
        }

        // Mismo carton (o primera vez): descontar solo la diferencia
        const usarPrevio = (cartonPrevio && cartonPrevio.id === cartonNuevo.id) ? (Number(cartonPrevio.pliegos) || 0) : 0;
        const delta = usarNuevo - usarPrevio; // positivo = descontar mas
        if (delta !== 0) {
            await ajustarStockCarton(cartonNuevo.id, -delta);
            // Registrar solo el consumo adicional (delta positivo). Si se corrige a la baja, es un ajuste.
            await registrarConsumoCarton(cartonNuevo, delta, orden);
        }
    } catch (err) {
        console.error("Error descontando carton del inventario:", err);
    }
}

// Registra el movimiento de consumo (salida) asociando cliente, orden y usuario.
async function registrarConsumoCarton(carton, pliegos, orden) {
    if (!pliegos) return;
    const item = inventarioDB.find(i => i.id === carton.id);
    const costoUnit = item ? (Number(item.costo) || 0) : 0;
    const positivo = pliegos > 0;
    await registrarMovimientoInventario({
        tipoMov: positivo ? "salida" : "ajuste",
        cartonId: carton.id,
        cartonTipo: carton.tipo || (item ? item.tipo : ""),
        cartonTamano: carton.tamano || (item ? item.tamano : ""),
        pliegos: Math.abs(pliegos),
        costoUnit,
        cliente: orden ? (orden.cliente || "") : "",
        ordenNumero: orden ? (orden.numero || "") : "",
        ordenId: orden ? (orden.id || "") : "",
        cotizacionId: orden ? (orden.cotizacionId || orden.id || "") : "",
        motivo: positivo ? "Consumo en guillotina" : "Corrección de consumo (guillotina)"
    });
}

// Suma (o resta) pliegos al stock de un carton. `cambio` puede ser negativo.
async function ajustarStockCarton(cartonId, cambio) {
    const ref = doc(db, "inventarioCarton", cartonId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    const nuevoStock = Math.max(0, (Number(data.pliegos) || 0) + cambio);
    await setDoc(ref, {
        ...data,
        pliegos: nuevoStock,
        fechaActualizacion: new Date().toISOString(),
        actualizadoPor: sessionStorage.getItem("userName") || data.actualizadoPor || ""
    });
    // Refrescar cache local si el inventario esta cargado
    const local = inventarioDB.find(i => i.id === cartonId);
    if (local) local.pliegos = nuevoStock;
}

// ===== MOVIMIENTOS DE INVENTARIO (trazabilidad de consumo, entradas y ajustes) =====
// Registra un movimiento en la coleccion "inventarioMovimientos".
// mov: { tipoMov: 'salida'|'entrada'|'ajuste', cartonId, cartonTipo, cartonTamano,
//        pliegos, costoUnit, cliente, ordenNumero, ordenId, cotizacionId, motivo }
async function registrarMovimientoInventario(mov) {
    try {
        const costoUnit = Number(mov.costoUnit) || 0;
        const pliegos = Number(mov.pliegos) || 0;
        const registro = {
            tipoMov: mov.tipoMov || "salida",
            cartonId: mov.cartonId || "",
            cartonTipo: mov.cartonTipo || "",
            cartonTamano: mov.cartonTamano || "",
            pliegos,
            costoUnit,
            costoTotal: pliegos * costoUnit,
            cliente: mov.cliente || "",
            ordenNumero: mov.ordenNumero || "",
            ordenId: mov.ordenId || "",
            cotizacionId: mov.cotizacionId || "",
            motivo: mov.motivo || "",
            usuario: sessionStorage.getItem("userName") || "",
            usuarioRol: sessionStorage.getItem("userRol") || "",
            fecha: new Date().toISOString()
        };
        const movId = "mov-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
        await setDoc(doc(db, "inventarioMovimientos", movId), registro);
        movimientosCargados = false;
    } catch (err) {
        console.error("Error registrando movimiento de inventario:", err);
    }
}

async function cargarMovimientos(force) {
    if (movimientosCargados && !force) { renderTablaMovimientos(); return; }
    const tbody = document.getElementById("invMovTablaBody");
    try {
        const snap = await getDocs(collection(db, "inventarioMovimientos"));
        movimientosDB = [];
        snap.forEach(d => movimientosDB.push({ id: d.id, ...d.data() }));
        movimientosDB.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
        movimientosCargados = true;
        poblarFiltrosMovimientos();
        renderTablaMovimientos();
    } catch (err) {
        console.error("Error cargando movimientos:", err);
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="tabla-empty">No se pudieron cargar los movimientos</td></tr>';
    }
}

const MOV_META = {
    salida:  { label: "Consumo",  icon: "bi-arrow-up-right", clase: "mov-salida" },
    entrada: { label: "Entrada",  icon: "bi-arrow-down-left", clase: "mov-entrada" },
    ajuste:  { label: "Ajuste",   icon: "bi-sliders", clase: "mov-ajuste" }
};

// Etiquetas legibles para las areas/roles de trabajo
const AREA_LABELS = {
    administrador: "Administrador", guillotina: "Guillotina", impresion: "Impresión",
    troquelado: "Troquelado", vasos: "Vasos", empaques: "Empaques",
    digital: "Digital", imprenta: "Imprenta", diseno: "Diseño",
    ventas: "Ventas", ordenes: "Órdenes"
};
const areaLabel = (rol) => AREA_LABELS[rol] || (rol || "Sin área");

// Rellena los selects de usuario, area, orden y carton con los valores presentes
// en los movimientos, conservando la seleccion actual.
function poblarFiltrosMovimientos() {
    const setOpts = (id, valores, placeholder) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const prev = sel.value;
        const opts = valores
            .filter(v => v.val !== "" && v.val != null)
            .sort((a, b) => a.label.localeCompare(b.label))
            .map(v => `<option value="${v.val}">${v.label}</option>`).join("");
        sel.innerHTML = `<option value="">${placeholder}</option>` + opts;
        if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    };

    const usuarios = [...new Set(movimientosDB.map(m => m.usuario).filter(Boolean))]
        .map(u => ({ val: u, label: u }));
    const areas = [...new Set(movimientosDB.map(m => m.usuarioRol).filter(Boolean))]
        .map(a => ({ val: a, label: areaLabel(a) }));
    // Cartones: distinguir por tipo + tamaño. El valor combina ambos con "||".
    const cartonMap = {};
    movimientosDB.forEach(m => {
        if (!m.cartonTipo) return;
        const val = (m.cartonTipo || "") + "||" + (m.cartonTamano || "");
        if (!cartonMap[val]) {
            cartonMap[val] = m.cartonTipo + (m.cartonTamano ? " · " + m.cartonTamano : "");
        }
    });
    const cartones = Object.entries(cartonMap).map(([val, label]) => ({ val, label }));

    // Ordenes: usar ordenId como valor y el numero (+cliente) como etiqueta
    const ordenMap = {};
    movimientosDB.forEach(m => {
        const key = m.ordenId || m.ordenNumero;
        if (key && !ordenMap[key]) {
            ordenMap[key] = "Orden " + (m.ordenNumero || key) + (m.cliente ? " · " + m.cliente : "");
        }
    });
    const ordenes = Object.entries(ordenMap).map(([val, label]) => ({ val, label }));

    setOpts("invMovUsuario", usuarios, "Todos los usuarios");
    setOpts("invMovArea", areas, "Todas las áreas");
    setOpts("invMovOrden", ordenes, "Todas las órdenes");
    setOpts("invMovCarton", cartones, "Todos los cartones");
}

function limpiarFiltrosMovimientos() {
    ["invMovBuscar", "invMovTipo", "invMovUsuario", "invMovArea", "invMovOrden", "invMovCarton"]
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    renderTablaMovimientos();
}

function renderTablaMovimientos() {
    const tbody = document.getElementById("invMovTablaBody");
    if (!tbody) return;

    const busqueda = (document.getElementById("invMovBuscar")?.value || "").trim().toLowerCase();
    const tipoFiltro = document.getElementById("invMovTipo")?.value || "";
    const usuarioFiltro = document.getElementById("invMovUsuario")?.value || "";
    const areaFiltro = document.getElementById("invMovArea")?.value || "";
    const ordenFiltro = document.getElementById("invMovOrden")?.value || "";
    const cartonFiltro = document.getElementById("invMovCarton")?.value || "";

    let lista = movimientosDB.slice();
    if (tipoFiltro) lista = lista.filter(m => m.tipoMov === tipoFiltro);
    if (usuarioFiltro) lista = lista.filter(m => m.usuario === usuarioFiltro);
    if (areaFiltro) lista = lista.filter(m => m.usuarioRol === areaFiltro);
    if (ordenFiltro) lista = lista.filter(m => (m.ordenId || m.ordenNumero) === ordenFiltro);
    if (cartonFiltro) lista = lista.filter(m => ((m.cartonTipo || "") + "||" + (m.cartonTamano || "")) === cartonFiltro);
    if (busqueda) {
        lista = lista.filter(m =>
            (m.cliente || "").toLowerCase().includes(busqueda) ||
            (m.ordenNumero || "").toLowerCase().includes(busqueda) ||
            (m.cartonTipo || "").toLowerCase().includes(busqueda) ||
            (m.cartonTamano || "").toLowerCase().includes(busqueda) ||
            (m.usuario || "").toLowerCase().includes(busqueda) ||
            (m.motivo || "").toLowerCase().includes(busqueda)
        );
    }

    renderResumenFiltroMov(lista);

    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="tabla-empty">No hay movimientos que coincidan con los filtros</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(m => {
        const meta = MOV_META[m.tipoMov] || MOV_META.salida;
        const fecha = m.fecha
            ? new Date(m.fecha).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "-";
        const signo = m.tipoMov === "entrada" ? "+" : "−";
        const pliegos = Number(m.pliegos) || 0;
        const clienteOrden = m.cliente || m.ordenNumero
            ? `<strong>${m.cliente || "-"}</strong>${m.ordenNumero ? `<div class="inventario-notas">Orden ${m.ordenNumero}</div>` : ""}`
            : `<span class="inv-mov-motivo">${m.motivo || "-"}</span>`;
        const costo = Number(m.costoTotal) || 0;
        return `
            <tr>
                <td>${fecha}</td>
                <td><span class="inv-mov-badge ${meta.clase}"><i class="bi ${meta.icon}"></i> ${meta.label}</span></td>
                <td><strong>${m.cartonTipo || "-"}</strong><div class="inventario-notas">${m.cartonTamano || ""}</div></td>
                <td><span class="inv-mov-pliegos ${meta.clase}">${signo}${pliegos.toLocaleString("es-CO")}</span></td>
                <td>${clienteOrden}</td>
                <td>${m.usuario || "-"}${m.usuarioRol ? `<div class="inventario-notas">${areaLabel(m.usuarioRol)}</div>` : ""}</td>
                <td>${costo > 0 ? formatMoney(costo) : "-"}</td>
            </tr>
        `;
    }).join("");
}

// Muestra un resumen de lo filtrado: total de movimientos, pliegos y costo.
function renderResumenFiltroMov(lista) {
    const cont = document.getElementById("invMovResumenFiltro");
    if (!cont) return;

    const hayFiltro = ["invMovBuscar", "invMovTipo", "invMovUsuario", "invMovArea", "invMovOrden", "invMovCarton"]
        .some(id => (document.getElementById(id)?.value || "") !== "");

    if (!hayFiltro) { cont.style.display = "none"; return; }

    const totalPliegos = lista.reduce((s, m) => {
        const p = Number(m.pliegos) || 0;
        return s + (m.tipoMov === "entrada" ? 0 : p); // solo cuenta consumo/ajuste como salida
    }, 0);
    const totalCosto = lista.filter(m => m.tipoMov !== "entrada").reduce((s, m) => s + (Number(m.costoTotal) || 0), 0);

    cont.style.display = "";
    cont.innerHTML = `
        <span><i class="bi bi-funnel"></i> <strong>${lista.length}</strong> movimiento(s)</span>
        <span><i class="bi bi-layers"></i> <strong>${totalPliegos.toLocaleString("es-CO")}</strong> pliegos consumidos</span>
        <span><i class="bi bi-cash-coin"></i> <strong>${formatMoney(totalCosto)}</strong> en consumo</span>
    `;
}

// ===== ANALISIS Y GASTOS DE INVENTARIO =====
async function renderAnalisisInventario() {
    const grid = document.getElementById("invAnalisisGrid");
    if (!grid) return;
    grid.innerHTML = '<div class="inv-analisis-loading">Calculando...</div>';

    if (!movimientosCargados) await cargarMovimientos();

    const dias = parseInt(document.getElementById("invAnalisisPeriodo")?.value || "30", 10);
    const desde = dias > 0 ? Date.now() - dias * 24 * 60 * 60 * 1000 : 0;

    const enRango = movimientosDB.filter(m => {
        const t = m.fecha ? new Date(m.fecha).getTime() : 0;
        return t >= desde;
    });

    const salidas = enRango.filter(m => m.tipoMov === "salida");
    const entradas = enRango.filter(m => m.tipoMov === "entrada");

    const pliegosConsumidos = salidas.reduce((s, m) => s + (Number(m.pliegos) || 0), 0);
    const gastoConsumo = salidas.reduce((s, m) => s + (Number(m.costoTotal) || 0), 0);
    const gastoEntradas = entradas.reduce((s, m) => s + (Number(m.costoTotal) || 0), 0);

    // Ranking por cliente (consumo)
    const porCliente = {};
    salidas.forEach(m => {
        const k = m.cliente || "Sin cliente";
        if (!porCliente[k]) porCliente[k] = { pliegos: 0, costo: 0 };
        porCliente[k].pliegos += Number(m.pliegos) || 0;
        porCliente[k].costo += Number(m.costoTotal) || 0;
    });
    const rankingClientes = Object.entries(porCliente)
        .sort((a, b) => b[1].pliegos - a[1].pliegos).slice(0, 6);

    // Ranking por tipo + tamaño de carton (para distinguir mismo tipo con distintos tamaños)
    const porTipo = {};
    salidas.forEach(m => {
        const tipo = m.cartonTipo || "Sin tipo";
        const tam = m.cartonTamano ? " · " + m.cartonTamano : "";
        const k = tipo + tam;
        porTipo[k] = (porTipo[k] || 0) + (Number(m.pliegos) || 0);
    });
    const rankingTipos = Object.entries(porTipo)
        .sort((a, b) => b[1] - a[1]).slice(0, 8);

    // Consumo por usuario
    const porUsuario = {};
    salidas.forEach(m => {
        const k = m.usuario || "Desconocido";
        porUsuario[k] = (porUsuario[k] || 0) + (Number(m.pliegos) || 0);
    });
    const rankingUsuarios = Object.entries(porUsuario)
        .sort((a, b) => b[1] - a[1]).slice(0, 6);

    const maxCliente = rankingClientes.length ? rankingClientes[0][1].pliegos : 0;
    const maxTipo = rankingTipos.length ? rankingTipos[0][1] : 0;
    const maxUsuario = rankingUsuarios.length ? rankingUsuarios[0][1] : 0;

    const barra = (val, max) => `<div class="inv-bar-track"><div class="inv-bar-fill" style="width:${max > 0 ? Math.round(val / max * 100) : 0}%"></div></div>`;

    const listaRanking = (items, max, fmt) => items.length
        ? items.map(([nombre, val]) => {
            const num = typeof val === "object" ? val.pliegos : val;
            const extra = typeof val === "object" && val.costo ? `<span class="inv-rank-extra">${formatMoney(val.costo)}</span>` : "";
            return `
                <div class="inv-rank-row">
                    <div class="inv-rank-head"><span class="inv-rank-name">${nombre}</span><span class="inv-rank-val">${num.toLocaleString("es-CO")} pl. ${extra}</span></div>
                    ${barra(num, max)}
                </div>`;
        }).join("")
        : '<div class="inv-analisis-empty">Sin datos en el periodo</div>';

    grid.innerHTML = `
        <div class="inv-kpi-row">
            <div class="inv-kpi">
                <span class="inv-kpi-label"><i class="bi bi-layers"></i> Pliegos consumidos</span>
                <span class="inv-kpi-num">${pliegosConsumidos.toLocaleString("es-CO")}</span>
            </div>
            <div class="inv-kpi inv-kpi-gasto">
                <span class="inv-kpi-label"><i class="bi bi-cash-coin"></i> Gasto en consumo</span>
                <span class="inv-kpi-num">${formatMoney(gastoConsumo)}</span>
            </div>
            <div class="inv-kpi">
                <span class="inv-kpi-label"><i class="bi bi-box-arrow-in-down"></i> Invertido en compras</span>
                <span class="inv-kpi-num">${formatMoney(gastoEntradas)}</span>
            </div>
            <div class="inv-kpi">
                <span class="inv-kpi-label"><i class="bi bi-arrow-left-right"></i> Movimientos</span>
                <span class="inv-kpi-num">${enRango.length.toLocaleString("es-CO")}</span>
            </div>
        </div>
        <div class="inv-analisis-cards">
            <div class="inv-analisis-card">
                <h4><i class="bi bi-people"></i> Consumo por cliente</h4>
                ${listaRanking(rankingClientes, maxCliente)}
            </div>
            <div class="inv-analisis-card">
                <h4><i class="bi bi-tags"></i> Consumo por cartón y tamaño</h4>
                ${listaRanking(rankingTipos, maxTipo)}
            </div>
            <div class="inv-analisis-card">
                <h4><i class="bi bi-person-badge"></i> Consumo por usuario</h4>
                ${listaRanking(rankingUsuarios, maxUsuario)}
            </div>
        </div>
    `;
}

// ===== SECCIÓN CATÁLOGO ADMIN =====
const IMGBB_KEY_ADMIN = "8813d73253a289aa90712058a3a81bc9";

const CATEGORIAS_CATALOGO = [
    "Comidas Principales",
    "Completos y Compartidos",
    "Street Food",
    "Snacks y Acompañamientos",
    "Exhibicion y Servicio",
    "Vasos",
    "Otros"
];

let catAdminActiva = "Comidas Principales";
let catAdminProductos = {};  // { categoria: [...productos] }
let catProdEditando = null;  // producto en edición

function setupCatalogoAdmin() {
    cargarCatalogoAdmin();

    document.getElementById("btnCatAgregarProducto").addEventListener("click", () => {
        abrirModalCatProducto(null);
    });

    document.getElementById("catProductoModalClose").addEventListener("click", cerrarModalCatProducto);
    document.getElementById("catProductoModalCancel").addEventListener("click", cerrarModalCatProducto);
    document.getElementById("catProductoModal").addEventListener("click", (e) => {
        if (e.target === document.getElementById("catProductoModal")) cerrarModalCatProducto();
    });

    document.getElementById("catImgUploadArea").addEventListener("click", () => {
        document.getElementById("catProdImgInput").click();
    });

    // Toggle descuento
    document.getElementById("catProdDescuento").addEventListener("change", (e) => {
        document.getElementById("catDescuentoPctWrap").style.display = e.target.checked ? "flex" : "none";
        if (!e.target.checked) document.getElementById("catProdDescuentoPct").value = "";
    });

    document.getElementById("catProdImgInput").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const preview = document.getElementById("catImgPreview");
        preview.innerHTML = '<i class="bi bi-arrow-repeat" style="animation:spin .7s linear infinite"></i><span>Subiendo...</span>';
        try {
            const b64 = await fileToBase64(file);
            const form = new FormData();
            form.append("key", IMGBB_KEY_ADMIN);
            form.append("image", b64.split(",")[1]);
            const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: form });
            const data = await res.json();
            if (data.success) {
                document.getElementById("catProdImagenUrl").value = data.data.url;
                preview.innerHTML = `<img src="${data.data.url}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
            } else {
                preview.innerHTML = '<i class="bi bi-x-circle" style="color:#ef4444"></i><span>Error al subir</span>';
            }
        } catch {
            preview.innerHTML = '<i class="bi bi-x-circle" style="color:#ef4444"></i><span>Error</span>';
        }
    });

    document.getElementById("catTierAgregar").addEventListener("click", () => agregarFilaTier());

    document.getElementById("catProductoModalSave").addEventListener("click", guardarCatProducto);
}

// ===== ESCALAS DE PRECIO POR CANTIDAD (catalogo) =====
// Cada fila es { min, precio }: a partir de "min" unidades, el valor unitario
// pasa a ser "precio". Se guarda ordenado y sin filas vacias.
function agregarFilaTier(min = "", precio = "") {
    const cont = document.getElementById("catTiersLista");
    const fila = document.createElement("div");
    fila.className = "cat-tier-fila";
    fila.innerHTML = `
        <span class="cat-tier-label">Desde</span>
        <input type="number" class="form-input cat-tier-min" min="1" step="1" placeholder="500" value="${min}">
        <span class="cat-tier-label">und a</span>
        <input type="number" class="form-input cat-tier-precio" min="0" step="1" placeholder="900" value="${precio}">
        <span class="cat-tier-label">c/u</span>
        <button type="button" class="btn-icon btn-delete cat-tier-quitar" title="Quitar escala">
            <i class="bi bi-x-lg"></i>
        </button>`;
    fila.querySelector(".cat-tier-quitar").addEventListener("click", () => fila.remove());
    cont.appendChild(fila);
}

function leerTiersFormulario() {
    return [...document.querySelectorAll("#catTiersLista .cat-tier-fila")]
        .map(f => ({
            min: parseInt(f.querySelector(".cat-tier-min").value) || 0,
            precio: parseInt(f.querySelector(".cat-tier-precio").value) || 0
        }))
        .filter(t => t.min > 0 && t.precio > 0)
        .sort((a, b) => a.min - b.min);
}

function fileToBase64(file) {
    return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
    });
}

async function cargarCatalogoAdmin() {
    catAdminProductos = {};
    const snap = await getDocs(collection(db, "catalogo"));

    if (snap.empty) {
        // Primera carga: poblar desde datos locales
        await poblarCatalogoDesdeLocal();
        return cargarCatalogoAdmin();
    }

    snap.forEach(d => {
        const data = d.data();
        if (!catAdminProductos[data.categoria]) catAdminProductos[data.categoria] = [];
        catAdminProductos[data.categoria].push({ firestoreId: d.id, ...data });
    });

    for (const cat of Object.keys(catAdminProductos)) {
        catAdminProductos[cat].sort((a, b) => (a.orden || 0) - (b.orden || 0));
    }

    renderCatAdminTabs();
    renderCatAdminGrid();
}

async function poblarCatalogoDesdeLocal() {
    for (const [categoria, info] of Object.entries(CATALOGO_DATA)) {
        for (const producto of info.productos) {
            const docId = categoria.replace(/\s+/g, "_") + "_" + producto.id;
            await setDoc(doc(db, "catalogo", docId), {
                categoria,
                icon: info.icon,
                descripcion: info.descripcion,
                usos: info.usos,
                orden: producto.id,
                nombre: producto.nombre,
                alto: producto.alto,
                largo: producto.largo,
                ancho: producto.ancho,
                imagen: producto.imagen,
                // El precio se define despues desde el panel
                precio: 0,
                tiers: []
            });
        }
    }
}

function renderCatAdminTabs() {
    const tabs = document.getElementById("catAdminTabs");
    if (!tabs) return;
    tabs.innerHTML = "";
    CATEGORIAS_CATALOGO.forEach(cat => {
        const btn = document.createElement("button");
        btn.className = "cat-admin-tab" + (cat === catAdminActiva ? " active" : "");
        const info = CATALOGO_DATA[cat] || {};
        btn.innerHTML = `<i class="bi ${info.icon || 'bi-box'}"></i> ${cat}`;
        btn.addEventListener("click", () => {
            catAdminActiva = cat;
            renderCatAdminTabs();
            renderCatAdminGrid();
        });
        tabs.appendChild(btn);
    });
}

function renderCatAdminGrid() {
    const header = document.getElementById("catAdminCatHeader");
    const grid = document.getElementById("catAdminGrid");
    if (!grid) return;

    const info = CATALOGO_DATA[catAdminActiva] || {};
    if (header) {
        header.innerHTML = `
            <p class="cat-admin-desc">${info.descripcion || ""}</p>
            <p class="cat-admin-usos"><i class="bi bi-lightbulb"></i> ${info.usos || ""}</p>
        `;
    }

    const productos = catAdminProductos[catAdminActiva] || [];
    grid.innerHTML = "";

    productos.forEach(prod => {
        const card = document.createElement("div");
        card.className = "cat-admin-card";
        const medidas = (prod.alto && prod.alto !== "-")
            ? `<span class="cat-admin-medidas">A: ${prod.alto} · L: ${prod.largo} · An: ${prod.ancho}</span>`
            : "";
        const descBadge = prod.descuento
            ? `<span class="cat-admin-descuento-badge">-${prod.descuentoPct}%</span>`
            : "";
        const nTiers = Array.isArray(prod.tiers) ? prod.tiers.length : 0;
        const precioTxt = prod.precio > 0
            ? `<span class="cat-admin-precio">$${Number(prod.precio).toLocaleString("es-CO")} c/u${nTiers ? ` · ${nTiers} escala(s)` : ""}</span>`
            : `<span class="cat-admin-precio cat-admin-precio--sin">Sin precio publicado</span>`;
        card.innerHTML = `
            ${descBadge}
            <img src="${prod.imagen}" alt="${prod.nombre}" class="cat-admin-img">
            <div class="cat-admin-card-body">
                <span class="cat-admin-orden">#${prod.orden}</span>
                <span class="cat-admin-nombre">${prod.nombre}</span>
                ${medidas}
                ${precioTxt}
            </div>
            <div class="cat-admin-card-actions">
                <button class="cat-btn-edit" data-id="${prod.firestoreId}"><i class="bi bi-pencil"></i> Editar</button>
                <button class="cat-btn-delete" data-id="${prod.firestoreId}"><i class="bi bi-trash"></i> Eliminar</button>
            </div>
        `;
        card.querySelector(".cat-btn-edit").addEventListener("click", () => abrirModalCatProducto(prod));
        card.querySelector(".cat-btn-delete").addEventListener("click", () => eliminarCatProducto(prod));
        grid.appendChild(card);
    });

    if (productos.length === 0) {
        grid.innerHTML = '<p class="cat-admin-empty">No hay productos en esta categoría.</p>';
    }
}

function abrirModalCatProducto(prod) {
    catProdEditando = prod;
    const modal = document.getElementById("catProductoModal");
    document.getElementById("catProductoModalTitle").textContent = prod ? "Editar producto" : "Agregar producto";
    document.getElementById("catProdFirestoreId").value = prod ? prod.firestoreId : "";
    document.getElementById("catProdNombre").value = prod ? prod.nombre : "";
    document.getElementById("catProdAlto").value = prod ? prod.alto : "";
    document.getElementById("catProdLargo").value = prod ? prod.largo : "";
    document.getElementById("catProdAncho").value = prod ? prod.ancho : "";
    document.getElementById("catProdImagenUrl").value = prod ? prod.imagen : "";
    document.getElementById("catProdPrecio").value = prod && prod.precio ? prod.precio : "";

    // Escalas por cantidad
    const tiersCont = document.getElementById("catTiersLista");
    tiersCont.innerHTML = "";
    if (prod && Array.isArray(prod.tiers)) {
        prod.tiers.forEach(t => agregarFilaTier(t.min || "", t.precio || ""));
    }

    // Descuento
    const descCheck = document.getElementById("catProdDescuento");
    const descPct = document.getElementById("catProdDescuentoPct");
    const descWrap = document.getElementById("catDescuentoPctWrap");
    if (prod && prod.descuento) {
        descCheck.checked = true;
        descPct.value = prod.descuentoPct || "";
        descWrap.style.display = "flex";
    } else {
        descCheck.checked = false;
        descPct.value = "";
        descWrap.style.display = "none";
    }

    const preview = document.getElementById("catImgPreview");
    if (prod && prod.imagen) {
        preview.innerHTML = `<img src="${prod.imagen}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
    } else {
        preview.innerHTML = '<i class="bi bi-cloud-arrow-up"></i><span>Subir imagen</span>';
    }

    modal.classList.add("show");
}

function cerrarModalCatProducto() {
    document.getElementById("catProductoModal").classList.remove("show");
    catProdEditando = null;
}

async function guardarCatProducto() {
    const nombre = document.getElementById("catProdNombre").value.trim();
    const alto   = document.getElementById("catProdAlto").value.trim() || "-";
    const largo  = document.getElementById("catProdLargo").value.trim() || "-";
    const ancho  = document.getElementById("catProdAncho").value.trim() || "-";
    const imagen = document.getElementById("catProdImagenUrl").value.trim();
    const precio = parseInt(document.getElementById("catProdPrecio").value) || 0;
    const tiers  = leerTiersFormulario();
    const descuento = document.getElementById("catProdDescuento").checked;
    const descuentoPct = descuento ? (parseInt(document.getElementById("catProdDescuentoPct").value) || 0) : 0;

    if (!nombre) { alert("El nombre es obligatorio."); return; }
    if (!imagen) { alert("Sube una imagen del producto."); return; }
    if (descuento && descuentoPct <= 0) { alert("Indica el porcentaje de descuento."); return; }

    const btn = document.getElementById("catProductoModalSave");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Guardando...';

    try {
        const cat = catAdminActiva;
        const info = CATALOGO_DATA[cat] || {};
        const existentes = catAdminProductos[cat] || [];

        let firestoreId = catProdEditando ? catProdEditando.firestoreId : null;
        let orden = catProdEditando ? catProdEditando.orden : (existentes.length > 0 ? Math.max(...existentes.map(p => p.orden || 0)) + 1 : 1);

        if (!firestoreId) {
            firestoreId = cat.replace(/\s+/g, "_") + "_" + orden + "_" + Date.now().toString(36);
        }

        await setDoc(doc(db, "catalogo", firestoreId), {
            categoria: cat,
            icon: info.icon || "bi-box",
            descripcion: info.descripcion || "",
            usos: info.usos || "",
            orden,
            nombre,
            alto,
            largo,
            ancho,
            imagen,
            precio,
            tiers,
            descuento,
            descuentoPct
        });

        cerrarModalCatProducto();
        await cargarCatalogoAdmin();
    } catch (err) {
        console.error(err);
        alert("Error al guardar.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg"></i> Guardar';
    }
}

async function eliminarCatProducto(prod) {
    showConfirm("Eliminar producto", `¿Eliminar "${prod.nombre}" del catálogo?`, async () => {
        await deleteDoc(doc(db, "catalogo", prod.firestoreId));
        await cargarCatalogoAdmin();
    });
}

// ===== SISTEMA DE NOTIFICACIONES EN TIEMPO REAL =====
let notifCotizacionesCount = null; // null = no inicializado
let notifOrdenesEstado = null;
let audioCtx = null;

// Desbloquear audio con la primera interacción del usuario
function unlockAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }
}
document.addEventListener("click", unlockAudio, { once: false });
document.addEventListener("keydown", unlockAudio, { once: false });

function playNotifSound() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();

        // Primer beep
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.type = "sine";
        osc1.frequency.value = 880;
        gain1.gain.setValueAtTime(0.4, audioCtx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
        osc1.start(audioCtx.currentTime);
        osc1.stop(audioCtx.currentTime + 0.4);

        // Segundo beep
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.type = "sine";
        osc2.frequency.value = 1200;
        gain2.gain.setValueAtTime(0.4, audioCtx.currentTime + 0.25);
        gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.65);
        osc2.start(audioCtx.currentTime + 0.25);
        osc2.stop(audioCtx.currentTime + 0.65);

        console.log("[NOTIF] Sonido reproducido");
    } catch (e) {
        console.warn("[NOTIF] Error audio:", e);
    }
}

function showNotifToast(message) {
    let container = document.getElementById("notifToastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "notifToastContainer";
        container.style.cssText = "position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.style.cssText = "background:#222;color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,0.25);display:flex;align-items:center;gap:10px;animation:slideInRight 0.3s ease;pointer-events:auto;max-width:320px;";
    toast.innerHTML = `<i class="bi bi-bell-fill" style="color:#29ABE2;font-size:16px;"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.3s";
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

function setupNotificaciones() {
    // Animación CSS
    const styleNotif = document.createElement("style");
    styleNotif.textContent = `@keyframes slideInRight{from{transform:translateX(100px);opacity:0}to{transform:translateX(0);opacity:1}}`;
    document.head.appendChild(styleNotif);

    console.log("[NOTIF] Sistema de notificaciones iniciado");

    // Listener en tiempo real para cotizaciones
    onSnapshot(collection(db, "cotizaciones"), (snapshot) => {
        let cotAprobadas = 0;
        snapshot.forEach(d => {
            const data = d.data();
            if (data.eliminado) return;
            if (data.estado === "aprobada") cotAprobadas++;
        });

        console.log("[NOTIF] Cotizaciones aprobadas:", cotAprobadas, "| anterior:", notifCotizacionesCount);

        if (notifCotizacionesCount !== null && cotAprobadas > notifCotizacionesCount) {
            const diff = cotAprobadas - notifCotizacionesCount;
            playNotifSound();
            showNotifToast(`${diff} nueva${diff > 1 ? "s" : ""} cotización${diff > 1 ? "es" : ""} aprobada${diff > 1 ? "s" : ""}`);
            if (typeof cargarListaCotizaciones === "function") cargarListaCotizaciones();
        }
        notifCotizacionesCount = cotAprobadas;
    });

    // Listener en tiempo real para producción
    onSnapshot(collection(db, "produccion"), (snapshot) => {
        let nuevoEstado = {};
        snapshot.forEach(d => {
            const data = d.data();
            if (data.eliminado) return;
            nuevoEstado[d.id] = data.pasoActual || "recibido";
        });

        console.log("[NOTIF] Producción actualizada, órdenes:", Object.keys(nuevoEstado).length);

        if (notifOrdenesEstado !== null) {
            let hayNueva = false;
            let hayCambio = false;

            for (const id of Object.keys(nuevoEstado)) {
                if (!notifOrdenesEstado[id]) { hayNueva = true; break; }
            }
            if (!hayNueva) {
                for (const id of Object.keys(nuevoEstado)) {
                    if (notifOrdenesEstado[id] && notifOrdenesEstado[id] !== nuevoEstado[id]) { hayCambio = true; break; }
                }
            }

            if (hayNueva) {
                playNotifSound();
                showNotifToast("Nueva orden en producción");
                cargarSeguimiento();
            } else if (hayCambio) {
                playNotifSound();
                showNotifToast("Una orden cambió de estado");
                cargarSeguimiento();
            }
        }
        notifOrdenesEstado = nuevoEstado;
    });
}

// ===== REMISION (Entregas) =====
let remisionFiltro = "todos";
let remisionCache = [];

function setupRemision() {
    const filtros = document.querySelectorAll(".rem-filtro-btn");
    filtros.forEach(btn => {
        btn.addEventListener("click", () => {
            filtros.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            remisionFiltro = btn.dataset.filtro;
            renderRemision();
        });
    });
    // Buscador
    const inputBuscar = document.getElementById("remisionBuscar");
    if (inputBuscar) inputBuscar.addEventListener("input", () => renderRemision());
}

async function cargarRemision() {
    const container = document.getElementById("remisionLista");
    if (!container) return;

    try {
        const snap = await getDocs(collection(db, "produccion"));
        let ordenes = [];
        snap.forEach(d => ordenes.push({ id: d.id, ...d.data() }));

        // Para ordenes sin negocio, buscarlo de la cotización
        const cotSnap = await getDocs(collection(db, "cotizaciones"));
        const cotizaciones = {};
        cotSnap.forEach(d => { cotizaciones[d.id] = d.data(); });

        ordenes.forEach(o => {
            if (!o.negocio && o.cotizacionId && cotizaciones[o.cotizacionId]) {
                o.negocio = cotizaciones[o.cotizacionId].negocio || "";
            }
        });

        // Solo ordenes terminadas y no eliminadas
        ordenes = ordenes.filter(o => o.pasoActual === "terminado" && !o.eliminado);
        ordenes.sort((a, b) => (b.fechaEnvio || "").localeCompare(a.fechaEnvio || ""));

        remisionCache = ordenes;
        renderRemision();
    } catch (err) {
        console.error("Error cargando remision:", err);
        container.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>Error al cargar</p></div>';
    }
}

function renderRemision() {
    const container = document.getElementById("remisionLista");
    if (!container) return;

    let ordenes = [...remisionCache];
    const busqueda = (document.getElementById("remisionBuscar")?.value || "").trim().toLowerCase();

    // Filtrar por búsqueda
    if (busqueda) {
        ordenes = ordenes.filter(o =>
            (o.cliente || "").toLowerCase().includes(busqueda) ||
            (o.numero || "").toLowerCase().includes(busqueda) ||
            (o.negocio || "").toLowerCase().includes(busqueda) ||
            (o.tipo || "").toLowerCase().includes(busqueda)
        );
    }

    // Filtrar según tab
    if (remisionFiltro === "pendiente") {
        ordenes = ordenes.filter(o => !o.metodoEntrega);
    } else if (remisionFiltro === "recoger") {
        ordenes = ordenes.filter(o => o.metodoEntrega === "recoger" && !o.entregaCompletada);
    } else if (remisionFiltro === "domicilio") {
        ordenes = ordenes.filter(o => o.metodoEntrega === "domicilio" && !o.entregaCompletada);
    } else if (remisionFiltro === "entregado") {
        ordenes = ordenes.filter(o => o.entregaCompletada);
    }

    if (ordenes.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-geo-alt"></i><p>No hay ordenes en este estado</p></div>';
        return;
    }

    container.innerHTML = "";
    ordenes.forEach(orden => {
            const card = document.createElement("div");
            card.className = "seg-orden-card";

            // Determinar estado de remisión
            let estadoBadge = "";
            if (orden.entregaCompletada) {
                estadoBadge = '<span class="seg-estado-badge terminado"><i class="bi bi-check-circle"></i> Entregado</span>';
            } else if (!orden.metodoEntrega) {
                estadoBadge = '<span class="seg-estado-badge recibido"><i class="bi bi-clock"></i> Esperando cliente</span>';
            } else if (orden.metodoEntrega === "recoger") {
                estadoBadge = '<span class="seg-estado-badge diseno"><i class="bi bi-shop"></i> Recoger en punto</span>';
            } else if (orden.metodoEntrega === "domicilio") {
                estadoBadge = '<span class="seg-estado-badge impresion"><i class="bi bi-geo-alt"></i> Domicilio</span>';
            }

            // Nombre a mostrar: negocio si existe, si no cliente
            const nombreDisplay = orden.negocio || orden.cliente;

            // Acciones
            let actionsHtml = '';
            if (!orden.entregaCompletada) {
                if (orden.metodoEntrega === "domicilio") {
                    // Link para el repartidor
                    actionsHtml += `<button class="seg-btn-link rem-btn-copiar-link-repartidor" data-id="${orden.id}"><i class="bi bi-truck"></i> Copiar link repartidor</button>`;
                    if (orden.entregaUbicacionUrl) {
                        actionsHtml += `<a href="${orden.entregaUbicacionUrl}" target="_blank" class="seg-btn-avanzar" style="text-decoration:none;"><i class="bi bi-geo-alt-fill"></i> Ver ubicacion</a>`;
                        actionsHtml += `<button class="seg-btn-link" data-copy-url="${orden.entregaUbicacionUrl}"><i class="bi bi-clipboard"></i> Copiar link Maps</button>`;
                    }
                }
                if (orden.metodoEntrega) {
                    actionsHtml += `<button class="seg-btn-avanzar rem-btn-completar" data-id="${orden.id}"><i class="bi bi-check-lg"></i> Marcar entregado</button>`;
                }
            }
            // Si está entregado y tiene evidencia, mostrar botón para ver
            if (orden.entregaCompletada && orden.entregaEvidenciaUrl) {
                actionsHtml += `<button class="seg-btn-avanzar rem-btn-ver-evidencia" data-url="${orden.entregaEvidenciaUrl}" style="background:#16a34a;"><i class="bi bi-image"></i> Ver evidencia</button>`;
            }
            // Botón eliminar siempre visible
            actionsHtml += `<button class="seg-btn-retroceder rem-btn-eliminar" data-id="${orden.id}"><i class="bi bi-trash"></i> Eliminar</button>`;

            // Info de dirección
            let direccionHtml = '';
            if (orden.metodoEntrega === "domicilio") {
                direccionHtml = `<div style="font-size:12px;color:#666;margin-top:4px;">📍 ${orden.entregaDireccion || 'Sin direccion'}</div>`;
            }
            if (orden.entregaCompletada && orden.entregaCompletadaFecha) {
                const fechaEntrega = new Date(orden.entregaCompletadaFecha).toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
                direccionHtml += `<div style="font-size:11px;color:#16a34a;margin-top:3px;"><i class="bi bi-check-circle-fill"></i> Entregado: ${fechaEntrega}</div>`;
            }

            const fechaEnvio = orden.fechaEnvio ? new Date(orden.fechaEnvio).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "-";

            card.innerHTML = `
                <div class="seg-orden-header">
                    <div class="seg-orden-info">
                        <div class="seg-orden-numero">${orden.numero} <span style="font-weight:400;color:#888;font-size:12px;">&bull; ${orden.tipo}</span></div>
                        <div class="seg-orden-cliente">${nombreDisplay} &bull; ${fechaEnvio}</div>
                        ${direccionHtml}
                    </div>
                    ${estadoBadge}
                </div>
                <div class="seg-orden-actions">${actionsHtml}</div>
            `;

            container.appendChild(card);
        });

        // Evento: copiar link repartidor
        container.querySelectorAll(".rem-btn-copiar-link-repartidor").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                const baseUrl = window.location.origin + window.location.pathname.replace("dashboard.html", "");
                const link = baseUrl + "remision.html?id=" + id;
                copyToClipboard(link).then(() => {
                    btn.innerHTML = '<i class="bi bi-check-lg"></i> Link copiado';
                    setTimeout(() => { btn.innerHTML = '<i class="bi bi-truck"></i> Copiar link repartidor'; }, 2000);
                });
            });
        });

        // Evento: copiar link maps
        container.querySelectorAll("[data-copy-url]").forEach(btn => {
            btn.addEventListener("click", () => {
                const url = btn.dataset.copyUrl;
                copyToClipboard(url).then(() => {
                    btn.innerHTML = '<i class="bi bi-check-lg"></i> Copiado';
                    setTimeout(() => { btn.innerHTML = '<i class="bi bi-clipboard"></i> Copiar link Maps'; }, 2000);
                });
            });
        });

        // Evento: ver evidencia de entrega
        container.querySelectorAll(".rem-btn-ver-evidencia").forEach(btn => {
            btn.addEventListener("click", () => {
                const url = btn.dataset.url;
                document.getElementById("imgModalDashImg").src = url;
                document.getElementById("imgModalDash").classList.add("show");
            });
        });

        // Evento: marcar entregado
        container.querySelectorAll(".rem-btn-completar").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                btn.disabled = true;
                btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando...';
                try {
                    const ref = doc(db, "produccion", id);
                    const snap = await getDoc(ref);
                    if (snap.exists()) {
                        const data = snap.data();
                        await setDoc(ref, { ...data, entregaCompletada: true, entregaCompletadaFecha: new Date().toISOString() });
                    }
                    cargarRemision();
                } catch (err) {
                    console.error("Error marcando entregado:", err);
                    btn.disabled = false;
                    btn.innerHTML = '<i class="bi bi-check-lg"></i> Marcar entregado';
                }
            });
        });

        // Evento: eliminar remisión
        container.querySelectorAll(".rem-btn-eliminar").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                showConfirm("Enviar a papelera", "¿Enviar esta orden a la papelera? Podras restaurarla despues.", async () => {
                    try {
                        await enviarOrdenAPapelera(id);
                        cargarRemision();
                        cargarSeguimiento();
                        cargarPapelera();
                    } catch (err) {
                        console.error("Error enviando remision a papelera:", err);
                    }
                });
            });
        });
}

// ===== PAPELERA: helpers para ordenes de produccion =====
async function enviarOrdenAPapelera(id) {
    const ref = doc(db, "produccion", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const current = snap.data();
    await setDoc(ref, {
        ...current,
        eliminado: true,
        fechaEliminado: new Date().toISOString(),
        eliminadoPor: sessionStorage.getItem("userName") || "",
        eliminadoPorEmail: sessionStorage.getItem("userEmail") || ""
    });
}

async function restaurarOrden(id) {
    const ref = doc(db, "produccion", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const current = snap.data();
    delete current.eliminado;
    delete current.fechaEliminado;
    delete current.eliminadoPor;
    delete current.eliminadoPorEmail;
    await setDoc(ref, current);
}

async function eliminarOrdenDefinitivo(id) {
    await deleteDoc(doc(db, "produccion", id));
}

// ===== PAPELERA (solo admin) =====
function setupPapelera() {
    const listaView     = document.getElementById("cotizadorLista");
    const papeleraView  = document.getElementById("cotizadorPapelera");
    const formView      = document.getElementById("cotizadorForm");
    const btnAbrir      = document.getElementById("btnAbrirPapelera");
    const btnVolver     = document.getElementById("btnVolverDePapelera");
    if (!btnAbrir || !papeleraView) return;

    btnAbrir.addEventListener("click", () => {
        if (listaView) listaView.style.display = "none";
        if (formView)  formView.style.display  = "none";
        papeleraView.style.display = "block";
        cargarPapelera();
    });

    if (btnVolver) {
        btnVolver.addEventListener("click", () => {
            papeleraView.style.display = "none";
            if (listaView) listaView.style.display = "block";
        });
    }
}

async function cargarPapelera() {
    const contCot = document.getElementById("papeleraCotizacionesLista");
    const contOrd = document.getElementById("papeleraOrdenesLista");
    if (!contCot || !contOrd) return; // solo admin tiene la seccion

    // --- Cotizaciones en papelera ---
    try {
        const cotizaciones = await obtenerCotizacionesEliminadas();
        renderPapeleraCotizaciones(cotizaciones);
    } catch (err) {
        console.error("Error cargando papelera de cotizaciones:", err);
    }

    // --- Ordenes en papelera ---
    try {
        const snap = await getDocs(collection(db, "produccion"));
        let ordenes = [];
        snap.forEach(d => ordenes.push({ id: d.id, ...d.data() }));
        ordenes = ordenes.filter(o => o.eliminado);
        ordenes.sort((a, b) => (b.fechaEliminado || "").localeCompare(a.fechaEliminado || ""));
        renderPapeleraOrdenes(ordenes);
    } catch (err) {
        console.error("Error cargando papelera de ordenes:", err);
    }
}

function fechaEliminadoStr(iso) {
    if (!iso) return "-";
    const f = new Date(iso);
    return isNaN(f) ? "-" : f.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderPapeleraCotizaciones(lista) {
    const container = document.getElementById("papeleraCotizacionesLista");
    if (!container) return;

    if (!lista || lista.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-trash3"></i><p>La papelera de cotizaciones esta vacia</p></div>';
        return;
    }

    container.innerHTML = "";
    lista.forEach(cot => {
        const item = document.createElement("div");
        item.className = "cot-list-item";
        item.innerHTML = `
            <div class="cot-list-info">
                <span class="cot-list-numero">${cot.numero || "Cotizacion"} <span class="cot-estado ${cot.estado || ""}">${cot.estado || ""}</span></span>
                <span class="cot-list-cliente">${cot.cliente || "-"} &bull; ${cot.tipo || "-"} &bull; Eliminada: ${fechaEliminadoStr(cot.fechaEliminado)}${cot.eliminadoPor ? " por " + cot.eliminadoPor : ""}</span>
            </div>
            <div class="cot-list-right">
                <span class="cot-list-total">$${formatMoneyLocal(cot.total)}</span>
                <button class="btn-copiar-link papelera-restaurar" data-tipo="cotizacion" data-id="${cot.id}">
                    <i class="bi bi-arrow-counterclockwise"></i> Restaurar
                </button>
                <button class="btn-mas-acciones papelera-eliminar" data-tipo="cotizacion" data-id="${cot.id}" data-name="${cot.numero || "cotizacion"}" style="background:#dc2626;color:#fff;">
                    <i class="bi bi-trash"></i> Eliminar definitivo
                </button>
            </div>
        `;
        container.appendChild(item);
    });

    wirePapeleraBotones(container);
}

function renderPapeleraOrdenes(lista) {
    const container = document.getElementById("papeleraOrdenesLista");
    if (!container) return;

    if (!lista || lista.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-trash3"></i><p>La papelera de ordenes esta vacia</p></div>';
        return;
    }

    container.innerHTML = "";
    lista.forEach(orden => {
        const nombre = orden.negocio || orden.cliente || "-";
        const item = document.createElement("div");
        item.className = "cot-list-item";
        item.innerHTML = `
            <div class="cot-list-info">
                <span class="cot-list-numero">${orden.numero || "Orden"} <span class="cot-estado">${orden.tipo || ""}</span></span>
                <span class="cot-list-cliente">${nombre} &bull; Eliminada: ${fechaEliminadoStr(orden.fechaEliminado)}${orden.eliminadoPor ? " por " + orden.eliminadoPor : ""}</span>
            </div>
            <div class="cot-list-right">
                <button class="btn-copiar-link papelera-restaurar" data-tipo="orden" data-id="${orden.id}">
                    <i class="bi bi-arrow-counterclockwise"></i> Restaurar
                </button>
                <button class="btn-mas-acciones papelera-eliminar" data-tipo="orden" data-id="${orden.id}" data-name="${orden.numero || "orden"}" style="background:#dc2626;color:#fff;">
                    <i class="bi bi-trash"></i> Eliminar definitivo
                </button>
            </div>
        `;
        container.appendChild(item);
    });

    wirePapeleraBotones(container);
}

function wirePapeleraBotones(container) {
    // Restaurar
    container.querySelectorAll(".papelera-restaurar").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            const tipo = btn.dataset.tipo;
            btn.disabled = true;
            try {
                if (tipo === "cotizacion") {
                    await restaurarCotizacion(id);
                    cargarListaCotizaciones();
                } else {
                    await restaurarOrden(id);
                    cargarOrdenes(rol);
                    cargarSeguimiento();
                    cargarRemision();
                }
                cargarPapelera();
            } catch (err) {
                console.error("Error restaurando:", err);
                btn.disabled = false;
            }
        });
    });

    // Eliminar definitivo
    container.querySelectorAll(".papelera-eliminar").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            const tipo = btn.dataset.tipo;
            const name = btn.dataset.name;
            showConfirm("Eliminar definitivamente", `Eliminar ${name} de forma permanente? Esta accion NO se puede deshacer.`, async () => {
                try {
                    if (tipo === "cotizacion") {
                        await eliminarCotizacionDefinitivo(id);
                    } else {
                        await eliminarOrdenDefinitivo(id);
                    }
                    cargarPapelera();
                } catch (err) {
                    console.error("Error eliminando definitivo:", err);
                }
            });
        });
    });
}

// ===== SECCION DOCUMENTOS (solo admin) =====
// Lista los archivos subidos a Firebase Storage (carpeta planchas/) y los cruza
// con las ordenes de diseño para saber a que orden/cliente pertenece cada uno.
let documentosCache = [];

function setupDocumentos() {
    const btnRecargar = document.getElementById("btnRecargarDocumentos");
    if (btnRecargar) btnRecargar.addEventListener("click", () => cargarDocumentos());

    const inputBuscar = document.getElementById("documentosBuscar");
    if (inputBuscar) inputBuscar.addEventListener("input", () => renderDocumentos());

    const selectTipo = document.getElementById("documentosFiltroTipo");
    if (selectTipo) selectTipo.addEventListener("change", () => renderDocumentos());
}

// Clasifica el documento por extension para el filtro de tipo.
function clasificarDocumento(nombre, contentType) {
    const ct = (contentType || "").toLowerCase();
    if (ct === "application/pdf" || /\.pdf$/i.test(nombre)) return "pdf";
    if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(nombre)) return "imagen";
    return "otro";
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "-";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

async function cargarDocumentos() {
    const tbody = document.getElementById("documentosTablaBody");
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" class="tabla-empty">Cargando documentos...</td></tr>';

    try {
        // Mapa url -> { numero, cliente } tomado de las ordenes de diseño
        const refsPorUrl = {};
        const snapDiseno = await getDocs(collection(db, "ordenesDiseno"));
        snapDiseno.forEach(d => {
            const data = d.data();
            (data.items || []).forEach(item => {
                const docu = item.ordenPlancha && item.ordenPlancha.documento;
                if (docu && docu.url) {
                    refsPorUrl[docu.url] = {
                        numero: data.numero || "",
                        cliente: data.cliente || "",
                        tipo: data.tipo || "",
                        producto: item.producto || ""
                    };
                }
            });
        });

        // Listar los archivos reales de Storage
        const carpeta = storageRef(storage, "planchas");
        const listado = await listAll(carpeta);

        const documentos = await Promise.all(listado.items.map(async (itemRef) => {
            try {
                const [meta, url] = await Promise.all([
                    getMetadata(itemRef),
                    getDownloadURL(itemRef)
                ]);
                const vinculo = refsPorUrl[url] || null;
                return {
                    path: itemRef.fullPath,
                    nombre: meta.name || itemRef.name,
                    url,
                    size: meta.size || 0,
                    contentType: meta.contentType || "",
                    fecha: meta.timeCreated || "",
                    clase: clasificarDocumento(meta.name || itemRef.name, meta.contentType),
                    orden: vinculo ? vinculo.numero : "",
                    cliente: vinculo ? vinculo.cliente : "",
                    producto: vinculo ? vinculo.producto : ""
                };
            } catch (err) {
                console.error("Error leyendo metadata de", itemRef.fullPath, err);
                return null;
            }
        }));

        documentosCache = documentos.filter(Boolean);
        documentosCache.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

        renderDocumentos();
    } catch (err) {
        console.error("Error cargando documentos:", err);
        tbody.innerHTML = '<tr><td colspan="6" class="tabla-empty">Error al cargar los documentos</td></tr>';
    }
}

function renderDocumentos() {
    const tbody = document.getElementById("documentosTablaBody");
    const resumen = document.getElementById("docsResumen");
    if (!tbody) return;

    let lista = [...documentosCache];
    const busqueda = (document.getElementById("documentosBuscar")?.value || "").trim().toLowerCase();
    const filtroTipo = document.getElementById("documentosFiltroTipo")?.value || "";

    if (busqueda) {
        lista = lista.filter(d =>
            (d.nombre || "").toLowerCase().includes(busqueda) ||
            (d.orden || "").toLowerCase().includes(busqueda) ||
            (d.cliente || "").toLowerCase().includes(busqueda) ||
            (d.producto || "").toLowerCase().includes(busqueda)
        );
    }

    if (filtroTipo) {
        lista = lista.filter(d => d.clase === filtroTipo);
    }

    // Resumen (sobre el total, no sobre el filtro)
    if (resumen) {
        const total = documentosCache.length;
        const pesoTotal = documentosCache.reduce((acc, d) => acc + (d.size || 0), 0);
        const pdfs = documentosCache.filter(d => d.clase === "pdf").length;
        const imgs = documentosCache.filter(d => d.clase === "imagen").length;
        resumen.innerHTML = `
            <div class="docs-resumen-item"><span class="docs-resumen-label">Documentos</span><span class="docs-resumen-valor">${total}</span></div>
            <div class="docs-resumen-item"><span class="docs-resumen-label">PDF</span><span class="docs-resumen-valor">${pdfs}</span></div>
            <div class="docs-resumen-item"><span class="docs-resumen-label">Imagenes</span><span class="docs-resumen-valor">${imgs}</span></div>
            <div class="docs-resumen-item"><span class="docs-resumen-label">Espacio usado</span><span class="docs-resumen-valor">${formatBytes(pesoTotal)}</span></div>
        `;
    }

    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="tabla-empty">No se encontraron documentos</td></tr>';
        return;
    }

    const iconos = { pdf: "bi-file-earmark-pdf", imagen: "bi-file-earmark-image", otro: "bi-file-earmark" };
    const etiquetas = { pdf: "PDF", imagen: "Imagen", otro: "Otro" };

    tbody.innerHTML = lista.map(d => {
        const fecha = d.fecha ? new Date(d.fecha).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "-";
        const vinculo = d.orden
            ? `<strong>${d.orden}</strong>${d.cliente ? " &bull; " + d.cliente : ""}`
            : '<span class="docs-sin-vinculo">Sin orden asociada</span>';
        return `
            <tr>
                <td>
                    <div class="docs-nombre">
                        <i class="bi ${iconos[d.clase]}"></i>
                        <span title="${d.nombre}">${d.nombre}</span>
                    </div>
                </td>
                <td><span class="docs-tipo-badge ${d.clase}">${etiquetas[d.clase]}</span></td>
                <td>${formatBytes(d.size)}</td>
                <td>${vinculo}</td>
                <td>${fecha}</td>
                <td>
                    <div class="docs-acciones">
                        <a href="${d.url}" download="${d.nombre}" class="docs-btn-descargar">
                            <i class="bi bi-download"></i> Descargar
                        </a>
                        <button class="docs-btn-eliminar" data-path="${d.path}" data-name="${d.nombre}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    // Eliminar documento de Storage
    tbody.querySelectorAll(".docs-btn-eliminar").forEach(btn => {
        btn.addEventListener("click", () => {
            const path = btn.dataset.path;
            const name = btn.dataset.name;
            showConfirm("Eliminar documento", `Eliminar "${name}" de forma permanente? Los correos ya enviados dejaran de poder descargarlo.`, async () => {
                try {
                    await deleteObject(storageRef(storage, path));
                    documentosCache = documentosCache.filter(d => d.path !== path);
                    renderDocumentos();
                    showNotif("Documento eliminado", "El archivo se borro del almacenamiento.");
                } catch (err) {
                    console.error("Error eliminando documento:", err);
                    showNotif("No se pudo eliminar", (err && (err.message || err.code)) || "Intenta de nuevo.");
                }
            });
        });
    });
}

// ===== SECCIÓN LANDING PAGE (solo admin) =====
// Administra los banners del sitio publico. Las imagenes se suben a ImgBB
// y solo se persisten en Firestore (config/landing) al guardar.

let landingBanners      = {};   // estado publicado
let landingBannersDraft = {};   // estado en edicion
let landingSubiendo     = 0;

let landingGaleria = [];   // [{ id, tipo, url, portada, titulo, texto }]
let landingCampania = [];  // [{ id, url, titulo, texto, link }]
let landingMarcas = [];    // [{ id, nombre, logo }]

function setupLandingAdmin() {
    const btnGuardar = document.getElementById("btnLandingGuardar");
    if (!btnGuardar) return;

    btnGuardar.addEventListener("click", guardarLandingConfig);

    document.getElementById("btnGaleriaImagen")
        .addEventListener("click", () => document.getElementById("galeriaFileInput").click());

    document.getElementById("btnGaleriaVideo")
        .addEventListener("click", agregarVideoGaleria);

    document.getElementById("galeriaFileInput").addEventListener("change", async e => {
        const file = e.target.files[0];
        e.target.value = "";
        if (file) await agregarImagenGaleria(file);
    });

    document.getElementById("btnCampaniaImagen")
        .addEventListener("click", () => document.getElementById("campaniaFileInput").click());

    document.getElementById("btnCampaniaVideo")
        .addEventListener("click", agregarVideoCampania);

    document.getElementById("campaniaFileInput").addEventListener("change", async e => {
        const file = e.target.files[0];
        e.target.value = "";
        if (file) await agregarImagenCampania(file);
    });

    // Vista previa en vivo de los textos del banner
    HERO_INPUTS.forEach(id => {
        document.getElementById(id).addEventListener("input", renderHeroPreview);
        document.getElementById(id).addEventListener("change", renderHeroPreview);
    });

    document.getElementById("btnMarcaAgregar")
        .addEventListener("click", agregarMarca);

    document.getElementById("marcasTituloInput")
        ?.addEventListener("input", renderLandingTabBadges);

    // El orden importa: primero existen los paneles, luego las pestañas
    construirPanelesBanners();
    setupLandingTabs();
    setupLandingPreviewModal();

    document.getElementById("btnHeroDefault").addEventListener("click", () => {
        showConfirm("Restaurar textos", "Se volveran a los textos por defecto del banner.", () => {
            pintarHeroInputs(HERO_DEFAULT);
            renderHeroPreview();
        });
    });

    cargarLandingAdmin();
}

/* ---------- Pestañas de la seccion Landing ----------
   Hay una pestaña por cada grupo de banners (Inicio, Nuestras lineas,
   Categorias de empaques, Categorias digital, Paginas internas) y otra
   por cada seccion de contenido (Campaña, Galeria, Marcas).
   Todas comparten el mismo boton "Guardar cambios": cambiar de pestaña
   no descarta lo editado, solo cambia lo que se muestra. */

/* Icono por grupo de banners. Si se agrega un grupo nuevo en
   landing-config.js y no esta aqui, cae a un icono genarico. */
const LANDING_GRUPO_ICONOS = {
    "Inicio":                 "bi-house-door",
    "Nuestras lineas":        "bi-columns-gap",
    "Categorias - Empaques":  "bi-box-seam",
    "Categorias - Digital":   "bi-display",
    "Paginas internas":       "bi-file-earmark-richtext"
};

/* Pestañas de contenido (no son grupos de banners). El panel ya existe
   en dashboard.html; aqui solo se declara como se ve la pestaña. */
const LANDING_TABS_CONTENIDO = [
    { panel: "campania", label: "Campaña del mes", icon: "bi-megaphone" },
    { panel: "galeria",  label: "Galeria",         icon: "bi-collection-play" },
    { panel: "marcas",   label: "Marcas",          icon: "bi-patch-check" }
];

/** Clave de panel para un grupo de banners. */
function panelGrupo(grupo) {
    return "grupo:" + grupo;
}

/* Crea un panel por grupo de banners y mueve los textos del hero al de Inicio.
   Se ejecuta una sola vez: los repintados posteriores solo rellenan las rejillas,
   asi no se pierde la pestaña activa ni el foco de los campos. */
function construirPanelesBanners() {
    const cont = document.getElementById("landingPaneles");
    if (!cont) return;

    // Los paneles de banners van antes que los de contenido, que ya estan en el HTML
    const primeroFijo = cont.querySelector("[data-landing-panel]");

    BANNER_GRUPOS.forEach(grupo => {
        const slots = BANNER_SLOTS.filter(s => s.grupo === grupo);
        if (!slots.length) return;

        const panel = document.createElement("div");
        panel.className = "landing-panel";
        panel.dataset.landingPanel = panelGrupo(grupo);
        panel.setAttribute("role", "tabpanel");
        panel.innerHTML = `
            <p class="landing-panel-hint">
                <i class="bi bi-info-circle"></i>
                Imagenes de la seccion <strong>${grupo}</strong>. Cada tarjeta es un espacio
                del sitio: sube la foto y queda publicada al guardar. Los espacios que no
                configures usan la imagen por defecto.
            </p>
            <div class="landing-grupo">
                <div class="landing-grupo-head">
                    <h3>${grupo}</h3>
                    <span>${slots.length} espacio${slots.length === 1 ? "" : "s"}</span>
                </div>
                <div class="landing-banner-grid" data-grupo-grid="${grupo}"></div>
            </div>`;

        // Los textos del banner principal pertenecen a la pestaña Inicio
        if (grupo === "Inicio") {
            const hero = document.getElementById("landingHeroBloque");
            if (hero) {
                hero.hidden = false;
                panel.insertBefore(hero, panel.firstElementChild);
            }
        }

        cont.insertBefore(panel, primeroFijo);
    });
}

function setupLandingTabs() {
    const barra = document.getElementById("landingTabs");
    if (!barra) return;

    barra.innerHTML = "";

    // Una pestaña por grupo de banners, en el orden de BANNER_GRUPOS
    const defs = BANNER_GRUPOS
        .filter(g => BANNER_SLOTS.some(s => s.grupo === g))
        .map(g => ({
            panel: panelGrupo(g),
            label: g,
            icon: LANDING_GRUPO_ICONOS[g] || "bi-image",
            grupo: g
        }))
        .concat(LANDING_TABS_CONTENIDO);

    defs.forEach(def => {
        const btn = document.createElement("button");
        btn.className = "landing-tab";
        btn.type = "button";
        btn.setAttribute("role", "tab");
        btn.dataset.landingTab = def.panel;
        if (def.grupo) btn.dataset.tabGrupo = def.grupo;
        btn.innerHTML = `
            <i class="bi ${def.icon}"></i>
            <span>${def.label}</span>
            <em class="landing-tab-badge"></em>`;
        btn.addEventListener("click", () => activarLandingTab(def.panel));
        barra.appendChild(btn);
    });

    if (defs.length) activarLandingTab(defs[0].panel);
    renderLandingTabBadges();
}

function activarLandingTab(panel) {
    document.querySelectorAll("#landingTabs [data-landing-tab]").forEach(t => {
        const activo = t.dataset.landingTab === panel;
        t.classList.toggle("is-active", activo);
        t.setAttribute("aria-selected", activo ? "true" : "false");
    });
    document.querySelectorAll("#landingPaneles [data-landing-panel]").forEach(p => {
        p.classList.toggle("is-active", p.dataset.landingPanel === panel);
    });
}

/* Contadores de cada pestaña, para ver de un vistazo que hay configurado.
   En los grupos de banners es "configurados/total"; en las de contenido,
   el numero de piezas. */
function renderLandingTabBadges() {
    const contenido = {
        campania: landingCampania.length,
        galeria:  landingGaleria.length,
        marcas:   landingMarcas.length
    };

    document.querySelectorAll("#landingTabs [data-landing-tab]").forEach(tab => {
        const badge = tab.querySelector(".landing-tab-badge");
        if (!badge) return;

        const grupo = tab.dataset.tabGrupo;
        let texto;

        if (grupo) {
            const slots = BANNER_SLOTS.filter(s => s.grupo === grupo);
            const listos = slots.filter(s => landingBannersDraft[s.key]).length;
            texto = `${listos}/${slots.length}`;
        } else {
            const n = contenido[tab.dataset.landingTab] ?? 0;
            // Un cero no aporta informacion, se oculta para no ensuciar la pestaña
            texto = n ? String(n) : "";
        }

        badge.textContent = texto;
        badge.style.display = texto ? "" : "none";
    });
}

/* ---------- Textos del banner principal ---------- */
const HERO_INPUTS = [
    "heroEyebrowInput", "heroTituloInput", "heroTextoInput",
    "heroCtaTextoInput", "heroCtaLinkInput"
];

function pintarHeroInputs(h) {
    document.getElementById("heroEyebrowInput").value  = h.eyebrow ?? "";
    document.getElementById("heroTituloInput").value   = h.titulo ?? "";
    document.getElementById("heroTextoInput").value    = h.texto ?? "";
    document.getElementById("heroCtaTextoInput").value = h.ctaTexto ?? "";
    document.getElementById("heroCtaLinkInput").value  = h.ctaLink || HERO_DEFAULT.ctaLink;
}

function leerHeroInputs() {
    return {
        eyebrow:  document.getElementById("heroEyebrowInput").value.trim(),
        titulo:   document.getElementById("heroTituloInput").value.trim() || HERO_DEFAULT.titulo,
        texto:    document.getElementById("heroTextoInput").value.trim(),
        ctaTexto: document.getElementById("heroCtaTextoInput").value.trim() || HERO_DEFAULT.ctaTexto,
        ctaLink:  document.getElementById("heroCtaLinkInput").value || HERO_DEFAULT.ctaLink
    };
}

function renderHeroPreview() {
    const prev = document.getElementById("heroPreview");
    if (!prev) return;
    const h = leerHeroInputs();

    // Fondo: la imagen del banner en edicion, o la de respaldo del slot
    const bg = document.getElementById("heroPreviewBg");
    if (bg) {
        // Primera imagen del carrusel con foto, o la de respaldo del slot inicial
        const slot = BANNER_SLOTS.find(s => s.key === "hero_1");
        const url  = HERO_SLIDE_KEYS.map(k => landingBannersDraft[k]).find(Boolean)
                     || slot?.fallback || "";
        bg.style.backgroundImage = url ? `url('${url}')` : "";
        prev.classList.toggle("is-sinfoto", !url);
    }

    const eyebrow = prev.querySelector(".lhp-eyebrow");
    const texto   = prev.querySelector(".lhp-texto");

    eyebrow.textContent = h.eyebrow;
    eyebrow.style.display = h.eyebrow ? "" : "none";
    prev.querySelector(".lhp-titulo").textContent = h.titulo;
    texto.textContent = h.texto;
    texto.style.display = h.texto ? "" : "none";
    prev.querySelector(".lhp-cta").textContent = h.ctaTexto;
}

async function cargarLandingAdmin() {
    const cfg = await getLandingConfig({ forzar: true });
    landingBanners = { ...cfg.banners };
    landingBannersDraft = { ...cfg.banners };
    landingGaleria = (cfg.galeria || []).map(i => ({ ...i }));
    landingCampania = (cfg.campania || []).map(i => ({ ...i }));

    // Si nunca se han configurado marcas (null) se precargan las de por defecto,
    // para que el admin vea y pueda editar lo que hoy muestra la landing.
    // Una lista guardada vacia se respeta: significa "sin seccion de marcas".
    landingMarcas = (Array.isArray(cfg.marcas) ? cfg.marcas : MARCAS_DEFAULT)
        .map(m => ({ ...m }));

    document.getElementById("marcasTituloInput").value =
        cfg.marcasTitulo === MARCAS_DEFAULT_TITULO ? "" : (cfg.marcasTitulo || "");

    document.getElementById("campaniaTituloInput").value =
        cfg.campaniaTitulo === CAMPANIA_DEFAULT_TITULO ? "" : (cfg.campaniaTitulo || "");
    document.getElementById("campaniaTextoInput").value =
        cfg.campaniaTexto === CAMPANIA_DEFAULT_TEXTO ? "" : (cfg.campaniaTexto || "");

    document.getElementById("galeriaTituloInput").value =
        cfg.galeriaTitulo === GALERIA_DEFAULT_TITULO ? "" : (cfg.galeriaTitulo || "");
    document.getElementById("galeriaTextoInput").value =
        cfg.galeriaTexto === GALERIA_DEFAULT_TEXTO ? "" : (cfg.galeriaTexto || "");

    pintarHeroInputs(getHeroTextos(cfg));
    renderHeroPreview();

    renderLandingMeta(cfg.actualizado);
    renderLandingGrupos();
    renderLandingGaleria();
    renderLandingCampania();
    renderLandingMarcas();
}

/* ---------- Marcas que confian en nosotros ---------- */
function agregarMarca() {
    if (landingMarcas.length >= MARCAS_MAX) {
        showNotifToast(`Maximo ${MARCAS_MAX} marcas en el carrusel`);
        return;
    }
    landingMarcas.push({
        id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        nombre: "",
        logo: ""
    });
    renderLandingMarcas();

    // Foco en el nombre de la marca recien agregada
    const inputs = document.querySelectorAll('#landingMarcasLista input[data-campo="nombre"]');
    inputs[inputs.length - 1]?.focus();
}

async function subirLogoMarca(file, marca, fila) {
    if (!file.type.startsWith("image/")) {
        showNotifToast("El archivo debe ser una imagen");
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        showNotifToast("La imagen supera 8 MB, comprimela antes de subir");
        return;
    }

    fila.classList.add("is-uploading");
    landingSubiendo++;

    try {
        marca.logo = await subirImgbb(file);
        showNotifToast("Logo listo. Guarda para publicar");
    } catch (err) {
        console.error("[landing] error subiendo logo de marca", err);
        showNotifToast("No se pudo subir el logo");
    } finally {
        landingSubiendo--;
        fila.classList.remove("is-uploading");
        renderLandingMarcas();
    }
}

function renderLandingMarcas() {
    const lista = document.getElementById("landingMarcasLista");
    const count = document.getElementById("landingMarcasCount");
    if (!lista) return;

    if (count) {
        count.textContent =
            `${landingMarcas.length} de ${MARCAS_MAX} marca${landingMarcas.length === 1 ? "" : "s"}`;
    }

    const btnAgregar = document.getElementById("btnMarcaAgregar");
    if (btnAgregar) btnAgregar.disabled = landingMarcas.length >= MARCAS_MAX;

    renderLandingTabBadges();

    if (!landingMarcas.length) {
        lista.innerHTML = `
            <div class="landing-galeria-empty">
                <i class="bi bi-patch-check"></i>
                <p>Aun no hay marcas. Agrega los negocios que trabajan contigo:
                   con logo se muestra la imagen, sin logo se muestra el nombre.
                   Si dejas la lista vacia la seccion no aparece en la landing.</p>
            </div>`;
        return;
    }

    lista.innerHTML = "";

    landingMarcas.forEach((marca, idx) => {
        const fila = document.createElement("div");
        fila.className = "landing-galeria-item landing-marca-item";
        fila.innerHTML = `
            <div class="landing-galeria-thumb landing-marca-thumb${marca.logo ? "" : " is-empty"}">
                ${marca.logo
                    ? `<img src="${marca.logo}" alt=""
                            onerror="this.style.display='none';this.parentElement.classList.add('is-empty')">`
                    : ""}
                <div class="landing-galeria-thumb-ph"><i class="bi bi-image"></i></div>
                <div class="landing-banner-loader"><i class="bi bi-arrow-repeat"></i> Subiendo...</div>
            </div>

            <div class="landing-galeria-campos">
                <span class="landing-galeria-tipo">
                    <i class="bi bi-patch-check"></i> Marca ${idx + 1}
                </span>
                <input type="text" data-campo="nombre" placeholder="Nombre de la marca *"
                       maxlength="40" value="${(marca.nombre || "").replace(/"/g, "&quot;")}">
                <div class="landing-marca-logo-acciones">
                    <button class="btn-secondary landing-btn-sm" data-accion="logo">
                        <i class="bi bi-upload"></i> ${marca.logo ? "Cambiar logo" : "Subir logo"}
                    </button>
                    ${marca.logo
                        ? `<button class="btn-secondary landing-btn-sm" data-accion="quitar-logo">
                               <i class="bi bi-x-lg"></i> Quitar logo
                           </button>`
                        : `<span class="landing-marca-hint">Sin logo se muestra el nombre en texto</span>`}
                </div>
            </div>

            <div class="landing-galeria-acciones">
                <button class="landing-icon-btn" data-accion="subir" title="Subir"
                        ${idx === 0 ? "disabled" : ""}><i class="bi bi-arrow-up"></i></button>
                <button class="landing-icon-btn" data-accion="bajar" title="Bajar"
                        ${idx === landingMarcas.length - 1 ? "disabled" : ""}><i class="bi bi-arrow-down"></i></button>
                <button class="landing-icon-btn landing-icon-btn--danger" data-accion="eliminar"
                        title="Eliminar"><i class="bi bi-trash3"></i></button>
            </div>

            <input type="file" accept="image/*" hidden>`;

        const fileInput = fila.querySelector("input[type=file]");

        fila.querySelector('[data-campo="nombre"]').addEventListener("input", e => {
            marca.nombre = e.target.value;
        });

        fila.querySelector('[data-accion="logo"]').addEventListener("click", () => fileInput.click());

        fileInput.addEventListener("change", async e => {
            const file = e.target.files[0];
            e.target.value = "";
            if (file) await subirLogoMarca(file, marca, fila);
        });

        fila.querySelector('[data-accion="quitar-logo"]')?.addEventListener("click", () => {
            marca.logo = "";
            renderLandingMarcas();
        });

        fila.querySelector('[data-accion="subir"]').addEventListener("click", () => {
            [landingMarcas[idx - 1], landingMarcas[idx]] = [landingMarcas[idx], landingMarcas[idx - 1]];
            renderLandingMarcas();
        });
        fila.querySelector('[data-accion="bajar"]').addEventListener("click", () => {
            [landingMarcas[idx + 1], landingMarcas[idx]] = [landingMarcas[idx], landingMarcas[idx + 1]];
            renderLandingMarcas();
        });
        fila.querySelector('[data-accion="eliminar"]').addEventListener("click", () => {
            showConfirm("Eliminar marca", `Se quitara "${marca.nombre || "esta marca"}" del carrusel.`, () => {
                landingMarcas = landingMarcas.filter(m => m.id !== marca.id);
                renderLandingMarcas();
            });
        });

        lista.appendChild(fila);
    });
}

/* Titulo de la seccion de marcas, vacio = titulo por defecto. */
function leerMarcasTitulo() {
    return document.getElementById("marcasTituloInput").value.trim() || MARCAS_DEFAULT_TITULO;
}

/* ---------- Modal para pedir el enlace de un video ----------
   Reemplaza al prompt() del navegador. Valida el enlace mientras se
   escribe y muestra la miniatura antes de agregarlo, para que no se
   cuele un enlace que la landing no pueda reproducir.
   Devuelve una promesa con la url, o null si se cancela. */
function pedirEnlaceVideo(titulo = "Agregar video") {
    const overlay = document.getElementById("videoUrlOverlay");
    const input   = document.getElementById("videoUrlInput");
    const error   = document.getElementById("videoUrlError");
    const preview = document.getElementById("videoUrlPreview");
    const prevImg = document.getElementById("videoUrlPreviewImg");
    const prevTxt = document.getElementById("videoUrlPreviewTxt");
    const btnSave = document.getElementById("videoUrlSave");

    // Sin el modal en el DOM no se bloquea la accion: se cae al prompt nativo
    if (!overlay) {
        const url = (prompt("Pega el enlace del video (YouTube o Vimeo):") || "").trim();
        return Promise.resolve(url || null);
    }

    document.getElementById("videoUrlTitle").textContent = titulo;
    input.value = "";
    mostrarEstado("");

    overlay.classList.add("show");
    setTimeout(() => input.focus(), 50);

    function mostrarEstado(url) {
        const limpia = url.trim();

        if (!limpia) {
            error.hidden = true;
            preview.hidden = true;
            // Sin src la miniatura mostraria el icono de imagen rota
            prevImg.hidden = true;
            prevImg.removeAttribute("src");
            btnSave.disabled = true;
            return;
        }

        if (!esVideoValido(limpia)) {
            error.querySelector("span").textContent =
                "No reconocemos ese enlace. Pega uno de YouTube o Vimeo.";
            error.hidden = false;
            preview.hidden = true;
            btnSave.disabled = true;
            return;
        }

        error.hidden = true;
        btnSave.disabled = false;

        // YouTube da miniatura; Vimeo no, ahi solo se confirma que es valido
        const thumb = portadaGaleria({ tipo: "video", url: limpia });
        if (thumb) {
            prevImg.src = thumb;
            prevImg.hidden = false;
            prevTxt.textContent = "Enlace valido, asi se vera la miniatura";
        } else {
            prevImg.hidden = true;
            prevImg.removeAttribute("src");
            prevTxt.textContent = "Enlace valido. Puedes agregarle una portada despues";
        }
        preview.hidden = false;
    }

    return new Promise(resolve => {
        function cerrar(valor) {
            overlay.classList.remove("show");
            input.removeEventListener("input", onInput);
            input.removeEventListener("keydown", onKey);
            btnSave.removeEventListener("click", onSave);
            document.getElementById("videoUrlCancel").removeEventListener("click", onCancel);
            document.getElementById("videoUrlClose").removeEventListener("click", onCancel);
            overlay.removeEventListener("click", onFuera);
            document.removeEventListener("keydown", onEsc);
            resolve(valor);
        }

        const onInput  = () => mostrarEstado(input.value);
        const onSave   = () => {
            const url = input.value.trim();
            if (url && esVideoValido(url)) cerrar(url);
        };
        const onCancel = () => cerrar(null);
        const onFuera  = e => { if (e.target === overlay) cerrar(null); };
        const onEsc    = e => { if (e.key === "Escape") cerrar(null); };
        const onKey    = e => { if (e.key === "Enter") { e.preventDefault(); onSave(); } };

        input.addEventListener("input", onInput);
        input.addEventListener("keydown", onKey);
        btnSave.addEventListener("click", onSave);
        document.getElementById("videoUrlCancel").addEventListener("click", onCancel);
        document.getElementById("videoUrlClose").addEventListener("click", onCancel);
        overlay.addEventListener("click", onFuera);
        document.addEventListener("keydown", onEsc);
    });
}

/* ---------- Campaña del mes: imagenes y videos ---------- */
function nuevoIdCampania() {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function agregarVideoCampania() {
    if (landingCampania.length >= CAMPANIA_MAX) {
        showNotifToast(`Maximo ${CAMPANIA_MAX} piezas en la campaña`);
        return;
    }

    const url = await pedirEnlaceVideo("Agregar video a la campaña");
    if (!url) return;

    landingCampania.push({
        id: nuevoIdCampania(), tipo: "video", url,
        portada: "", titulo: "", texto: "", link: ""
    });
    renderLandingCampania();
    showNotifToast("Video agregado. Guarda para publicar");
}

async function agregarImagenCampania(file) {
    if (landingCampania.length >= CAMPANIA_MAX) {
        showNotifToast(`Maximo ${CAMPANIA_MAX} piezas en la campaña`);
        return;
    }
    if (!file.type.startsWith("image/")) {
        showNotifToast("El archivo debe ser una imagen");
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        showNotifToast("La imagen supera 8 MB, comprimela antes de subir");
        return;
    }

    const lista = document.getElementById("landingCampaniaLista");
    lista.classList.add("is-busy");
    landingSubiendo++;

    try {
        const url = await subirImgbb(file);
        landingCampania.push({
            id: nuevoIdCampania(), tipo: "imagen", url,
            portada: "", titulo: "", texto: "", link: ""
        });
        showNotifToast("Imagen agregada. Guarda para publicar");
    } catch (err) {
        console.error("[landing] error subiendo imagen de campaña", err);
        showNotifToast("No se pudo subir la imagen");
    } finally {
        landingSubiendo--;
        lista.classList.remove("is-busy");
        renderLandingCampania();
    }
}

function renderLandingCampania() {
    const lista = document.getElementById("landingCampaniaLista");
    const count = document.getElementById("landingCampaniaCount");
    if (!lista) return;

    if (count) {
        const imgs   = landingCampania.filter(i => i.tipo !== "video").length;
        const videos = landingCampania.length - imgs;
        count.textContent =
            `${landingCampania.length} de ${CAMPANIA_MAX} · ${imgs} imagen${imgs === 1 ? "" : "es"} · ${videos} video${videos === 1 ? "" : "s"}`;
    }

    // Al llegar al maximo se bloquean ambos botones de alta
    const lleno = landingCampania.length >= CAMPANIA_MAX;
    const btnImg = document.getElementById("btnCampaniaImagen");
    const btnVid = document.getElementById("btnCampaniaVideo");
    if (btnImg) btnImg.disabled = lleno;
    if (btnVid) btnVid.disabled = lleno;

    renderLandingTabBadges();

    if (!landingCampania.length) {
        lista.innerHTML = `
            <div class="landing-galeria-empty">
                <i class="bi bi-megaphone"></i>
                <p>Aun no hay piezas de campaña. Sube hasta ${CAMPANIA_MAX} imagenes o
                   videos de YouTube (lo nuevo del mes, promociones) y la seccion
                   aparecera en la landing, justo debajo de "Nuestras Lineas".</p>
            </div>`;
        return;
    }

    lista.innerHTML = "";

    landingCampania.forEach((item, idx) => {
        const esVideo = item.tipo === "video";
        // En video la miniatura es la portada propia o la que da YouTube
        const thumb   = esVideo ? portadaGaleria(item) : item.url;

        const fila = document.createElement("div");
        fila.className = "landing-galeria-item";
        fila.innerHTML = `
            <div class="landing-galeria-thumb">
                ${thumb
                    ? `<img src="${thumb}" alt=""
                            onerror="this.style.display='none';this.parentElement.classList.add('is-empty')">`
                    : ""}
                <div class="landing-galeria-thumb-ph"><i class="bi bi-image"></i></div>
                ${esVideo ? '<span class="landing-galeria-badge"><i class="bi bi-play-fill"></i></span>' : ""}
            </div>

            <div class="landing-galeria-campos">
                <span class="landing-galeria-tipo">
                    <i class="bi ${esVideo ? "bi-play-btn" : "bi-image"}"></i>
                    ${esVideo ? "Video" : "Imagen"} · Pieza ${idx + 1}
                </span>
                <input type="text" data-campo="titulo" placeholder="Titulo (opcional)"
                       maxlength="60" value="${(item.titulo || "").replace(/"/g, "&quot;")}">
                <input type="text" data-campo="texto" placeholder="Descripcion corta (opcional)"
                       maxlength="120" value="${(item.texto || "").replace(/"/g, "&quot;")}">
                ${esVideo
                    ? `<input type="url" data-campo="url" placeholder="Enlace del video (YouTube o Vimeo)"
                              value="${(item.url || "").replace(/"/g, "&quot;")}">
                       <input type="url" data-campo="portada" placeholder="Portada propia (opcional)"
                              value="${(item.portada || "").replace(/"/g, "&quot;")}">`
                    : `<input type="text" data-campo="link" placeholder="Enlace al hacer clic (opcional)"
                              maxlength="200" value="${(item.link || "").replace(/"/g, "&quot;")}">`}
            </div>

            <div class="landing-galeria-acciones">
                <button class="landing-icon-btn" data-accion="subir" title="Subir"
                        ${idx === 0 ? "disabled" : ""}><i class="bi bi-arrow-up"></i></button>
                <button class="landing-icon-btn" data-accion="bajar" title="Bajar"
                        ${idx === landingCampania.length - 1 ? "disabled" : ""}><i class="bi bi-arrow-down"></i></button>
                <a class="landing-icon-btn" href="${item.url}" target="_blank" rel="noopener"
                   title="Abrir"><i class="bi bi-box-arrow-up-right"></i></a>
                <button class="landing-icon-btn landing-icon-btn--danger" data-accion="eliminar"
                        title="Eliminar"><i class="bi bi-trash3"></i></button>
            </div>`;

        fila.querySelectorAll("[data-campo]").forEach(input => {
            input.addEventListener("input", () => {
                const campo = input.dataset.campo;
                item[campo] = input.value.trim();
                // Cambiar el video o su portada obliga a repintar la miniatura
                if (campo === "url" || campo === "portada") renderLandingCampania();
            });
        });

        fila.querySelector('[data-accion="subir"]').addEventListener("click", () => {
            [landingCampania[idx - 1], landingCampania[idx]] = [landingCampania[idx], landingCampania[idx - 1]];
            renderLandingCampania();
        });
        fila.querySelector('[data-accion="bajar"]').addEventListener("click", () => {
            [landingCampania[idx + 1], landingCampania[idx]] = [landingCampania[idx], landingCampania[idx + 1]];
            renderLandingCampania();
        });
        fila.querySelector('[data-accion="eliminar"]').addEventListener("click", () => {
            showConfirm("Eliminar imagen", "Se quitara de la campaña del mes.", () => {
                landingCampania = landingCampania.filter(c => c.id !== item.id);
                renderLandingCampania();
            });
        });

        lista.appendChild(fila);
    });
}

/* ---------- Galeria: imagenes y videos ---------- */
function nuevoIdGaleria() {
    return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function agregarImagenGaleria(file) {
    if (!file.type.startsWith("image/")) {
        showNotifToast("El archivo debe ser una imagen");
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        showNotifToast("La imagen supera 8 MB, comprimela antes de subir");
        return;
    }

    const lista = document.getElementById("landingGaleriaLista");
    lista.classList.add("is-busy");
    landingSubiendo++;

    try {
        const url = await subirImgbb(file);
        landingGaleria.push({
            id: nuevoIdGaleria(), tipo: "imagen", url, portada: "", titulo: "", texto: ""
        });
        showNotifToast("Imagen agregada. Guarda para publicar");
    } catch (err) {
        console.error("[landing] error subiendo imagen de galeria", err);
        showNotifToast("No se pudo subir la imagen");
    } finally {
        landingSubiendo--;
        lista.classList.remove("is-busy");
        renderLandingGaleria();
    }
}

async function agregarVideoGaleria() {
    const url = await pedirEnlaceVideo("Agregar video a la galeria");
    if (!url) return;

    landingGaleria.push({
        id: nuevoIdGaleria(), tipo: "video", url, portada: "", titulo: "", texto: ""
    });
    renderLandingGaleria();
    showNotifToast("Video agregado. Guarda para publicar");
}

function renderLandingGaleria() {
    const lista = document.getElementById("landingGaleriaLista");
    const count = document.getElementById("landingGaleriaCount");
    if (!lista) return;

    const imgs   = landingGaleria.filter(i => i.tipo === "imagen").length;
    const videos = landingGaleria.filter(i => i.tipo === "video").length;
    if (count) count.textContent = `${imgs} imagen${imgs === 1 ? "" : "es"} · ${videos} video${videos === 1 ? "" : "s"}`;

    renderLandingTabBadges();

    if (!landingGaleria.length) {
        lista.innerHTML = `
            <div class="landing-galeria-empty">
                <i class="bi bi-collection-play"></i>
                <p>Aun no hay piezas en la galeria. Agrega imagenes o videos y la
                   seccion aparecera automaticamente en la landing.</p>
            </div>`;
        return;
    }

    lista.innerHTML = "";

    landingGaleria.forEach((item, idx) => {
        const portada = portadaGaleria(item);
        const fila = document.createElement("div");
        fila.className = "landing-galeria-item";
        fila.innerHTML = `
            <div class="landing-galeria-thumb">
                ${portada
                    ? `<img src="${portada}" alt=""
                            onerror="this.style.display='none';this.parentElement.classList.add('is-empty')">`
                    : ""}
                <div class="landing-galeria-thumb-ph"><i class="bi bi-image"></i></div>
                ${item.tipo === "video" ? '<span class="landing-galeria-badge"><i class="bi bi-play-fill"></i></span>' : ""}
            </div>

            <div class="landing-galeria-campos">
                <span class="landing-galeria-tipo">
                    <i class="bi ${item.tipo === "video" ? "bi-play-btn" : "bi-image"}"></i>
                    ${item.tipo === "video" ? "Video" : "Imagen"}
                </span>
                <input type="text" data-campo="titulo" placeholder="Titulo (opcional)"
                       maxlength="60" value="${(item.titulo || "").replace(/"/g, "&quot;")}">
                <input type="text" data-campo="texto" placeholder="Descripcion corta (opcional)"
                       maxlength="120" value="${(item.texto || "").replace(/"/g, "&quot;")}">
                ${item.tipo === "video"
                    ? `<input type="url" data-campo="url" placeholder="Enlace del video"
                              value="${(item.url || "").replace(/"/g, "&quot;")}">`
                    : ""}
            </div>

            <div class="landing-galeria-acciones">
                <button class="landing-icon-btn" data-accion="subir" title="Subir"
                        ${idx === 0 ? "disabled" : ""}><i class="bi bi-arrow-up"></i></button>
                <button class="landing-icon-btn" data-accion="bajar" title="Bajar"
                        ${idx === landingGaleria.length - 1 ? "disabled" : ""}><i class="bi bi-arrow-down"></i></button>
                <a class="landing-icon-btn" href="${item.url}" target="_blank" rel="noopener"
                   title="Abrir"><i class="bi bi-box-arrow-up-right"></i></a>
                <button class="landing-icon-btn landing-icon-btn--danger" data-accion="eliminar"
                        title="Eliminar"><i class="bi bi-trash3"></i></button>
            </div>`;

        fila.querySelectorAll("[data-campo]").forEach(input => {
            input.addEventListener("input", () => {
                const campo = input.dataset.campo;
                item[campo] = input.value.trim();
                if (campo === "url") renderLandingGaleria();
            });
        });

        fila.querySelector('[data-accion="subir"]').addEventListener("click", () => {
            [landingGaleria[idx - 1], landingGaleria[idx]] = [landingGaleria[idx], landingGaleria[idx - 1]];
            renderLandingGaleria();
        });
        fila.querySelector('[data-accion="bajar"]').addEventListener("click", () => {
            [landingGaleria[idx + 1], landingGaleria[idx]] = [landingGaleria[idx], landingGaleria[idx + 1]];
            renderLandingGaleria();
        });
        fila.querySelector('[data-accion="eliminar"]').addEventListener("click", () => {
            showConfirm("Eliminar pieza", "Se quitara de la galeria de la landing.", () => {
                landingGaleria = landingGaleria.filter(g => g.id !== item.id);
                renderLandingGaleria();
            });
        });

        lista.appendChild(fila);
    });
}

/** Sube un archivo a ImgBB y devuelve la URL publica. */
async function subirImgbb(file) {
    const b64 = await fileToBase64(file);
    const form = new FormData();
    form.append("key", IMGBB_KEY_ADMIN);
    form.append("image", b64.split(",")[1]);

    const res  = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!data.success) throw new Error(data?.error?.message || "ImgBB rechazo la imagen");
    return data.data.url;
}

function renderLandingMeta(actualizado) {
    const meta = document.getElementById("landingMeta");
    if (!meta) return;
    renderLandingTabBadges();
    const configurados = BANNER_SLOTS.filter(s => landingBannersDraft[s.key]).length;
    const fecha = actualizado
        ? new Date(actualizado).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
        : "sin publicar";
    meta.innerHTML = `
        <div class="landing-meta-item">
            <span class="landing-meta-label">Espacios configurados</span>
            <strong>${configurados} de ${BANNER_SLOTS.length}</strong>
        </div>
        <div class="landing-meta-item">
            <span class="landing-meta-label">Ultima publicacion</span>
            <strong>${fecha}</strong>
        </div>`;
}

/* Rellena la rejilla de cada pestaña de banners. Los paneles ya existen
   (los crea construirPanelesBanners), aqui solo se repintan las tarjetas. */
function renderLandingGrupos() {
    document.querySelectorAll("[data-grupo-grid]").forEach(grid => {
        const grupo = grid.dataset.grupoGrid;
        grid.innerHTML = "";
        BANNER_SLOTS
            .filter(s => s.grupo === grupo)
            .forEach(slot => grid.appendChild(landingSlotCard(slot)));
    });
    renderLandingTabBadges();
}

function landingSlotCard(slot) {
    const url        = landingBannersDraft[slot.key] || "";
    const publicada  = landingBanners[slot.key] || "";
    const preview    = url || slot.fallback;
    const modificado = url !== publicada;

    const card = document.createElement("div");
    card.className = "landing-banner-card" + (modificado ? " is-dirty" : "");
    card.innerHTML = `
        <div class="landing-banner-preview">
            <img src="${preview}" alt="${slot.label}"
                 onerror="this.style.display='none';this.parentElement.classList.add('is-empty')">
            <div class="landing-banner-ph"><i class="bi bi-image"></i><span>Sin imagen</span></div>
            <span class="landing-banner-state">
                ${url ? '<i class="bi bi-check-circle-fill"></i> Personalizado'
                      : '<i class="bi bi-dash-circle"></i> Imagen por defecto'}
            </span>
            ${modificado ? '<span class="landing-banner-dirty">Sin guardar</span>' : ""}
            <div class="landing-banner-loader"><i class="bi bi-arrow-repeat"></i> Subiendo...</div>
        </div>
        <div class="landing-banner-body">
            <h4>${slot.label}</h4>
            <p>${slot.ayuda}</p>
            <div class="landing-banner-actions">
                <button class="btn-secondary landing-btn-sm" data-accion="subir">
                    <i class="bi bi-upload"></i> ${url ? "Cambiar" : "Subir"}
                </button>
                ${url ? `<button class="btn-secondary landing-btn-sm" data-accion="quitar">
                            <i class="bi bi-arrow-counterclockwise"></i> Restaurar
                         </button>` : ""}
                ${url ? `<a class="btn-secondary landing-btn-sm" href="${url}" target="_blank" rel="noopener">
                            <i class="bi bi-eye"></i>
                         </a>` : ""}
            </div>
        </div>
        <input type="file" accept="image/*" hidden>`;

    const input = card.querySelector("input[type=file]");

    card.querySelector('[data-accion="subir"]').addEventListener("click", () => input.click());

    card.querySelector('[data-accion="quitar"]')?.addEventListener("click", () => {
        delete landingBannersDraft[slot.key];
        renderLandingGrupos();
        renderLandingMeta(null);
        renderHeroPreview();
    });

    input.addEventListener("change", async e => {
        const file = e.target.files[0];
        if (!file) return;
        await subirBannerLanding(file, slot, card);
    });

    return card;
}

async function subirBannerLanding(file, slot, card) {
    if (!file.type.startsWith("image/")) {
        showNotifToast("El archivo debe ser una imagen");
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        showNotifToast("La imagen supera 8 MB, comprimela antes de subir");
        return;
    }

    card.classList.add("is-uploading");
    landingSubiendo++;

    try {
        const b64 = await fileToBase64(file);
        const form = new FormData();
        form.append("key", IMGBB_KEY_ADMIN);
        form.append("image", b64.split(",")[1]);

        const res  = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: form });
        const data = await res.json();

        if (!data.success) throw new Error(data?.error?.message || "ImgBB rechazo la imagen");

        landingBannersDraft[slot.key] = data.data.url;
        renderHeroPreview();
        showNotifToast(`"${slot.label}" listo. Guarda para publicar`);
    } catch (err) {
        console.error("[landing] error subiendo banner", err);
        showNotifToast("No se pudo subir la imagen, intenta de nuevo");
    } finally {
        landingSubiendo--;
        card.classList.remove("is-uploading");
        renderLandingGrupos();
        renderLandingMeta(null);
    }
}

async function guardarLandingConfig() {
    if (landingSubiendo > 0) {
        showNotifToast("Espera a que terminen las subidas en curso");
        return;
    }

    const btn = document.getElementById("btnLandingGuardar");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-arrow-repeat" style="animation:spin .7s linear infinite"></i> Guardando...';

    const ahora = new Date().toISOString();

    try {
        const titulo = document.getElementById("galeriaTituloInput").value.trim();
        const texto  = document.getElementById("galeriaTextoInput").value.trim();

        // Solo se publican piezas con url valida
        const galeria = landingGaleria
            .filter(i => i.url && (i.tipo !== "video" || esVideoValido(i.url)))
            .map(({ id, tipo, url, portada, titulo, texto }) =>
                ({ id, tipo, url, portada: portada || "", titulo: titulo || "", texto: texto || "" }));

        const campTitulo = document.getElementById("campaniaTituloInput").value.trim();
        const campTexto  = document.getElementById("campaniaTextoInput").value.trim();
        const campania   = normalizarCampania(landingCampania);

        // Las marcas sin nombre no se publican: se avisa para que no pase inadvertido
        const marcas = normalizarMarcas(landingMarcas);
        const marcasDescartadas = landingMarcas.length - marcas.length;

        await setDoc(doc(db, LANDING_DOC.coleccion, LANDING_DOC.id), {
            banners: landingBannersDraft,
            hero: leerHeroInputs(),
            galeria,
            galeriaTitulo: titulo || GALERIA_DEFAULT_TITULO,
            galeriaTexto: texto || GALERIA_DEFAULT_TEXTO,
            campania,
            campaniaTitulo: campTitulo || CAMPANIA_DEFAULT_TITULO,
            campaniaTexto: campTexto || CAMPANIA_DEFAULT_TEXTO,
            marcas,
            marcasTitulo: leerMarcasTitulo(),
            actualizado: ahora,
            actualizadoPor: nombre || "administrador"
        }, { merge: true });

        landingBanners = { ...landingBannersDraft };
        landingGaleria = galeria.map(i => ({ ...i }));
        landingCampania = campania.map(i => ({ ...i }));
        landingMarcas = marcas.map(i => ({ ...i }));
        renderLandingGrupos();
        renderLandingGaleria();
        renderLandingCampania();
        renderLandingMarcas();
        renderLandingMeta(ahora);
        showNotifToast(
            marcasDescartadas > 0
                ? `Landing actualizada. ${marcasDescartadas} marca${marcasDescartadas === 1 ? "" : "s"} sin nombre no se publico`
                : "Landing actualizada. Los cambios ya estan publicados"
        );
    } catch (err) {
        console.error("[landing] error guardando config", err);
        showNotifToast("No se pudo guardar la configuracion");
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
}

// ===== VISTA PREVIA DE LA LANDING (ventana emergente) =====
// Escribe el borrador en localStorage y abre el sitio con ?preview=1
// dentro de un iframe, para ver los cambios antes de publicarlos.

function borradorLandingActual() {
    const titulo = document.getElementById("galeriaTituloInput").value.trim();
    const texto  = document.getElementById("galeriaTextoInput").value.trim();

    return {
        banners: { ...landingBannersDraft },
        hero: leerHeroInputs(),
        galeria: landingGaleria
            .filter(i => i.url && (i.tipo !== "video" || esVideoValido(i.url)))
            .map(({ id, tipo, url, portada, titulo, texto }) =>
                ({ id, tipo, url, portada: portada || "", titulo: titulo || "", texto: texto || "" })),
        galeriaTitulo: titulo || GALERIA_DEFAULT_TITULO,
        galeriaTexto: texto || GALERIA_DEFAULT_TEXTO,
        campania: normalizarCampania(landingCampania),
        campaniaTitulo:
            document.getElementById("campaniaTituloInput").value.trim() || CAMPANIA_DEFAULT_TITULO,
        campaniaTexto:
            document.getElementById("campaniaTextoInput").value.trim() || CAMPANIA_DEFAULT_TEXTO,
        marcas: normalizarMarcas(landingMarcas),
        marcasTitulo: leerMarcasTitulo()
    };
}

function setupLandingPreviewModal() {
    const modal   = document.getElementById("previewModal");
    const frame   = document.getElementById("previewFrame");
    const stage   = document.getElementById("previewStage");
    const selPag  = document.getElementById("previewPagina");
    const nueva   = document.getElementById("previewNueva");
    if (!modal || !frame) return;

    function urlPreview() {
        const pagina = selPag.value || "index.html";
        const sep = pagina.includes("?") ? "&" : "?";
        return `${pagina}${sep}preview=1&t=${Date.now()}`;
    }

    function cargar() {
        // El borrador se guarda antes de cargar: el sitio lo lee al arrancar
        localStorage.setItem(PREVIEW_KEY, JSON.stringify(borradorLandingActual()));
        const url = urlPreview();
        frame.src = url;
        nueva.href = url;
    }

    function abrir() {
        cargar();
        modal.classList.add("is-open");
        document.body.style.overflow = "hidden";
    }

    function cerrar() {
        modal.classList.remove("is-open");
        frame.src = "about:blank";
        document.body.style.overflow = "";
    }

    document.getElementById("btnLandingPreview").addEventListener("click", abrir);
    document.getElementById("previewCerrar").addEventListener("click", cerrar);
    document.getElementById("previewRecargar").addEventListener("click", cargar);
    selPag.addEventListener("change", cargar);

    modal.addEventListener("click", e => { if (e.target === modal) cerrar(); });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && modal.classList.contains("is-open")) cerrar();
    });

    // Cambio de tamaño de pantalla simulado
    modal.querySelectorAll(".preview-dev").forEach(btn => {
        btn.addEventListener("click", () => {
            modal.querySelectorAll(".preview-dev").forEach(b => b.classList.remove("is-active"));
            btn.classList.add("is-active");
            stage.dataset.dev = btn.dataset.dev;
        });
    });
}

// ============================================================
// ===== PRODUCCION DEL DIA ===================================
// El administrador programa que ordenes se deben producir en
// una fecha. El jefe de produccion marca cuales salieron ese
// dia; las que no, quedan pendientes y el admin las reagenda.
//
// Coleccion Firestore: "produccionDia"
//   id del doc = fecha en formato YYYY-MM-DD
//   {
//     fecha: "YYYY-MM-DD",
//     ordenes: [{
//        ordenId, numero, cliente, negocio, tipo, items,
//        estado: "pendiente" | "completado",
//        nota, agregadoPor, fechaAgregado,
//        completadoPor, fechaCompletado, reagendadoDe
//     }],
//     creadoPor, actualizadoPor, actualizado
//   }
// ============================================================

function pdiaHoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pdiaEsc(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

function pdiaFechaLarga(iso) {
    if (!iso) return "--";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-CO", {
        weekday: "long", day: "numeric", month: "long", year: "numeric"
    });
}

function pdiaFechaCorta(iso) {
    if (!iso) return "--";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

function pdiaSumarDias(iso, dias) {
    const [y, m, d] = iso.split("-").map(Number);
    const f = new Date(y, m - 1, d);
    f.setDate(f.getDate() + dias);
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

function pdiaEsAdmin()  { return rol === "administrador"; }
function pdiaPuedeReportar() { return rol === "administrador" || rol === "jefe_produccion"; }

// Resumen corto de los productos de una orden
function pdiaResumenItems(items) {
    if (!Array.isArray(items) || items.length === 0) return "Sin productos";
    return items.map(i => {
        const nombre = i.producto || i.nombre || i.descripcion || "Producto";
        const cant   = i.cantidad ? ` x${i.cantidad}` : "";
        return nombre + cant;
    }).join(", ");
}

// ===== SETUP =====
function setupProduccionDia() {
    const inputFecha = document.getElementById("pdiaFecha");
    if (!inputFecha) return;

    inputFecha.value = pdiaFechaActual;

    inputFecha.addEventListener("change", () => {
        pdiaFechaActual = inputFecha.value || pdiaHoyISO();
        inputFecha.value = pdiaFechaActual;
        cargarProduccionDia();
    });

    document.getElementById("pdiaDiaAnterior").addEventListener("click", () => {
        pdiaFechaActual = pdiaSumarDias(pdiaFechaActual, -1);
        inputFecha.value = pdiaFechaActual;
        cargarProduccionDia();
    });
    document.getElementById("pdiaDiaSiguiente").addEventListener("click", () => {
        pdiaFechaActual = pdiaSumarDias(pdiaFechaActual, 1);
        inputFecha.value = pdiaFechaActual;
        cargarProduccionDia();
    });
    document.getElementById("pdiaHoy").addEventListener("click", () => {
        pdiaFechaActual = pdiaHoyISO();
        inputFecha.value = pdiaFechaActual;
        cargarProduccionDia();
    });

    // Solo el admin programa ordenes
    const btnAgregar = document.getElementById("pdiaBtnAgregar");
    if (pdiaEsAdmin()) {
        btnAgregar.addEventListener("click", abrirPdiaSelect);
    } else if (btnAgregar) {
        btnAgregar.style.display = "none";
    }

    setupPdiaSelectModal();
    setupPdiaReagendarModal();

    setupPdespModal();

    // Al entrar a cada tab, recargar su contenido
    document.querySelectorAll("#pdiaTabBar .tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            if (btn.dataset.tab === "pdiaPendientes") cargarPdiaPendientes();
            if (btn.dataset.tab === "pdiaDespachos")  cargarPdespDespachos();
        });
    });

    // Filtros del tab de despachos
    const chkTodos = document.getElementById("pdespVerTodos");
    if (chkTodos) chkTodos.addEventListener("change", renderPdespDespachos);
    const inputBuscarDesp = document.getElementById("pdespBuscar");
    if (inputBuscarDesp) inputBuscarDesp.addEventListener("input", renderPdespDespachos);
    const btnNuevoDesp = document.getElementById("pdespBtnNuevo");
    if (btnNuevoDesp) btnNuevoDesp.addEventListener("click", abrirPdespModal);
}

// ===== CARGA DEL PLAN DEL DIA =====
async function cargarProduccionDia() {
    const tbody = document.getElementById("pdiaTablaBody");
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="tabla-empty">Cargando plan del dia...</td></tr>';

    try {
        const snap = await getDoc(doc(db, PDIA_COL, pdiaFechaActual));
        pdiaPlanCache = snap.exists() ? { id: snap.id, ...snap.data() } : { id: pdiaFechaActual, fecha: pdiaFechaActual, ordenes: [] };
    } catch (e) {
        console.error("Error cargando produccion del dia", e);
        tbody.innerHTML = '<tr><td colspan="7" class="tabla-empty">Error al cargar el plan del dia.</td></tr>';
        return;
    }

    renderProduccionDia();
    cargarPdiaPendientes();
    // Si ya se cargaron los despachos, re-renderizarlos con la nueva fecha
    if (pdespDiasCache.length > 0) renderPdespDespachos();
}

function renderProduccionDia() {
    const tbody  = document.getElementById("pdiaTablaBody");
    const banner = document.getElementById("pdiaBanner");
    const footer = document.getElementById("pdiaFooter");
    if (!tbody) return;

    const ordenes = (pdiaPlanCache && pdiaPlanCache.ordenes) || [];

    banner.innerHTML = `<i class="bi bi-calendar2-week"></i> Plan de <strong>${pdiaEsc(pdiaFechaLarga(pdiaFechaActual))}</strong>`;

    renderPdiaResumen(ordenes);

    if (ordenes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="tabla-empty">${
            pdiaEsAdmin()
                ? "No hay ordenes programadas para este dia. Usa \"Programar ordenes\" para agregarlas."
                : "El administrador aun no ha programado ordenes para este dia."
        }</td></tr>`;
        footer.innerHTML = "";
        return;
    }

    tbody.innerHTML = ordenes.map(o => {
        const completado = o.estado === "completado";
        const registro = completado
            ? `<span class="pdia-registro">Por ${pdiaEsc(o.completadoPor || "--")}<br><small>${o.fechaCompletado ? new Date(o.fechaCompletado).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</small></span>`
            : `<span class="pdia-registro"><small>${o.reagendadoDe ? "Reagendada de " + pdiaEsc(pdiaFechaCorta(o.reagendadoDe)) : "Sin reportar"}</small></span>`;

        let acciones = "";
        if (pdiaPuedeReportar()) {
            acciones += completado
                ? `<button class="btn-icon pdia-btn-revertir" data-id="${pdiaEsc(o.ordenId)}" title="Marcar como pendiente"><i class="bi bi-arrow-counterclockwise"></i></button>`
                : `<button class="btn-icon pdia-btn-completar" data-id="${pdiaEsc(o.ordenId)}" title="Marcar como producida hoy"><i class="bi bi-check2-circle"></i></button>`;
        }
        if (pdiaEsAdmin()) {
            if (!completado) {
                acciones += `<button class="btn-icon pdia-btn-reagendar" data-id="${pdiaEsc(o.ordenId)}" title="Reagendar a otro dia"><i class="bi bi-calendar2-event"></i></button>`;
            }
            acciones += `<button class="btn-icon btn-delete pdia-btn-quitar" data-id="${pdiaEsc(o.ordenId)}" title="Quitar del plan"><i class="bi bi-trash3"></i></button>`;
        }

        return `
            <tr class="${completado ? "pdia-row-ok" : ""}">
                <td><strong>${pdiaEsc(o.numero || o.ordenId)}</strong></td>
                <td>${pdiaEsc(o.cliente || "--")}${o.negocio ? `<br><small>${pdiaEsc(o.negocio)}</small>` : ""}</td>
                <td><span class="pdia-tipo">${pdiaEsc(o.tipo || "--")}</span></td>
                <td><small>${pdiaEsc(pdiaResumenItems(o.items))}</small></td>
                <td><span class="pdia-badge ${completado ? "completado" : "pendiente"}">${completado ? "Producida" : "Pendiente"}</span></td>
                <td>${registro}</td>
                <td><div class="pdia-acciones">${acciones}</div></td>
            </tr>`;
    }).join("");

    const pendientes = ordenes.filter(o => o.estado !== "completado");
    footer.innerHTML = pdiaPuedeReportar() && pendientes.length > 0
        ? `<div class="pdia-footer-inner">
               <span>${pendientes.length} orden(es) sin reportar</span>
               <button class="btn-save" id="pdiaBtnCompletarTodas"><i class="bi bi-check-all"></i> Marcar todas como producidas</button>
           </div>`
        : "";

    const btnTodas = document.getElementById("pdiaBtnCompletarTodas");
    if (btnTodas) {
        btnTodas.addEventListener("click", () => {
            showConfirm(
                "Confirmar produccion",
                `Marcar las ${pendientes.length} orden(es) restantes como producidas el ${pdiaFechaLarga(pdiaFechaActual)}?`,
                () => pdiaMarcarTodas()
            );
        });
    }

    tbody.querySelectorAll(".pdia-btn-completar").forEach(b =>
        b.addEventListener("click", () => pdiaCambiarEstado(b.dataset.id, "completado")));
    tbody.querySelectorAll(".pdia-btn-revertir").forEach(b =>
        b.addEventListener("click", () => pdiaCambiarEstado(b.dataset.id, "pendiente")));
    tbody.querySelectorAll(".pdia-btn-reagendar").forEach(b =>
        b.addEventListener("click", () => abrirPdiaReagendar(pdiaFechaActual, b.dataset.id)));
    tbody.querySelectorAll(".pdia-btn-quitar").forEach(b =>
        b.addEventListener("click", () => {
            const o = (pdiaPlanCache.ordenes || []).find(x => x.ordenId === b.dataset.id);
            showConfirm("Quitar del plan", `Quitar la orden ${o ? (o.numero || o.ordenId) : ""} del plan de este dia?`,
                () => pdiaQuitarOrden(b.dataset.id));
        }));
}

function renderPdiaResumen(ordenes) {
    const cont = document.getElementById("pdiaResumen");
    if (!cont) return;
    const total = ordenes.length;
    const hechas = ordenes.filter(o => o.estado === "completado").length;
    const pend = total - hechas;
    const pct = total ? Math.round((hechas / total) * 100) : 0;

    cont.innerHTML = `
        <div class="pdia-card">
            <span class="pdia-card-label">Programadas</span>
            <span class="pdia-card-valor">${total}</span>
        </div>
        <div class="pdia-card ok">
            <span class="pdia-card-label">Producidas</span>
            <span class="pdia-card-valor">${hechas}</span>
        </div>
        <div class="pdia-card warn">
            <span class="pdia-card-label">Pendientes</span>
            <span class="pdia-card-valor">${pend}</span>
        </div>
        <div class="pdia-card">
            <span class="pdia-card-label">Cumplimiento</span>
            <span class="pdia-card-valor">${pct}%</span>
            <div class="pdia-progress"><div style="width:${pct}%"></div></div>
        </div>`;
}

// ===== GUARDADO DEL PLAN =====
async function pdiaGuardarPlan(fecha, ordenes) {
    const payload = {
        fecha,
        ordenes,
        actualizadoPor: sessionStorage.getItem("userName") || "",
        actualizado: new Date().toISOString()
    };
    await setDoc(doc(db, PDIA_COL, fecha), payload, { merge: true });
    return payload;
}

async function pdiaCambiarEstado(ordenId, nuevoEstado) {
    if (!pdiaPuedeReportar() || !pdiaPlanCache) return;
    const ordenes = (pdiaPlanCache.ordenes || []).map(o => {
        if (o.ordenId !== ordenId) return o;
        if (nuevoEstado === "completado") {
            return {
                ...o,
                estado: "completado",
                completadoPor: sessionStorage.getItem("userName") || "",
                fechaCompletado: new Date().toISOString()
            };
        }
        const { completadoPor, fechaCompletado, ...resto } = o;
        return { ...resto, estado: "pendiente" };
    });

    try {
        await pdiaGuardarPlan(pdiaFechaActual, ordenes);
        pdiaPlanCache.ordenes = ordenes;
        renderProduccionDia();
        cargarPdiaPendientes();
        showNotifToast(nuevoEstado === "completado" ? "Orden marcada como producida" : "Orden devuelta a pendiente");
    } catch (e) {
        console.error(e);
        showNotifToast("No se pudo actualizar la orden");
    }
}

async function pdiaMarcarTodas() {
    if (!pdiaPuedeReportar() || !pdiaPlanCache) return;
    const ahora = new Date().toISOString();
    const quien = sessionStorage.getItem("userName") || "";
    const ordenes = (pdiaPlanCache.ordenes || []).map(o =>
        o.estado === "completado" ? o : { ...o, estado: "completado", completadoPor: quien, fechaCompletado: ahora }
    );
    try {
        await pdiaGuardarPlan(pdiaFechaActual, ordenes);
        pdiaPlanCache.ordenes = ordenes;
        renderProduccionDia();
        cargarPdiaPendientes();
        showNotifToast("Plan del dia completado");
    } catch (e) {
        console.error(e);
        showNotifToast("No se pudo completar el plan");
    }
}

async function pdiaQuitarOrden(ordenId) {
    if (!pdiaEsAdmin() || !pdiaPlanCache) return;
    const ordenes = (pdiaPlanCache.ordenes || []).filter(o => o.ordenId !== ordenId);
    try {
        await pdiaGuardarPlan(pdiaFechaActual, ordenes);
        pdiaPlanCache.ordenes = ordenes;
        renderProduccionDia();
        cargarPdiaPendientes();
        showNotifToast("Orden retirada del plan");
    } catch (e) {
        console.error(e);
        showNotifToast("No se pudo quitar la orden");
    }
}

// ===== MODAL: SELECCIONAR ORDENES A PROGRAMAR =====
function setupPdiaSelectModal() {
    const overlay = document.getElementById("pdiaSelectOverlay");
    if (!overlay) return;
    const cerrar = () => overlay.classList.remove("show");

    document.getElementById("pdiaSelectClose").addEventListener("click", cerrar);
    document.getElementById("pdiaSelectCancel").addEventListener("click", cerrar);
    overlay.addEventListener("click", e => { if (e.target === overlay) cerrar(); });
    document.getElementById("pdiaSelectBuscar").addEventListener("input", renderPdiaSelectLista);
    document.getElementById("pdiaSelectSave").addEventListener("click", pdiaProgramarSeleccion);
}

async function abrirPdiaSelect() {
    const overlay = document.getElementById("pdiaSelectOverlay");
    pdiaSeleccion = new Set();
    document.getElementById("pdiaSelectBuscar").value = "";
    document.getElementById("pdiaSelectFechaLabel").textContent = pdiaFechaLarga(pdiaFechaActual);
    document.getElementById("pdiaSelectLista").innerHTML = '<p class="placeholder-text">Cargando ordenes...</p>';
    overlay.classList.add("show");

    try {
        const snap = await getDocs(collection(db, "produccion"));
        pdiaOrdenesCache = [];
        snap.forEach(d => pdiaOrdenesCache.push({ id: d.id, ...d.data() }));
        // Solo ordenes vivas: no eliminadas y no terminadas
        pdiaOrdenesCache = pdiaOrdenesCache
            .filter(o => !o.eliminado && o.pasoActual !== "terminado" && o.estado !== "terminado")
            .sort((a, b) => (b.fechaEnvio || "").localeCompare(a.fechaEnvio || ""));
        renderPdiaSelectLista();
    } catch (e) {
        console.error(e);
        document.getElementById("pdiaSelectLista").innerHTML = '<p class="placeholder-text">Error al cargar las ordenes.</p>';
    }
}

function renderPdiaSelectLista() {
    const cont = document.getElementById("pdiaSelectLista");
    const term = (document.getElementById("pdiaSelectBuscar").value || "").toLowerCase().trim();
    const yaEnPlan = new Set(((pdiaPlanCache && pdiaPlanCache.ordenes) || []).map(o => o.ordenId));

    const lista = pdiaOrdenesCache.filter(o => {
        if (!term) return true;
        return [o.numero, o.cliente, o.negocio, o.tipo].some(v => String(v || "").toLowerCase().includes(term));
    });

    if (lista.length === 0) {
        cont.innerHTML = '<p class="placeholder-text">No se encontraron ordenes en produccion.</p>';
        pdiaActualizarContador();
        return;
    }

    cont.innerHTML = lista.map(o => {
        const enPlan = yaEnPlan.has(o.id);
        const checked = pdiaSeleccion.has(o.id) ? "checked" : "";
        return `
            <label class="pdia-select-item ${enPlan ? "ya-en-plan" : ""}">
                <input type="checkbox" data-id="${pdiaEsc(o.id)}" ${checked} ${enPlan ? "disabled" : ""}>
                <span class="pdia-select-info">
                    <strong>${pdiaEsc(o.numero || o.id)}</strong>
                    <span>${pdiaEsc(o.cliente || "--")}${o.negocio ? " · " + pdiaEsc(o.negocio) : ""}</span>
                    <small>${pdiaEsc(o.tipo || "")} · etapa: ${pdiaEsc(o.pasoActual || "recibido")} · ${pdiaEsc(pdiaResumenItems(o.items))}</small>
                </span>
                ${enPlan ? '<span class="pdia-badge completado">Ya programada</span>' : ""}
            </label>`;
    }).join("");

    cont.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.addEventListener("change", () => {
            if (chk.checked) pdiaSeleccion.add(chk.dataset.id);
            else pdiaSeleccion.delete(chk.dataset.id);
            pdiaActualizarContador();
        });
    });
    pdiaActualizarContador();
}

function pdiaActualizarContador() {
    const el = document.getElementById("pdiaSelectCount");
    if (el) el.textContent = `${pdiaSeleccion.size} seleccionada(s)`;
}

async function pdiaProgramarSeleccion() {
    if (pdiaSeleccion.size === 0) {
        showNotifToast("Selecciona al menos una orden");
        return;
    }
    const existentes = (pdiaPlanCache && pdiaPlanCache.ordenes) || [];
    const yaEnPlan = new Set(existentes.map(o => o.ordenId));
    const ahora = new Date().toISOString();
    const quien = sessionStorage.getItem("userName") || "";

    const nuevas = [...pdiaSeleccion]
        .filter(id => !yaEnPlan.has(id))
        .map(id => {
            const o = pdiaOrdenesCache.find(x => x.id === id) || {};
            return {
                ordenId: id,
                numero: o.numero || id,
                cliente: o.cliente || "",
                negocio: o.negocio || "",
                tipo: o.tipo || "",
                items: (o.items || []).map(i => ({
                    producto: i.producto || i.nombre || i.descripcion || "Producto",
                    cantidad: i.cantidad || 0
                })),
                estado: "pendiente",
                agregadoPor: quien,
                fechaAgregado: ahora
            };
        });

    try {
        const ordenes = existentes.concat(nuevas);
        await pdiaGuardarPlan(pdiaFechaActual, ordenes);
        if (!pdiaPlanCache) pdiaPlanCache = { fecha: pdiaFechaActual, ordenes: [] };
        pdiaPlanCache.ordenes = ordenes;
        document.getElementById("pdiaSelectOverlay").classList.remove("show");
        renderProduccionDia();
        cargarPdiaPendientes();
        showNotifToast(`${nuevas.length} orden(es) programada(s) para el ${pdiaFechaCorta(pdiaFechaActual)}`);
    } catch (e) {
        console.error(e);
        showNotifToast("No se pudieron programar las ordenes");
    }
}

// ===== PENDIENTES ACUMULADOS =====
async function cargarPdiaPendientes() {
    const tbody = document.getElementById("pdiaPendientesBody");
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="tabla-empty">Cargando pendientes...</td></tr>';

    try {
        const snap = await getDocs(collection(db, PDIA_COL));
        const hoy = pdiaHoyISO();
        const filas = [];
        snap.forEach(d => {
            const data = d.data();
            // Solo dias ya pasados (los de hoy o futuros aun estan en curso)
            if (d.id >= hoy) return;
            (data.ordenes || []).forEach(o => {
                if (o.estado !== "completado") filas.push({ fecha: d.id, ...o });
            });
        });
        filas.sort((a, b) => b.fecha.localeCompare(a.fecha));

        if (filas.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="tabla-empty">No hay ordenes pendientes de dias anteriores.</td></tr>';
            return;
        }

        tbody.innerHTML = filas.map(f => `
            <tr>
                <td><strong>${pdiaEsc(pdiaFechaCorta(f.fecha))}</strong><br><small>${pdiaEsc(f.fecha)}</small></td>
                <td>${pdiaEsc(f.numero || f.ordenId)}</td>
                <td>${pdiaEsc(f.cliente || "--")}${f.negocio ? `<br><small>${pdiaEsc(f.negocio)}</small>` : ""}</td>
                <td><span class="pdia-tipo">${pdiaEsc(f.tipo || "--")}</span></td>
                <td><span class="pdia-badge pendiente">No producida</span></td>
                <td><div class="pdia-acciones">${
                    pdiaEsAdmin()
                        ? `<button class="btn-icon pdia-btn-reagendar-pend" data-fecha="${pdiaEsc(f.fecha)}" data-id="${pdiaEsc(f.ordenId)}" title="Reagendar"><i class="bi bi-calendar2-event"></i></button>`
                        : ""
                }</div></td>
            </tr>`).join("");

        tbody.querySelectorAll(".pdia-btn-reagendar-pend").forEach(b =>
            b.addEventListener("click", () => abrirPdiaReagendar(b.dataset.fecha, b.dataset.id)));
    } catch (e) {
        console.error("Error cargando pendientes de produccion", e);
        tbody.innerHTML = '<tr><td colspan="6" class="tabla-empty">Error al cargar pendientes.</td></tr>';
    }
}

// ===== MODAL: REAGENDAR =====
function setupPdiaReagendarModal() {
    const overlay = document.getElementById("pdiaReagendarOverlay");
    if (!overlay) return;
    const cerrar = () => { overlay.classList.remove("show"); pdiaReagendarCtx = null; };

    document.getElementById("pdiaReagendarClose").addEventListener("click", cerrar);
    document.getElementById("pdiaReagendarCancel").addEventListener("click", cerrar);
    overlay.addEventListener("click", e => { if (e.target === overlay) cerrar(); });
    document.getElementById("pdiaReagendarSave").addEventListener("click", pdiaReagendarConfirmar);
}

async function abrirPdiaReagendar(fecha, ordenId) {
    if (!pdiaEsAdmin()) return;
    let orden = null;
    if (fecha === pdiaFechaActual && pdiaPlanCache) {
        orden = (pdiaPlanCache.ordenes || []).find(o => o.ordenId === ordenId);
    }
    if (!orden) {
        const snap = await getDoc(doc(db, PDIA_COL, fecha));
        if (snap.exists()) orden = (snap.data().ordenes || []).find(o => o.ordenId === ordenId);
    }
    if (!orden) {
        showNotifToast("No se encontro la orden en el plan");
        return;
    }

    pdiaReagendarCtx = { fecha, ordenId };
    document.getElementById("pdiaReagendarInfo").innerHTML =
        `Orden <strong>${pdiaEsc(orden.numero || ordenId)}</strong> de ${pdiaEsc(orden.cliente || "--")}, programada el ${pdiaEsc(pdiaFechaLarga(fecha))}.`;
    document.getElementById("pdiaReagendarFecha").value = pdiaSumarDias(pdiaHoyISO(), 1);
    document.getElementById("pdiaReagendarOverlay").classList.add("show");
}

async function pdiaReagendarConfirmar() {
    if (!pdiaReagendarCtx) return;
    const nueva = document.getElementById("pdiaReagendarFecha").value;
    if (!nueva) {
        showNotifToast("Selecciona una fecha");
        return;
    }
    const { fecha, ordenId } = pdiaReagendarCtx;
    if (nueva === fecha) {
        showNotifToast("La orden ya esta programada en esa fecha");
        return;
    }

    try {
        // Quitar del dia original
        const origenSnap = await getDoc(doc(db, PDIA_COL, fecha));
        if (!origenSnap.exists()) { showNotifToast("El plan de origen no existe"); return; }
        const origenOrdenes = origenSnap.data().ordenes || [];
        const orden = origenOrdenes.find(o => o.ordenId === ordenId);
        if (!orden) { showNotifToast("La orden ya no esta en ese plan"); return; }
        await pdiaGuardarPlan(fecha, origenOrdenes.filter(o => o.ordenId !== ordenId));

        // Agregar al dia destino (sin duplicar)
        const destinoSnap = await getDoc(doc(db, PDIA_COL, nueva));
        const destinoOrdenes = destinoSnap.exists() ? (destinoSnap.data().ordenes || []) : [];
        if (!destinoOrdenes.some(o => o.ordenId === ordenId)) {
            const { completadoPor, fechaCompletado, ...limpio } = orden;
            destinoOrdenes.push({
                ...limpio,
                estado: "pendiente",
                reagendadoDe: fecha,
                agregadoPor: sessionStorage.getItem("userName") || "",
                fechaAgregado: new Date().toISOString()
            });
        }
        await pdiaGuardarPlan(nueva, destinoOrdenes);

        document.getElementById("pdiaReagendarOverlay").classList.remove("show");
        pdiaReagendarCtx = null;
        await cargarProduccionDia();
        showNotifToast(`Orden reagendada al ${pdiaFechaCorta(nueva)}`);
    } catch (e) {
        console.error(e);
        showNotifToast("No se pudo reagendar la orden");
    }
}

// ============================================================
// ===== DESPACHOS DIARIOS ====================================
// Registro de lo que realmente salio de cada orden, por dia.
// Soporta despachos parciales: una orden puede despacharse en
// varios dias y el saldo pendiente se calcula acumulando todos
// los despachos historicos de esa orden.
//
// Coleccion Firestore: "despachosDia"
//   id del doc = fecha en formato YYYY-MM-DD
//   {
//     fecha: "YYYY-MM-DD",
//     despachos: [{
//        despachoId, ordenId, numero, cliente, negocio, nit,
//        telefono, direccion, ciudad, tipo,
//        items: [{ itemIdx, producto, cantidadOrdenada, cantidadDespachada }],
//        observaciones, fecha: ISO, creadoPor
//     }]
//   }
// ============================================================

// Total ya despachado de una orden, por indice de producto, sumando todos los
// dias. Si se pasa "excluirDespachoId", ese despacho no se cuenta (util para
// mostrar "ya despachado antes de este").
function pdespAcumuladoPorItem(ordenId, excluirDespachoId) {
    const acum = {};
    pdespDiasCache.forEach(dia => {
        (dia.despachos || []).forEach(d => {
            if (d.ordenId !== ordenId) return;
            if (excluirDespachoId && d.despachoId === excluirDespachoId) return;
            (d.items || []).forEach(i => {
                const key = i.itemIdx !== undefined && i.itemIdx !== null ? i.itemIdx : i.producto;
                acum[key] = (acum[key] || 0) + (parseInt(i.cantidadDespachada) || 0);
            });
        });
    });
    return acum;
}

// Enriquece los items de un despacho con acumulado y pendiente de la orden.
function pdespResolverItems(despacho) {
    const acum = pdespAcumuladoPorItem(despacho.ordenId);
    return (despacho.items || []).map(i => {
        const key = i.itemIdx !== undefined && i.itemIdx !== null ? i.itemIdx : i.producto;
        const ordenada   = parseInt(i.cantidadOrdenada) || 0;
        const despachada = parseInt(i.cantidadDespachada) || 0;
        const acumulado  = acum[key] || 0;
        return {
            ...i,
            cantidadOrdenada: ordenada,
            cantidadDespachada: despachada,
            acumulado,
            pendiente: Math.max(0, ordenada - acumulado)
        };
    });
}

// ===== CARGA =====
async function cargarPdespDespachos() {
    const cont = document.getElementById("pdespLista");
    if (!cont) return;
    cont.innerHTML = '<p class="placeholder-text">Cargando despachos...</p>';

    try {
        const snap = await getDocs(collection(db, PDESP_COL));
        pdespDiasCache = [];
        snap.forEach(d => pdespDiasCache.push({ fecha: d.id, ...d.data() }));
        pdespDiasCache.sort((a, b) => b.fecha.localeCompare(a.fecha));
        renderPdespDespachos();
    } catch (e) {
        console.error("Error cargando despachos", e);
        cont.innerHTML = '<p class="placeholder-text">Error al cargar los despachos.</p>';
    }
}

function renderPdespDespachos() {
    const cont = document.getElementById("pdespLista");
    if (!cont) return;

    const verTodos = document.getElementById("pdespVerTodos")?.checked;
    const term = (document.getElementById("pdespBuscar")?.value || "").toLowerCase().trim();

    // Dias a mostrar: solo el seleccionado, o todos
    let dias = verTodos
        ? pdespDiasCache
        : pdespDiasCache.filter(d => d.fecha === pdiaFechaActual);

    // Aplicar busqueda sobre los despachos de cada dia
    dias = dias.map(dia => ({
        fecha: dia.fecha,
        despachos: (dia.despachos || []).filter(d => {
            if (!term) return true;
            return [d.numero, d.cliente, d.negocio, d.tipo].some(v => String(v || "").toLowerCase().includes(term));
        })
    })).filter(dia => dia.despachos.length > 0);

    renderPdespResumen(dias, verTodos);

    if (dias.length === 0) {
        cont.innerHTML = `<div class="empty-state"><i class="bi bi-truck"></i><p>${
            verTodos
                ? (term ? "Ningun despacho coincide con la busqueda." : "Aun no hay despachos registrados.")
                : `No hay despachos registrados el ${pdiaEsc(pdiaFechaLarga(pdiaFechaActual))}.`
        }</p></div>`;
        return;
    }

    cont.innerHTML = dias.map(dia => {
        const totalDia = dia.despachos.reduce((s, d) =>
            s + (d.items || []).reduce((t, i) => t + (parseInt(i.cantidadDespachada) || 0), 0), 0);

        const cards = dia.despachos
            .slice()
            .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")))
            .map(d => pdespCardHtml(d, dia.fecha))
            .join("");

        return `
            <div class="pdesp-dia">
                <div class="pdesp-dia-header">
                    <span class="pdesp-dia-fecha"><i class="bi bi-calendar2-week"></i> ${pdiaEsc(pdiaFechaLarga(dia.fecha))}</span>
                    <span class="pdesp-dia-meta">${dia.despachos.length} despacho(s) · ${totalDia.toLocaleString("es-CO")} unidades</span>
                </div>
                ${cards}
            </div>`;
    }).join("");

    // Acciones
    cont.querySelectorAll(".pdesp-btn-pdf").forEach(b =>
        b.addEventListener("click", () => pdespImprimirPDF(b.dataset.fecha, b.dataset.id)));
    cont.querySelectorAll(".pdesp-btn-eliminar").forEach(b =>
        b.addEventListener("click", () => {
            showConfirm("Eliminar despacho",
                "Eliminar este registro de despacho? Las unidades volveran a contarse como pendientes.",
                () => pdespEliminar(b.dataset.fecha, b.dataset.id));
        }));
}

function pdespCardHtml(d, fechaDia) {
    const items = pdespResolverItems(d);
    const hora = d.fecha ? new Date(d.fecha).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "";
    const totalDespachado = items.reduce((s, i) => s + i.cantidadDespachada, 0);
    const totalPendiente  = items.reduce((s, i) => s + i.pendiente, 0);
    const completa = totalPendiente === 0;

    const filas = items.map(i => `
        <tr>
            <td>${pdiaEsc(i.producto || "-")}</td>
            <td class="pdesp-num">${i.cantidadOrdenada.toLocaleString("es-CO")}</td>
            <td class="pdesp-num pdesp-num-fuerte">${i.cantidadDespachada.toLocaleString("es-CO")}</td>
            <td class="pdesp-num">${i.acumulado.toLocaleString("es-CO")}</td>
            <td class="pdesp-num ${i.pendiente > 0 ? "pdesp-num-pend" : "pdesp-num-ok"}">${i.pendiente.toLocaleString("es-CO")}</td>
        </tr>`).join("");

    return `
        <div class="pdesp-card">
            <div class="pdesp-card-header">
                <div class="pdesp-card-info">
                    <span class="pdesp-card-numero">${pdiaEsc(d.numero || d.ordenId)}
                        <span class="pdia-tipo">${pdiaEsc(d.tipo || "--")}</span>
                    </span>
                    <span class="pdesp-card-cliente">${pdiaEsc(d.cliente || "--")}${d.negocio ? " · " + pdiaEsc(d.negocio) : ""}</span>
                    <small>${hora ? "Despachado " + hora + " · " : ""}por ${pdiaEsc(d.creadoPor || "--")}</small>
                </div>
                <div class="pdesp-card-right">
                    <span class="pdia-badge ${completa ? "completado" : "pendiente"}">${completa ? "Orden completa" : totalPendiente.toLocaleString("es-CO") + " pendientes"}</span>
                    <div class="pdia-acciones">
                        <button class="btn-icon pdesp-btn-pdf" data-fecha="${pdiaEsc(fechaDia)}" data-id="${pdiaEsc(d.despachoId)}" title="Imprimir remision en PDF"><i class="bi bi-file-earmark-pdf"></i></button>
                        ${pdiaEsAdmin() ? `<button class="btn-icon btn-delete pdesp-btn-eliminar" data-fecha="${pdiaEsc(fechaDia)}" data-id="${pdiaEsc(d.despachoId)}" title="Eliminar despacho"><i class="bi bi-trash3"></i></button>` : ""}
                    </div>
                </div>
            </div>
            <div class="clientes-tabla-wrap">
                <table class="clientes-tabla pdesp-tabla">
                    <thead>
                        <tr>
                            <th>Producto</th>
                            <th class="pdesp-num">Ordenado</th>
                            <th class="pdesp-num">Despachado</th>
                            <th class="pdesp-num">Acumulado</th>
                            <th class="pdesp-num">Pendiente</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
            <div class="pdesp-card-footer">
                <span><i class="bi bi-box-seam"></i> ${totalDespachado.toLocaleString("es-CO")} unidades en este despacho</span>
                ${d.observaciones ? `<span class="pdesp-obs"><i class="bi bi-chat-left-text"></i> ${pdiaEsc(d.observaciones)}</span>` : ""}
            </div>
        </div>`;
}

function renderPdespResumen(dias, verTodos) {
    const cont = document.getElementById("pdespResumen");
    if (!cont) return;

    const despachos = dias.flatMap(d => d.despachos);
    const unidades = despachos.reduce((s, d) =>
        s + (d.items || []).reduce((t, i) => t + (parseInt(i.cantidadDespachada) || 0), 0), 0);
    const ordenes = new Set(despachos.map(d => d.ordenId)).size;
    const parciales = despachos.filter(d => pdespResolverItems(d).some(i => i.pendiente > 0)).length;

    cont.innerHTML = `
        <div class="pdia-card">
            <span class="pdia-card-label">${verTodos ? "Despachos (historico)" : "Despachos del dia"}</span>
            <span class="pdia-card-valor">${despachos.length}</span>
        </div>
        <div class="pdia-card ok">
            <span class="pdia-card-label">Unidades despachadas</span>
            <span class="pdia-card-valor">${unidades.toLocaleString("es-CO")}</span>
        </div>
        <div class="pdia-card">
            <span class="pdia-card-label">Ordenes distintas</span>
            <span class="pdia-card-valor">${ordenes}</span>
        </div>
        <div class="pdia-card warn">
            <span class="pdia-card-label">Con saldo pendiente</span>
            <span class="pdia-card-valor">${parciales}</span>
        </div>`;
}

// ===== PDF =====
function pdespImprimirPDF(fechaDia, despachoId) {
    if (typeof window.exportarDespachoPDF !== "function") {
        showNotifToast("El modulo de PDF no esta disponible");
        return;
    }
    const dia = pdespDiasCache.find(d => d.fecha === fechaDia);
    const d = dia && (dia.despachos || []).find(x => x.despachoId === despachoId);
    if (!d) {
        showNotifToast("No se encontro el despacho");
        return;
    }
    window.exportarDespachoPDF({ ...d, fechaDia, items: pdespResolverItems(d) });
}

// ===== ELIMINAR =====
async function pdespEliminar(fechaDia, despachoId) {
    if (!pdiaEsAdmin()) return;
    try {
        const ref = doc(db, PDESP_COL, fechaDia);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        const despachos = (data.despachos || []).filter(d => d.despachoId !== despachoId);
        await setDoc(ref, {
            fecha: fechaDia,
            despachos,
            actualizadoPor: sessionStorage.getItem("userName") || "",
            actualizado: new Date().toISOString()
        }, { merge: true });

        const dia = pdespDiasCache.find(d => d.fecha === fechaDia);
        if (dia) dia.despachos = despachos;
        renderPdespDespachos();
        showNotifToast("Despacho eliminado");
    } catch (e) {
        console.error(e);
        showNotifToast("No se pudo eliminar el despacho");
    }
}

// ===== MODAL: REGISTRAR DESPACHO =====
function setupPdespModal() {
    const overlay = document.getElementById("pdespOverlay");
    if (!overlay) return;
    const cerrar = () => { overlay.classList.remove("show"); pdespOrdenSel = null; };

    document.getElementById("pdespClose").addEventListener("click", cerrar);
    document.getElementById("pdespCancel").addEventListener("click", cerrar);
    overlay.addEventListener("click", e => { if (e.target === overlay) cerrar(); });
    document.getElementById("pdespOrdenBuscar").addEventListener("input", renderPdespOrdenLista);
    document.getElementById("pdespVolver").addEventListener("click", pdespVolverAPaso1);
    document.getElementById("pdespSave").addEventListener("click", pdespGuardar);
}

async function abrirPdespModal() {
    const overlay = document.getElementById("pdespOverlay");
    pdespOrdenSel = null;
    document.getElementById("pdespOrdenBuscar").value = "";
    document.getElementById("pdespObs").value = "";
    document.getElementById("pdespFecha").value = pdiaFechaActual;
    pdespVolverAPaso1();
    document.getElementById("pdespOrdenLista").innerHTML = '<p class="placeholder-text">Cargando ordenes...</p>';
    overlay.classList.add("show");

    // Asegurar que el historico de despachos este cargado para calcular pendientes
    if (pdespDiasCache.length === 0) {
        try {
            const snap = await getDocs(collection(db, PDESP_COL));
            pdespDiasCache = [];
            snap.forEach(d => pdespDiasCache.push({ fecha: d.id, ...d.data() }));
            pdespDiasCache.sort((a, b) => b.fecha.localeCompare(a.fecha));
        } catch (e) {
            console.warn("No se pudo cargar el historico de despachos", e);
        }
    }

    try {
        const snap = await getDocs(collection(db, "produccion"));
        pdespOrdenesCache = [];
        snap.forEach(d => pdespOrdenesCache.push({ id: d.id, ...d.data() }));
        pdespOrdenesCache = pdespOrdenesCache
            .filter(o => !o.eliminado)
            .sort((a, b) => (b.fechaEnvio || "").localeCompare(a.fechaEnvio || ""));
        renderPdespOrdenLista();
    } catch (e) {
        console.error(e);
        document.getElementById("pdespOrdenLista").innerHTML = '<p class="placeholder-text">Error al cargar las ordenes.</p>';
    }
}

function pdespVolverAPaso1() {
    document.getElementById("pdespPaso1").style.display = "";
    document.getElementById("pdespPaso2").style.display = "none";
    document.getElementById("pdespSave").style.display = "none";
    pdespOrdenSel = null;
}

// Unidades pendientes totales de una orden (contra el historico de despachos)
function pdespPendienteOrden(orden) {
    const acum = pdespAcumuladoPorItem(orden.id);
    return (orden.items || []).reduce((s, item, idx) => {
        const ordenada = parseInt(item.cantidad) || 0;
        return s + Math.max(0, ordenada - (acum[idx] || 0));
    }, 0);
}

function renderPdespOrdenLista() {
    const cont = document.getElementById("pdespOrdenLista");
    const term = (document.getElementById("pdespOrdenBuscar").value || "").toLowerCase().trim();

    const lista = pdespOrdenesCache.filter(o => {
        if (!term) return true;
        return [o.numero, o.cliente, o.negocio, o.tipo].some(v => String(v || "").toLowerCase().includes(term));
    });

    if (lista.length === 0) {
        cont.innerHTML = '<p class="placeholder-text">No se encontraron ordenes.</p>';
        return;
    }

    cont.innerHTML = lista.map(o => {
        const pend = pdespPendienteOrden(o);
        const total = (o.items || []).reduce((s, i) => s + (parseInt(i.cantidad) || 0), 0);
        return `
            <div class="pdia-select-item pdesp-orden-item ${pend === 0 ? "ya-en-plan" : ""}" data-id="${pdiaEsc(o.id)}">
                <span class="pdia-select-info">
                    <strong>${pdiaEsc(o.numero || o.id)}</strong>
                    <span>${pdiaEsc(o.cliente || "--")}${o.negocio ? " · " + pdiaEsc(o.negocio) : ""}</span>
                    <small>${pdiaEsc(o.tipo || "")} · etapa: ${pdiaEsc(o.pasoActual || "recibido")} · ${total.toLocaleString("es-CO")} unidades ordenadas</small>
                </span>
                <span class="pdia-badge ${pend === 0 ? "completado" : "pendiente"}">${pend === 0 ? "Despachada" : pend.toLocaleString("es-CO") + " pendientes"}</span>
            </div>`;
    }).join("");

    cont.querySelectorAll(".pdesp-orden-item").forEach(el =>
        el.addEventListener("click", () => pdespElegirOrden(el.dataset.id)));
}

function pdespElegirOrden(ordenId) {
    const orden = pdespOrdenesCache.find(o => o.id === ordenId);
    if (!orden) return;
    pdespOrdenSel = orden;

    document.getElementById("pdespPaso1").style.display = "none";
    document.getElementById("pdespPaso2").style.display = "";
    document.getElementById("pdespSave").style.display = "";

    document.getElementById("pdespOrdenInfo").innerHTML = `
        <strong>${pdiaEsc(orden.numero || orden.id)}</strong>
        <span>${pdiaEsc(orden.cliente || "--")}${orden.negocio ? " · " + pdiaEsc(orden.negocio) : ""}</span>
        <small>${pdiaEsc(orden.tipo || "")}${orden.ciudad ? " · " + pdiaEsc(orden.ciudad) : ""}</small>`;

    const acum = pdespAcumuladoPorItem(orden.id);
    const items = orden.items || [];

    if (items.length === 0) {
        document.getElementById("pdespItemsBody").innerHTML =
            '<tr><td colspan="5" class="tabla-empty">Esta orden no tiene productos detallados.</td></tr>';
        return;
    }

    document.getElementById("pdespItemsBody").innerHTML = items.map((item, idx) => {
        const ordenada = parseInt(item.cantidad) || 0;
        const ya = acum[idx] || 0;
        const pend = Math.max(0, ordenada - ya);
        return `
            <tr>
                <td>${pdiaEsc(item.producto || item.nombre || "Producto")}</td>
                <td class="pdesp-num">${ordenada.toLocaleString("es-CO")}</td>
                <td class="pdesp-num">${ya.toLocaleString("es-CO")}</td>
                <td class="pdesp-num ${pend > 0 ? "pdesp-num-pend" : "pdesp-num-ok"}">${pend.toLocaleString("es-CO")}</td>
                <td>
                    <input type="number" class="pdesp-input-cant" data-idx="${idx}" data-max="${pend}"
                           min="0" max="${pend}" value="${pend}" inputmode="numeric" ${pend === 0 ? "disabled" : ""}>
                </td>
            </tr>`;
    }).join("");
}

async function pdespGuardar() {
    if (!pdespOrdenSel) return;
    const fecha = document.getElementById("pdespFecha").value || pdiaHoyISO();
    const inputs = [...document.querySelectorAll(".pdesp-input-cant")];
    const orden = pdespOrdenSel;
    const items = orden.items || [];

    const itemsDespacho = [];
    for (const inp of inputs) {
        const idx = parseInt(inp.dataset.idx);
        const max = parseInt(inp.dataset.max) || 0;
        const cant = parseInt(inp.value) || 0;
        if (cant <= 0) continue;
        if (cant > max) {
            showNotifToast(`No puedes despachar mas de ${max} unidades de "${items[idx]?.producto || "ese producto"}"`);
            return;
        }
        itemsDespacho.push({
            itemIdx: idx,
            producto: items[idx]?.producto || items[idx]?.nombre || "Producto",
            cantidadOrdenada: parseInt(items[idx]?.cantidad) || 0,
            cantidadDespachada: cant
        });
    }

    if (itemsDespacho.length === 0) {
        showNotifToast("Indica al menos una cantidad a despachar");
        return;
    }

    const despacho = {
        despachoId: `${orden.id}-${Date.now()}`,
        ordenId:    orden.id,
        numero:     orden.numero || orden.id,
        cliente:    orden.cliente || "",
        negocio:    orden.negocio || "",
        nit:        orden.nit || "",
        telefono:   orden.telefono || "",
        direccion:  orden.direccion || "",
        ciudad:     orden.ciudad || "",
        tipo:       orden.tipo || "",
        items:      itemsDespacho,
        observaciones: document.getElementById("pdespObs").value.trim(),
        fecha:      new Date().toISOString(),
        creadoPor:  sessionStorage.getItem("userName") || ""
    };

    const btn = document.getElementById("pdespSave");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando...';

    try {
        const ref = doc(db, PDESP_COL, fecha);
        const snap = await getDoc(ref);
        const despachos = snap.exists() ? (snap.data().despachos || []) : [];
        despachos.push(despacho);
        await setDoc(ref, {
            fecha,
            despachos,
            actualizadoPor: sessionStorage.getItem("userName") || "",
            actualizado: new Date().toISOString()
        }, { merge: true });

        // Refrescar cache local
        const dia = pdespDiasCache.find(d => d.fecha === fecha);
        if (dia) dia.despachos = despachos;
        else {
            pdespDiasCache.push({ fecha, despachos });
            pdespDiasCache.sort((a, b) => b.fecha.localeCompare(a.fecha));
        }

        document.getElementById("pdespOverlay").classList.remove("show");
        pdespOrdenSel = null;
        renderPdespDespachos();

        const unidades = itemsDespacho.reduce((s, i) => s + i.cantidadDespachada, 0);
        showNotifToast(`Despacho registrado: ${unidades.toLocaleString("es-CO")} unidades el ${pdiaFechaCorta(fecha)}`);
    } catch (e) {
        console.error(e);
        showNotifToast("No se pudo guardar el despacho");
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
}
