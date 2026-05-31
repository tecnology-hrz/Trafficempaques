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
}

// ===== GENERAR NUMERO COTIZACION =====
async function generarNumeroCotizacion() {
    const snap = await getDocs(collection(db, "cotizaciones"));
    const num = snap.size + 1;
    return "COT-" + String(num).padStart(4, "0");
}

// ===== CREAR COTIZACION =====
export async function crearCotizacion(datos) {
    const numero = await generarNumeroCotizacion();
    const id = numero.toLowerCase();

    const cotizacion = {
        numero,
        cliente: datos.cliente,
        nit: datos.nit || "",
        telefono: datos.telefono || "",
        tipo: datos.tipo,
        items: datos.items,
        total: datos.total,
        estado: "pendiente",
        metodoPago: "",
        comprobante: "",
        fechaCreacion: new Date().toISOString(),
        fechaAprobacion: ""
    };

    await setDoc(doc(db, "cotizaciones", id), cotizacion);
    return { id, numero };
}

// ===== OBTENER COTIZACIONES =====
export async function obtenerCotizaciones() {
    const snap = await getDocs(collection(db, "cotizaciones"));
    const lista = [];
    snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
    lista.sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion));
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
export function getFormatMoney()       { return formatMoney; }
export function getParseMoney()        { return parseMoney; }
