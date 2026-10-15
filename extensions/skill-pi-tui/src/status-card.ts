import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { CARD_TONE, panelInnerWidth, renderCard, type CardTheme } from "./card.ts";
import { sanitizeTerminalText } from "./text.ts";

export interface StatusCardTheme extends CardTheme {
  bold(text: string): string;
}

export interface StatusCardModel {
  cwd: string;
  branch: string | null;
  sessionName?: string;
  changes: { files: number; added: number; deleted: number; notice?: string } | undefined;
}

export function renderStatusCard(model: StatusCardModel, theme: StatusCardTheme, width: number): string[] {
  const value = (text: string) => theme.fg("text", theme.bold(text));
  const label = (text: string) => theme.fg("muted", text);
  const branch = model.branch ? `${label("Branch")} ${value(sanitizeTerminalText(model.branch))}` : "";
  const innerWidth = panelInnerWidth(theme, width);
  const inset = Math.min(1, innerWidth - 1);
  const groups: Array<{ title: string; lines: string[] }> = [
    {
      title: "Project",
      lines: [
        value(sanitizeTerminalText(model.cwd)),
        ...(branch ? [branch] : []),
        ...(model.sessionName ? [`${label("Session")} ${value(sanitizeTerminalText(model.sessionName))}`] : []),
      ],
    },
    {
      title: "Changes",
      lines: [
        model.changes?.files
          ? `${model.changes.files} ${model.changes.files === 1 ? "file" : "files"} · ${theme.fg("success", `+${model.changes.added}`)} ${theme.fg("error", `−${model.changes.deleted}`)}`
          : label("No captured changes"),
        ...(model.changes?.notice ? [theme.fg("warning", sanitizeTerminalText(model.changes.notice))] : []),
      ],
    },
  ];
  const body = groups.flatMap((group, index) => [
    ...(index ? [""] : []),
    label(group.title),
    ...group.lines.flatMap((line) => wrapTextWithAnsi(line, innerWidth - inset).map((part) => " ".repeat(inset) + part)),
  ]);
  return renderCard({ title: "Status", body, tone: CARD_TONE.INFO }, theme, width, { expanded: true, panel: true });
}
