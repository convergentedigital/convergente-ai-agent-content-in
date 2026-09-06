/**
 * Avisa en un canal de Microsoft Teams cuando el agente termina de generar
 * un copy nuevo. Usa un webhook del canal (app "Workflows" de Teams:
 * plantilla "Post to a channel when a webhook request is received").
 *
 * Mientras TEAMS_WEBHOOK_URL no esté configurado, no falla el pipeline:
 * devuelve `sent: false` con un motivo.
 */

export type NotifyResult = { sent: boolean; reason?: string };

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

  const text = link ? `**${title}**\n\n${message}\n\n[Ver en SharePoint](${link})` : `**${title}**\n\n${message}`;

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
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
