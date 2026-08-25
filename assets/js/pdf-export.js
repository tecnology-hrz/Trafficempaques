// ===== EXPORTACION A PDF (cotizaciones y ordenes) =====
// Usa jsPDF + jspdf-autotable cargados via CDN en dashboard.html.
// Expone dos funciones globales: window.exportarCotizacionPDF y window.exportarOrdenPDF.

const BRAND = {
    primary: [41, 171, 226],   // #29ABE2
    dark:    [33, 37, 41],
    gray:    [120, 120, 120],
    light:   [240, 240, 240]
};

const EMPRESA = {
    nombre:   "Traffic",
    contacto: "Impresion Digital y Litografia"
};

const LOGO_URL = "public/img/logo.png";

// Cache del logo como dataURL para no recargarlo en cada PDF.
let _logoDataURL = null;
let _logoDims = null; // { w, h } proporcion original

// Precarga el logo y lo convierte a dataURL usando un canvas.
// Devuelve una promesa que resuelve en { dataURL, w, h } o null si falla.
function cargarLogo() {
    if (_logoDataURL) return Promise.resolve({ dataURL: _logoDataURL, ...(_logoDims || {}) });
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
                _logoDataURL = canvas.toDataURL("image/png");
                _logoDims = { w: img.naturalWidth, h: img.naturalHeight };
                resolve({ dataURL: _logoDataURL, ..._logoDims });
            } catch (e) {
                console.warn("No se pudo procesar el logo para el PDF:", e);
                resolve(null);
            }
        };
        img.onerror = () => {
            console.warn("No se pudo cargar el logo para el PDF.");
            resolve(null);
        };
        img.src = LOGO_URL;
    });
}

function fmtMoney(value) {
    const num = parseInt(value) || 0;
    return "$" + num.toLocaleString("en-US");
}

function getJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    return null;
}

// Dibuja el encabezado comun (logo + titulo del documento) y devuelve la Y siguiente.
// logo es el objeto { dataURL, w, h } devuelto por cargarLogo(), o null.
function drawHeader(docPdf, titulo, numero, logo) {
    const pageW = docPdf.internal.pageSize.getWidth();
    const barH = 26;

    // Barra superior de marca (fondo oscuro para que el logo claro se vea bien,
    // como en la pantalla de login) con una linea de acento azul debajo.
    docPdf.setFillColor(...BRAND.dark);
    docPdf.rect(0, 0, pageW, barH, "F");
    docPdf.setFillColor(...BRAND.primary);
    docPdf.rect(0, barH, pageW, 1.5, "F");

    // Logo (sobre la barra). Se escala para caber en una altura fija manteniendo proporcion.
    let textoX = 14;
    if (logo && logo.dataURL) {
        const maxH = 16;
        const maxW = 55;
        let w = logo.w || maxW;
        let h = logo.h || maxH;
        const ratio = w / h;
        h = maxH;
        w = h * ratio;
        if (w > maxW) { w = maxW; h = w / ratio; }
        const logoY = (barH - h) / 2;
        try {
            docPdf.addImage(logo.dataURL, "PNG", 14, logoY, w, h);
        } catch (e) {
            console.warn("No se pudo incrustar el logo:", e);
        }
    } else {
        // Sin logo: usar el nombre de la empresa como texto
        docPdf.setTextColor(255, 255, 255);
        docPdf.setFont("helvetica", "bold");
        docPdf.setFontSize(18);
        docPdf.text(EMPRESA.nombre, 14, 14);
        docPdf.setFont("helvetica", "normal");
        docPdf.setFontSize(9);
        docPdf.text(EMPRESA.contacto, 14, 20);
    }

    // Titulo del documento (derecha)
    docPdf.setTextColor(255, 255, 255);
    docPdf.setFont("helvetica", "bold");
    docPdf.setFontSize(14);
    docPdf.text(titulo, pageW - 14, 13, { align: "right" });
    docPdf.setFont("helvetica", "normal");
    docPdf.setFontSize(11);
    docPdf.text(numero || "", pageW - 14, 20, { align: "right" });

    return barH + 8;
}

// Dibuja una tabla de pares clave/valor con la info del cliente.
function drawInfoCliente(docPdf, startY, filas) {
    docPdf.autoTable({
        startY,
        theme: "plain",
        styles: { fontSize: 9, cellPadding: 1.5, textColor: BRAND.dark },
        columnStyles: {
            0: { fontStyle: "bold", cellWidth: 32, textColor: BRAND.gray },
            1: { cellWidth: 62 },
            2: { fontStyle: "bold", cellWidth: 32, textColor: BRAND.gray },
            3: { cellWidth: "auto" }
        },
        body: filas
    });
    return docPdf.lastAutoTable.finalY + 4;
}

// Pie de pagina con fecha de generacion y numeracion.
function drawFooter(docPdf) {
    const pageW = docPdf.internal.pageSize.getWidth();
    const pageH = docPdf.internal.pageSize.getHeight();
    const total = docPdf.internal.getNumberOfPages();
    const hoy = new Date().toLocaleString("es-CO");

    for (let i = 1; i <= total; i++) {
        docPdf.setPage(i);
        docPdf.setDrawColor(...BRAND.light);
        docPdf.line(14, pageH - 14, pageW - 14, pageH - 14);
        docPdf.setFontSize(8);
        docPdf.setTextColor(...BRAND.gray);
        docPdf.text("Generado: " + hoy, 14, pageH - 9);
        docPdf.text(`Pagina ${i} de ${total}`, pageW - 14, pageH - 9, { align: "right" });
    }
}

function displayList(val, fallbackSingle) {
    if (Array.isArray(val)) return val.length > 0 ? val.join(", ") : "-";
    if (val) return val;
    if (fallbackSingle) return fallbackSingle;
    return "-";
}

// ===== COTIZACION =====
async function exportarCotizacionPDF(cot) {
    const JsPDF = getJsPDF();
    if (!JsPDF) { alert("No se pudo cargar el generador de PDF. Verifica tu conexion."); return; }

    const logo = await cargarLogo();
    const docPdf = new JsPDF({ unit: "mm", format: "a4" });
    let y = drawHeader(docPdf, "COTIZACION", cot.numero || "", logo);

    // Fecha
    let fechaStr = "-";
    if (cot.fechaCreacion) {
        const f = new Date(cot.fechaCreacion);
        if (!isNaN(f)) fechaStr = f.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
    }
    const tipoLabel = cot.tipo === "ambas" ? "Imprenta y Digital" : (cot.tipo || "-");
    const estado = (cot.estado || "-").charAt(0).toUpperCase() + (cot.estado || "-").slice(1);

    y = drawInfoCliente(docPdf, y, [
        ["Cliente", cot.cliente || "-", "Fecha", fechaStr],
        ["NIT / Cedula", cot.nit || "-", "Estado", estado],
        ["Negocio", cot.negocio || "-", "Tipo", tipoLabel],
        ["Telefono", cot.telefono || "-", "Ciudad", cot.ciudad || "-"],
        ["Direccion", cot.direccion || "-", "Modalidad", cot.modalidadPago || "-"],
        ["Asesor", cot.creadoPor || "-", "", ""]
    ]);

    // Items
    const items = cot.items || [];
    const body = items.map((i, idx) => [
        i.id || (idx + 1),
        i.tipo === "digital" ? "Digital" : "Imprenta",
        i.producto || "-",
        i.cantidad || 0,
        displayList(i.terminados, i.terminado),
        displayList(i.colores, i.color),
        displayList(i.materiales),
        displayList(i.planchas),
        fmtMoney(i.precioUnit),
        fmtMoney(i.precioTotal)
    ]);

    docPdf.autoTable({
        startY: y,
        head: [["#", "Tipo", "Producto", "Cant.", "Terminado", "Color", "Material", "Plancha", "V. Unit", "V. Total"]],
        body,
        theme: "striped",
        headStyles: { fillColor: BRAND.primary, textColor: 255, fontSize: 8, halign: "center" },
        styles: { fontSize: 8, cellPadding: 2, textColor: BRAND.dark },
        columnStyles: {
            0: { halign: "center", cellWidth: 8 },
            3: { halign: "center" },
            8: { halign: "right" },
            9: { halign: "right", fontStyle: "bold" }
        }
    });

    y = docPdf.lastAutoTable.finalY + 6;

    // Totales
    const pageW = docPdf.internal.pageSize.getWidth();
    const totalesBody = [];
    if (cot.aplicarIva && cot.iva) {
        const subtotal = cot.subtotal !== undefined ? cot.subtotal : (cot.total - cot.iva);
        totalesBody.push(["Subtotal", fmtMoney(subtotal)]);
        totalesBody.push(["IVA (19%)", fmtMoney(cot.iva)]);
    }
    totalesBody.push(["TOTAL", fmtMoney(cot.total)]);

    docPdf.autoTable({
        startY: y,
        margin: { left: pageW - 84 },
        tableWidth: 70,
        theme: "plain",
        styles: { fontSize: 10, cellPadding: 2 },
        columnStyles: {
            0: { fontStyle: "bold", textColor: BRAND.gray },
            1: { halign: "right", fontStyle: "bold", textColor: BRAND.dark }
        },
        body: totalesBody,
        didParseCell: (data) => {
            if (data.row.index === totalesBody.length - 1) {
                data.cell.styles.fontSize = 12;
                data.cell.styles.textColor = BRAND.primary;
            }
        }
    });

    y = docPdf.lastAutoTable.finalY + 6;

    // Notas
    if (cot.notas && cot.notas.trim()) {
        docPdf.setFontSize(9);
        docPdf.setTextColor(...BRAND.gray);
        docPdf.setFont("helvetica", "bold");
        docPdf.text("Notas:", 14, y);
        docPdf.setFont("helvetica", "normal");
        docPdf.setTextColor(...BRAND.dark);
        const lines = docPdf.splitTextToSize(cot.notas, pageW - 28);
        docPdf.text(lines, 14, y + 5);
    }

    drawFooter(docPdf);
    docPdf.save(`${cot.numero || "cotizacion"}.pdf`);
}

// ===== ORDEN DE PRODUCCION =====
async function exportarOrdenPDF(orden) {
    const JsPDF = getJsPDF();
    if (!JsPDF) { alert("No se pudo cargar el generador de PDF. Verifica tu conexion."); return; }

    const logo = await cargarLogo();
    const docPdf = new JsPDF({ unit: "mm", format: "a4" });
    let y = drawHeader(docPdf, "ORDEN DE PRODUCCION", orden.numero || "", logo);

    let fechaStr = "-";
    if (orden.fechaEnvio) {
        const f = new Date(orden.fechaEnvio);
        if (!isNaN(f)) fechaStr = f.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
    }
    const tipoLabel = orden.tipo === "digital" ? "Digital" : "Imprenta";

    y = drawInfoCliente(docPdf, y, [
        ["Cliente", orden.cliente || "-", "Fecha envio", fechaStr],
        ["NIT / Cedula", orden.nit || "-", "Tipo", tipoLabel],
        ["Negocio", orden.negocio || "-", "Entrega", orden.fechaEntrega || "-"],
        ["Telefono", orden.telefono || "-", "Ciudad", orden.ciudad || "-"],
        ["Direccion", orden.direccion || "-", "Asesor", orden.creadoPor || "-"]
    ]);

    const items = orden.items || [];
    const body = items.map((i) => [
        (i.cantidad || 0) + "x",
        i.producto || "-",
        displayList(i.terminados, i.terminado),
        displayList(i.colores, i.color),
        displayList(i.materiales),
        displayList(i.planchas)
    ]);

    docPdf.autoTable({
        startY: y,
        head: [["Cant.", "Producto", "Terminado", "Color", "Material", "Plancha"]],
        body,
        theme: "striped",
        headStyles: { fillColor: BRAND.primary, textColor: 255, fontSize: 9, halign: "center" },
        styles: { fontSize: 9, cellPadding: 2.5, textColor: BRAND.dark },
        columnStyles: { 0: { halign: "center", cellWidth: 16, fontStyle: "bold" } }
    });

    drawFooter(docPdf);
    docPdf.save(`${orden.numero || "orden"}.pdf`);
}

window.exportarCotizacionPDF = exportarCotizacionPDF;
window.exportarOrdenPDF = exportarOrdenPDF;
