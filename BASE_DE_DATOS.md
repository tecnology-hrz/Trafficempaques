# Base de datos de Traffic Empaques

Documento de referencia sobre cómo está montada la base de datos del proyecto (catálogo de productos, cotizaciones, producción, etc.), cómo conectarse y cómo cargar imágenes.

Todo lo que aparece aquí sale del código del repositorio (`assets/js/*.js`, `storage.rules`, `cors.json`). Cuando algo no se puede comprobar desde el código (por ejemplo, las reglas de Firestore, que solo están en la consola de Firebase) se indica.

---

## 1. Resumen

| Elemento | Valor |
|---|---|
| Proveedor | Firebase (Google) |
| Proyecto | `traffic-9b19f` |
| Base de datos | Cloud Firestore (NoSQL, colecciones y documentos) |
| Archivos | Firebase Storage, bucket `traffic-9b19f.firebasestorage.app` (solo carpeta `planchas/`) |
| Imágenes de productos y landing | ImgBB (`i.ibb.co`), **no** Firebase Storage |
| SDK usado | Firebase JS SDK 10.12.0 cargado por CDN (`gstatic.com`) |
| Autenticación | Login propio contra la colección `usuarios` + `sessionStorage`. **No usa Firebase Auth** |
| Hosting | GitHub Pages (`.github/workflows/static.yml`) |
| Archivo de conexión | `assets/js/auth.js` (exporta `db`, `storage` y las funciones de Firestore/Storage) |

Puntos clave del diseño:

- Todas las colecciones son de primer nivel. No hay subcolecciones.
- Todas las escrituras usan `setDoc` con un ID generado en el cliente. No se usa `addDoc` ni `updateDoc`; para actualizar se lee el documento y se reescribe completo (`{...actual, ...cambios}`).
- No hay `firestore.rules`, `firebase.json`, `.firebaserc` ni índices en el repo. Las reglas de Firestore se manejan solo desde la consola.

---

## 2. Cómo conectarse

### 2.1 Configuración del proyecto

Es la misma que está en `assets/js/auth.js` y `config/key.js`. La configuración web de Firebase es pública por diseño (va en el navegador); lo que protege los datos son las reglas.

```js
const firebaseConfig = {
  apiKey: "AIzaSyBwv1vtzRLgaaJlQcEKb4e3_vjPAKx6wuU",
  authDomain: "traffic-9b19f.firebaseapp.com",
  projectId: "traffic-9b19f",
  storageBucket: "traffic-9b19f.firebasestorage.app",
  messagingSenderId: "999354084305",
  appId: "1:999354084305:web:2dca14852c1c3950404ef0"
};
```

### 2.2 Desde una página del proyecto (navegador)

Lo más sencillo es reutilizar `auth.js`, que ya inicializa todo:

```html
<script type="module">
  import { db, collection, getDocs, doc, setDoc } from "./assets/js/auth.js";

  const snap = await getDocs(collection(db, "catalogo"));
  snap.forEach(d => console.log(d.id, d.data()));
</script>
```

Para un archivo HTML independiente (fuera del proyecto):

```html
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
  import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

  const app = initializeApp(firebaseConfig);   // objeto de la sección 2.1
  const db = getFirestore(app);
  const storage = getStorage(app);
</script>
```

### 2.3 Desde Node.js (scripts de carga masiva)

Con reglas públicas basta el SDK web en Node, sin credenciales:

```bash
npm init -y
npm install firebase
```

```js
// leer-catalogo.mjs
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const snap = await getDocs(collection(db, "catalogo"));
console.log(`Productos: ${snap.size}`);
snap.forEach(d => console.log(d.id, d.data().nombre, d.data().precio));
```

```bash
node leer-catalogo.mjs
```

Si en el futuro se cierran las reglas, la opción para scripts de servidor es el **Admin SDK** (`npm install firebase-admin`) con una cuenta de servicio descargada desde *Consola de Firebase → Configuración del proyecto → Cuentas de servicio*. El Admin SDK ignora las reglas. Ese archivo JSON es una credencial: no se sube al repositorio.

### 2.4 Consola web

- Firestore: https://console.firebase.google.com/project/traffic-9b19f/firestore
- Storage: https://console.firebase.google.com/project/traffic-9b19f/storage
- Reglas de Firestore: pestaña **Reglas** dentro de Firestore.

---

## 3. Catálogo de productos (colección `catalogo`)

Es la colección que alimenta la tienda pública (`index.html`, `productos.html`, `catalogo.html`, `producto.html`, `carrito.html`) y el editor de catálogo del panel (`dashboard.html`, solo rol `administrador`).

### 3.1 Estructura de un documento

```json
{
  "categoria": "Comidas Principales",
  "icon": "bi-egg-fried",
  "descripcion": "Cajas versátiles para porciones protagonistas",
  "usos": "Hamburguesas · Arepas · Pasteles individuales · Platos especiales",
  "orden": 1,
  "nombre": "Caja Hamburguesa Pequeña",
  "alto": "10 cm",
  "largo": "12.2 cm",
  "ancho": "12.2 cm",
  "imagen": "https://i.ibb.co/d0ryLGWf/1.png",
  "precio": 1200,
  "tiers": [ { "min": 500, "precio": 900 }, { "min": 1000, "precio": 800 } ],
  "descuento": true,
  "descuentoPct": 10
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `categoria` | string | Una de las 7 categorías (ver 3.3) |
| `icon` | string | Clase de Bootstrap Icons de la categoría |
| `descripcion` | string | Descripción de la categoría (se copia en cada producto) |
| `usos` | string | Usos de la categoría (se copia en cada producto) |
| `orden` | number | Posición dentro de la categoría |
| `nombre` | string | Nombre del producto. Obligatorio; documentos sin `nombre` se ignoran en la tienda |
| `alto`, `largo`, `ancho` | string | Medidas con unidad (`"10 cm"`, `"Diám. 6.8 cm"`) o `"-"` si no aplica |
| `imagen` | string | URL completa de la imagen (hoy ImgBB). Obligatoria al guardar desde el panel |
| `precio` | number | Precio unitario base en COP, sin decimales. `0` = "a cotizar" |
| `tiers` | array | Escalas por cantidad `{min, precio}`: desde `min` unidades el precio unitario pasa a `precio` |
| `descuento` | boolean | Si tiene descuento activo |
| `descuentoPct` | number | Porcentaje de descuento. Solo cuenta si es mayor que 0 |

### 3.2 ID de los documentos

- Productos iniciales (semilla): `<Categoria_con_guiones_bajos>_<id>`, por ejemplo `Comidas_Principales_1`, `Street_Food_3`.
- Productos creados desde el panel: `<Categoria>_<orden>_<timestamp base36>`, por ejemplo `Vasos_5_lx3k9a2b`.

Para cargas masivas conviene mantener el primer formato: es legible y, al ser fijo, volver a correr el script sobrescribe el mismo documento en lugar de duplicarlo.

### 3.3 Categorías

No existe una colección de categorías. La categoría es un texto dentro de cada producto y la información de la categoría (icono, descripción, usos) vive en `assets/js/catalogo-data.js` (`CATALOGO_DATA`). Las categorías válidas, en el orden en que se muestran, son:

1. Comidas Principales
2. Completos y Compartidos
3. Street Food
4. Snacks y Acompañamientos
5. Exhibicion y Servicio
6. Vasos
7. Otros

Un producto con una categoría fuera de esta lista se muestra al final y no aparece en las pestañas del panel. Para agregar una categoría nueva hay que añadirla en `CATALOGO_DATA` y en `CATEGORIAS_CATALOGO` (`dashboard.js`).

### 3.4 Variantes

No hay modelo de variantes. Cada tamaño o versión es un documento propio (por ejemplo "Caja Chiff Grande" y "Caja Chiff Grande Ventana").

### 3.5 Cómo se calcula el precio en la tienda

Lógica en `assets/js/tienda-core.js`:

1. Se parte de `precio`.
2. Se recorre `tiers` ordenado por `min`; se toma la escala más alta cuyo `min` sea menor o igual a la cantidad pedida.
3. Si `descuento` es `true` y `descuentoPct > 0`, se aplica `precio × (1 − pct/100)`, redondeado.

La tienda también genera un `sku` que no se guarda en Firestore: `slug(categoria)--slug(nombre)`. Es el que usa la URL `producto.html?sku=...` y el carrito.

### 3.6 Respaldo local y semilla

- Si `catalogo` está vacía o falla la lectura, la tienda usa `CATALOGO_DATA` de `catalogo-data.js`.
- Al abrir la sección Catálogo del panel con la colección vacía, `poblarCatalogoDesdeLocal()` (`dashboard.js`) la llena con `CATALOGO_DATA` y `precio: 0, tiers: []`.
- `assets/js/setup-catalogo.js` (`poblarCatalogo()`) **borra todo el catálogo** y lo vuelve a crear desde `CATALOGO_DATA`, sin precios ni descuentos. Ninguna página lo importa; solo se ejecuta a mano. Cuidado: se pierden los precios cargados.

### 3.7 Carpeta `caalogo/`

`caalogo/Pantallazos/Pantallazos/<Categoría>/N.png` contiene las fotos originales de los productos, numeradas igual que el `id` de `CATALOGO_DATA`:

| Carpeta | Imágenes |
|---|---|
| Comidas Principales | 20 |
| Completos y Compartidos | 9 |
| Exhibicion y Servicio | 6 |
| Otros | 13 |
| Snacks y Acompañamientos | 11 |
| Street Food | 6 |
| Vasos | 4 |

El sitio no usa estos archivos directamente. Ya se subieron a ImgBB y las URLs están en `catalogo-data.js`.

---

## 4. Listas de precios del cotizador

El cotizador del panel lee seis colecciones con la misma forma. Se administran desde la configuración del panel (`dashboard.js`, botones "Agregar ...").

| Colección | Uso | Campos |
|---|---|---|
| `productosImprenta` | Productos de imprenta | `nombre`, `valor` |
| `productosDigital` | Servicios digitales | `nombre`, `valor` |
| `terminados` | Acabados | `nombre`, `valor` |
| `colores` | Colores | `nombre` |
| `materiales` | Materiales | `nombre` |
| `planchas` | Planchas | `nombre` |

ID: el nombre en minúsculas, espacios cambiados por `-` y sin caracteres especiales (`"Caja Box"` → `caja-box`). `valor` es un número en COP.

Nota: la colección `planchas` de Firestore (lista de opciones) es distinta de la carpeta `planchas/` de Storage (documentos adjuntos a órdenes).

---

## 5. Resto de colecciones

### `cotizaciones`
- ID: `<numero en minúscula>-<timestamp base36>`, por ejemplo `cot-0042-lx3k9a`.
- Campos al crear (`cotizador.js → crearCotizacion`): `numero` (`COT-0042`), `cliente`, `tipoPersona`, `nit`, `negocio`, `telefono`, `direccion`, `ciudad`, `tipo` (`imprenta`/`digital`), `modalidadPago` (`contado`/`credito`), `items[]`, `subtotal`, `aplicarIva`, `iva`, `total`, `estado` (`pendiente`), `metodoPago`, `comprobante`, `notas`, `comentarioCliente`, `fechaCreacion`, `fechaAprobacion`, `fechaActual`, `fechaEntrega`, `creadoPor`, `creadoPorEmail`, `origen` (`panel`/`web`).
- Ítem desde el carrito web: `{tipo, producto, descripcion, cantidad, terminados[], colores[], materiales[], planchas[], precioUnit, precioTotal}`.
- Campos que se agregan después:
  - Aprobación del cliente: `estado` (`aprobada`/`rechazada`), `tipoPago` (`completo`/`abono`), `montoPagado`, `comprobante` (URL ImgBB), `comprobanteNombre`, `abonos[]` (`{monto, metodo, comprobante, comprobanteNombre, fecha}`), `productosAdicionalesCotizar[]`.
  - Pago del saldo: `pagoRestanteCompletado`, `pagoRestanteFecha`.
  - Papelera: `eliminado`, `fechaEliminado`, `eliminadoPor`, `eliminadoPorEmail`.
  - Producción: `estadoProduccion` (texto con los tipos enviados, ej. `"digital imprenta "`).

### `config`
- `config/contadorCotizaciones`: `{ ultimo: number }`. Se incrementa en una transacción para generar `COT-XXXX` sin repetir.
- `config/landing`: contenido editable de la web pública (ver sección 6.2). Incluye `whatsapp` (se lee pero el panel no lo escribe; se edita a mano en la consola).

### `usuarios`
- ID: `admin`, `ventas`… (desde `setup.html`) o la parte del email antes de `@` (desde el panel).
- Campos: `email`, `password` (texto plano), `nombre`, `rol`.
- Roles: `administrador`, `ventas`, `digital`, `imprenta`, `ordenes`, `diseno`, `guillotina`, `impresion`, `troquelado`, `vasos`, `empaques`, `jefe_produccion`.

### `produccion`
- ID: `<idCotizacion>-<imprenta|digital>`.
- Campos: `cotizacionId`, `numero`, `cliente`, `negocio`, `nit`, `telefono`, `direccion`, `ciudad`, `tipo`, `items[]`, `total`, `metodoPago`, `tipoPago`, `montoPagado`, `comprobante`, `estado` (`en_produccion`), `pasoActual`, `seguimiento` (mapa paso → fecha ISO), `fechaEnvio`, `fechaLimiteDiseno`, `fechaEntrega`, `creadoPor`, `creadoPorEmail`. `remision.html` agrega `entregaCompletada` y los datos de entrega.
- Pasos imprenta: recibido → diseno → guillotina → impresion → troquelado → vasos → empaques → terminado.
- Pasos digital: recibido → diseno → revision → ajustes → entrega → terminado.

### `ordenesDiseno`
- ID: `<idProduccion>-diseno`.
- Campos: `ordenId`, `cotizacionId`, `numero`, `cliente`, `telefono`, `tipo`, `items[]` (con `imagenes[]` en ImgBB y `pacdoraLinks[]`), `estado`, `fechaLimite`, `creadoPor`, `creadoPorEmail`, `fechaCreacion`, `fechaActualizacion`.

### `clientes`
- ID: `<nombre-en-slug>-<timestamp base36>`.
- Campos: `nombre`, `tipoPersona` (`natural`/`juridica`), `nit`, `negocio`, `telefono`, `direccion`, `ciudad`, `fechaCreacion`, `cotizaciones`.

### `inventarioCarton`
- Campos: `tipo`, `tamano`, `pliegos` (existencias), `costo`, `minimo`, `notas`, `actualizadoPor`, `fechaActualizacion`, `fechaCreacion`.

### `inventarioMovimientos`
- ID: `mov-<timestamp base36>-<aleatorio>`.
- Campos: `tipoMov` (`salida`/`entrada`/`ajuste`), `cartonId`, `cartonTipo`, `cartonTamano`, `pliegos`, `costoUnit`, `costoTotal`, `cliente`, `ordenNumero`, `ordenId`, `cotizacionId`, `motivo`, `usuario`, `usuarioRol`, `fecha`.

### Páginas y colecciones que usan

| Página | Colecciones |
|---|---|
| `index.html`, `productos.html`, `catalogo.html`, `producto.html` | lee `catalogo`, `config/landing` |
| `carrito.html` | lee `catalogo`, `config/landing`; escribe `cotizaciones` y `config/contadorCotizaciones` |
| `login.html` | lee `usuarios` |
| `setup.html` | escribe `usuarios` |
| `dashboard.html` | todas, más Storage `planchas/` |
| `cotizacion.html` | lee/escribe `cotizaciones`; lee `catalogo` |
| `diseno.html` | lee/escribe `ordenesDiseno` |
| `seguimiento.html` | lee/escribe `produccion` y `cotizaciones` |
| `remision.html` | lee/escribe `produccion`; lee `cotizaciones` |
| `auditoria-cotizaciones.html`, `duplicados-cotizaciones.html` | herramientas de mantenimiento sobre `cotizaciones`, `produccion`, `ordenesDiseno` |

---

## 6. Imágenes: dónde están y cómo cargarlas

### 6.1 Situación actual

| Qué | Dónde se sube | Dónde queda la URL |
|---|---|---|
| Fotos de productos del catálogo | ImgBB (clave `IMGBB_KEY_ADMIN` en `dashboard.js`) | `catalogo/{id}.imagen` |
| Banners, galería, campañas y logos de marcas | ImgBB (`subirImgbb`, solo `image/*`, máx. 8 MB) | `config/landing` |
| Comprobantes de pago | ImgBB (`IMGBB_KEY` en `cotizacion-publica.js`) | `cotizaciones/{id}.comprobante` y `abonos[]` |
| Imágenes de diseño | ImgBB | `ordenesDiseno/{id}.items[].imagenes` |
| Documentos de planchas (PDF/imagen) | Firebase Storage `planchas/` (máx. 20 MB) | ítems de la orden |

**Respaldo automático:** todas las subidas pasan por `assets/js/subir-imagen.js` (`subirImagen(file, carpeta, claveImgbb)`). Primero intenta ImgBB (espera hasta 20 s). Si ImgBB falla, sube el archivo a Firebase Storage en `comprobantes/`, `disenos/`, `catalogo/`, `landing/` o `entregas/` (solo imágenes, máx. 10 MB, según `storage.rules`). Si fallan los dos, se muestra el error de siempre.

Firestore solo guarda la URL en texto. Cualquier URL pública de imagen sirve en el campo `imagen` (ImgBB, Firebase Storage u otro hosting).

### 6.2 Cargar una imagen de producto desde el panel

1. Entrar a `dashboard.html` con un usuario `administrador`.
2. Sección **Catálogo** → elegir la categoría → **Agregar producto** o editar uno existente.
3. Clic en el recuadro de imagen y elegir el archivo. Se sube a ImgBB y la URL se llena sola. También se puede pegar una URL a mano.
4. Completar nombre, medidas, precio, escalas y descuento → **Guardar**.

Para los banners: sección **Landing** del panel, subir en el espacio correspondiente y pulsar **Guardar** para publicar. Las medidas recomendadas están en `landing-config.js` (por ejemplo 1920 × 900 px para el carrusel principal, 900 × 900 px para categorías).

### 6.3 Carga masiva de productos con imágenes (opción ImgBB, igual que hoy)

Script de Node que recorre `caalogo/Pantallazos/Pantallazos/`, sube cada imagen a ImgBB y actualiza el campo `imagen` del producto `Categoria_N`. Requiere Node 18 o superior (trae `fetch` y `FormData`).

```js
// subir-imagenes-imgbb.mjs
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = { /* sección 2.1 */ };
const IMGBB_KEY = process.env.IMGBB_KEY;          // no dejar la clave escrita en el script
const RAIZ = "caalogo/Pantallazos/Pantallazos";

const db = getFirestore(initializeApp(firebaseConfig));

async function subirImgbb(buffer) {
  const form = new FormData();
  form.append("key", IMGBB_KEY);
  form.append("image", buffer.toString("base64"));
  const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: form });
  const data = await res.json();
  if (!data.success) throw new Error(data?.error?.message || "ImgBB rechazó la imagen");
  return data.data.url;
}

for (const categoria of await readdir(RAIZ)) {
  for (const archivo of await readdir(path.join(RAIZ, categoria))) {
    const n = parseInt(archivo);                    // "7.png" -> 7
    if (!n) continue;
    const url = await subirImgbb(await readFile(path.join(RAIZ, categoria, archivo)));
    const docId = `${categoria.replace(/\s+/g, "_")}_${n}`;
    // merge: true para no borrar precio, escalas ni descuento
    await setDoc(doc(db, "catalogo", docId), { imagen: url }, { merge: true });
    console.log(docId, "→", url);
  }
}
```

```powershell
$env:IMGBB_KEY = "<tu clave de ImgBB>"
node subir-imagenes-imgbb.mjs
```

Ojo: con `merge: true`, si el documento `Categoria_N` no existe se crea solo con `imagen` y sin `nombre`, y la tienda lo ignora. Primero hay que verificar que el producto exista en `catalogo`.

### 6.4 Opción Firebase Storage para imágenes de productos

Hoy `storage.rules` **solo permite** la carpeta `planchas/` y bloquea todo lo demás:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /planchas/{allPaths=**} {
      allow read: if true;
      allow write: if request.resource == null
                   || request.resource.size < 20 * 1024 * 1024;
    }
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

Si se quieren guardar las fotos del catálogo en Storage, primero hay que agregar una carpeta, por ejemplo `catalogo/`, **antes** del bloque que bloquea todo, y publicar las reglas desde la consola (*Storage → Reglas*) o con `firebase deploy --only storage`:

```
    match /catalogo/{allPaths=**} {
      allow read: if true;
      allow write: if request.resource == null
                   || (request.resource.size < 5 * 1024 * 1024
                       && request.resource.contentType.matches('image/.*'));
    }
```

Subida desde Node con el SDK web:

```js
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

const storage = getStorage(app);
const destino = ref(storage, `catalogo/${docId}.png`);
await uploadBytes(destino, buffer, { contentType: "image/png" });
const url = await getDownloadURL(destino);
await setDoc(doc(db, "catalogo", docId), { imagen: url }, { merge: true });
```

Trade-off frente a ImgBB:

| | ImgBB (actual) | Firebase Storage |
|---|---|---|
| Cambios necesarios | Ninguno | Agregar regla `catalogo/` |
| Borrar o reemplazar imágenes | Manual en la cuenta de ImgBB | Desde el panel/SDK (`deleteObject`) |
| Control de acceso | Clave de API visible en el código | Reglas de Storage |
| Costo | Gratis con límites de ImgBB | Cuota gratis de Firebase, luego por uso |

### 6.5 CORS del bucket

`cors.json` permite `GET` y `HEAD` desde `trafficempaques.com`, `www.trafficempaques.com`, `tecnology-hrz.github.io` y `localhost` (puertos 5500, 3000, 8080). Mostrar una imagen con `<img src>` no necesita CORS. Sí hace falta para descargarla con `fetch` desde otro dominio. Si se agrega un dominio nuevo:

```bash
gsutil cors set cors.json gs://traffic-9b19f.firebasestorage.app
```

---

## 7. Reglas y seguridad

### 7.1 Firestore

Las reglas de Firestore no están en el repositorio. Según lo indicado, hoy están **públicas** (lectura y escritura abiertas). Eso es lo que permite que los scripts de las secciones 2.3 y 6.3 funcionen sin credenciales.

La app no usa Firebase Auth, así que en las reglas no se puede usar `request.auth` para distinguir al administrador. Con reglas abiertas, cualquiera que tenga la configuración web (visible en el navegador) puede:

- Leer la colección `usuarios`, incluidas las contraseñas, que están en texto plano.
- Modificar o borrar productos, precios, cotizaciones y órdenes.

### 7.2 Recomendaciones

Estas son sugerencias, no cambios hechos:

1. **Mínimo inmediato**: dejar `catalogo` y `config` en solo lectura pública y abrir la escritura solo durante las cargas masivas.
2. **Sacar las contraseñas** de `usuarios` y pasar el login a Firebase Authentication (email/contraseña). Con eso las reglas pueden exigir `request.auth != null` y validar el rol.
3. **Guardar las reglas en el repo** (`firestore.rules` + `firebase.json`) para tener historial de cambios.
4. **Scripts de carga con Admin SDK** una vez cerradas las reglas.
5. **Mover las claves de ImgBB** fuera del código del navegador, o pasar las imágenes a Firebase Storage (6.4).

Ejemplo de reglas de transición (catálogo y landing de solo lectura, el resto sigue abierto mientras se migra el login):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /catalogo/{id} {
      allow read: if true;
      allow write: if false;   // abrir temporalmente para cargas masivas
    }
    match /{document=**} {
      allow read, write: if true;   // estado actual, cerrar al migrar a Firebase Auth
    }
  }
}
```

Antes de publicar algo así hay que tener en cuenta que el editor de catálogo del panel también escribe en `catalogo`. Con esa regla dejaría de poder guardar productos hasta migrar a Firebase Auth.

---

## 8. Referencia rápida de archivos

| Archivo | Qué tiene |
|---|---|
| `assets/js/auth.js` | Inicialización de Firebase y exportaciones (`db`, `storage`, funciones) |
| `assets/js/catalogo-data.js` | Catálogo local (`CATALOGO_DATA`): categorías, medidas, URLs ImgBB |
| `assets/js/tienda-core.js` | Lectura y normalización del catálogo, precios, carrito (`localStorage: traffic_carrito_v1`) |
| `assets/js/dashboard.js` | Panel: editor de catálogo, landing, usuarios, clientes, inventario, producción, Storage |
| `assets/js/cotizador.js` | Cotizaciones, contador, listas de precios |
| `assets/js/landing-config.js` | Esquema de `config/landing` y espacios de banners |
| `assets/js/setup-catalogo.js` | Semilla del catálogo (borra y recrea) |
| `assets/js/setup.js` | Creación de usuarios iniciales |
| `storage.rules` | Reglas de Storage |
| `cors.json` | CORS del bucket |
