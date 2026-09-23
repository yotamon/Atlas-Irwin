"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/studio/constants";
import { redirectWithNotice } from "@/lib/studio/flash";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";

const required = z.string().trim().min(1).max(300);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function nullable(form: FormData, key: string) {
  return value(form, key) || null;
}

async function taskContext(form?: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = form ? value(form, "artist_id") || undefined : undefined;
  const artist = await resolveActiveArtistContext(supabase, user, requestedArtistId);
  return {
    supabase,
    user,
    artist,
    operational: asArtistScopedOperationalClient(supabase),
    music: asArtistScopedMusicClient(supabase),
  };
}

async function assertRelease(
  context: Awaited<ReturnType<typeof taskContext>>,
  releaseId: string | null,
) {
  if (!releaseId) return;
  const { data, error } = await context.music
    .from("releases")
    .select("id")
    .eq("id", releaseId)
    .eq("owner_id", context.user.id)
    .eq("artist_id", context.artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Release not found for the active artist.");
}

export async function saveTask(form: FormData) {
  const context = await taskContext(form);
  const id = value(form, "id");
  const releaseId = nullable(form, "release_id");
  await assertRelease(context, releaseId);

  const row = {
    owner_id: context.user.id,
    artist_id: context.artist.artistId,
    release_id: releaseId,
    title: required.parse(value(form, "title")),
    status: z.enum(TASK_STATUSES).parse(value(form, "status") || "Open"),
    priority: z.enum(TASK_PRIORITIES).parse(value(form, "priority") || "Medium"),
    due_at: nullable(form, "due_at"),
  };

  const { error } = id
    ? await context.operational
        .from("tasks")
        .update(row)
        .eq("id", z.uuid().parse(id))
        .eq("owner_id", context.user.id)
        .eq("artist_id", context.artist.artistId)
    : await context.operational.from("tasks").insert(row);
  if (error) throw new Error(error.message);

  revalidatePath("/studio/tasks");
  revalidatePath("/studio");
  redirectWithNotice(`/studio/tasks?artist=${encodeURIComponent(context.artist.artistId)}`, id ? "Task updated." : "Task created.");
}

export async function completeTask(form: FormData) {
  const context = await taskContext(form);
  const id = z.uuid().parse(value(form, "id"));
  const { error } = await context.operational
    .from("tasks")
    .update({ status: "Done" })
    .eq("id", id)
    .eq("owner_id", context.user.id)
    .eq("artist_id", context.artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/tasks");
  revalidatePath("/studio");
}

export async function deleteTask(form: FormData) {
  const context = await taskContext(form);
  const id = z.uuid().parse(value(form, "id"));
  const { error } = await context.operational
    .from("tasks")
    .delete()
    .eq("id", id)
    .eq("owner_id", context.user.id)
    .eq("artist_id", context.artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/tasks");
  revalidatePath("/studio");
}
