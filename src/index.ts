/**
 * Agente de contenido para LinkedIn — Convergente Digital.
 *
 * Cada corrida:
 *  1. Analiza convergentedigital.com para refrescar el tono de marca
 *     (solo si el análisis guardado tiene más de 30 días)
 *  2. Elige un tema (servicio actual o nueva línea de negocio) y un
 *     formato, evitando repetir lo usado en las últimas corridas
 *  3. Genera el copy completo con OpenAI
 *  4. Lo guarda en la Lista de SharePoint (si ya está configurado)
 *  5. Avisa en el canal de Teams (si ya está configurado)
 */
import { Agent, getAgentByName } from "agents";
import { scrapeSitePaths } from "./pipeline/scrape-website";
import { analyzeBrandVoice, type BrandVoice } from "./pipeline/brand-voice";
import { elegirTema, elegirFormato, generateLinkedInCopy } from "./pipeline/generate-copy";
import { saveToSharePointList, sharePointConfigured } from "./pipeline/save-sharepoint";
import { notifyTeams } from "./pipeline/notify-teams";

export type Env = {
  AgenteContenido: DurableObjectNamespace<AgenteContenido>;

  OPENAI_MODEL: string;
  SITIO_WEB_BASE: string;

  OPENAI_API_KEY: string;
  AGENT_API_TOKEN: string;

  // Pendientes hasta tener el registro en Microsoft Entra ID:
  MS_TENANT_ID?: string;
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  SHAREPOINT_SITE_ID?: string;
  SHAREPOINT_LIST_ID?: string;
  TEAMS_WEBHOOK_URL?: string;
};

const BRAND_VOICE_MAX_AGE_DAYS = 30;
const RUTAS_SITIO = ["/", "/servicios", "/nosotros", "/agentes-ia", "/software-a-medida"];
const HISTORIAL_ANTIRREPETICION = 6; // no repetir tema/formato en las últimas N corridas
const MAX_RECENT_RUNS_KEPT = 30;

type AgentState = {
  lastRunAt: string | null;
  totalRunsCompleted: number;
  brandVoice: BrandVoice | null;
  recentRuns: Array<{
    runAt: string;
    durationMs: number;
    ok: boolean;
    error?: string;
    tema?: string;
    formato?: string;
    copy?: string;
    sharePointSaved?: boolean;
    teamsNotified?: boolean;
  }>;
};

const INITIAL_STATE: AgentState = {
  lastRunAt: null,
  totalRunsCompleted: 0,
  brandVoice: null,
  recentRuns: [],
};

export class AgenteContenido extends Agent<Env, AgentState> {
  initialState = INITIAL_STATE;

  async onRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/run" || url.pathname === "/state") {
      if (!isAuthorized(req, this.env.AGENT_API_TOKEN)) {
        return new Response("No autorizado", { status: 401 });
      }
    }

    if (url.pathname === "/run" && req.method === "POST") {
      const result = await this.runPipeline();
      return Response.json(result);
    }

    if (url.pathname === "/state") {
      return Response.json(this.state);
    }

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        lastRunAt: this.state.lastRunAt,
        totalRunsCompleted: this.state.totalRunsCompleted,
      });
    }

    return new Response("ok — agente de contenido Convergente Digital 🤖", { status: 200 });
  }

  private async getBrandVoice(): Promise<BrandVoice> {
    const cached = this.state.brandVoice;
    if (cached) {
      const ageMs = Date.now() - new Date(cached.analizadoAt).getTime();
      const maxAgeMs = BRAND_VOICE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs < maxAgeMs) return cached;
    }

    const pages = await scrapeSitePaths({
      baseUrl: this.env.SITIO_WEB_BASE,
      paths: RUTAS_SITIO,
    });

    const brandVoice = await analyzeBrandVoice({
      pages,
      apiKey: this.env.OPENAI_API_KEY,
      model: this.env.OPENAI_MODEL,
    });

    this.setState({ ...this.state, brandVoice });
    return brandVoice;
  }

  async runPipeline(): Promise<{
    ok: boolean;
    durationMs: number;
    error?: string;
    tema?: string;
    formato?: string;
    copy?: string;
    sharePointSaved?: boolean;
    teamsNotified?: boolean;
  }> {
    const t0 = Date.now();
    const runRecord: AgentState["recentRuns"][number] = {
      runAt: new Date().toISOString(),
      durationMs: 0,
      ok: false,
    };

    try {
      // PASO 1: refrescar (o reusar) el análisis de tono de marca
      const brandVoice = await this.getBrandVoice();

      // PASO 2: elegir tema y formato evitando repetir los últimos usados
      const recientes = this.state.recentRuns.slice(0, HISTORIAL_ANTIRREPETICION);
      const temasRecientes = recientes.map((r) => r.tema).filter((t): t is string => Boolean(t));
      const formatosRecientes = recientes.map((r) => r.formato).filter((f): f is string => Boolean(f));

      const tema = elegirTema(brandVoice.servicios, temasRecientes);
      const formato = elegirFormato(formatosRecientes);

      // PASO 3: generar el copy con OpenAI
      const generated = await generateLinkedInCopy({
        brandVoice,
        tema,
        formato,
        apiKey: this.env.OPENAI_API_KEY,
        model: this.env.OPENAI_MODEL,
      });

      const textoCompleto = [generated.texto, generated.hashtags.join(" ")].filter(Boolean).join("\n\n");

      runRecord.tema = tema;
      runRecord.formato = formato;
      runRecord.copy = textoCompleto;

      // PASO 4: guardar en SharePoint (no-op si aún no está configurado)
      const spConfig = {
        tenantId: this.env.MS_TENANT_ID,
        clientId: this.env.MS_CLIENT_ID,
        clientSecret: this.env.MS_CLIENT_SECRET,
        siteId: this.env.SHAREPOINT_SITE_ID,
        listId: this.env.SHAREPOINT_LIST_ID,
      };

      let sharePointSaved = false;
      if (sharePointConfigured(spConfig)) {
        const saveResult = await saveToSharePointList({
          config: spConfig,
          fields: {
            Titulo: `${tema} — ${formato}`,
            Tema: tema,
            Formato: formato,
            Copy: textoCompleto,
            Estado: "Pendiente",
            FechaSugerida: new Date().toISOString(),
          },
        });
        sharePointSaved = saveResult.saved;
      }
      runRecord.sharePointSaved = sharePointSaved;

      // PASO 5: avisar en Teams (no-op si aún no está configurado)
      const notifyResult = await notifyTeams({
        webhookUrl: this.env.TEAMS_WEBHOOK_URL,
        title: "🆕 Copy listo para revisar",
        message: `Tema: ${tema}\nFormato: ${formato}\n\n${textoCompleto}`,
      });
      runRecord.teamsNotified = notifyResult.sent;

      runRecord.ok = true;
    } catch (err) {
      runRecord.error = err instanceof Error ? err.message : String(err);
      runRecord.ok = false;
    } finally {
      runRecord.durationMs = Date.now() - t0;
    }

    this.setState({
      ...this.state,
      lastRunAt: runRecord.runAt,
      totalRunsCompleted: this.state.totalRunsCompleted + (runRecord.ok ? 1 : 0),
      recentRuns: [runRecord, ...this.state.recentRuns].slice(0, MAX_RECENT_RUNS_KEPT),
    });

    return {
      ok: runRecord.ok,
      durationMs: runRecord.durationMs,
      ...(runRecord.error && { error: runRecord.error }),
      tema: runRecord.tema,
      formato: runRecord.formato,
      copy: runRecord.copy,
      sharePointSaved: runRecord.sharePointSaved,
      teamsNotified: runRecord.teamsNotified,
    };
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const agent = await getAgentByName(env.AgenteContenido, "default");
    return agent.fetch(req);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const agent = await getAgentByName(env.AgenteContenido, "default");
    const internalReq = new Request("https://agent.internal/run", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.AGENT_API_TOKEN}` },
    });
    ctx.waitUntil(agent.fetch(internalReq).then((r) => r.text()));
  },
};

function isAuthorized(req: Request, token: string | undefined): boolean {
  if (!token) return false;
  return req.headers.get("Authorization") === `Bearer ${token}`;
}
