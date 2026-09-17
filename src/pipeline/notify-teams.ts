/**
 * Avisa en un canal de Microsoft Teams cuando el agente termina de generar
 * un copy nuevo. Usa el webhook de un flujo "Workflows" del canal (plantilla
 * "Enviar alertas de webhook a un canal"), que espera el payload como una
 * tarjeta adaptable (Adaptive Card) envuelta en `attachments`.
 *
 * Mientras TEAMS_WEBHOOK_URL no esté configurado, no falla el pipeline:
 * devuelve `sent: false` con un motivo.
 */

export type NotifyResult = { sent: boolean; reason?: string };

const ADAPTIVE_CARD_SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";
const ADAPTIVE_CARD_VERSION = "1.4";

export async function notifyTeams(opts: {
  webhookUrl?: string;
  title: string;
  message: string;
  link?: string;
}): Promise<NotifyResult> {
  const { webhookUrl, title, message, link } = opts;

  if (!webhookUrl) {
    return { sent: false, reason: "TEAMS_WEBHOOK_URL todavía no configurado" };
  }

  const body: Record<string, unknown>[] = [
    { type: "TextBlock", text: title, weight: "Bolder", size: "Medium", wrap: true },
    { type: "TextBlock", text: message, wrap: true },
  ];

  if (link) {
    body.push({
      type: "ActionSet",
      actions: [{ type: "Action.OpenUrl", title: "Ver en SharePoint", url: link }],
    });
  }

  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: ADAPTIVE_CARD_SCHEMA,
          type: "AdaptiveCard",
          version: ADAPTIVE_CARD_VERSION,
          body,
        },
      },
    ],
  };

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { sent: false, reason: `Teams respondió ${resp.status}: ${errText.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
