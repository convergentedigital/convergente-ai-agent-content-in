# Agente de Contenido para LinkedIn — Convergente Digital

Genera copys listos para publicar en LinkedIn sobre los servicios de la empresa
(incluidas las nuevas líneas: software a medida y agentes de IA), basándose en
el tono de marca detectado en [convergentedigital.com](https://convergentedigital.com/).

## Qué hace cada corrida

1. Analiza el sitio web (o reusa el análisis si tiene menos de 30 días)
2. Elige un tema y un formato distintos a los usados en las últimas 6 corridas
3. Genera el copy completo con OpenAI (`gpt-4o-mini`)
4. Lo guarda en una Lista de SharePoint — **pendiente de configurar**
5. Avisa en un canal de Teams — **pendiente de configurar**

Mientras los pasos 4 y 5 no tengan credenciales, el agente sigue funcionando:
genera el copy igual, solo no lo guarda ni notifica automáticamente. Puedes
verlo con `/state` (ver abajo).

## Calendario

Corre lunes, miércoles y viernes a las 9:00am hora CDMX. Nunca dos veces en
menos de 24 horas. Editable en `wrangler.jsonc` → `triggers.crons`.

## Comandos

```bash
npm run dev        # probar localmente
npm run deploy      # publicar en internet
```

Con el servidor local corriendo (`npm run dev`), en otra terminal:

```powershell
Invoke-WebRequest -Method Post -Uri http://localhost:8787/run
Invoke-WebRequest -Uri http://localhost:8787/state
```

## Variables de entorno

**Configuradas** (en `.dev.vars` para local, con `wrangler secret put` en producción):
- `OPENAI_API_KEY`

**Pendientes** (una vez que tengas el registro en Microsoft Entra ID):
- `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`
- `SHAREPOINT_SITE_ID`, `SHAREPOINT_LIST_ID`
- `TEAMS_WEBHOOK_URL`

## Estructura

```
src/
├── index.ts              — el agente principal, orquesta el pipeline
└── pipeline/
    ├── scrape-website.ts   — lee el contenido del sitio web
    ├── brand-voice.ts      — detecta tono/estilo de marca con IA
    ├── generate-copy.ts    — redacta el copy final
    ├── save-sharepoint.ts  — guarda en la Lista de SharePoint
    └── notify-teams.ts     — avisa en el canal de Teams
```
