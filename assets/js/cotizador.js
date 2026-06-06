import { db, collection, getDocs, doc, setDoc, getDoc, deleteDoc } from "./auth.js";
import { query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
    // Usar un contador persistente para nunca reutilizar numeros
    const contadorRef = doc(db, "config", "contadorCotizaciones");
    const contadorSnap = await getDoc(contadorRef);

    let siguiente;
    if (contadorSnap.exists()) {
        siguiente = (contadorSnap.data().ultimo || 0) + 1;
    } else {
        // Primera vez: inicializar basado en cotizaciones existentes para no perder la secuencia
        const snap = await getDocs(collection(db, "cotizaciones"));
        siguiente = snap.size + 1;
    }

    // Guardar el nuevo contador
    await setDoc(contadorRef, { ultimo: siguiente });

    return "COT-" + String(siguiente).padStart(4, "0");
}

// ===== CREAR COTIZACION =====
export async function crearCotizacion(datos) {
    const numero = await generarNumeroCotizacion();
    // ID unico: numero + timestamp para evitar colisiones
    const id = numero.toLowerCase() + "-" + Date.now().toString(36);

    const cotizacion = {
        numero,
        cliente: datos.cliente,
        nit: datos.nit || "",
        negocio: datos.negocio || "",
        telefono: datos.telefono || "",
        direccion: datos.direccion || "",
        ciudad: datos.ciudad || "",
        tipo: datos.tipo,
        modalidadPago: datos.modalidadPago || "contado",
        items: datos.items,
        total: datos.total,
        estado: "pendiente",
        metodoPago: "",
        comprobante: "",
        fechaCreacion: new Date().toISOString(),
        fechaAprobacion: "",
        fechaActual: datos.fechaActual || "",
        fechaEntrega: datos.fechaEntrega || "",
        creadoPor: datos.creadoPor || "",
        creadoPorEmail: datos.creadoPorEmail || ""
    };

    await setDoc(doc(db, "cotizaciones", id), cotizacion);
    return { id, numero };
}

// ===== OBTENER COTIZACIONES =====
export async function obtenerCotizaciones(filtroUsuario) {
    const snap = await getDocs(collection(db, "cotizaciones"));
    let lista = [];
    snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
    lista.sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion));
    // Filtrar por usuario si se proporciona
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

// ===== ELIMINAR COTIZACION =====
export async function eliminarCotizacion(id) {
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
