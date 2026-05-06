declare module "@heroui-pro/react" {
  import type {ComponentType, ReactNode} from "react";

  type ProChildren = ReactNode | ((item: never) => ReactNode);
  type CompoundComponent = ComponentType<Record<string, unknown> & {children?: ProChildren}> & {
    [key: string]: ComponentType<Record<string, unknown> & {children?: ProChildren}>;
  };

  export const EmptyState: CompoundComponent;
  export const Kanban: CompoundComponent;
  export const KPI: CompoundComponent;
  export const KPIGroup: CompoundComponent;
}
