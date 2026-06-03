/**
 * SETUP INICIAL - Crea los 3 usuarios en la coleccion "usuarios" de Firestore
 * 
 * Usuarios:
 *   admin@traffic.com     / Traffic2026! -> administrador
 *   digital@traffic.com   / Traffic2026! -> digital
 *   imprenta@traffic.com  / Traffic2026! -> imprenta
 */

import { db, doc, setDoc } from "./auth.js";

const usuarios = [
    { id: "admin",    email: "admin@traffic.com",    password: "Traffic2026!", nombre: "Administrador",    rol: "administrador" },
    { id: "ventas",   email: "ventas@traffic.com",   password: "Traffic2026!", nombre: "Usuario Ventas",   rol: "ventas"        },
    { id: "digital",  email: "digital@traffic.com",  password: "Traffic2026!", nombre: "Usuario Digital",  rol: "digital"       },
    { id: "imprenta", email: "imprenta@traffic.com", password: "Traffic2026!", nombre: "Usuario Imprenta", rol: "imprenta"      }
];

document.getElementById("btnSetup").addEventListener("click", async () => {
    const log = document.getElementById("log");
    log.innerHTML = "<p>Creando usuarios...</p>";

    for (const u of usuarios) {
        try {
            await setDoc(doc(db, "usuarios", u.id), {
                email:    u.email,
                password: u.password,
                nombre:   u.nombre,
                rol:      u.rol
            });
            log.innerHTML += `<p style="color:#16a34a"><i class="bi bi-check-circle"></i> Creado: ${u.email} (${u.rol})</p>`;
        } catch (err) {
            log.innerHTML += `<p style="color:#dc2626"><i class="bi bi-x-circle"></i> Error ${u.email}: ${err.message}</p>`;
        }
    }

    log.innerHTML += `<p style="margin-top:16px;font-weight:600;">Listo. Ya puedes ir al <a href="index.html" style="color:#29ABE2;">Login</a>.</p>`;
});
