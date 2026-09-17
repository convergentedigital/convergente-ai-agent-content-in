# Changelog

Registro de todos los cambios relevantes de **agente-cd-contenidos**.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el
versionado sigue [Versionado Semántico](https://semver.org/lang/es/).

## Cómo mantener este archivo

- Toda modificación funcional se anota en `[Sin publicar]` **en el mismo commit**
  que la introduce.
- Al liberar una versión, se mueve el bloque `[Sin publicar]` a una versión nueva
  con su fecha (`AAAA-MM-DD`) y se sube `version` en `package.json`.
- Categorías permitidas: `Añadido`, `Cambiado`, `Obsoleto`, `Eliminado`,
  `Corregido`, `Seguridad`.
- Cada entrada dice **qué cambió y por qué importa**, no solo qué archivo se tocó.
  Si aplica, se referencia el commit corto (ej. `60930b5`).

---

## [Sin publicar]

### Añadido

- `CLAUDE.md`: guía de trabajo para agentes de IA y personas que se incorporen al
  proyecto — arquitectura, convenciones de código, reglas de negocio no obvias,
  trampas conocidas, criterios de verificación y lista de "qué no hacer".
- `CHANGELOG.md`: este archivo, como mecanismo de trazabilidad del proyecto.

### Cambiado

- `README.md` reescrito para servir de documentación de incorporación completa:
  diagrama del pipeline, tabla de estado por paso, endpoints HTTP, guía de
  despliegue, tabla de secretos, forma del estado persistido, pasos concretos
  para habilitar SharePoint y Teams, tabla de limitaciones conocidas priorizada y
  sección de solución de problemas.
- Integración de SharePoint (paso 5 del pipeline) configurada y verificada en
  local: app registrada en Microsoft Entra ID (`Sites.Selected` con acceso
  otorgado solo al sitio `ContenidoRedesConvergente`), Lista `CopysLinkedIn`
  creada con las columnas esperadas, y corrida de prueba confirmando
  `sharePointSaved: true`.
- Integración de Teams (paso 6 del pipeline) configurada y verificada en local:
  canal `Contenido Redes` creado en el equipo `CONVERGENTE DIGITAL SAS`, flujo
  de Workflows "Enviar alertas de webhook a un canal" conectado, y corrida de
  prueba confirmando `teamsNotified: true`.
- Los 6 secretos (OpenAI + Microsoft + Teams) subidos a producción con
  `wrangler secret put`.
- **Primer despliegue a producción**:
  `https://agente-cd-contenidos.ai-projects-2c4.workers.dev`, con el cron
  `0 15 * * 1,3,5` activo. Las 6 etapas del pipeline funcionan de punta a punta
  tanto en local como en producción.
- **Autenticación por token compartido** en `/run` y `/state`: nuevo secreto
  `AGENT_API_TOKEN`, verificado en `onRequest` vía header
  `Authorization: Bearer <token>`; responden `401` sin token o con uno
  incorrecto. El disparo interno del cron en `scheduled()` manda el header
  automáticamente. `/health` y `/` se dejan públicos a propósito (no exponen
  datos sensibles). Resuelve el punto #1 de "Limitaciones conocidas" del
  README, verificado en local y en producción.

### Corregido

- `notify-teams.ts`: el payload pasa de texto plano (`{ "text": "..." }`) a una
  tarjeta adaptable (Adaptive Card) envuelta en `attachments`, que es el formato
  que exige la plantilla de Workflows "Enviar alertas de webhook a un canal".
  El formato anterior no era compatible con esa plantilla.

---

## [1.0.0] — 2026-09-06

Primera versión funcional del agente. Commit `60930b5`
("Baseline with cloudflare and openai configuration").

### Añadido

**Infraestructura**

- Worker de Cloudflare con Durable Object `AgenteContenido` (clase SQLite,
  migración `v1`), construido sobre el framework `agents` v0.22.
- Instancia única del agente (`getAgentByName(..., "default")`): todo el estado
  de la empresa vive en un solo Durable Object.
- Disparador cron `0 15 * * 1,3,5` — lunes, miércoles y viernes a las 9:00 a. m.
  hora CDMX (15:00 UTC).
- Configuración TypeScript en modo `strict` con `noUnusedLocals` y
  `noUnusedParameters`, tipos de `@cloudflare/workers-types`.
- `nodejs_compat` habilitado para dar soporte al SDK de OpenAI.

**Pipeline de generación de contenido**

- `scrape-website.ts`: lectura de páginas públicas y extracción de título,
  meta-descripción y texto plano mediante expresiones regulares, sin
  dependencias externas. Timeout de 15 s por página, tope de 20 000 caracteres,
  decodificación de entidades HTML. Las rutas que fallan se omiten sin romper el
  pipeline.
- `brand-voice.ts`: análisis del sitio con OpenAI para inferir tono, estilo,
  público objetivo y catálogo de servicios; salida forzada a JSON con valores por
  defecto si el modelo devuelve algo no parseable.
- Caché del análisis de marca por 30 días para evitar releer el sitio y gastar
  tokens en cada corrida.
- `generate-copy.ts`: selección de tema (servicios detectados + las líneas nuevas
  *software a medida* y *agentes de IA*) y de formato entre 5 opciones, con
  anti-repetición sobre las últimas 6 corridas y reapertura del pool cuando se
  agotan las opciones.
- Redacción del copy con OpenAI bajo un prompt de marca que exige español neutro
  LATAM, entre 800 y 1300 caracteres, párrafos cortos, llamada a la acción sutil
  y prohíbe explícitamente inventar clientes, testimonios o cifras.

**Integraciones**

- `save-sharepoint.ts`: creación de un item en una Lista de SharePoint vía
  Microsoft Graph con autenticación app-only (client credentials), mapeando los
  campos `Titulo`, `Tema`, `Formato`, `Copy`, `Estado` y `FechaSugerida`.
- `notify-teams.ts`: notificación al canal de Teams mediante webhook de la app
  Workflows.
- Degradación suave en ambas integraciones: si faltan credenciales, devuelven
  `false` con un motivo y el pipeline continúa generando el copy igualmente.

**Interfaz HTTP**

- `POST /run` — ejecuta el pipeline bajo demanda y devuelve el resultado.
- `GET /state` — estado completo: tono de marca cacheado e historial de corridas.
- `GET /health` — `status`, `lastRunAt` y `totalRunsCompleted`.
- `GET /` — comprobación de vida.

**Estado persistido**

- `lastRunAt`, `totalRunsCompleted`, `brandVoice` e historial `recentRuns`
  (últimas 30 corridas, con tema, formato, copy, duración, resultado de las
  integraciones y error si lo hubo).

### Pendiente en esta versión

- Credenciales de Microsoft Entra ID (`MS_TENANT_ID`, `MS_CLIENT_ID`,
  `MS_CLIENT_SECRET`) e identificadores de SharePoint (`SHAREPOINT_SITE_ID`,
  `SHAREPOINT_LIST_ID`): los pasos 5 y 6 del pipeline quedan inactivos hasta
  tenerlas.
- `TEAMS_WEBHOOK_URL` para la notificación al canal.
- Suite de pruebas automatizadas (`npm test` sin implementar).
- Autenticación de los endpoints HTTP: `POST /run` y `GET /state` quedan
  públicos una vez desplegado el Worker.

---

