/**
 * Genera un copy completo, listo para publicar en LinkedIn, a partir del
 * documento de contexto de marca (brand-context.ts), un tema/servicio y un
 * formato específico.
 */
import OpenAI from "openai";
import { SERVICIOS } from "./brand-context";

export type GeneratedCopy = {
  tema: string;
  formato: string;
  texto: string;
  hashtags: string[];
};

const FORMATOS = [
  "tip corto y accionable",
  "pregunta abierta para generar interacción en los comentarios",
  "caso de uso o ejemplo concreto",
  "dato o reflexión sobre la industria",
  "mini historia o analogía sencilla",
] as const;

export function elegirFormato(evitar: string[]): string {
  const disponibles = FORMATOS.filter((f) => !evitar.includes(f));
  const pool = disponibles.length > 0 ? disponibles : FORMATOS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function elegirTema(evitar: string[]): string {
  const disponibles = SERVICIOS.filter((t) => !evitar.includes(t));
  const pool = disponibles.length > 0 ? disponibles : SERVICIOS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildSystemPrompt(brandContext: string): string {
  return `Eres el redactor de contenido de LinkedIn de Convergente Digital. Escribes
SIEMPRE en español neutro LATAM.

A continuación tienes el documento oficial de referencia de marca. Básate en él
para el tono, el portafolio de servicios, los casos reales y las reglas de qué
hacer y qué evitar — sigue especialmente al pie de la letra su sección
"11. Lineamientos para el agente de contenido":

---
${brandContext}
---

Reglas adicionales del copy:
- Escrito 100% en español neutro LATAM. Nunca mezcles palabras en inglés
  (ej. nunca "unique", "insights", "feedback" — usa sus equivalentes en español).
- Listo para publicar tal cual, sin placeholders ni corchetes.
- Entre 800 y 1300 caracteres.
- Usa saltos de línea para que sea fácil de leer en LinkedIn (párrafos cortos).
- Termina con una llamada a la acción sutil (pregunta, invitación a comentar o a contactar).
- No uses emojis en exceso (máximo 2-3, si aportan).
- Si mencionas un caso de éxito o cliente real, usa ÚNICAMENTE los casos
  documentados arriba (Stasia / SAMS Panificadora, eresmariabonita.com, Latin
  Nails) — nunca inventes un cliente, testimonio o cifra de resultado que no
  esté en el documento de marca.
- Si el formato es "caso de uso o ejemplo concreto": usa uno de esos casos
  reales si aplica al tema, o plantéalo de forma hipotética
  ("imagina una empresa que...") si ninguno encaja — nunca presentes un caso
  hipotético como si fuera real.
- Devuelve SOLO un JSON con la forma exacta:
{
  "texto": "el copy completo",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"]
}`;
}

export async function generateLinkedInCopy(opts: {
  brandContext: string;
  tema: string;
  formato: string;
  apiKey: string;
  model?: string;
}): Promise<GeneratedCopy> {
  const { brandContext, tema, formato, apiKey, model = "gpt-4o-mini" } = opts;
  const client = new OpenAI({ apiKey });

  const userMsg = `Tema de hoy: ${tema}
Formato de hoy: ${formato}

Redacta el copy de LinkedIn siguiendo el documento de marca y las reglas del sistema.`;

  const resp = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt(brandContext) },
      { role: "user", content: userMsg },
    ],
  });

  const content = resp.choices[0]?.message?.content ?? "{}";
  let parsed: { texto?: string; hashtags?: string[] } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    // Deja parsed vacío
  }

  return {
    tema,
    formato,
    texto: parsed.texto ?? "",
    hashtags: parsed.hashtags ?? [],
  };
}
