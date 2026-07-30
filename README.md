# SHORE Kanban

Tablero de tareas personal con dos vertientes (**SHORE Content** y **Project Management · Shore Video**), estatus de Pendiente / En proceso / En revisión / Completado, prioridades, subtareas, dependencias entre tareas y con áreas, y un panel de pendientes rápidos.

Es una página web estática (HTML/CSS/JS) que guarda todo en una base de datos en la nube gratuita (Supabase), pensada para hostearse en GitHub Pages.

---

## 1. Crear la base de datos en Supabase (~5 min)

1. Ve a [supabase.com](https://supabase.com) y crea una cuenta gratuita.
2. Crea un **nuevo proyecto** (elige cualquier nombre y región, y una contraseña de base de datos — esa contraseña es distinta a la del tablero, guárdala por si acaso).
3. Espera a que el proyecto termine de aprovisionarse (1-2 minutos).
4. En el menú lateral, ve a **SQL Editor** → **New query**.
5. Abre el archivo [`supabase/schema.sql`](supabase/schema.sql) de este proyecto, copia **todo** el contenido y pégalo en el editor.
6. Antes de correrlo, define tu contraseña de acceso al tablero:
   - Abre el archivo `generar-hash.html` (incluido en este proyecto) en tu navegador — solo doble clic, no necesita servidor.
   - Escribe la contraseña que quieras usar y da clic en "Generar hash".
   - Copia el hash resultante y reemplaza `PEGA_AQUI_TU_HASH` al final del archivo `schema.sql` (línea del `insert into app_auth...`).
7. Da clic en **Run** en el SQL Editor de Supabase. Deberías ver "Success. No rows returned".

## 2. Conectar la app a tu proyecto de Supabase

1. En Supabase, ve a **Project Settings** (ícono de engrane) → **API**.
2. Copia el **Project URL** y la llave **anon public**.
3. Abre `js/config.js` en este proyecto y pega ambos valores:

```js
const SUPABASE_CONFIG = {
  url: 'https://tuproyecto.supabase.co',
  anonKey: 'eyJhbGciOi...'
};
```

## 3. Probar localmente (opcional pero recomendado)

Antes de publicarlo, ábrelo en tu compu:

- Opción simple: doble clic en `index.html` (puede que Chrome bloquee algunas cosas por seguridad de archivos locales).
- Opción recomendada: si tienes Python instalado, abre una terminal en la carpeta del proyecto y corre:
  ```
  python3 -m http.server 8000
  ```
  Luego entra a `http://localhost:8000` en tu navegador.

Deberías ver la pantalla de contraseña. Si te dice que falta configurar Supabase, revisa el paso 2.

## 4. Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub (puede ser privado o público — si es público, cualquiera puede ver el código, pero no puede entrar al tablero sin la contraseña).
2. Sube todos los archivos de esta carpeta al repositorio:
   ```
   git init
   git add .
   git commit -m "SHORE Kanban inicial"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
   git push -u origin main
   ```
3. En GitHub, ve a **Settings** → **Pages**.
4. En "Source", selecciona la rama `main` y la carpeta `/ (root)`.
5. Da clic en **Save**. En 1-2 minutos tu tablero estará disponible en:
   ```
   https://TU-USUARIO.github.io/TU-REPO/
   ```

Guarda ese link — es tu tablero.

---

## Cómo funciona el tablero

- **Vistas:** arriba puedes alternar entre "Todo" (ambas vertientes juntas, diferenciadas por color en el borde izquierdo de cada tarjeta), "SHORE Content" y "PM · Shore Video".
- **Arrastrar y soltar:** mueve las tarjetas entre columnas para cambiar su estatus.
- **Nueva tarea:** botón superior derecho. Ahí defines vertiente, estatus, prioridad, fecha límite, área o cliente del que depende, dependencia de otra tarea, descripción, notas breves y subtareas.
- **Prioridad:** un punto ámbar indica "Prioritaria"; un punto rojo pulsante indica "Urgente".
- **Subtareas:** si agregas subtareas, la tarjeta muestra una barra de progreso (ej. 3/7).
- **Dependencias entre tareas:** si una tarea depende de otra que no está "Completada", se ve atenuada con un candado 🔒 y el nombre de la tarea de la que depende.
- **Áreas:** cada tarea puede tener una etiqueta de color con el área (Brand, MKT, Comercial, Dirección, Administración, Culture & People, Producción, Postproducción) o "Cliente".
- **Filtros:** por área, por prioridad, y un toggle de "solo bloqueadas" para ver rápido qué depende de alguien más ahora mismo.
- **Pendientes rápidos:** botón superior para abrir el panel lateral — lista simple de recordatorios sueltos, sin pasar por el flujo de columnas.

## Nota sobre seguridad

La protección por contraseña es intencionalmente simple (pensada para uso personal, no para datos altamente sensibles). El hash se compara del lado del navegador contra un valor guardado en Supabase; no hay sesiones de usuario ni cifrado de nivel empresarial. Si en algún momento necesitas algo más robusto (varios usuarios, permisos distintos, etc.), se puede migrar a Supabase Auth — avísame y lo ajustamos.

## Estructura de archivos

```
shore-kanban/
├── index.html              # Estructura de la página
├── css/styles.css          # Estilos
├── js/config.js            # Credenciales de Supabase (edítalo tú)
├── js/app.js               # Lógica de la app
├── supabase/schema.sql     # Script para crear las tablas en Supabase
├── generar-hash.html       # Utilidad para generar el hash de tu contraseña
└── README.md                # Esta guía
```
