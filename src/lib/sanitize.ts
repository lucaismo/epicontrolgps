// Sanitização leve para texto livre que será renderizado no app.
// Remove tags HTML, atributos perigosos e caracteres de controle.
export function sanitizeText(input: string | null | undefined, maxLen = 500): string | null {
  if (input == null) return null;
  let s = String(input);
  // remove tags HTML
  s = s.replace(/<[^>]*>/g, "");
  // remove protocolos perigosos
  s = s.replace(/javascript:/gi, "").replace(/data:text\/html/gi, "");
  // remove caracteres de controle (exceto \n, \r, \t)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  s = s.trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s.length ? s : null;
}

// Normaliza matrícula: remove não-dígitos e completa com zeros à esquerda até 6 dígitos.
// Valores com mais de 6 dígitos são mantidos como vieram (apenas dígitos).
export function formatMatricula(input: string | null | undefined): string {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length >= 6 ? digits : digits.padStart(6, "0");
}

// Avalia força de senha simples (0-4).
export function passwordStrength(pwd: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd)) score++;
  const labels = ["Muito fraca", "Fraca", "Razoável", "Boa", "Forte"] as const;
  return { score: Math.min(score, 4) as 0 | 1 | 2 | 3 | 4, label: labels[Math.min(score, 4)] };
}
