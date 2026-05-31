import { db, collection, query, where, getDocs } from "./auth.js";

// Si ya hay sesion activa en sessionStorage, redirigir
if (sessionStorage.getItem("userRol")) {
    window.location.href = "dashboard.html";
}

const form       = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passInput  = document.getElementById("password");
const btnLogin   = document.getElementById("btnLogin");
const errorMsg   = document.getElementById("errorMsg");
const errorText  = document.getElementById("errorText");
const toggleBtn  = document.getElementById("togglePassword");
const eyeIcon    = document.getElementById("eyeIcon");

// Toggle mostrar/ocultar contrasena
toggleBtn.addEventListener("click", () => {
    const isPassword = passInput.type === "password";
    passInput.type = isPassword ? "text" : "password";
    eyeIcon.className = isPassword ? "bi bi-eye-slash" : "bi bi-eye";
});

// Submit login
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();

    const email    = emailInput.value.trim();
    const password = passInput.value;

    if (!email || !password) {
        showError("Por favor completa todos los campos.");
        return;
    }

    setLoading(true);

    try {
        // Buscar usuario en la coleccion "usuarios" por email
        const q = query(collection(db, "usuarios"), where("email", "==", email));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            showError("No existe una cuenta con ese correo.");
            setLoading(false);
            return;
        }

        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();

        // Verificar contrasena
        if (userData.password !== password) {
            showError("Contrasena incorrecta.");
            setLoading(false);
            return;
        }

        // Verificar rol valido
        const rolesValidos = ["administrador", "digital", "imprenta"];
        if (!rolesValidos.includes(userData.rol)) {
            showError("Rol no autorizado.");
            setLoading(false);
            return;
        }

        // Guardar sesion
        sessionStorage.setItem("userRol", userData.rol);
        sessionStorage.setItem("userName", userData.nombre || email);
        sessionStorage.setItem("userEmail", email);
        sessionStorage.setItem("userId", userDoc.id);

        window.location.href = "dashboard.html";

    } catch (error) {
        setLoading(false);
        console.error(error);
        showError("Error de conexion. Verifica tu internet.");
    }
});

function showError(msg) {
    errorText.textContent = msg;
    errorMsg.classList.add("show");
}

function hideError() {
    errorMsg.classList.remove("show");
}

function setLoading(loading) {
    btnLogin.disabled = loading;
    btnLogin.innerHTML = loading
        ? '<span class="spinner"></span> Ingresando...'
        : '<i class="bi bi-box-arrow-in-right"></i> Ingresar';
}
