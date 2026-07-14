// ============================================================
//  Validador inteligente de comprobantes de pago (OCR)
//  Lee la imagen del comprobante con Tesseract.js y verifica
//  que en el comprobante aparezca el monto que se va a pagar.
//  Si el monto no coincide, devuelve { ok:false, mensaje } para
//  bloquear el registro del pago.
//  El pago en efectivo NO requiere validacion (cualquier imagen).
// ============================================================

const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

// Palabras que indican que la imagen es realmente un comprobante de transferencia/pago.
const INDICADORES_COMPROBANTE = [
    "transferencia", "comprobante", "exitosa", "exitoso", "pago",
    "valor", "envio a banco", "envío a banco", "referencia", "cuenta"
];

let _tesseractPromise = null;

// Carga Tesseract.js una sola vez (lazy) desde CDN.
function cargarTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (_tesseractPromise) return _tesseractPromise;

    _tesseractPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = TESSERACT_CDN;
        script.async = true;
        script.onload = () => {
            if (window.Tesseract) resolve(window.Tesseract);
            else reject(new Error("No se pudo cargar el motor de lectura"));
        };
        script.onerror = () => reject(new Error("No se pudo cargar el motor de lectura"));
        document.head.appendChild(script);
    });
    return _tesseractPromise;
}

// Convierte el texto del comprobante en una lista de montos (enteros en pesos).
// Maneja formato colombiano: "." como separador de miles y "," como decimales.
//   "$790.000,00"  -> 790000
//   "$1.230.000"   -> 1230000
//   "$ 200.000,00" -> 200000
function extraerMontos(texto) {
    const montos = new Set();
    const regex = /\$?\s*(\d[\d.,]{2,})/g;
    let m;
    while ((m = regex.exec(texto)) !== null) {
        let token = m[1];
        // Quitar la parte decimal final (,00 o .00) si existe
        token = token.replace(/[.,]\d{2}$/, "");
        // Dejar solo digitos
        const digits = token.replace(/[^\d]/g, "");
        if (digits.length >= 4) {
            montos.add(parseInt(digits, 10));
        }
    }
    return [...montos];
}

// Normaliza texto: minusculas y sin tildes, para comparar palabras clave.
function normalizar(texto) {
    return texto
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

// Verifica si el monto esperado aparece entre los montos leidos.
// Se permite una pequena tolerancia por posibles errores de lectura del OCR.
function montoCoincide(montoEsperado, montosDetectados) {
    if (!montoEsperado || montoEsperado <= 0) return false;
    return montosDetectados.some(v => {
        if (v === montoEsperado) return true;
        // Tolerancia del 0.5% (o minimo 1 peso) por lectura imperfecta
        const tol = Math.max(1, Math.round(montoEsperado * 0.005));
        return Math.abs(v - montoEsperado) <= tol;
    });
}

/**
 * Valida un comprobante de pago verificando unicamente el monto.
 * @param {File} file            Imagen del comprobante.
 * @param {Object} opciones
 * @param {string} opciones.entidad         Metodo de pago: davivienda|bancolombia|nequi|efectivo
 *                                          (solo se usa para exonerar el efectivo).
 * @param {number} opciones.montoEsperado   Monto que se va a pagar (pesos).
 * @param {Function} [opciones.onProgreso]  Callback opcional (0..1) para mostrar avance.
 * @returns {Promise<{ok:boolean, mensaje?:string, texto?:string, montos?:number[]}>}
 */
export async function validarComprobante(file, { entidad, montoEsperado, onProgreso } = {}) {
    // El efectivo no requiere validacion: cualquier imagen es valida.
    if (entidad === "efectivo") {
        return { ok: true };
    }

    // Solo imagenes se pueden analizar con OCR. Los PDF no se pueden leer aqui.
    if (file && file.type === "application/pdf") {
        return {
            ok: false,
            mensaje: "Por seguridad, sube el comprobante como imagen (captura de pantalla o foto), no como PDF, para poder verificarlo."
        };
    }

    let Tesseract;
    try {
        Tesseract = await cargarTesseract();
    } catch (err) {
        console.error(err);
        return {
            ok: false,
            mensaje: "No se pudo iniciar la verificacion del comprobante. Revisa tu conexion e intenta de nuevo."
        };
    }

    let texto = "";
    try {
        const result = await Tesseract.recognize(file, "spa", {
            logger: m => {
                if (m.status === "recognizing text" && typeof onProgreso === "function") {
                    onProgreso(m.progress);
                }
            }
        });
        texto = (result && result.data && result.data.text) ? result.data.text : "";
    } catch (err) {
        console.error(err);
        return {
            ok: false,
            mensaje: "No se pudo leer el comprobante. Asegurate de subir una imagen clara y legible."
        };
    }

    const textoNorm = normalizar(texto);
    const montos = extraerMontos(texto);

    // 1) Verificar que sea realmente un comprobante de pago.
    const pareceComprobante = INDICADORES_COMPROBANTE.some(k => textoNorm.includes(normalizar(k)));
    if (!pareceComprobante && montos.length === 0) {
        return {
            ok: false,
            texto,
            montos,
            mensaje: "La imagen no parece ser un comprobante de pago. Sube el comprobante real de tu transferencia."
        };
    }

    // 2) Verificar unicamente el monto.
    const montoOk = montoCoincide(montoEsperado, montos);
    const montoFmt = "$" + (montoEsperado || 0).toLocaleString("en-US");

    if (!montoOk) {
        const detectado = montos.length
            ? " (se detecto: " + montos.map(v => "$" + v.toLocaleString("en-US")).join(", ") + ")"
            : "";
        return {
            ok: false,
            texto,
            montos,
            mensaje: `El comprobante no coincide con el monto a pagar de ${montoFmt}${detectado}. Verifica el valor de la transferencia.`
        };
    }

    return { ok: true, texto, montos };
}

// ============================================================
//  Modal de alerta reutilizable para mostrar errores de validacion.
// ============================================================
let _alertaInit = false;

function initAlertaComprobante() {
    if (_alertaInit) return;
    _alertaInit = true;

    const style = document.createElement("style");
    style.textContent = `
        .comp-alerta-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;z-index:99999;padding:20px;backdrop-filter:blur(2px)}
        .comp-alerta-overlay.show{display:flex}
        .comp-alerta-box{background:#fff;border-radius:16px;max-width:400px;width:100%;padding:26px 24px;box-shadow:0 20px 50px rgba(0,0,0,.3);text-align:center;font-family:inherit;animation:compAlertaIn .2s ease}
        @keyframes compAlertaIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
        .comp-alerta-icon{width:60px;height:60px;border-radius:50%;background:#fef2f2;color:#dc2626;display:flex;align-items:center;justify-content:center;font-size:30px;margin:0 auto 16px}
        .comp-alerta-title{font-size:18px;font-weight:700;color:#0f172a;margin:0 0 8px}
        .comp-alerta-msg{font-size:14px;color:#475569;line-height:1.5;margin:0 0 20px}
        .comp-alerta-btn{background:#dc2626;color:#fff;border:none;border-radius:10px;padding:11px 26px;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s}
        .comp-alerta-btn:hover{background:#b91c1c}
    `;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.className = "comp-alerta-overlay";
    overlay.id = "compAlertaOverlay";
    overlay.innerHTML = `
        <div class="comp-alerta-box">
            <div class="comp-alerta-icon"><i class="bi bi-exclamation-triangle-fill"></i></div>
            <h3 class="comp-alerta-title" id="compAlertaTitle">Comprobante no valido</h3>
            <p class="comp-alerta-msg" id="compAlertaMsg"></p>
            <button class="comp-alerta-btn" id="compAlertaBtn">Entendido</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const cerrar = () => overlay.classList.remove("show");
    overlay.querySelector("#compAlertaBtn").addEventListener("click", cerrar);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });
}

/** Muestra una ventana emergente de alerta con el mensaje indicado. */
export function mostrarAlertaComprobante(mensaje, titulo) {
    initAlertaComprobante();
    const overlay = document.getElementById("compAlertaOverlay");
    document.getElementById("compAlertaMsg").textContent = mensaje || "El comprobante no pudo ser verificado.";
    document.getElementById("compAlertaTitle").textContent = titulo || "Comprobante no valido";
    overlay.classList.add("show");
}
