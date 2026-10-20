import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface PlateAction {
  (ctx: ExtensionContext): void | Promise<void>;
}

export interface ActionItem {
  key: string;
  label: string;
  description?: string;
  action?: PlateAction;
}

export interface ActionGroup {
  key: string;
  label: string;
  items: ActionItem[];
}

export type TopLevelEntry =
  | { type: "group"; group: ActionGroup }
  | {
      type: "action";
      key: string;
      label: string;
      description?: string;
      action: PlateAction;
    };
