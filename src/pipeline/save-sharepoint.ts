/**
 * Guarda un copy generado como un nuevo elemento en una Lista de SharePoint,
 * usando Microsoft Graph API con autenticación app-only (client credentials).
 *
 * Requiere una app registrada en Microsoft Entra ID del tenant de Convergente
 * Digital, con permiso de aplicación "Sites.Selected" (o "Sites.ReadWrite.All")
 * consentido por un administrador. Ver walkthroughs/06-microsoft-graph.md.
 *
 * Mientras no existan las credenciales (MS_TENANT_ID, MS_CLIENT_ID,
 * MS_CLIENT_SECRET, SHAREPOINT_SITE_ID, SHAREPOINT_LIST_ID), esta función
 * no falla el pipeline: devuelve `saved: false` con un motivo.
 */

export type SaveResult = { saved: false; reason: string } | { saved: true; itemId: string };

export type SharePointConfig = {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  siteId?: string;
  listId?: string;
};

export function sharePointConfigured(cfg: SharePointConfig): boolean {
  return Boolean(cfg.tenantId && cfg.clientId && cfg.clientSecret && cfg.siteId && cfg.listId);
}

async function getGraphToken(cfg: Required<Pick<SharePointConfig, "tenantId" | "clientId" | "clientSecret">>): Promise<string> {
  const resp = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Graph auth falló: ${resp.status} ${errText.slice(0, 300)}`);
  }

  const data = (await resp.json()) as { access_token: string };
  return data.access_token;
}

export async function saveToSharePointList(opts: {
  config: SharePointConfig;
  fields: {
    Titulo: string;
    Tema: string;
    Formato: string;
    Copy: string;
    Estado: "Pendiente" | "Aprobado" | "Publicado";
    FechaSugerida: string; // ISO date
  };
}): Promise<SaveResult> {
  const { config, fields } = opts;

  if (!sharePointConfigured(config)) {
    return { saved: false, reason: "Credenciales de Microsoft Graph / SharePoint todavía no configuradas" };
  }

  const token = await getGraphToken({
    tenantId: config.tenantId!,
    clientId: config.clientId!,
    clientSecret: config.clientSecret!,
  });

  const resp = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${config.siteId}/lists/${config.listId}/items`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    },
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`SharePoint create item falló: ${resp.status} ${errText.slice(0, 300)}`);
  }

  const item = (await resp.json()) as { id: string };
  return { saved: true, itemId: item.id };
}
