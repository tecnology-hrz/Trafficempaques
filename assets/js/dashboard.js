import { db, collection, getDocs, doc, setDoc, getDoc, deleteDoc } from "./auth.js";
import { onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    cargarCatalogos, crearCotizacion, obtenerCotizaciones, eliminarCotizacion,
    obtenerCotizacionesEliminadas, restaurarCotizacion, eliminarCotizacionDefinitivo,
    getProductosImprenta, getProductosDigital, getTerminados, getColores,
    getMateriales, getPlanchas,
    getFormatMoney, getParseMoney
} from "./cotizador.js";
import { CATALOGO_DATA } from "./catalogo-data.js";

// Verificar sesion
const rol    = sessionStorage.getItem("userRol");
const nombre = sessionStorage.getItem("userName");

// Etapas que cada rol puede ver en el timeline de seguimiento.
// Si un rol no esta listado aqui, ve todas las etapas de la orden.
const PASOS_VISIBLES_POR_ROL = {
    digital: ["impresion", "empaques", "terminado"]
};

if (!rol || !nombre) {
    window.location.href = "index.html";
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
        setupPapelera();
        cargarPapelera();
    }

    // Ventas: finanzas propias
    if (rol === "ventas") {
        setupFinanzas();
        cargarFinanzas();
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

    const titles = { cotizador: "Cotizador", ordenes: "Ordenes", seguimiento: "Seguimiento", disenos: "Diseños", clientes: "Clientes", finanzas: "Finanzas", usuarios: "Usuarios", configuracion: "Configuracion", "catalogo-admin": "Catálogo" };
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
    if (inputBuscar) inputBuscar.addEventListener("input", () => renderListaCotizaciones());
    if (selectEstado) selectEstado.addEventListener("change", () => renderListaCotizaciones());


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

            // Boton enviar a produccion
            let btnEnviarHtml = "";
            if (esAprobada && !yaEnviada) {
                btnEnviarHtml = `<button class="btn-enviar-prod" data-id="${cot.id}"><i class="bi bi-send"></i> Enviar a produccion</button>`;
            } else if (esAprobada && yaEnviada) {
                btnEnviarHtml = `<span class="badge-enviada"><i class="bi bi-check-circle"></i> Enviada</span>`;
            }

            const item = document.createElement("div");
            item.className = "cot-list-item";
            item.innerHTML = `
                <div class="cot-list-info">
                    <span class="cot-list-numero">${cot.numero} <span class="cot-estado ${cot.estado}">${cot.estado}</span></span>
                    <span class="cot-list-cliente">${cot.cliente} &bull; ${cot.tipo} &bull; ${fechaStr}</span>
                </div>
                <div class="cot-list-right">
                    <span class="cot-list-total">$${formatMoneyLocal(cot.total)}</span>
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

function abrirModalOrden(orden, esRolProduccion) {
    const overlay = document.getElementById("ordenDetalleOverlay");
    const items = orden.items || [];
    ordenDetalleActual = orden;

    document.getElementById("ordenDetalleNumero").textContent = orden.numero;
    document.getElementById("ordenDetalleCliente").textContent = orden.cliente;

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
                    <th>Tipo</th>
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
                <td>${tipoLabel}</td>
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
            </div>
        `;
        container.appendChild(card);

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
            pacdoraLinks: pacdoraLinks
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

    document.getElementById("cotDetalleOverlay").classList.add("show");
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
        return { pasoActual: entry.pasoActual, seguimiento: entry.seguimiento || {}, cantidades: entry.cantidades || {} };
    }
    return { pasoActual: orden.pasoActual || "recibido", seguimiento: {}, cantidades: {} };
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

    if (filas.length === 0 && !recibidaHtml) return "";

    return `
        <div class="seg-cantidades">
            ${recibidaHtml}
            ${filas.length > 0 ? `<div class="seg-cant-titulo">Cantidades por etapa (de ${ordenada} ordenadas)</div>${filas.join("")}` : ""}
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

    const seg = hayItem ? getItemSeguimiento(orden, itemIdx) : { pasoActual: orden.pasoActual || "recibido" };
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

    document.getElementById("segCantidadOverlay").classList.add("show");
    setTimeout(() => { input.focus(); input.select(); }, 100);
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
        cerrar();
        await actualizarPasoOrden(ordenId, nuevoPaso, itemIdx, { paso: pasoActual, cantidad });
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
        if (itemIdx === undefined || itemIdx === null || isNaN(itemIdx) || itemIdx < 0 || items.length === 0) {
            const seguimiento = data.seguimiento || {};
            seguimiento[nuevoPaso] = new Date().toISOString();
            const cantidadesSeguimiento = data.cantidadesSeguimiento || {};
            if (cantidadInfo && cantidadInfo.paso && cantidadInfo.cantidad !== null && cantidadInfo.cantidad !== undefined) {
                cantidadesSeguimiento[cantidadInfo.paso] = cantidadInfo.cantidad;
            }
            await setDoc(ref, { ...data, pasoActual: nuevoPaso, seguimiento, cantidadesSeguimiento });
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
    window.location.href = "index.html";
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

    document.getElementById("catProductoModalSave").addEventListener("click", guardarCatProducto);
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
                imagen: producto.imagen
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
        card.innerHTML = `
            ${descBadge}
            <img src="${prod.imagen}" alt="${prod.nombre}" class="cat-admin-img">
            <div class="cat-admin-card-body">
                <span class="cat-admin-orden">#${prod.orden}</span>
                <span class="cat-admin-nombre">${prod.nombre}</span>
                ${medidas}
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
