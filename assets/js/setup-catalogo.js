import { db, doc, setDoc, collection, getDocs, deleteDoc } from "./auth.js";
import { CATALOGO_DATA } from "./catalogo-data.js";

// Poblar la colección "catalogo" en Firestore con todos los productos
export async function poblarCatalogo() {
    // Borrar datos anteriores
    const snap = await getDocs(collection(db, "catalogo"));
    for (const d of snap.docs) await deleteDoc(d.ref);

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
    console.log("Catálogo poblado en Firestore");
}
