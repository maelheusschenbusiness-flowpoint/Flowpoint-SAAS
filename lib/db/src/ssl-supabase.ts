/**
 * ssl-supabase.ts
 *
 * Verification TLS des connexions PostgreSQL.
 *
 * DEFAUT MESURE LE 18/10/2026. La connexion au pooler Supabase echouait avec
 * `SELF_SIGNED_CERT_IN_CHAIN`. Mesure de la chaine reellement presentee par
 * `aws-1-eu-central-1.pooler.supabase.com:5432` :
 *
 *   0  CN=*.pooler.supabase.com
 *   1  CN=Supabase Intermediate 2021 CA
 *   2  CN=Supabase Root 2021 CA        <- auto-signee, absente du magasin public
 *
 * D'ou l'erreur : la racine n'est pas publiquement approuvee. Node avait
 * raison de refuser.
 *
 * La reponse n'est donc pas d'affaiblir la verification, mais de fournir la
 * bonne racine. Celle ci-dessous a ete telechargee depuis la distribution
 * officielle de Supabase en HTTPS verifie, puis RECOUPEE avec celle que le
 * serveur presente — empreintes SHA256 identiques :
 *
 *   80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F
 *   82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
 *
 * Validite : 28/04/2021 -> 26/04/2031. Verifie par `openssl s_client
 * -CAfile`, avec verification du nom d'hote : « Verification: OK ».
 *
 * Un certificat public n'est pas un secret : il est ici en clair, a dessein.
 *
 * `rejectUnauthorized` reste a `true`. La racine Supabase est AJOUTEE au
 * magasin par defaut, elle ne le remplace pas : une base chez un autre
 * fournisseur continue d'etre verifiee normalement.
 */
import { rootCertificates } from "node:tls";

/** Supabase Root 2021 CA — certificat public, verifie par empreinte. */
export const RACINE_SUPABASE_2021 = [
  "-----BEGIN CERTIFICATE-----",
  "MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL",
  "BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l",
  "dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh",
  "c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow",
  "azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD",
  "YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug",
  "Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW",
  "QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q",
  "DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2",
  "GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi",
  "cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4",
  "O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt",
  "NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX",
  "uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt",
  "aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU",
  "tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b",
  "VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6",
  "jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx",
  "Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2",
  "CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P",
  "o/bKiIz+Fq8=",
  "-----END CERTIFICATE-----",
].join("\n");

export interface OptionsSsl {
  ca: string[];
  rejectUnauthorized: true;
}

/**
 * Les options TLS a passer au pool, ou `undefined` pour ne rien imposer.
 *
 * - `PGSSLMODE=disable` -> `false` : aucun chiffrement (bases locales de test).
 * - `PGSSLMODE` pose a autre chose -> verification active avec la racine ajoutee.
 * - Variables separees completes et `PGSSLMODE` absente -> verification active
 *   par defaut : une base distante ne doit pas etre joignable en clair.
 * - Sinon (`DATABASE_URL` seule, sans `PGSSLMODE`) -> `undefined`, le
 *   comportement reste exactement celui d'avant. C'est le cas de la
 *   production, qu'on ne modifie pas ici.
 */
export function optionsSslPostgres(
  env: NodeJS.ProcessEnv = process.env
): OptionsSsl | false | undefined {
  const mode = env["PGSSLMODE"];
  if (mode === "disable") return false;

  const variablesSepareesCompletes =
    !!env["PGHOST"] && !!env["PGUSER"] && !!env["PGPASSWORD"] && !!env["PGDATABASE"];

  if (!mode && !variablesSepareesCompletes) return undefined;

  return {
    // La racine Supabase EN PLUS du magasin par defaut, jamais a sa place.
    ca: [RACINE_SUPABASE_2021, ...rootCertificates],
    rejectUnauthorized: true,
  };
}
