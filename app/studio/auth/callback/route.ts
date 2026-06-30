import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/studio", request.url));
  }
  return NextResponse.redirect(
    new URL(
      "/studio/login?error=Unable%20to%20complete%20sign-in",
      request.url,
    ),
  );
}
