/** Deliberately narrow: marketing can resume music intake, never an arbitrary redirect. */
export function studioReturnPath(value: unknown) {
  return value === "/studio/music/import" ? "/studio/music/import" : "/studio";
}
