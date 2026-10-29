// Subida de imagenes con respaldo.
// 1. Intenta ImgBB (como siempre).
// 2. Si ImgBB falla (mantenimiento, clave bloqueada, sin red, demora), sube
//    el archivo a Firebase Storage en la carpeta indicada.
// Devuelve la URL publica de la imagen. Lanza error solo si fallan los dos.
//
// Carpetas de Storage usadas (deben estar permitidas en storage.rules):
//   comprobantes/, disenos/, catalogo/, landing/, entregas/

import { storage, storageRef, uploadBytes, getDownloadURL } from "./auth.js";

const IMGBB_TIMEOUT_MS = 20000;

async function subirAImgbb(file, clave) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IMGBB_TIMEOUT_MS);
    try {
        const form = new FormData();
        form.append("image", file);
        const res = await fetch("https://api.imgbb.com/1/upload?key=" + encodeURIComponent(clave), {
            method: "POST",
            body: form,
            signal: ctrl.signal
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success || !data?.data?.url) {
            throw new Error(data?.error?.message || `ImgBB respondio ${res.status}`);
        }
        return data.data.url;
    } finally {
        clearTimeout(timer);
    }
}

async function subirAStorage(file, carpeta) {
    const limpio = (file.name || "imagen").replace(/[^\w.\-]+/g, "_");
    const ruta = `${carpeta}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${limpio}`;
    const ref = storageRef(storage, ruta);
    await uploadBytes(ref, file, {
        contentType: file.type || "application/octet-stream",
        contentDisposition: `inline; filename="${limpio}"`
    });
    return getDownloadURL(ref);
}

/**
 * @param {File|Blob} file    Archivo a subir
 * @param {string} carpeta    Carpeta de respaldo en Firebase Storage
 * @param {string} claveImgbb Clave de ImgBB
 * @returns {Promise<string>} URL publica
 */
export async function subirImagen(file, carpeta, claveImgbb) {
    if (claveImgbb) {
        try {
            return await subirAImgbb(file, claveImgbb);
        } catch (err) {
            console.warn("[subir-imagen] ImgBB no disponible, se usa Firebase Storage:", err?.message || err);
        }
    }
    try {
        return await subirAStorage(file, carpeta);
    } catch (err) {
        console.error("[subir-imagen] Firebase Storage tambien fallo:", err);
        throw new Error("No se pudo subir la imagen (ImgBB y Firebase Storage fallaron)");
    }
}
