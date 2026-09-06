/**
 * Genera un copy completo, listo para publicar en LinkedIn, a partir del
 * tono de marca detectado, un tema/servicio y un formato específico.
 */
import OpenAI from "openai";
import type { BrandVoice } from "./brand-voice";

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

export function elegirTema(servicios: string[], evitar: string[]): string {
  const temasBase = [
    ...servicios,
    "desarrollo de software a medida",
    "creación de agentes de IA",
  ];
  const disponibles = temasBase.filter((t) => !evitar.includes(t));
  const pool = disponibles.length > 0 ? disponibles : temasBase;
  return pool[Math.floor(Math.random() * pool.length)];
}

const SYSTEM = `Eres el redactor de contenido de LinkedIn de una empresa de tecnología
llamada Convergente Digital. Escribes SIEMPRE en español neutro LATAM, respetando
el tono y estilo de marca que se te da como contexto.

Reglas del copy:
- Escrito 100% en español neutro LATAM. Nunca mezcles palabras en inglés
  (ej. nunca "unique", "insights", "feedback" — usa sus equivalentes en español).
- Listo para publicar tal cual, sin placeholders ni corchetes.
- Entre 800 y 1300 caracteres.
- Usa saltos de línea para que sea fácil de leer en LinkedIn (párrafos cortos).
- Termina con una llamada a la acción sutil (pregunta, invitación a comentar o a contactar).
- No uses emojis en exceso (máximo 2-3, si aportan).
- NUNCA inventes clientes, testimonios ni cifras de resultados específicas
  (porcentajes, montos, nombres de empresas) que no te hayan dado como dato real.
  Si el formato es "caso de uso", plantéalo de forma genérica e hipotética
  ("imagina una empresa que...", "un escenario típico es...") sin presentarlo
  como un cliente real ni inventar estadísticas concretas.
- Devuelve SOLO un JSON con la forma exacta:
{
  "texto": "el copy completo",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"]
}`;

export async function generateLinkedInCopy(opts: {
  brandVoice: BrandVoice;
  tema: string;
  formato: string;
  apiKey: string;
  model?: string;
}): Promise<GeneratedCopy> {
  const { brandVoice, tema, formato, apiKey, model = "gpt-4o-mini" } = opts;
  const client = new OpenAI({ apiKey });

  const userMsg = `Contexto de marca:
- Tono: ${brandVoice.tono}
- Estilo: ${brandVoice.estilo}
- Público objetivo: ${brandVoice.publicoObjetivo}

Tema de hoy: ${tema}
Formato de hoy: ${formato}

Redacta el copy de LinkedIn siguiendo las reglas del sistema.`;

  const resp = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
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
