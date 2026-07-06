export type ApprovalRisk = "low" | "medium" | "high";

const HIGH_RISK = /\b(sudo|rm\s+-rf?|del(ete)?\b|kill|shutdown|reboot|format|(curl|wget|base64).*\|\s*(ba)?sh|chmod\s+777|drop\s+table|dd|mkfs(\.\w+)?)\b/i;
const MEDIUM_RISK = /\b(write|edit|create|move|rename|install|download|send|post|upload|exec|run|command|terminal|shell)\b/i;

export function classifyApprovalRisk(description: string): ApprovalRisk {
  if (HIGH_RISK.test(description)) {
    return "high";
  }

  if (MEDIUM_RISK.test(description)) {
    return "medium";
  }

  return "low";
}
