# CLAUDE.md

Guía de trabajo para Claude Code (y cualquier agente o persona nueva) en este
repositorio. Léela antes de tocar código. El [README.md](./README.md) explica
*qué es* el producto; este archivo explica *cómo se trabaja en él*.

---

## 1. El proyecto en 30 segundos

Worker de Cloudflare que, tres veces por semana, genera un copy de LinkedIn para
Convergente Digital: lee el sitio web de la empresa, infiere el tono de marca con
OpenAI, elige un tema y un formato que no se hayan usado recientemente, redacta
el post, lo guarda en una Lista de SharePoint y avisa en Teams.

**SharePoint y Teams todavía no tienen credenciales.** Están implementados y
degradan a *no-op* sin romper nada. No los "arregles": no están rotos, están
esperando secretos.

---

## 2. Comandos

```bash
npm install          # instalar dependencias
npm run dev          # servidor local en http://localhost:8787
npm run deploy       # publicar en Cloudflare
npx tsc --noEmit     # ÚNICA verificación automática disponible hoy
npx wrangler tail    # logs en vivo de producción
```

`npm test` **no está implementado** (falla a propósito). No lo uses como señal de
verificación ni lo reportes como "tests pasando".

Para probar un cambio de extremo a extremo, con `npm run dev` corriendo en otra
terminal:

```bash
curl -X POST http://localhost:8787/run   # ejecuta el pipeline completo
curl http://localhost:8787/state         # inspecciona el estado persistido
```

⚠️ Cada `POST /run` hace llamadas reales a OpenAI y **cuesta dinero**. No lo
dispares en bucle ni para "verificar que compila".

---

## 3. Arquitectura y flujo de datos

```
scheduled() ─┐
             ├─→ getAgentByName(env.AgenteContenido, "default")  ← una sola instancia
fetch()    ──┘         │
                       ▼
              AgenteContenido.onRequest()  → enruta / run / state / health
                       │
                       ▼
              AgenteContenido.runPipeline()   ← TODA la orquestación vive aquí
                       │
   ┌───────────────────┼───────────────────┬──────────────┬────────────┐
   ▼                   ▼                   ▼              ▼            ▼
scrape-website   brand-voice        generate-copy   save-sharepoint  notify-teams
```

### La regla estructural que hay que respetar

- **`src/index.ts`** es el único que conoce el agente, `this.state`, `this.env`
  y el orden de los pasos. Ahí va la orquestación y la persistencia.
- **`src/pipeline/*.ts`** son módulos independientes: reciben todo por
  parámetros (incluidas las API keys) y devuelven datos. **No importan `Agent`,
  no leen `env`, no llaman a `setState`.**

Si un cambio te tienta a leer estado desde un módulo de `pipeline/`, pásalo como
parámetro desde `runPipeline()`.

### Archivo por archivo

| Archivo | Responsabilidad | Notas |
|---|---|---|
| `src/index.ts` | Agente, estado, rutas HTTP, cron, orquestación | Aquí están las constantes de negocio ajustables |
| `src/pipeline/scrape-website.ts` | HTML → texto plano | Regex, sin librerías. Timeout 15 s, corta a 20 000 caracteres |
| `src/pipeline/brand-voice.ts` | OpenAI → `BrandVoice` | `response_format: json_object`, envía 4 000 caracteres por página |
| `src/pipeline/generate-copy.ts` | `elegirTema`, `elegirFormato`, redacción | Aquí vive el prompt de marca. Cambios aquí afectan directo al negocio |
| `src/pipeline/save-sharepoint.ts` | Graph API client-credentials → item de Lista | Token nuevo en cada llamada (no se cachea) |
| `src/pipeline/notify-teams.ts` | POST al webhook del canal | Nunca lanza: captura y devuelve `{ sent: false, reason }` |

---

## 4. Convenciones de código

1. **Idioma.** Comentarios, prompts, mensajes de error visibles y vocabulario de
   dominio en **español neutro LATAM**. Los identificadores de dominio también
   (`tema`, `formato`, `elegirTema`, `RUTAS_SITIO`). Los tipos y funciones de
   infraestructura quedan en inglés (`BrandVoice`, `runPipeline`, `ScrapedPage`).
   Es una convención mixta deliberada — **no la unifiques**.
2. **El prompt de `generate-copy.ts` prohíbe explícitamente** mezclar inglés en
   el copy e inventar clientes, testimonios o cifras. Si editas ese prompt,
   conserva esas dos reglas: son requisitos del negocio, no relleno.
3. **TypeScript `strict`** con `noUnusedLocals` y `noUnusedParameters`. Una
   variable o parámetro sin usar **rompe la compilación** — prefija con `_` si
   es inevitable (ver `_event` en `scheduled()`).
4. **ESM puro**, sin extensión en los imports relativos (`./pipeline/brand-voice`).
5. **Manejo de errores por capas:**
   - *Blando* (devuelve un resultado con motivo, no lanza): scraping de una ruta,
     Teams, SharePoint no configurado, JSON de OpenAI no parseable.
   - *Duro* (lanza y marca la corrida `ok: false`): fallo de la API de OpenAI,
     fallo de autenticación de Graph, error al crear el item de SharePoint.

   Antes de añadir un `throw`, decide conscientemente en cuál de las dos capas
   estás.
6. **Nada de dependencias nuevas sin necesidad real.** El scraping es regex a
   propósito: el runtime de Workers no es Node y cada dependencia es peso y
   riesgo de compatibilidad.

---

## 5. Reglas de negocio no obvias

- El caché de tono de marca de **30 días** significa que un cambio en
  `RUTAS_SITIO` o en el prompt de `brand-voice.ts` **no se refleja hasta que el
  caché expire**. En local: borra `.wrangler/state/`. En producción: no hay
  endpoint para invalidarlo (candidato razonable a mejora).
- `elegirTema()` combina `brandVoice.servicios` (dinámico, del sitio) con dos
  temas fijos: *desarrollo de software a medida* y *creación de agentes de IA*.
  Esos dos están hardcodeados porque son las líneas nuevas y pueden no aparecer
  aún en el sitio.
- Hay **5 formatos** y el historial anti-repetición mira **6 corridas**. Es
  matemáticamente imposible evitarlos todos; por eso ambos selectores reabren el
  pool completo cuando se quedan sin opciones. No es un bug.
- `totalRunsCompleted` cuenta **solo corridas exitosas**; `lastRunAt` se
  actualiza **siempre**, exitosa o no. Son métricas distintas a propósito.
- La cadencia "nunca dos veces en menos de 24 h" la garantiza **solo el cron**.
  No hay guarda de idempotencia en el código.

---

## 6. Trampas conocidas

- **Los 5 secretos de SharePoint son todo o nada.** `sharePointConfigured()` los
  exige todos; si falta uno, el paso se salta en silencio con
  `sharePointSaved: false`.
- **`scheduled()` usa `ctx.waitUntil()` sin `.catch()`**: si el pipeline falla en
  una corrida por cron, el error no aparece en los logs. Solo se ve en
  `GET /state` → `recentRuns[0].error`.
- **`setState()` reescribe el estado completo.** Siempre haz spread del estado
  actual: `this.setState({ ...this.state, campoNuevo })`. Omitirlo borra datos.
- **`migrations` en `wrangler.jsonc`**: renombrar la clase `AgenteContenido`
  requiere una migración `renamed_classes`. Cambiar el nombre sin migración
  **pierde el estado en producción**. No lo hagas a la ligera.
- **Los crons de Cloudflare son UTC**, siempre. `0 15 * * 1,3,5` = 9:00 CDMX.
- **`nodejs_compat` es obligatorio** para el SDK de OpenAI. No lo quites de
  `compatibility_flags`.
- `save-sharepoint.ts` referencia `walkthroughs/06-microsoft-graph.md`, que **no
  existe** en este repo. La guía real está en la sección 8.1 del README.

---

## 7. Seguridad

- **Nunca** commitear `.dev.vars`, ni pegar claves en `wrangler.jsonc`, ni
  imprimirlas en logs o en respuestas HTTP.
- Los secretos de producción se cargan con `npx wrangler secret put <NOMBRE>` —
  nunca en `vars`.
- `GET /state` devuelve todo el historial sin autenticación. Si añades campos al
  estado, ten presente que quedan expuestos públicamente cuando el Worker está
  desplegado. Cerrar ese endpoint es la mejora #1 pendiente del README.

---

## 8. Cómo verificar un cambio

En orden, y sin saltarse pasos:

1. `npx tsc --noEmit` — obligatorio, es la única red de seguridad automática.
2. `npm run dev` + `curl -X POST http://localhost:8787/run` — **una sola vez**,
   y solo si el cambio afecta el pipeline en tiempo de ejecución.
3. `curl http://localhost:8787/state` — confirmar que el estado quedó coherente.
4. Reportar honestamente qué se verificó y qué no. No afirmes "probado" si solo
   compilaste.

---

## 9. Al terminar un cambio

- **Actualiza [CHANGELOG.md](./CHANGELOG.md)** en la sección `[Sin publicar]`,
  con el formato *Keep a Changelog* ya establecido. Es el mecanismo de
  trazabilidad acordado del proyecto.
- Si el cambio afecta configuración, endpoints, secretos o el flujo, actualiza
  también la sección correspondiente del README.
- Si resolviste algún punto de la tabla "Limitaciones conocidas" del README,
  quítalo de ahí.

---

## 10. Qué NO hacer

- No "completar" SharePoint/Teams inventando credenciales o endpoints.
- No convertir los no-ops en errores duros: la degradación suave es intencional.
- No añadir dependencias de Node que no funcionen en el runtime de Workers.
- No traducir a inglés el vocabulario de dominio ni los prompts.
- No cambiar el nombre de la clase del Durable Object sin migración.
- No ejecutar `POST /run` repetidamente: cada llamada gasta tokens de OpenAI.
- No hacer commit ni push salvo que se pida explícitamente.
