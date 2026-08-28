import { db, collection, getDocs, doc, setDoc, getDoc, deleteDoc } from "./auth.js";
import { query, orderBy, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ===== FORMATO =====
function formatMoney(value) {
    const num = parseInt(value) || 0;
    return num.toLocaleString("en-US");
}

function parseMoney(str) {
    return parseInt(String(str).replace(/,/g, "").replace(/[^0-9]/g, "")) || 0;
}

// ===== CARGAR PRODUCTOS Y TERMINADOS =====
let productosImprenta = [];
let productosDigital  = [];
let terminados        = [];
let colores           = [];
let materiales        = [];
let planchas          = [];

export async function cargarCatalogos() {
    const snapPI = await getDocs(collection(db, "productosImprenta"));
    productosImprenta = [];
    snapPI.forEach(d => productosImprenta.push({ id: d.id, ...d.data() }));

    const snapPD = await getDocs(collection(db, "productosDigital"));
    productosDigital = [];
    snapPD.forEach(d => productosDigital.push({ id: d.id, ...d.data() }));

    const snapT = await getDocs(collection(db, "terminados"));
    terminados = [];
    snapT.forEach(d => terminados.push({ id: d.id, ...d.data() }));

    const snapC = await getDocs(collection(db, "colores"));
    colores = [];
    snapC.forEach(d => colores.push({ id: d.id, ...d.data() }));

    const snapM = await getDocs(collection(db, "materiales"));
    materiales = [];
    snapM.forEach(d => materiales.push({ id: d.id, ...d.data() }));

    const snapP = await getDocs(collection(db, "planchas"));
    planchas = [];
    snapP.forEach(d => planchas.push({ id: d.id, ...d.data() }));
}

// ===== GENERAR NUMERO COTIZACION =====
async function generarNumeroCotizacion() {
    // Usar un contador persistente para nunca reutilizar numeros.
    // Va en una transaccion porque ahora tambien lo incrementan los clientes
    // desde la web: dos solicitudes simultaneas darian el mismo numero.
    const contadorRef = doc(db, "config", "contadorCotizaciones");

    // Semilla para la primera vez, fuera de la transaccion (no se puede
    // consultar una coleccion completa dentro de una).
    let semilla = null;
    const previo = await getDoc(contadorRef);
    if (!previo.exists()) {
        const snap = await getDocs(collection(db, "cotizaciones"));
        semilla = snap.size;
    }

    try {
        const siguiente = await runTransaction(db, async (tx) => {
            const snap = await tx.get(contadorRef);
            const actual = snap.exists() ? (snap.data().ultimo || 0) : (semilla || 0);
            const nuevo = actual + 1;
            tx.set(contadorRef, { ultimo: nuevo }, { merge: true });
            return nuevo;
        });
        return "COT-" + String(siguiente).padStart(4, "0");
    } catch (err) {
        // Si la transaccion no es posible, se cae al camino simple para no
        // bloquear la creacion de la cotizacion.
        console.warn("[cotizador] contador sin transaccion, se usa lectura directa", err);
        const snap = await getDoc(contadorRef);
        const siguiente = (snap.exists() ? (snap.data().ultimo || 0) : (semilla || 0)) + 1;
        await setDoc(contadorRef, { ultimo: siguiente }, { merge: true });
        return "COT-" + String(siguiente).padStart(4, "0");
    }
}

// ===== CREAR COTIZACION =====
export async function crearCotizacion(datos) {
    const numero = await generarNumeroCotizacion();
    // ID unico: numero + timestamp para evitar colisiones
    const id = numero.toLowerCase() + "-" + Date.now().toString(36);

    const cotizacion = {
        numero,
        cliente: datos.cliente,
        tipoPersona: datos.tipoPersona || "natural",
        nit: datos.nit || "",
        negocio: datos.negocio || "",
        telefono: datos.telefono || "",
        direccion: datos.direccion || "",
        ciudad: datos.ciudad || "",
        tipo: datos.tipo,
        modalidadPago: datos.modalidadPago || "contado",
        items: datos.items,
        subtotal: datos.subtotal !== undefined ? datos.subtotal : datos.total,
        aplicarIva: datos.aplicarIva || false,
        iva: datos.iva || 0,
        total: datos.total,
        estado: "pendiente",
        metodoPago: "",
        comprobante: "",
        notas: datos.notas || "",
        comentarioCliente: "",
        fechaCreacion: new Date().toISOString(),
        fechaAprobacion: "",
        fechaActual: datos.fechaActual || "",
        fechaEntrega: datos.fechaEntrega || "",
        creadoPor: datos.creadoPor || "",
        creadoPorEmail: datos.creadoPorEmail || "",
        // "web" cuando la genera el cliente desde el carrito publico,
        // "panel" cuando la crea un asesor. Permite distinguirlas en la lista.
        origen: datos.origen || "panel"
    };

    await setDoc(doc(db, "cotizaciones", id), cotizacion);
    return { id, numero };
}

// ===== OBTENER COTIZACIONES =====
export async function obtenerCotizaciones(filtroUsuario) {
    const snap = await getDocs(collection(db, "cotizaciones"));
    let lista = [];
    snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
    // Excluir las que estan en papelera
    lista = lista.filter(c => !c.eliminado);
    lista.sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion));
    // Filtrar por usuario si se proporciona
    if (filtroUsuario && filtroUsuario.email) {
        lista = lista.filter(c =>
            c.creadoPorEmail === filtroUsuario.email || c.creadoPor === filtroUsuario.nombre
        );
    }
    return lista;
}

// ===== OBTENER COTIZACIONES EN PAPELERA =====
export async function obtenerCotizacionesEliminadas(filtroUsuario) {
    const snap = await getDocs(collection(db, "cotizaciones"));
    let lista = [];
    snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
    lista = lista.filter(c => c.eliminado);
    lista.sort((a, b) => (b.fechaEliminado || "").localeCompare(a.fechaEliminado || ""));
    if (filtroUsuario && filtroUsuario.email) {
        lista = lista.filter(c =>
            c.creadoPorEmail === filtroUsuario.email || c.creadoPor === filtroUsuario.nombre
        );
    }
    return lista;
}

// ===== OBTENER UNA COTIZACION =====
export async function obtenerCotizacion(id) {
    const docSnap = await getDoc(doc(db, "cotizaciones", id));
    if (!docSnap.exists()) return null;
    return { id: docSnap.id, ...docSnap.data() };
}

// ===== ACTUALIZAR COTIZACION =====
export async function actualizarCotizacion(id, datos) {
    const ref = doc(db, "cotizaciones", id);
    const docSnap = await getDoc(ref);
    if (!docSnap.exists()) return;
    const current = docSnap.data();
    await setDoc(ref, { ...current, ...datos });
}

// ===== ELIMINAR COTIZACION (enviar a papelera / soft delete) =====
export async function eliminarCotizacion(id, usuario) {
    const ref = doc(db, "cotizaciones", id);
    const docSnap = await getDoc(ref);
    if (!docSnap.exists()) return;
    const current = docSnap.data();
    await setDoc(ref, {
        ...current,
        eliminado: true,
        fechaEliminado: new Date().toISOString(),
        eliminadoPor: (usuario && usuario.nombre) || "",
        eliminadoPorEmail: (usuario && usuario.email) || ""
    });
}

// ===== RESTAURAR COTIZACION (sacar de papelera) =====
export async function restaurarCotizacion(id) {
    const ref = doc(db, "cotizaciones", id);
    const docSnap = await getDoc(ref);
    if (!docSnap.exists()) return;
    const current = docSnap.data();
    delete current.eliminado;
    delete current.fechaEliminado;
    delete current.eliminadoPor;
    delete current.eliminadoPorEmail;
    await setDoc(ref, current);
}

// ===== ELIMINAR COTIZACION DEFINITIVAMENTE =====
export async function eliminarCotizacionDefinitivo(id) {
    await deleteDoc(doc(db, "cotizaciones", id));
}

// ===== GETTERS =====
export function getProductosImprenta() { return productosImprenta; }
export function getProductosDigital()  { return productosDigital; }
export function getTerminados()        { return terminados; }
export function getColores()           { return colores; }
export function getMateriales()        { return materiales; }
export function getPlanchas()          { return planchas; }
export function getFormatMoney()       { return formatMoney; }
export function getParseMoney()        { return parseMoney; }
