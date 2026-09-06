export * from "./database-core";
export * from "./ensemblis-database";

import type { Database as CoreDatabase } from "./database-core";
import type { EnsemblisDatabase } from "./ensemblis-database";

export type Database = {
  public: {
    Tables: CoreDatabase["public"]["Tables"] & EnsemblisDatabase["public"]["Tables"];
    Views: CoreDatabase["public"]["Views"] & EnsemblisDatabase["public"]["Views"];
    Functions: CoreDatabase["public"]["Functions"] & EnsemblisDatabase["public"]["Functions"];
    Enums: CoreDatabase["public"]["Enums"] & EnsemblisDatabase["public"]["Enums"];
    CompositeTypes: CoreDatabase["public"]["CompositeTypes"] & EnsemblisDatabase["public"]["CompositeTypes"];
  };
  private: CoreDatabase["private"];
};
