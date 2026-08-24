// ===== EXPORTACION A EXCEL =====
// Genera un .xlsx real usando SheetJS, que se carga de forma perezosa desde CDN
// (igual que Tesseract en comprobante-validador.js) para no pesar en el arranque.
// Si el CDN falla, cae automaticamente a un .csv compatible con Excel.
//
// Expone: window.exportarExcel(filas, columnas, opciones)

(function () {
    "use strict";

    const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    let _cargando = null;

    function cargarSheetJS() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        if (_cargando) return _cargando;

        _cargando = new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = SHEETJS_URL;
            s.async = true;
            s.onload = () => resolve(window.XLSX);
            s.onerror = () => reject(new Error("No se pudo cargar SheetJS"));
            document.head.appendChild(s);
        });
        return _cargando;
    }

    /** Descarga un Blob con el nombre indicado. */
    function descargar(blob, nombreArchivo) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = nombreArchivo;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    function nombreConFecha(base, ext) {
        const d = new Date();
        const p = n => String(n).padStart(2, "0");
        return `${base}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
    }

    /** Respaldo: CSV con BOM UTF-8 y separador ; (el que espera Excel en es-CO). */
    function exportarCSV(filas, columnas, opciones) {
        const esc = v => {
            const s = v === null || v === undefined ? "" : String(v);
            return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };

        const lineas = [columnas.map(c => esc(c.titulo)).join(";")];
        filas.forEach(f => lineas.push(columnas.map(c => esc(f[c.campo])).join(";")));

        const blob = new Blob(["\uFEFF" + lineas.join("\r\n")], {
            type: "text/csv;charset=utf-8;"
        });
        descargar(blob, nombreConFecha(opciones.archivo || "export", "csv"));
    }

    /**
     * Exporta filas a Excel.
     * @param {Array<Object>} filas    - objetos de datos
     * @param {Array<{campo:string,titulo:string,ancho?:number}>} columnas
     * @param {Object} opciones        - { archivo, hoja, titulo }
     * @returns {Promise<{formato:string}>}
     */
    async function exportarExcel(filas, columnas, opciones = {}) {
        if (!Array.isArray(filas) || filas.length === 0) {
            throw new Error("No hay datos para exportar");
        }

        let XLSX;
        try {
            XLSX = await cargarSheetJS();
        } catch (err) {
            console.warn("[excel-export] SheetJS no disponible, se exporta CSV.", err);
            exportarCSV(filas, columnas, opciones);
            return { formato: "csv" };
        }

        // Matriz: encabezados + datos, respetando el orden de columnas
        const encabezados = columnas.map(c => c.titulo);
        const datos = filas.map(f => columnas.map(c => {
            const v = f[c.campo];
            return v === null || v === undefined ? "" : v;
        }));

        const ws = XLSX.utils.aoa_to_sheet([encabezados, ...datos]);

        // Ancho de columnas: el declarado o calculado segun el contenido
        ws["!cols"] = columnas.map((c, i) => {
            if (c.ancho) return { wch: c.ancho };
            const largos = datos.map(r => String(r[i] ?? "").length);
            const max = Math.max(c.titulo.length, ...largos, 8);
            return { wch: Math.min(max + 2, 45) };
        });

        // Autofiltro en el encabezado, para ordenar y filtrar dentro de Excel.
        // (La version community de SheetJS no escribe paneles congelados.)
        ws["!autofilter"] = {
            ref: XLSX.utils.encode_range({
                s: { r: 0, c: 0 },
                e: { r: datos.length, c: columnas.length - 1 }
            })
        };

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, (opciones.hoja || "Datos").slice(0, 31));

        wb.Props = {
            Title: opciones.titulo || opciones.hoja || "Exportacion",
            Author: "Traffic Empaques",
            CreatedDate: new Date()
        };

        const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        descargar(
            new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
            nombreConFecha(opciones.archivo || "export", "xlsx")
        );

        return { formato: "xlsx" };
    }

    window.exportarExcel = exportarExcel;
})();
