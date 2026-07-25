// ===== Configuracion de EmailJS =====
// Credenciales de la cuenta de EmailJS usada para enviar las ordenes de plancha
// automaticamente al correo del proveedor/disenador.
//
// IMPORTANTE (seguridad): en el navegador SOLO se usa la Public Key.
// La Private Key NUNCA debe incluirse en codigo del lado del cliente.
//
// Para que el correo llegue al destinatario que se escribe en el formulario,
// en la plantilla de EmailJS el campo "To Email" debe estar configurado como:
//     {{to_email}}
export const EMAILJS_CONFIG = {
    publicKey:  "aimWfj-RRaUGykqxD",
    serviceId:  "service_if2gk0k",
    templateId: "template_rfl8pnw"
};
