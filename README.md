# Agente de Contenido para LinkedIn — Convergente Digital

Agente autónomo que genera copys listos para publicar en LinkedIn sobre los
servicios de Convergente Digital (incluidas las líneas nuevas: **software a
medida** y **agentes de IA**), respetando el tono de marca detectado
automáticamente desde [convergentedigital.com](https://convergentedigital.com/).

Corre solo, en la nube, tres veces por semana. No necesita servidor propio ni
que alguien lo dispare a mano.

- **Runtime:** Cloudflare Workers + Durable Objects (SQLite)
- **Framework de agente:** [`agents`](https://github.com/cloudflare/agents) v0.22 (Cloudflare)
- **LLM:** OpenAI `gpt-4o-mini`
- **Lenguaje:** TypeScript (ESM, `strict`)

---

## Índice

1. [Estado actual del proyecto](#1-estado-actual-del-proyecto)
2. [Cómo funciona](#2-cómo-funciona)
3. [Puesta en marcha local](#3-puesta-en-marcha-local)
4. [Endpoints HTTP](#4-endpoints-http)
5. [Despliegue a producción](#5-despliegue-a-producción)
6. [Configuración](#6-configuración)
7. [Estado persistido del agente](#7-estado-persistido-del-agente)
8. [Completar las integraciones pendientes](#8-completar-las-integraciones-pendientes)
9. [Estructura del proyecto](#9-estructura-del-proyecto)
10. [Limitaciones conocidas y próximos pasos](#10-limitaciones-conocidas-y-próximos-pasos)
11. [Solución de problemas](#11-solución-de-problemas)

---

## 1. Estado actual del proyecto

| Paso del pipeline | Estado | Comentario |
|---|---|---|
| 1. Leer el sitio web | ✅ Funcionando | `fetch` nativo + extracción de texto, sin dependencias |
| 2. Detectar tono de marca | ✅ Funcionando | OpenAI; el resultado se cachea 30 días |
| 3. Elegir tema y formato | ✅ Funcionando | Anti-repetición sobre las últimas 6 corridas |
| 4. Redactar el copy | ✅ Funcionando | OpenAI, salida JSON estructurada |
| 5. Guardar en SharePoint | ✅ Funcionando | Configurado y probado en local (`sharePointSaved: true`); falta subir los secretos a producción |
| 6. Avisar en Teams | ⏸️ Pendiente | Falta la URL del webhook del canal |

> **Importante:** los pasos 5 y 6 están diseñados como *degradación suave*. Si no
> hay credenciales, **no rompen el pipeline**: el copy se genera igual y queda
> guardado en el estado del agente, consultable en `GET /state`.

---

## 2. Cómo funciona

### Diagrama del flujo

```
   Cron (L/Mi/V 9:00 CDMX)          POST /run (manual)
              │                             │
              └──────────────┬──────────────┘
                             ▼
              ┌──────────────────────────────┐
              │  Durable Object "default"    │
              │  class AgenteContenido       │
              │  (estado persistente SQLite) │
              └──────────────┬───────────────┘
                             ▼
   [1] scrape-website.ts ── lee 5 rutas del sitio (HTML → texto plano)
                             │   ↳ se salta las rutas que fallan (404, timeout)
                             ▼
   [2] brand-voice.ts ───── OpenAI: tono, estilo, público, servicios
                             │   ↳ CACHÉ: si el análisis tiene < 30 días se reusa
                             ▼         y NO se vuelve a leer el sitio
   [3] generate-copy.ts ─── elige tema + formato (evitando los 6 últimos)
                             │
                             ▼
   [4] generate-copy.ts ─── OpenAI: redacta el copy + hashtags (JSON)
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
   [5] save-sharepoint.ts        [6] notify-teams.ts
       Graph API (app-only)          Webhook del canal
       ⏸️ no-op sin credenciales     ⏸️ no-op sin webhook
              │                             │
              └──────────────┬──────────────┘
                             ▼
              Se registra la corrida en `state.recentRuns`
```

### Decisiones de diseño que conviene conocer

- **Una sola instancia del agente.** `getAgentByName(env.AgenteContenido, "default")`
  siempre resuelve al mismo Durable Object. Todo el historial y el tono de marca
  viven ahí. Es intencional: es un agente único para toda la empresa, no uno por
  usuario.
- **El tono de marca se cachea 30 días** (`BRAND_VOICE_MAX_AGE_DAYS` en
  `src/index.ts`). Evita releer el sitio y pagar tokens en cada corrida.
- **Anti-repetición por historial.** Se miran las últimas 6 corridas
  (`HISTORIAL_ANTIRREPETICION`) y se excluyen esos temas y formatos. Si ya no
  quedan opciones disponibles, se reabre el pool completo en vez de fallar.
- **Errores blandos vs. errores duros.** El scraping de una ruta, SharePoint y
  Teams degradan suavemente (devuelven `false` + un motivo). Un fallo de OpenAI sí
  marca la corrida como `ok: false` y queda registrado con su mensaje de error.
- **Sin base de datos externa.** Todo el estado vive en el SQLite del Durable Object.

---

## 3. Puesta en marcha local

### Requisitos

- Node.js 20 o superior
- Una cuenta de Cloudflare (para desplegar; para desarrollo local no hace falta)
- Una API key de OpenAI con saldo

### Pasos

```bash
git clone <url-del-repo>
cd agente-cd-contenidos
npm install
```

Crea el archivo `.dev.vars` en la raíz (**no se commitea**, ya está en `.gitignore`):

```ini
OPENAI_API_KEY=sk-...
# Opcionales — cuando estén disponibles:
# MS_TENANT_ID=
# MS_CLIENT_ID=
# MS_CLIENT_SECRET=
# SHAREPOINT_SITE_ID=
# SHAREPOINT_LIST_ID=
# TEAMS_WEBHOOK_URL=
```

Levanta el servidor local:

```bash
npm run dev     # queda escuchando en http://localhost:8787
```

Y en **otra terminal**, dispara una corrida:

```powershell
# PowerShell (Windows)
Invoke-WebRequest -Method Post -Uri http://localhost:8787/run | Select-Object -Expand Content
Invoke-WebRequest -Uri http://localhost:8787/state | Select-Object -Expand Content
```

```bash
# bash / Git Bash
curl -X POST http://localhost:8787/run
curl http://localhost:8787/state
```

> El estado local se guarda en `.wrangler/state/`. Bórralo si quieres empezar
> de cero (por ejemplo, para forzar un re-análisis del tono de marca).

### Verificar que el código compila

```bash
npx tsc --noEmit
```

---

## 4. Endpoints HTTP

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/run` | Ejecuta el pipeline completo ahora y devuelve el resultado de la corrida |
| `GET` | `/state` | Devuelve el estado completo: tono de marca cacheado + últimas 30 corridas (con sus copys) |
| `GET` | `/health` | Chequeo rápido: `status`, `lastRunAt`, `totalRunsCompleted` |
| `GET` | `/` | Mensaje de vida (`"ok — agente de contenido..."`) |

Respuesta típica de `POST /run`:

```json
{
  "ok": true,
  "durationMs": 8421,
  "tema": "creación de agentes de IA",
  "formato": "caso de uso o ejemplo concreto",
  "copy": "Texto completo del post...\n\n#IA #Automatizacion #Software",
  "sharePointSaved": false,
  "teamsNotified": false
}
```

> ⚠️ **Estos endpoints hoy no tienen autenticación.** Ver
> [Limitaciones conocidas](#10-limitaciones-conocidas-y-próximos-pasos).

---

## 5. Despliegue a producción

```bash
# 1. Autenticarse en Cloudflare (una sola vez)
npx wrangler login

# 2. Cargar los secretos (uno por uno; pide el valor de forma interactiva)
npx wrangler secret put OPENAI_API_KEY

# 3. Publicar
npm run deploy
```

Al terminar, wrangler imprime la URL pública
(`https://agente-cd-contenidos.<subdominio>.workers.dev`). A partir de ese
momento el cron queda activo automáticamente.

Ver logs en vivo:

```bash
npx wrangler tail
```

---

## 6. Configuración

### Variables públicas (`wrangler.jsonc` → `vars`)

| Variable | Valor actual | Para qué sirve |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo usado tanto para el análisis de marca como para el copy |
| `SITIO_WEB_BASE` | `https://convergentedigital.com` | Base sobre la que se resuelven las rutas a leer |

### Secretos (nunca en el repo)

Local → `.dev.vars` · Producción → `npx wrangler secret put <NOMBRE>`

| Secreto | Estado | Usado por |
|---|---|---|
| `OPENAI_API_KEY` | ✅ Configurado (local + producción) | `brand-voice.ts`, `generate-copy.ts` |
| `MS_TENANT_ID` | ✅ Configurado (solo local) | `save-sharepoint.ts` |
| `MS_CLIENT_ID` | ✅ Configurado (solo local) | `save-sharepoint.ts` |
| `MS_CLIENT_SECRET` | ✅ Configurado (solo local) | `save-sharepoint.ts` |
| `SHAREPOINT_SITE_ID` | ✅ Configurado (solo local) | `save-sharepoint.ts` |
| `SHAREPOINT_LIST_ID` | ✅ Configurado (solo local) | `save-sharepoint.ts` |
| `TEAMS_WEBHOOK_URL` | ⏸️ Pendiente | `notify-teams.ts` |

Los cinco secretos de Microsoft están cargados en `.dev.vars` y verificados con una
corrida local (`sharePointSaved: true`). Todavía no se subieron a producción con
`wrangler secret put` — eso se hace en el paso de despliegue (sección 5).

Los cinco de SharePoint son **todo o nada**: si falta uno, `sharePointConfigured()`
devuelve `false` y el paso se salta silenciosamente.

### Calendario (cron)

```jsonc
"triggers": { "crons": ["0 15 * * 1,3,5"] }
```

`15:00 UTC` = **9:00 a.m. hora CDMX** (México no aplica horario de verano desde
2022, así que la equivalencia UTC-6 es estable todo el año). Días: lunes,
miércoles y viernes.

Para cambiar la frecuencia, edita `wrangler.jsonc` y vuelve a desplegar.
Los crons de Cloudflare se expresan **siempre en UTC**.

### Constantes ajustables (`src/index.ts`)

| Constante | Valor | Efecto |
|---|---|---|
| `BRAND_VOICE_MAX_AGE_DAYS` | `30` | Cada cuánto se re-analiza el sitio web |
| `RUTAS_SITIO` | 5 rutas | Qué páginas se leen para inferir el tono |
| `HISTORIAL_ANTIRREPETICION` | `6` | Cuántas corridas atrás se miran para no repetir |
| `MAX_RECENT_RUNS_KEPT` | `30` | Cuántas corridas se conservan en el estado |

---

## 7. Estado persistido del agente

Forma de `state` (lo que devuelve `GET /state`):

```ts
{
  lastRunAt: string | null;          // ISO de la última corrida (exitosa o no)
  totalRunsCompleted: number;        // solo cuenta las exitosas
  brandVoice: {
    tono: string;
    estilo: string;
    publicoObjetivo: string;
    servicios: string[];             // alimenta la lista de temas posibles
    analizadoAt: string;             // ISO — base del caché de 30 días
  } | null;
  recentRuns: Array<{                // más reciente primero, máximo 30
    runAt: string;
    durationMs: number;
    ok: boolean;
    error?: string;
    tema?: string;
    formato?: string;
    copy?: string;                   // el copy completo, listo para publicar
    sharePointSaved?: boolean;
    teamsNotified?: boolean;
  }>;
}
```

Mientras SharePoint no esté conectado, **`recentRuns` es el único lugar donde
quedan los copys generados**. Guárdalos manualmente si los vas a usar.

---

## 8. Completar las integraciones pendientes

### 8.1 SharePoint (paso 5)

1. **Registrar la app** en Microsoft Entra ID del tenant de Convergente Digital
   (Azure Portal → Entra ID → App registrations → New registration).
2. Crear un **client secret** y anotar `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`.
3. Conceder el permiso **de aplicación** `Sites.Selected` (recomendado) o
   `Sites.ReadWrite.All`, y que un administrador otorgue el *admin consent*.
   Con `Sites.Selected` hay que autorizar además el sitio específico vía Graph.
4. Obtener los IDs vía Microsoft Graph:
   - `GET /v1.0/sites/{hostname}:/sites/{ruta-del-sitio}` → `SHAREPOINT_SITE_ID`
   - `GET /v1.0/sites/{site-id}/lists` → `SHAREPOINT_LIST_ID`
5. La Lista de SharePoint debe tener estas columnas con **exactamente** estos
   nombres internos (los espera `saveToSharePointList`):

   | Columna | Tipo | Notas |
   |---|---|---|
   | `Titulo` | Texto | Se llena con `"<tema> — <formato>"` |
   | `Tema` | Texto | |
   | `Formato` | Texto | |
   | `Copy` | Texto multilínea | El post completo |
   | `Estado` | Opción | Valores: `Pendiente`, `Aprobado`, `Publicado` |
   | `FechaSugerida` | Fecha y hora | ISO |

6. Subir los cinco secretos con `wrangler secret put` y redesplegar.

### 8.2 Teams (paso 6)

1. En el canal de Teams destino: **Workflows** → plantilla
   *"Post to a channel when a webhook request is received"*.
2. Copiar la URL generada.
3. `npx wrangler secret put TEAMS_WEBHOOK_URL` y redesplegar.

El mensaje se envía como `{ "text": "..." }` en formato Markdown simple. Si el
flujo de Workflows espera un *Adaptive Card*, hay que ajustar el payload en
`src/pipeline/notify-teams.ts`.

---

## 9. Estructura del proyecto

```
agente-cd-contenidos/
├── src/
│   ├── index.ts                  # Agente + orquestación del pipeline + rutas HTTP + cron
│   └── pipeline/
│       ├── scrape-website.ts     # HTML → texto plano (sin dependencias)
│       ├── brand-voice.ts        # OpenAI → tono, estilo, público, servicios
│       ├── generate-copy.ts      # Selección de tema/formato + redacción del copy
│       ├── save-sharepoint.ts    # Microsoft Graph (client credentials) → Lista
│       └── notify-teams.ts       # Webhook del canal de Teams
├── wrangler.jsonc                # Config del Worker: DO, cron, vars
├── tsconfig.json                 # TS strict, target es2021, tipos de Workers
├── package.json
├── CLAUDE.md                     # Guía para agentes de IA que trabajen en este repo
├── CHANGELOG.md                  # Trazabilidad de cambios
└── .dev.vars                     # Secretos locales (NO commitear)
```

**Regla de oro de la arquitectura:** `src/index.ts` orquesta y guarda estado;
los módulos de `src/pipeline/` son funciones de entrada/salida que **no conocen
el agente ni su estado**. Reciben todo por parámetros y devuelven datos.
Mantener esa separación es lo que hace el proyecto fácil de probar y extender.

---

## 10. Limitaciones conocidas y próximos pasos

Ordenadas por prioridad sugerida:

| # | Tema | Detalle | Sugerencia |
|---|---|---|---|
| 1 | **Endpoints sin autenticación** | Cualquiera con la URL pública puede llamar `POST /run` (gasta tokens de OpenAI) y leer `GET /state` (expone todos los copys) | Validar un token compartido en `onRequest`, o proteger con Cloudflare Access |
| 2 | **Sin tests** | `npm test` está sin implementar | `vitest` + `@cloudflare/vitest-pool-workers`; empezar por `elegirTema`/`elegirFormato` y los extractores de `scrape-website.ts`, que son funciones puras |
| 3 | **Los fallos son silenciosos** | Si OpenAI falla, no se notifica a nadie: solo queda en `state.recentRuns[0].error` | Enviar a Teams también desde el `catch` del pipeline |
| 4 | **Errores del cron se tragan** | `scheduled()` usa `ctx.waitUntil(...)` sin capturar el resultado | Añadir `.catch()` con `console.error` |
| 5 | **Observabilidad no declarada** | `wrangler.jsonc` no incluye `observability` | Agregar `"observability": { "enabled": true }` |
| 6 | **El estado crece** | 30 corridas × copy completo se serializan enteras en cada `setState` | Recortar `copy` en el historial una vez que SharePoint sea la fuente de verdad |
| 7 | **Rutas del sitio fijas en código** | `/agentes-ia` y `/software-a-medida` pueden no existir y se saltan sin avisar | Registrar en el estado qué rutas respondieron |
| 8 | **Sin guarda de idempotencia** | La no-repetición diaria depende solo del cron; dos `POST /run` seguidos generan dos copys | Agregar una comprobación sobre `lastRunAt` si se requiere |
| 9 | **Referencia rota** | `save-sharepoint.ts` menciona `walkthroughs/06-microsoft-graph.md`, que no existe en el repo | Crear el documento o apuntar a la sección 8.1 de este README |
| 10 | **Modelo único** | Se usa `gpt-4o-mini` tanto para analizar como para redactar | Considerar un modelo más capaz solo para el copy final |

---

## 11. Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `POST /run` devuelve `ok: false` con error de OpenAI | API key inválida o sin saldo | Verificar la key y el saldo de la cuenta |
| El copy sale vacío (`texto: ""`) | El modelo no devolvió JSON parseable | Revisar el prompt en `generate-copy.ts`; el código cae a `""` sin lanzar excepción |
| `servicios` viene vacío en `brandVoice` | El scraping no obtuvo contenido útil | Verificar que `SITIO_WEB_BASE` responde y que las rutas existen. Con `servicios: []` el agente sigue funcionando, pero solo rota entre 2 temas base |
| Siempre genera el mismo tema | `brandVoice.servicios` vacío + poco historial | Ver la fila anterior |
| `sharePointSaved: false` siempre | Falta alguno de los 5 secretos de Microsoft | Ver [sección 8.1](#81-sharepoint-paso-5) |
| El cron no dispara | El Worker no está desplegado, o el cron se editó sin redesplegar | `npm run deploy` y revisar el dashboard de Cloudflare → Workers → Triggers |
| Cambios en el tono de marca no se reflejan | El análisis cacheado tiene menos de 30 días | Borrar `.wrangler/state/` (local) o bajar temporalmente `BRAND_VOICE_MAX_AGE_DAYS` |

---

## Convenciones del repositorio

- **Todo el contenido de cara al usuario va en español neutro LATAM**, incluidos
  comentarios, nombres de variables de dominio (`tema`, `formato`, `elegirTema`)
  y los prompts. Es una regla explícita del negocio, no una preferencia estética.
- Los nombres técnicos de infraestructura y de los tipos siguen en inglés
  (`runPipeline`, `BrandVoice`, `ScrapedPage`) — es la convención mixta ya
  establecida; respétala en vez de unificar.
- TypeScript en modo `strict`, con `noUnusedLocals` y `noUnusedParameters`
  activos: el código sin usar **rompe la compilación**.
- Nunca commitear `.dev.vars` ni pegar claves en `wrangler.jsonc`.

Ver [CLAUDE.md](./CLAUDE.md) para la guía detallada de trabajo en este repo y
[CHANGELOG.md](./CHANGELOG.md) para el histórico de cambios.
