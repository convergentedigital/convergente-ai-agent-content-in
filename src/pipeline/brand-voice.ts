/**
 * Le pide a OpenAI que analice el contenido del sitio web de la empresa
 * y devuelva un resumen del tono/estilo de marca + lista de servicios,
 * para usarlo luego como contexto al redactar cada copy.
 */
import OpenAI from "openai";
import type { ScrapedPage } from "./scrape-website";

export type BrandVoice = {
  tono: string;
  estilo: string;
  publicoObjetivo: string;
  servicios: string[];
  analizadoAt: string;
};

const SYSTEM = `Eres un analista de marca. Analizas el contenido de un sitio web
y devuelves SOLO un JSON con la forma exacta:
{
  "tono": "descripción breve del tono de comunicación (ej. cercano, técnico, formal)",
  "estilo": "descripción breve del estilo de redacción (ej. frases cortas, uso de storytelling)",
  "publicoObjetivo": "a quién le habla la marca",
  "servicios": ["servicio 1", "servicio 2", ...]
}`;

const PAGE_TEXT_PREVIEW_CHARS = 4000;

export async function analyzeBrandVoice(opts: {
  pages: ScrapedPage[];
  apiKey: string;
  model?: string;
}): Promise<BrandVoice> {
  const { pages, apiKey, model = "gpt-4o-mini" } = opts;
  const client = new OpenAI({ apiKey });

  const compact = pages
    .map((p) => `URL: ${p.url}\nTítulo: ${p.title}\nContenido: ${p.textContent.slice(0, PAGE_TEXT_PREVIEW_CHARS)}`)
    .join("\n\n---\n\n");

  const resp = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Contenido del sitio web:\n\n${compact}` },
    ],
  });

  const content = resp.choices[0]?.message?.content ?? "{}";
  let parsed: Partial<BrandVoice> = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    // Deja parsed vacío — se usan defaults abajo
  }

  return {
    tono: parsed.tono ?? "profesional y cercano",
    estilo: parsed.estilo ?? "claro y directo",
    publicoObjetivo: parsed.publicoObjetivo ?? "tomadores de decisión en empresas",
    servicios: parsed.servicios ?? [],
    analizadoAt: new Date().toISOString(),
  };
}
