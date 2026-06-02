import { db, collection, getDocs, doc, setDoc, getDoc, deleteDoc } from "./auth.js";
import {
    cargarCatalogos, crearCotizacion, obtenerCotizaciones, eliminarCotizacion,
    getProductosImprenta, getProductosDigital, getTerminados, getColores,
    getMateriales, getPlanchas,
    getFormatMoney, getParseMoney
} from "./cotizador.js";

// Verificar sesion
const rol    = sessionStorage.getItem("userRol");
const nombre = sessionStorage.getItem("userName");

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

    if (rol !== "administrador") {
        document.querySelectorAll("[data-role='administrador']").forEach(el => {
            el.style.display = "none";
        });
        activateSection("ordenes");
    }

    setupOrdenesByRole(rol);
    setupNavigation();
    setupTabs();
    setupModal();
    setupConfirm();
    setupNotifModal();
    setupAccionesModal();
    loadConfig();
    setupOrdenDetalleModal(); // Modal detalle orden para todos los roles
    setupPacdoraModal(); // Modal Pacdora 3D preview

    // Cotizador (solo admin)
    if (rol === "administrador") {
        await cargarCatalogos();
        setupCotizador();
        setupMultiSelectModal();
        cargarListaCotizaciones();
        setupUsuarios();
        cargarUsuarios();
        setupModalDetalle();
    }

    // Cargar ordenes para todos los roles
    cargarOrdenes(rol);
    cargarDisenosAprobados(rol);

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

    if (rol === "digital" || rol === "imprenta") {
        tabBar.style.display = "none";
        tabDigital.style.display = "none";
        tabDigital.classList.remove("active");
        tabImprenta.style.display = "none";
        // Mostrar tabs de rol
        rolTabBar.style.display = "flex";
        tabPendientes.classList.add("active");
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

    const titles = { cotizador: "Cotizador", ordenes: "Ordenes", disenos: "Diseños", usuarios: "Usuarios", configuracion: "Configuracion" };
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

function setupCotizador() {
    const btnNueva  = document.getElementById("btnNuevaCotizacion");
    const btnVolver = document.getElementById("btnVolverLista");
    const btnAdd    = document.getElementById("btnAddItem");
    const btnGuardar = document.getElementById("btnGuardarCotizacion");
    const tipoSelect = document.getElementById("cotTipo");

    btnNueva.addEventListener("click", () => {
        cotItems = [];
        document.getElementById("cotCliente").value  = "";
        document.getElementById("cotNit").value      = "";
        document.getElementById("cotNegocio").value  = "";
        document.getElementById("cotTelefono").value = "";
        document.getElementById("cotDireccion").value = "";
        document.getElementById("cotCiudad").value   = "";
        document.getElementById("cotTipo").value     = "imprenta";
        // Fecha actual auto
        const hoy = new Date();
        const dd = String(hoy.getDate()).padStart(2, "0");
        const mm = String(hoy.getMonth() + 1).padStart(2, "0");
        const yyyy = hoy.getFullYear();
        document.getElementById("cotFechaActual").value  = `${dd}/${mm}/${yyyy}`;
        document.getElementById("cotFechaEntrega").value = "";
        renderCotItems();
        calcularTotales();
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

    btnGuardar.addEventListener("click", async () => {
        const cliente  = document.getElementById("cotCliente").value.trim();
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

        const total = items.reduce((sum, i) => sum + i.precioTotal, 0);

        if (editId) {
            // Editar: actualizar sin cambiar el ID ni el link
            const ref = doc(db, "cotizaciones", editId);
            const snap = await getDoc(ref);
            const existing = snap.data();
            await setDoc(ref, { ...existing, cliente, nit, negocio, telefono, direccion, ciudad, tipo, items, total, fechaActual, fechaEntrega });
            btnGuardar.dataset.editId = "";
            btnGuardar.innerHTML = '<i class="bi bi-check-lg"></i> Guardar y generar link';
            document.getElementById("formCotTitle").textContent = "Nueva Cotizacion";
        } else {
            // Crear nueva
            const result = await crearCotizacion({ cliente, nit, negocio, telefono, direccion, ciudad, tipo, items, total, fechaActual, fechaEntrega });
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
            ${tipoField}
            <div class="form-field">
                <label>Producto</label>
                <select class="cot-sel-producto" data-idx="${idx}">
                    <option value="">Seleccionar</option>
                    ${prodOptions}
                </select>
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

    container.querySelectorAll(".cot-sel-producto").forEach(sel => {
        sel.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.idx);
            const opt = e.target.selectedOptions[0];
            cotItems[idx].producto = e.target.value;
            cotItems[idx].precioUnit = parseInt(opt?.dataset?.valor) || 0;
            renderCotItems();
            calcularTotales();
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

function calcularTotales() {
    const total = cotItems.reduce((sum, item) => sum + (item.cantidad * item.precioUnit), 0);
    document.getElementById("cotTotal").textContent = "$" + formatMoneyLocal(total);
}

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

// ===== LISTA COTIZACIONES =====
async function cargarListaCotizaciones() {
    const container = document.getElementById("listaCotizaciones");
    try {
        const lista = await obtenerCotizaciones();

        if (lista.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="bi bi-file-earmark-text"></i><p>No hay cotizaciones creadas</p></div>';
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

    } catch (err) {
        console.error(err);
        container.innerHTML = '<div class="list-empty"><i class="bi bi-exclamation-triangle"></i> Error al cargar</div>';
    }
}

function abrirModalAcciones(cotId, cotName) {
    const overlay = document.getElementById("accionesOverlay");
    document.getElementById("accionesTitulo").textContent = cotName;

    document.getElementById("btnAccionEditar").onclick = async () => {
        overlay.classList.remove("show");
        const docSnap = await getDoc(doc(db, "cotizaciones", cotId));
        if (!docSnap.exists()) return;
        const cot = docSnap.data();

        document.getElementById("cotCliente").value  = cot.cliente || "";
        document.getElementById("cotNit").value      = cot.nit || "";
        document.getElementById("cotNegocio").value  = cot.negocio || "";
        document.getElementById("cotTelefono").value = cot.telefono || "";
        document.getElementById("cotDireccion").value = cot.direccion || "";
        document.getElementById("cotCiudad").value   = cot.ciudad || "";
        document.getElementById("cotTipo").value     = cot.tipo || "imprenta";
        document.getElementById("cotFechaActual").value = cot.fechaActual || "";
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

        const btnGuardar = document.getElementById("btnGuardarCotizacion");
        btnGuardar.dataset.editId = cotId;
        btnGuardar.innerHTML = '<i class="bi bi-check-lg"></i> Guardar cambios';
        document.getElementById("formCotTitle").textContent = "Editar " + cotName;
        document.getElementById("cotizadorLista").style.display = "none";
        document.getElementById("cotizadorForm").style.display  = "block";
    };

    document.getElementById("btnAccionEliminar").onclick = () => {
        overlay.classList.remove("show");
        showConfirm("Eliminar cotizacion", `Eliminar ${cotName}? No se puede deshacer.`, async () => {
            await eliminarCotizacion(cotId);
            cargarListaCotizaciones();
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

async function cargarOrdenes(rolUsuario) {
    try {
        // Leer de la coleccion "produccion" que el admin crea al enviar
        const snap = await getDocs(collection(db, "produccion"));
        const ordenes = [];
        snap.forEach(d => ordenes.push({ id: d.id, ...d.data() }));
        ordenes.sort((a, b) => (b.fechaEnvio || "").localeCompare(a.fechaEnvio || ""));

        // Cargar ordenes de diseño existentes
        const snapDiseno = await getDocs(collection(db, "ordenesDiseno"));
        ordenesDisenoDB = {};
        snapDiseno.forEach(d => { ordenesDisenoDB[d.id] = { id: d.id, ...d.data() }; });

        if (rolUsuario === "administrador") {
            // Admin ve todo en tabs digital/imprenta
            renderOrdenesPorTipo(ordenes, "digital", "ordenesDigitalLista", rolUsuario);
            renderOrdenesPorTipo(ordenes, "imprenta", "ordenesImprentaLista", rolUsuario);
        } else {
            // Imprenta/Digital: separar en pendientes y con diseño respondido
            const tipoRol = rolUsuario; // "imprenta" o "digital"
            const misOrdenes = ordenes.filter(o => o.tipo === tipoRol);

            // Separar: las que tienen diseño respondido con al menos 1 aprobada
            const pendientes = [];
            const respondidas = [];

            misOrdenes.forEach(orden => {
                const disenoId = orden.id + "-diseno";
                const diseno = ordenesDisenoDB[disenoId];
                if (diseno && diseno.estado === "respondida") {
                    // Verificar si tiene al menos 1 imagen aprobada
                    const tieneAprobada = (diseno.items || []).some(item =>
                        (item.imagenes || []).some(img => img.estado === "aprobada")
                    );
                    if (tieneAprobada) {
                        respondidas.push({ orden, diseno });
                    } else {
                        pendientes.push(orden);
                    }
                } else {
                    pendientes.push(orden);
                }
            });

            renderOrdenesPorTipo(pendientes, tipoRol, "ordenesPendientesLista", rolUsuario);
            renderDisenosRespondidos(respondidas, "ordenesDisenosLista", rolUsuario);
        }
    } catch (err) {
        console.error("Error al cargar ordenes:", err);
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

        html += `
            <div class="diseno-lista-item">
                <div class="diseno-lista-info">
                    <div class="diseno-lista-top">
                        <strong>${orden.numero}</strong>
                        <span class="diseno-estado-badge respondida"><i class="bi bi-check-circle"></i> ${aprobadas} aprobadas, ${rechazadas} rechazadas</span>
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

    // Si es admin, filtrar por tipo. Si es rol, ya vienen filtradas.
    const filtradas = rolUsuario === "administrador" ? ordenes.filter(o => o.tipo === tipo) : ordenes;

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

        // Semaforo segun fecha de entrega
        let filaClass = "fila-verde";
        if (orden.fechaEntrega) {
            const [d, m, y] = orden.fechaEntrega.split("/");
            const entrega = new Date(y, m - 1, d);
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            entrega.setHours(0, 0, 0, 0);
            const diffDias = Math.round((entrega - hoy) / (1000 * 60 * 60 * 24));
            if (diffDias <= 0) {
                filaClass = "fila-rojo";
            } else if (diffDias <= 2) {
                filaClass = "fila-amarillo";
            } else {
                filaClass = "fila-verde";
            }
        }

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
        }

        // Boton copiar link solo si ya existe orden de diseño
        const btnCopyLink = tieneDiseno
            ? `<button class="btn-copiar-link-diseno" data-id="${orden.id}"><i class="bi bi-link-45deg"></i> Copiar link</button>`
            : "";

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
                        <button class="${btnDisenoClass}" data-id="${orden.id}">
                            ${btnDisenoLabel}
                        </button>
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

function abrirModalOrden(orden, esRolProduccion) {
    const overlay = document.getElementById("ordenDetalleOverlay");
    const items = orden.items || [];

    document.getElementById("ordenDetalleNumero").textContent = orden.numero;
    document.getElementById("ordenDetalleCliente").textContent = orden.cliente;

    // Ocultar botones de diseño (solo se muestran en abrirModalVerDisenos)
    document.getElementById("ordenDetalleCopyLink").style.display = "none";
    document.getElementById("ordenDetalleRedisenar").style.display = "none";

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

async function crearOrdenDiseno(orden) {
    // Verificar si ya existe una orden de diseño
    const disenoId = orden.id + "-diseno";
    const existente = ordenesDisenoDB[disenoId] || null;
    abrirVistaDisenoOrden(orden, existente);
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

    // Verificar que al menos un producto tenga imagen
    const tieneImagenes = disenoItems.some(i => i.imagenes.length > 0);
    if (!tieneImagenes) {
        showNotif("Sin diseños", "Sube al menos una imagen de diseño para algun producto.");
        return;
    }

    const btnGuardar = document.getElementById("btnGuardarDiseno");
    btnGuardar.disabled = true;
    btnGuardar.innerHTML = '<span class="spinner-sm"></span> Guardando...';

    try {
        const disenoId = orden.id + "-diseno";
        const esEdicion = !!disenoEditando;

        const dataToSave = {
            ordenId: orden.id,
            cotizacionId: orden.cotizacionId || orden.id,
            numero: orden.numero,
            cliente: orden.cliente,
            telefono: orden.telefono || "",
            tipo: orden.tipo,
            items: disenoItems,
            estado: "pendiente",
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
async function cargarDisenosAprobados(rolUsuario) {
    // Solo admin usa esta seccion separada
    if (rolUsuario !== "administrador") return;

    const containerDigital = document.getElementById("listaDisenosDigital");
    const containerImprenta = document.getElementById("listaDisenosImprenta");
    if (!containerDigital || !containerImprenta) return;

    try {
        const snap = await getDocs(collection(db, "ordenesDiseno"));
        const disenos = [];
        snap.forEach(d => disenos.push({ id: d.id, ...d.data() }));
        disenos.sort((a, b) => (b.fechaCreacion || "").localeCompare(a.fechaCreacion || ""));

        const digitales = disenos.filter(d => d.tipo === "digital");
        const imprenta = disenos.filter(d => d.tipo === "imprenta");

        renderDisenosEnContainer(digitales, containerDigital);
        renderDisenosEnContainer(imprenta, containerImprenta);

    } catch (err) {
        console.error("Error cargando diseños:", err);
        containerDigital.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>Error al cargar</p></div>';
        containerImprenta.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>Error al cargar</p></div>';
    }
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

    document.getElementById("cotDetalleOverlay").classList.add("show");
}

async function enviarAProduccion(cot, tipoProd, items) {
    // Guardar en coleccion "produccion" con el ID de la cotizacion
    const prodId = cot.id + "-" + tipoProd;
    await setDoc(doc(db, "produccion", prodId), {
        cotizacionId: cot.id,
        numero:       cot.numero,
        cliente:      cot.cliente,
        nit:          cot.nit || "",
        telefono:     cot.telefono || "",
        tipo:         tipoProd,
        items:        items,
        total:        items.reduce((s, i) => s + (i.precioTotal || 0), 0),
        metodoPago:   cot.metodoPago || "",
        tipoPago:     cot.tipoPago || "completo",
        montoPagado:  cot.montoPagado || cot.total,
        comprobante:  cot.comprobante || "",
        estado:       "en_produccion",
        fechaEnvio:   new Date().toISOString()
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

// ===== LOGOUT =====
function logout() {
    sessionStorage.clear();
    window.location.href = "index.html";
}
