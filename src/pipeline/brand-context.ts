/**
 * Contexto estático de marca de Convergente Digital: identidad, portafolio de
 * servicios, casos de éxito reales, tono de voz e identidad visual, más las
 * reglas de qué hacer y qué evitar. Reemplaza el análisis dinámico del sitio
 * web — es la fuente de verdad que se inyecta directo en el prompt de
 * generate-copy.ts.
 *
 * Para actualizarlo: editar context/convergente-digital-brand-reference.md
 * en la raíz del repo. No hace falta tocar código.
 */
import brandReferenceMd from "../../context/convergente-digital-brand-reference.md";

export const BRAND_CONTEXT: string = brandReferenceMd;

/** Servicios reales del portafolio (sección 3 del documento de marca), usados para rotar temas de contenido. */
export const SERVICIOS: string[] = [
  "infraestructura tecnológica",
  "soporte y outsourcing IT",
  "contingencia y réplica de información",
  "equipos, periféricos y servidores",
  "desarrollo de software a la medida",
  "implementación de agentes de IA",
];
