import { db, collection, getDocs, doc, setDoc, getDoc, deleteDoc } from "./auth.js";
import {
    cargarCatalogos, crearCotizacion, obtenerCotizaciones, eliminarCotizacion,
    getProductosImprenta, getProductosDigital, getTerminados, getColores,
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

    // Cotizador (solo admin)
    if (rol === "administrador") {
        await cargarCatalogos();
        setupCotizador();
        cargarListaCotizaciones();
        setupUsuarios();
        cargarUsuarios();
        setupModalDetalle();
    }

    // Cargar ordenes para todos los roles
    cargarOrdenes(rol);

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

    if (rol === "digital") {
        tabBar.style.display = "none";
        tabDigital.classList.add("active");
        tabImprenta.style.display = "none";
    } else if (rol === "imprenta") {
        tabBar.style.display = "none";
        tabDigital.style.display = "none";
        tabImprenta.classList.add("active");
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

    const titles = { cotizador: "Cotizador", ordenes: "Ordenes", usuarios: "Usuarios", configuracion: "Configuracion" };
    document.getElementById("topbarTitle").textContent = titles[target] || target;
}

// ===== TABS ORDENES =====
function setupTabs() {
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            tabContents.forEach(c => c.classList.remove("active"));
            document.getElementById("tab-" + target).classList.add("active");
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

    btnSave.addEventListener("click", async () => {
        const name = inputName.value.trim();
        if (!name) return;

        let id = editingId || name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const data = { nombre: name };
        if (currentHasValue) data.valor = parseMoneyLocal(inputVal.value);

        await setDoc(doc(db, currentCollection, id), data);
        closeModal();
        loadConfig();
        await cargarCatalogos(); // Refrescar catalogos para cotizador
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

function closeModal() {
    document.getElementById("modalOverlay").classList.remove("show");
    editingId = null;
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
                const titles = { productosImprenta: "Editar Producto Imprenta", productosDigital: "Editar Producto Digital", terminados: "Editar Terminado", colores: "Editar Color" };
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
        document.getElementById("cotTelefono").value = "";
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
        cotItems.push({ producto: "", descripcion: "", cantidad: 1, terminado: "", color: "", precioUnit: 0 });
        renderCotItems();
    });

    btnGuardar.addEventListener("click", async () => {
        const cliente  = document.getElementById("cotCliente").value.trim();
        const nit      = document.getElementById("cotNit").value.trim();
        const telefono = document.getElementById("cotTelefono").value.trim();
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
            terminado: item.terminado,
            color: item.color,
            precioUnit: item.precioUnit,
            precioTotal: item.cantidad * item.precioUnit
        }));

        const total = items.reduce((sum, i) => sum + i.precioTotal, 0);

        if (editId) {
            // Editar: actualizar sin cambiar el ID ni el link
            const ref = doc(db, "cotizaciones", editId);
            const snap = await getDoc(ref);
            const existing = snap.data();
            await setDoc(ref, { ...existing, cliente, nit, telefono, tipo, items, total, fechaActual, fechaEntrega });
            btnGuardar.dataset.editId = "";
            btnGuardar.innerHTML = '<i class="bi bi-check-lg"></i> Guardar y generar link';
            document.getElementById("formCotTitle").textContent = "Nueva Cotizacion";
        } else {
            // Crear nueva
            const result = await crearCotizacion({ cliente, nit, telefono, tipo, items, total, fechaActual, fechaEntrega });
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
    const terms = getTerminados();
    const cols  = getColores();

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

        const termOptions = `<option value="">Ninguno</option>` + terms.map(t =>
            `<option value="${t.nombre}" ${item.terminado === t.nombre ? "selected" : ""}>${t.nombre}</option>`
        ).join("");

        const colOptions = `<option value="">Ninguno</option>` + cols.map(c =>
            `<option value="${c.nombre}" ${item.color === c.nombre ? "selected" : ""}>${c.nombre}</option>`
        ).join("");

        const precioTotal = item.cantidad * item.precioUnit;

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
                <input type="number" class="cot-cantidad" data-idx="${idx}" value="${item.cantidad}" min="1">
            </div>
            <div class="form-field">
                <label>Terminado</label>
                <select class="cot-sel-terminado" data-idx="${idx}">
                    ${termOptions}
                </select>
            </div>
            <div class="form-field">
                <label>Color</label>
                <select class="cot-sel-color" data-idx="${idx}">
                    ${colOptions}
                </select>
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
            renderCotItems();
            calcularTotales();
        });
    });

    container.querySelectorAll(".cot-sel-terminado").forEach(sel => {
        sel.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.idx);
            cotItems[idx].terminado = e.target.value;
        });
    });

    container.querySelectorAll(".cot-sel-color").forEach(sel => {
        sel.addEventListener("change", (e) => {
            const idx = parseInt(e.target.dataset.idx);
            cotItems[idx].color = e.target.value;
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
        document.getElementById("cotTelefono").value = cot.telefono || "";
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
            terminado:  i.terminado || "",
            color:      i.color || "",
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
async function cargarOrdenes(rolUsuario) {
    try {
        // Leer de la coleccion "produccion" que el admin crea al enviar
        const snap = await getDocs(collection(db, "produccion"));
        const ordenes = [];
        snap.forEach(d => ordenes.push({ id: d.id, ...d.data() }));
        ordenes.sort((a, b) => (b.fechaEnvio || "").localeCompare(a.fechaEnvio || ""));

        renderOrdenesPorTipo(ordenes, "digital", "ordenesDigitalLista", rolUsuario);
        renderOrdenesPorTipo(ordenes, "imprenta", "ordenesImprentaLista", rolUsuario);
    } catch (err) {
        console.error("Error al cargar ordenes:", err);
    }
}

function renderOrdenesPorTipo(ordenes, tipo, containerId, rolUsuario) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const filtradas = ordenes.filter(o => o.tipo === tipo);

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

        html += `
            <tr class="${filaClass}">
                <td><strong>${orden.numero}</strong></td>
                <td>${orden.cliente}</td>
                <td>${fechaMostrar}</td>
                <td>
                    <button class="btn-ver-orden" data-id="${orden.id}">
                        <i class="bi bi-eye"></i> Ver mas
                    </button>
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
}

function abrirModalOrden(orden, esRolProduccion) {
    const overlay = document.getElementById("ordenDetalleOverlay");
    const items = orden.items || [];

    document.getElementById("ordenDetalleNumero").textContent = orden.numero;
    document.getElementById("ordenDetalleCliente").textContent = orden.cliente;

    const itemsHtml = items.map(i => `
        <tr>
            <td><strong>${i.cantidad}x</strong></td>
            <td>${i.producto}</td>
            <td>${i.terminado || "-"}</td>
            <td>${i.color || "-"}</td>
        </tr>
    `).join("");

    document.getElementById("ordenDetalleItems").innerHTML = itemsHtml || `<tr><td colspan="4">Sin productos</td></tr>`;

    // Boton diseno
    const btnDiseno = document.getElementById("btnCrearOrdenDiseno");
    btnDiseno.onclick = () => crearOrdenDiseno(orden);

    overlay.classList.add("show");
}

async function crearOrdenDiseno(orden) {
    const prodId = orden.id + "-diseno";
    await setDoc(doc(db, "produccion", prodId), {
        cotizacionId: orden.cotizacionId || orden.id,
        numero:       orden.numero,
        cliente:      orden.cliente,
        nit:          orden.nit || "",
        telefono:     orden.telefono || "",
        tipo:         "diseno",
        items:        orden.items || [],
        total:        orden.total || 0,
        metodoPago:   orden.metodoPago || "",
        tipoPago:     orden.tipoPago || "completo",
        montoPagado:  orden.montoPagado || orden.total,
        comprobante:  orden.comprobante || "",
        estado:       "en_produccion",
        fechaEnvio:   new Date().toISOString()
    });

    document.getElementById("ordenDetalleOverlay").classList.remove("show");
    showConfirm(
        "Orden de diseno creada",
        `Se creo la orden de diseno para ${orden.numero}.`,
        () => {}
    );
    document.getElementById("confirmYes").textContent = "Entendido";
    document.getElementById("confirmNo").style.display = "none";
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
