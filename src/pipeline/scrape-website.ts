/**
 * Lee el contenido de páginas públicas de un sitio web y extrae texto plano.
 * Usa fetch nativo — funciona en Cloudflare Workers, sin dependencias.
 */

export type ScrapedPage = {
  url: string;
  title: string;
  textContent: string;
  metaDescription: string;
  fetchedAt: string;
};

const DEFAULT_TIMEOUT_MS = 15000;
const TEXT_CONTENT_CAP_CHARS = 20000;

export async function scrapeWebsite(opts: {
  url: string;
  timeoutMs?: number;
  userAgent?: string;
}): Promise<ScrapedPage> {
  const {
    url,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    userAgent = "Mozilla/5.0 (Cloudflare Worker Agent; Convergente Digital)",
  } = opts;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let html: string;
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }
    html = await resp.text();
  } finally {
    clearTimeout(timeout);
  }

  return {
    url,
    title: extractTitle(html),
    textContent: extractText(html).slice(0, TEXT_CONTENT_CAP_CHARS),
    metaDescription: extractMetaDescription(html),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Intenta leer varias rutas del sitio; ignora las que no existan (404, etc).
 */
export async function scrapeSitePaths(opts: {
  baseUrl: string;
  paths: string[];
  timeoutMs?: number;
}): Promise<ScrapedPage[]> {
  const { baseUrl, paths, timeoutMs } = opts;
  const results: ScrapedPage[] = [];

  for (const path of paths) {
    const url = new URL(path, baseUrl).toString();
    try {
      results.push(await scrapeWebsite({ url, timeoutMs }));
    } catch {
      // Ruta no disponible — se omite sin romper el pipeline
    }
  }

  return results;
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return decodeEntities(match?.[1]?.trim() ?? "");
}

function extractMetaDescription(html: string): string {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return "";
}

function extractText(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
