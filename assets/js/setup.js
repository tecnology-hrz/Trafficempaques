/**
 * SETUP INICIAL - Crea los usuarios en la coleccion "usuarios" de Firestore
 * 
 * Usuarios:
 *   admin@traffic.com       / Traffic2026! -> administrador
 *   ventas@traffic.com      / Traffic2026! -> ventas
 *   digital@traffic.com     / Traffic2026! -> digital
 *   imprenta@traffic.com    / Traffic2026! -> imprenta
 *   ordenes@traffic.com     / Traffic2026! -> ordenes
 *   diseno@traffic.com      / Traffic2026! -> diseno
 *   guillotina@traffic.com  / Traffic2026! -> guillotina
 *   impresion@traffic.com   / Traffic2026! -> impresion
 *   troquelado@traffic.com  / Traffic2026! -> troquelado
 *   vasos@traffic.com       / Traffic2026! -> vasos
 *   empaques@traffic.com    / Traffic2026! -> empaques
 */

import { db, doc, setDoc } from "./auth.js";

const usuarios = [
    { id: "admin",      email: "admin@traffic.com",      password: "Traffic2026!", nombre: "Administrador",      rol: "administrador" },
    { id: "ventas",     email: "ventas@traffic.com",     password: "Traffic2026!", nombre: "Usuario Ventas",     rol: "ventas"        },
    { id: "digital",    email: "digital@traffic.com",    password: "Traffic2026!", nombre: "Usuario Digital",    rol: "digital"       },
    { id: "imprenta",   email: "imprenta@traffic.com",   password: "Traffic2026!", nombre: "Usuario Imprenta",   rol: "imprenta"      },
    { id: "ordenes",    email: "ordenes@traffic.com",    password: "Traffic2026!", nombre: "Usuario Ordenes",    rol: "ordenes"       },
    { id: "diseno",     email: "diseno@traffic.com",     password: "Traffic2026!", nombre: "Usuario Diseño",     rol: "diseno"        },
    { id: "guillotina", email: "guillotina@traffic.com", password: "Traffic2026!", nombre: "Usuario Guillotina", rol: "guillotina"    },
    { id: "impresion",  email: "impresion@traffic.com",  password: "Traffic2026!", nombre: "Usuario Impresión",  rol: "impresion"     },
    { id: "troquelado", email: "troquelado@traffic.com", password: "Traffic2026!", nombre: "Usuario Troquelado", rol: "troquelado"    },
    { id: "vasos",      email: "vasos@traffic.com",      password: "Traffic2026!", nombre: "Usuario Vasos",      rol: "vasos"         },
    { id: "empaques",   email: "empaques@traffic.com",   password: "Traffic2026!", nombre: "Usuario Empaques",   rol: "empaques"      }
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
