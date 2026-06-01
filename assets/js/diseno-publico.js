import { db, doc, getDoc, setDoc } from "./auth.js";

const params = new URLSearchParams(window.location.search);
const disenoId = params.get("id");

if (!disenoId) {
    document.body.innerHTML = '<div style="text-align:center;padding:60px;font-family:sans-serif;"><h2>Orden no encontrada</h2><p>El link no es valido.</p></div>';
}

let ordenDiseno = null;

async function cargarOrdenDiseno() {
    try {
        const docSnap = await getDoc(doc(db, "ordenesDiseno", disenoId));
        if (!docSnap.exists()) {
            document.body.innerHTML = '<div style="text-align:center;padding:60px;font-family:sans-serif;"><h2>Orden no encontrada</h2><p>Esta orden de diseño no existe o fue eliminada.</p></div>';
            return;
        }
        ordenDiseno = docSnap.data();
        renderOrdenDiseno();
    } catch (err) {
        console.error(err);
        document.body.innerHTML = '<div style="text-align:center;padding:60px;font-family:sans-serif;"><h2>Error</h2><p>No se pudo cargar la orden de diseño.</p></div>';
    }
}

function renderOrdenDiseno() {
    document.getElementById("disenoNumero").textContent = ordenDiseno.numero;
    document.getElementById("pubCliente").textContent = ordenDiseno.cliente;
    document.getElementById("pubTelefono").textContent = ordenDiseno.telefono || "-";
    document.getElementById("pubTipo").textContent = ordenDiseno.tipo || "-";

    // Fecha
    const fecha = new Date(ordenDiseno.fechaCreacion);
    const fechaStr = fecha.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    document.getElementById("disenoFecha").textContent = fechaStr;

    // Si ya fue respondida
    if (ordenDiseno.estado === "respondida") {
        mostrarCompletado();
        return;
    }

    // Renderizar productos
    const container = document.getElementById("pubProductosContainer");
    container.innerHTML = "";

    ordenDiseno.items.forEach((item, prodIdx) => {
        const card = document.createElement("div");
        card.className = "pub-producto-card";

        let tagsHtml = "";
        if (item.terminados && Array.isArray(item.terminados)) {
            item.terminados.forEach(t => { tagsHtml += `<span class="pub-producto-tag">${t}</span>`; });
        } else if (item.terminado) {
            tagsHtml += `<span class="pub-producto-tag">${item.terminado}</span>`;
        }
        if (item.colores && Array.isArray(item.colores)) {
            item.colores.forEach(c => { tagsHtml += `<span class="pub-producto-tag">${c}</span>`; });
        } else if (item.color) {
            tagsHtml += `<span class="pub-producto-tag">${item.color}</span>`;
        }

        // Pacdora links
        let pacdoraHtml = "";
        const links = item.pacdoraLinks || (item.pacdoraLink ? [item.pacdoraLink] : []);
        if (links.length > 0) {
            const linksItems = links.map((link, i) => `
                <button class="pub-pacdora-btn" data-url="${link}">
                    <i class="bi bi-box-seam"></i> Ver mockup 3D ${links.length > 1 ? "#" + (i + 1) : ""}
                </button>
            `).join("");
            pacdoraHtml = `<div class="pub-pacdora-links">${linksItems}</div>`;
        }

        let imagenesHtml = "";
        (item.imagenes || []).forEach((img, imgIdx) => {
            const estadoClass = img.estado === "aprobada" ? "aprobada" : img.estado === "rechazada" ? "rechazada" : "";
            const badgeText = img.estado === "aprobada" ? "Aprobada" : img.estado === "rechazada" ? "Rechazada" : "";

            imagenesHtml += `
                <div class="pub-imagen-card ${estadoClass}" data-prod="${prodIdx}" data-img="${imgIdx}">
                    <div class="pub-imagen-wrap">
                        <img src="${img.url}" alt="Diseño ${imgIdx + 1}">
                        <span class="pub-imagen-badge">${badgeText}</span>
                    </div>
                    <div class="pub-imagen-actions">
                        <button class="pub-btn-aprobar" data-prod="${prodIdx}" data-img="${imgIdx}">
                            <i class="bi bi-check-lg"></i> Aprobar
                        </button>
                        <button class="pub-btn-rechazar" data-prod="${prodIdx}" data-img="${imgIdx}">
                            <i class="bi bi-x-lg"></i> Rechazar
                        </button>
                    </div>
                </div>
            `;
        });

        card.innerHTML = `
            <div class="pub-producto-header">
                <span class="pub-producto-nombre"><strong>${item.cantidad}x</strong> ${item.producto}</span>
                ${tagsHtml}
            </div>
            ${pacdoraHtml}
            <div class="pub-imagenes-grid">
                ${imagenesHtml}
            </div>
        `;

        container.appendChild(card);
    });

    // Eventos de aprobacion/rechazo
    container.querySelectorAll(".pub-btn-aprobar").forEach(btn => {
        btn.addEventListener("click", () => {
            const prodIdx = parseInt(btn.dataset.prod);
            const imgIdx = parseInt(btn.dataset.img);
            setEstadoImagen(prodIdx, imgIdx, "aprobada");
        });
    });

    container.querySelectorAll(".pub-btn-rechazar").forEach(btn => {
        btn.addEventListener("click", () => {
            const prodIdx = parseInt(btn.dataset.prod);
            const imgIdx = parseInt(btn.dataset.img);
            setEstadoImagen(prodIdx, imgIdx, "rechazada");
        });
    });

    // Click en imagen para ver grande
    container.querySelectorAll(".pub-imagen-wrap").forEach(wrap => {
        wrap.addEventListener("click", () => {
            const img = wrap.querySelector("img");
            document.getElementById("imgModalImg").src = img.src;
            document.getElementById("imgModal").classList.add("show");
        });
    });

    // Click en botones Pacdora 3D
    container.querySelectorAll(".pub-pacdora-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const url = btn.dataset.url;
            if (url) abrirPacdoraModal(url);
        });
    });

    checkCanSend();
}

function setEstadoImagen(prodIdx, imgIdx, estado) {
    ordenDiseno.items[prodIdx].imagenes[imgIdx].estado = estado;

    // Actualizar UI
    const card = document.querySelector(`.pub-imagen-card[data-prod="${prodIdx}"][data-img="${imgIdx}"]`);
    card.className = `pub-imagen-card ${estado}`;
    const badge = card.querySelector(".pub-imagen-badge");
    badge.textContent = estado === "aprobada" ? "Aprobada" : "Rechazada";

    checkCanSend();
}

function checkCanSend() {
    // Habilitar boton si todas las imagenes tienen estado
    const todasRespondidas = ordenDiseno.items.every(item =>
        (item.imagenes || []).every(img => img.estado === "aprobada" || img.estado === "rechazada")
    );
    document.getElementById("btnEnviarAprobacion").disabled = !todasRespondidas;
}

// Enviar aprobacion
document.getElementById("btnEnviarAprobacion").addEventListener("click", async () => {
    const btn = document.getElementById("btnEnviarAprobacion");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Enviando...';

    try {
        const ref = doc(db, "ordenesDiseno", disenoId);
        await setDoc(ref, {
            ...ordenDiseno,
            estado: "respondida",
            fechaRespuesta: new Date().toISOString()
        });
        mostrarCompletado();
    } catch (err) {
        console.error(err);
        alert("Error al enviar. Intenta de nuevo.");
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle"></i> Enviar aprobacion';
    }
});

function mostrarCompletado() {
    document.getElementById("seccionAccionesDiseno").style.display = "none";
    document.getElementById("seccionCompletado").style.display = "block";

    const statusBar = document.getElementById("disenoStatusBar");
    statusBar.className = "diseno-status-bar aprobada";
    statusBar.querySelector("i").className = "bi bi-check-circle";
    document.getElementById("disenoStatusText").textContent = "Aprobacion enviada";
}

// Modal imagen
const imgModal = document.getElementById("imgModal");
const imgModalClose = document.getElementById("imgModalClose");
imgModalClose.addEventListener("click", () => imgModal.classList.remove("show"));
imgModal.addEventListener("click", (e) => {
    if (e.target === imgModal) imgModal.classList.remove("show");
});

// Modal Pacdora 3D
const pacdoraModal = document.getElementById("pacdoraModal");
const pacdoraModalClose = document.getElementById("pacdoraModalClose");
pacdoraModalClose.addEventListener("click", () => {
    pacdoraModal.classList.remove("show");
    document.getElementById("pacdoraIframe").src = "";
});
pacdoraModal.addEventListener("click", (e) => {
    if (e.target === pacdoraModal) {
        pacdoraModal.classList.remove("show");
        document.getElementById("pacdoraIframe").src = "";
    }
});

function abrirPacdoraModal(url) {
    document.getElementById("pacdoraIframe").src = url;
    document.getElementById("pacdoraOpenExternal").href = url;
    pacdoraModal.classList.add("show");
}

cargarOrdenDiseno();
