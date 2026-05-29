export const CATEGORIAS_EPI = [
  "Proteção da Cabeça",
  "Proteção dos Olhos e Face",
  "Proteção Auditiva",
  "Proteção Respiratória",
  "Proteção das Mãos e Braços",
  "Proteção dos Pés",
  "Proteção do Tronco",
  "Proteção contra Quedas",
  "Vestimentas Especiais",
  "Outros",
] as const;

export const TURNOS = ["Turno 1", "Turno 2", "Turno 3", "Administrativo"] as const;
export type Turno = (typeof TURNOS)[number];

export const STATUS_COLAB = ["ativo", "afastado", "desligado"] as const;
export type StatusColab = (typeof STATUS_COLAB)[number];
