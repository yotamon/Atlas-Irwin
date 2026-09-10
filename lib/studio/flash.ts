import { redirect } from "next/navigation";

export function redirectWithNotice(path: string, notice: string) {
  const url = new URL(path, "http://studio.local");
  url.searchParams.set("notice", notice);
  redirect(`${url.pathname}${url.search}${url.hash}`);
}

export function noticeFromParams(params: {
  notice?: string;
  error?: string;
  synced?: string;
  disconnected?: string;
  generated?: string;
  saved?: string;
}) {
  if (params.error) return { tone: "error" as const, message: params.error };
  if (params.notice) return { tone: "success" as const, message: params.notice };
  if (params.synced === "1")
    return { tone: "success" as const, message: "Catalog synced." };
  if (params.disconnected === "1")
    return { tone: "success" as const, message: "Account disconnected." };
  if (params.generated === "1")
    return { tone: "success" as const, message: "Content pack prepared." };
  if (params.saved === "1")
    return { tone: "success" as const, message: "Saved." };
  return null;
}
