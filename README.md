# Agente de Contenido para LinkedIn — Convergente Digital

Agente autónomo que genera copys listos para publicar en LinkedIn sobre el
portafolio de servicios de ConverGente Digital (incluidos **desarrollo de
software a la medida** e **implementación de agentes de IA**), respetando el
tono, los servicios y los casos de éxito reales documentados en
[`context/convergente-digital-brand-reference.md`](context/convergente-digital-brand-reference.md).

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
| 1. Elegir tema y formato | ✅ Funcionando | Anti-repetición sobre las últimas 6 corridas |
| 2. Redactar el copy | ✅ Funcionando | OpenAI + contexto estático de marca, salida JSON estructurada |
| 3. Guardar en SharePoint | ✅ Funcionando | Verificado en local y en producción |
| 4. Avisar en Teams | ✅ Funcionando | Verificado en local y en producción, vía Workflows (tarjeta adaptable) |

**El agente ya está desplegado en producción:**
`https://agente-cd-contenidos.ai-projects-2c4.workers.dev` — cron activo
(lunes, miércoles y viernes, 9:00 a. m. CDMX).

> **Importante:** los pasos 3 y 4 están diseñados como *degradación suave*. Si no
> hay credenciales, **no rompen el pipeline**: el copy se genera igual y queda
> guardado en el estado del agente, consultable en `GET /state`.

---

## 2. Cómo funciona

### Diagrama del flujo

```
   Cron (L/Mi/V 9:00 CDMX)          POST /run (manual, con token)
              │                             │
              └──────────────┬──────────────┘
                             ▼
              ┌──────────────────────────────┐
              │  Durable Object "default"    │
              │  class AgenteContenido       │
              │  (estado persistente SQLite) │
              └──────────────┬───────────────┘
                             ▼
   [1] generate-copy.ts ─── elige tema + formato (evitando los 6 últimos)
                             │   ↳ temas = servicios reales del portafolio
                             ▼     (brand-context.ts)
   [2] generate-copy.ts ─── OpenAI: redacta el copy + hashtags (JSON),
                             │      usando brand-context.ts como contexto
                             │      de marca (tono, servicios, casos reales)
                             ▼
              ┌──────────────┴──────────────┐
              ▼                             ▼
   [3] save-sharepoint.ts        [4] notify-teams.ts
       Graph API (app-only)          Webhook del canal
       ⏸️ no-op sin credenciales     ⏸️ no-op sin webhook
              │                             │
              └──────────────┬──────────────┘
                             ▼
              Se registra la corrida en `state.recentRuns`
```

`brand-context.ts` no hace ninguna llamada externa: importa como texto plano
`context/convergente-digital-brand-reference.md` (el brochure corporativo) y
expone la lista de servicios reales del portafolio para rotar temas. Antes de
este cambio, el paso 1 leía el sitio web en vivo y un segundo paso llamaba a
OpenAI para inferir el tono — ver el CHANGELOG para el detalle de ese
reemplazo.

### Decisiones de diseño que conviene conocer

- **Una sola instancia del agente.** `getAgentByName(env.AgenteContenido, "default")`
  siempre resuelve al mismo Durable Object. Todo el historial vive ahí. Es
  intencional: es un agente único para toda la empresa, no uno por usuario.
- **El contexto de marca es estático, no se cachea ni expira.** Vive en
  `context/convergente-digital-brand-reference.md` y se importa como texto en
  build time (`src/pipeline/brand-context.ts`). Para actualizar el tono, los
  servicios o los casos de éxito, se edita ese archivo — no hace falta tocar
  código ni redesplegar por vencimiento de caché (si se cambia el archivo, sí
  hay que redesplegar para que el Worker lo recoja).
- **Anti-repetición por historial.** Se miran las últimas 6 corridas
  (`HISTORIAL_ANTIRREPETICION`) y se excluyen esos temas y formatos. Si ya no
  quedan opciones disponibles, se reabre el pool completo en vez de fallar.
- **Errores blandos vs. errores duros.** SharePoint y Teams degradan
  suavemente (devuelven `false` + un motivo). Un fallo de OpenAI sí marca la
  corrida como `ok: false` y queda registrado con su mensaje de error.
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
AGENT_API_TOKEN=cualquier-cadena-larga-y-aleatoria
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
# PowerShell (Windows) — reemplaza <token> por el valor de AGENT_API_TOKEN
$headers = @{ Authorization = "Bearer <token>" }
Invoke-WebRequest -Method Post -Uri http://localhost:8787/run -Headers $headers | Select-Object -Expand Content
Invoke-WebRequest -Uri http://localhost:8787/state -Headers $headers | Select-Object -Expand Content
```

```bash
# bash / Git Bash — reemplaza <token> por el valor de AGENT_API_TOKEN
curl -X POST -H "Authorization: Bearer <token>" http://localhost:8787/run
curl -H "Authorization: Bearer <token>" http://localhost:8787/state
```

> El estado local se guarda en `.wrangler/state/`. Bórralo si quieres empezar
> de cero (por ejemplo, para limpiar el historial de corridas).

### Verificar que el código compila

```bash
npx tsc --noEmit
```

---

## 4. Endpoints HTTP

| Método | Ruta | Auth | Qué hace |
|---|---|---|---|
| `POST` | `/run` | 🔒 Requiere token | Ejecuta el pipeline completo ahora y devuelve el resultado de la corrida |
| `GET` | `/state` | 🔒 Requiere token | Devuelve el estado completo: tono de marca cacheado + últimas 30 corridas (con sus copys) |
| `GET` | `/health` | Público | Chequeo rápido: `status`, `lastRunAt`, `totalRunsCompleted` |
| `GET` | `/` | Público | Mensaje de vida (`"ok — agente de contenido..."`) |

`/run` y `/state` exponen datos sensibles o gastan tokens de OpenAI, así que
exigen el header:

```
Authorization: Bearer <AGENT_API_TOKEN>
```

Sin el header, o con un valor incorrecto, responden `401 Unauthorized`. El cron
interno (`scheduled()`) manda este header automáticamente; no hace falta
configurarlo aparte para las corridas programadas.

Respuesta típica de `POST /run`:

```json
{
  "ok": true,
  "durationMs": 8421,
  "tema": "implementación de agentes de IA",
  "formato": "caso de uso o ejemplo concreto",
  "copy": "Texto completo del post...\n\n#IA #Automatizacion #Software",
  "sharePointSaved": false,
  "teamsNotified": false
}
```

---

## 5. Despliegue a producción

```bash
# 1. Autenticarse en Cloudflare (una sola vez)
npx wrangler login

# 2. Cargar los secretos (uno por uno; pide el valor de forma interactiva)
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put AGENT_API_TOKEN
# + los de SharePoint/Teams cuando estén disponibles (ver sección 8)

# 3. Publicar
npm run deploy
```

Al terminar, wrangler imprime la URL pública
(`https://agente-cd-contenidos.<subdominio>.workers.dev`). A partir de ese
momento el cron queda activo automáticamente.

**Ya desplegado:** `https://agente-cd-contenidos.ai-projects-2c4.workers.dev`

Ver logs en vivo:

```bash
npx wrangler tail
```

---

## 6. Configuración

### Variables públicas (`wrangler.jsonc` → `vars`)

| Variable | Valor actual | Para qué sirve |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo usado para redactar el copy |

### Secretos (nunca en el repo)

Local → `.dev.vars` · Producción → `npx wrangler secret put <NOMBRE>`

| Secreto | Estado | Usado por |
|---|---|---|
| `OPENAI_API_KEY` | ✅ Configurado (local + producción) | `generate-copy.ts` |
| `AGENT_API_TOKEN` | ✅ Configurado (local + producción) | `index.ts` — protege `/run` y `/state` |
| `MS_TENANT_ID` | ✅ Configurado (local + producción) | `save-sharepoint.ts` |
| `MS_CLIENT_ID` | ✅ Configurado (local + producción) | `save-sharepoint.ts` |
| `MS_CLIENT_SECRET` | ✅ Configurado (local + producción) | `save-sharepoint.ts` |
| `SHAREPOINT_SITE_ID` | ✅ Configurado (local + producción) | `save-sharepoint.ts` |
| `SHAREPOINT_LIST_ID` | ✅ Configurado (local + producción) | `save-sharepoint.ts` |
| `TEAMS_WEBHOOK_URL` | ✅ Configurado (local + producción) | `notify-teams.ts` |

Los seis secretos están cargados en `.dev.vars` y subidos a producción con
`wrangler secret put`. Verificados con corridas reales en ambos entornos
(`sharePointSaved: true`, `teamsNotified: true`).

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

### Constantes ajustables

| Constante | Archivo | Valor | Efecto |
|---|---|---|---|
| `HISTORIAL_ANTIRREPETICION` | `src/index.ts` | `6` | Cuántas corridas atrás se miran para no repetir |
| `MAX_RECENT_RUNS_KEPT` | `src/index.ts` | `30` | Cuántas corridas se conservan en el estado |
| `SERVICIOS` | `src/pipeline/brand-context.ts` | 6 servicios | Lista de temas entre los que rota `elegirTema()` |

---

## 7. Estado persistido del agente

Forma de `state` (lo que devuelve `GET /state`):

```ts
{
  lastRunAt: string | null;          // ISO de la última corrida (exitosa o no)
  totalRunsCompleted: number;        // solo cuenta las exitosas
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

### 8.1 SharePoint (paso 3)

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

### 8.2 Teams (paso 4)

1. En el canal de Teams destino: **Workflows** → plantilla
   *"Enviar alertas de webhook a un canal"* ("Post to a channel when a webhook
   request is received").
2. Copiar la URL generada ("Copiar vínculo de webhook").
3. `npx wrangler secret put TEAMS_WEBHOOK_URL` y redesplegar.

El mensaje se envía como una **tarjeta adaptable (Adaptive Card)** envuelta en
`attachments` — es el formato que espera esta plantilla de Workflows. Ver
`src/pipeline/notify-teams.ts`.

---

## 9. Estructura del proyecto

```
agente-cd-contenidos/
├── context/
│   └── convergente-digital-brand-reference.md  # Brochure — fuente de verdad de marca
├── src/
│   ├── index.ts                  # Agente + orquestación del pipeline + rutas HTTP + cron
│   ├── types/
│   │   └── markdown.d.ts         # Declaración de tipos para imports de .md como texto
│   └── pipeline/
│       ├── brand-context.ts      # Importa el brochure + lista de servicios (SERVICIOS)
│       ├── generate-copy.ts      # Selección de tema/formato + redacción del copy
│       ├── save-sharepoint.ts    # Microsoft Graph (client credentials) → Lista
│       └── notify-teams.ts       # Webhook del canal de Teams
├── wrangler.jsonc                # Config del Worker: DO, cron, vars, regla de import de .md
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
| 1 | **Sin tests** | `npm test` está sin implementar | `vitest` + `@cloudflare/vitest-pool-workers`; empezar por `elegirTema`/`elegirFormato`, que son funciones puras |
| 2 | **Los fallos son silenciosos** | Si OpenAI falla, no se notifica a nadie: solo queda en `state.recentRuns[0].error` | Enviar a Teams también desde el `catch` del pipeline |
| 3 | **Errores del cron se tragan** | `scheduled()` usa `ctx.waitUntil(...)` sin capturar el resultado | Añadir `.catch()` con `console.error` |
| 4 | **Observabilidad no declarada** | `wrangler.jsonc` no incluye `observability` | Agregar `"observability": { "enabled": true }` |
| 5 | **El estado crece** | 30 corridas × copy completo se serializan enteras en cada `setState` | Recortar `copy` en el historial una vez que SharePoint sea la fuente de verdad |
| 6 | **Sin guarda de idempotencia** | La no-repetición diaria depende solo del cron; dos `POST /run` seguidos generan dos copys | Agregar una comprobación sobre `lastRunAt` si se requiere |
| 7 | **Referencia rota** | `save-sharepoint.ts` menciona `walkthroughs/06-microsoft-graph.md`, que no existe en el repo | Crear el documento o apuntar a la sección 8.1 de este README |
| 8 | **Token único sin rotación** | `AGENT_API_TOKEN` es un solo secreto compartido; si se filtra hay que rotarlo a mano | Documentar el procedimiento de rotación, o pasar a Cloudflare Access si el equipo crece |
| 9 | **Contexto de marca desactualizable en silencio** | Si el brochure cambia (nuevo servicio, nuevo caso de éxito) y nadie actualiza `context/convergente-digital-brand-reference.md`, el agente sigue generando contenido con datos viejos, sin ninguna alerta | Revisar el documento periódicamente como parte del mantenimiento del agente |

---

## 11. Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `POST /run` o `GET /state` devuelven `401 Unauthorized` | Falta el header `Authorization` o el token no coincide con `AGENT_API_TOKEN` | Revisar el header enviado; ver [sección 4](#4-endpoints-http) |
| `POST /run` devuelve `ok: false` con error de OpenAI | API key inválida o sin saldo | Verificar la key y el saldo de la cuenta |
| El copy sale vacío (`texto: ""`) | El modelo no devolvió JSON parseable | Revisar el prompt en `generate-copy.ts`; el código cae a `""` sin lanzar excepción |
| Siempre genera el mismo tema | Poco historial en `recentRuns` (agente recién desplegado) | Es esperado al inicio; con más corridas el anti-repetición empieza a rotar sobre los 6 servicios de `SERVICIOS` |
| `sharePointSaved: false` siempre | Falta alguno de los 5 secretos de Microsoft | Ver [sección 8.1](#81-sharepoint-paso-3) |
| El cron no dispara | El Worker no está desplegado, o el cron se editó sin redesplegar | `npm run deploy` y revisar el dashboard de Cloudflare → Workers → Triggers |
| Cambios al brochure de marca no se reflejan | El Worker no se redesplegó después de editar `context/convergente-digital-brand-reference.md` | `npm run deploy` — el archivo se empaqueta en build time, no se lee en runtime |

---

## Convenciones del repositorio

- **Todo el contenido de cara al usuario va en español neutro LATAM**, incluidos
  comentarios, nombres de variables de dominio (`tema`, `formato`, `elegirTema`)
  y los prompts. Es una regla explícita del negocio, no una preferencia estética.
- Los nombres técnicos de infraestructura y de los tipos siguen en inglés
  (`runPipeline`, `GeneratedCopy`, `AgentState`) — es la convención mixta ya
  establecida; respétala en vez de unificar.
- TypeScript en modo `strict`, con `noUnusedLocals` y `noUnusedParameters`
  activos: el código sin usar **rompe la compilación**.
- Nunca commitear `.dev.vars` ni pegar claves en `wrangler.jsonc`.

Ver [CLAUDE.md](./CLAUDE.md) para la guía detallada de trabajo en este repo y
[CHANGELOG.md](./CHANGELOG.md) para el histórico de cambios.
