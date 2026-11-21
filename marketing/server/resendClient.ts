import { Resend } from 'resend';

type ResendCredentials = {
  apiKey: string;
  fromEmail?: string;
};

async function getCredentials(): Promise<ResendCredentials> {
  const directApiKey = process.env.RESEND_API_KEY;
  if (directApiKey) {
    return {
      apiKey: directApiKey,
      fromEmail: process.env.RESEND_FROM_EMAIL,
    };
  }

  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('RESEND_API_KEY must be configured outside Replit.');
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (!hostname) {
    throw new Error('Replit Resend connector is unavailable.');
  }

  const response = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken
      }
    }
  );
  if (!response.ok) throw new Error('Replit Resend connector request failed.');

  const data = await response.json() as {
    items?: Array<{ settings?: { api_key?: string; from_email?: string } }>;
  };
  const connectionSettings = data.items?.[0];
  const apiKey = connectionSettings?.settings?.api_key;

  if (!apiKey) {
    throw new Error('Resend not connected');
  }
  return {
    apiKey,
    fromEmail: connectionSettings?.settings?.from_email
  };
}

export async function getUncachableResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail: fromEmail || process.env.RESEND_FROM_EMAIL || 'support@flowpoint.pro'
  };
}
