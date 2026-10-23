/**
 * Real email delivery of the 6-digit sign-in key (FIXES F6). Switched on only when SMTP is fully
 * configured in .env; otherwise demo mode shows the key on screen, or the server log prints it.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** Pure: returns null unless SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM are all set. */
export function smtpConfig(env: Record<string, string | undefined> = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.trim();
  const from = env.SMTP_FROM?.trim();
  if (!host || !user || !pass || !from) return null;
  const port = Number(env.SMTP_PORT) || 587;
  return { host, port, secure: port === 465, user, pass, from };
}

export async function sendSignInKey(cfg: SmtpConfig, to: string, code: string): Promise<void> {
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass } });
  await transport.sendMail({
    from: cfg.from,
    to,
    subject: `Your SoulMark sign-in key: ${code}`,
    text: `Your SoulMark sign-in key is ${code}\n\nIt expires in 5 minutes. If you didn't ask for it, ignore this email.`,
  });
}
