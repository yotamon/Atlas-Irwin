import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const CANVAS_VIDEO_FILES = new Set(["canvas.mp4", "canvas.webm", "canvas.mov"]);

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (
  process.env.STUDIO_IMPORT_ADMIN_EMAIL ||
  process.env.STUDIO_ADMIN_EMAILS?.split(",")[0] ||
  ""
).trim().toLowerCase();

if (!url || !key || !email) {
  throw new Error(
    "Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and STUDIO_IMPORT_ADMIN_EMAIL.",
  );
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);
const ROOT = path.join(process.cwd(), "public", "releases");
const LARGE_AUDIO_BYTES = 30 * 1024 * 1024;

const report = {
  releasesImported: 0,
  tracksImported: 0,
  assetsUploaded: 0,
  skippedAssets: 0,
  unmappedFiles: [],
  duplicateCandidates: [],
  missingMedia: [],
  failures: [],
};

function releaseType(value, trackCount) {
  if (["Single", "EP", "Album", "Album Track", "Edit", "Instrumental", "DJ Tool"].includes(value)) {
    return value;
  }
  if (trackCount === 1) return "Single";
  if (trackCount <= 6) return "EP";
  return "Album";
}

function durationSeconds(value) {
  if (!value || !String(value).includes(":")) return null;
  const [minutes, seconds] = String(value).split(":").map(Number);
  return Number.isFinite(minutes) && Number.isFinite(seconds)
    ? minutes * 60 + seconds
    : null;
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function mimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".avif") return "image/avif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  return "application/octet-stream";
}

function classifyAsset(relativePath, manifest) {
  const lower = relativePath.toLowerCase();
  if (manifest.cover && lower.endsWith(manifest.cover.toLowerCase())) return "cover";
  if (manifest.canvasVideo && lower.endsWith(manifest.canvasVideo.toLowerCase())) {
    return "canvas_video";
  }
  if (CANVAS_VIDEO_FILES.has(path.basename(lower))) return "canvas_video";
  if (lower.includes("visualizer")) return "visualizer";
  if (lower.startsWith("audio/")) return "audio_preview";
  if (IMAGE_EXTENSIONS.has(path.extname(lower))) {
    if (lower.includes("cover")) return "cover";
    if (lower.includes("social")) return "social_image";
    if (lower.includes("press")) return "press_image";
    return "alternate_artwork";
  }
  if (VIDEO_EXTENSIONS.has(path.extname(lower))) return "content_video";
  return null;
}

async function uploadPublicAsset(ownerId, releaseId, slug, filePath, role) {
  const fileName = path.basename(filePath);
  const contentHash = await hashFile(filePath);
  const stats = statSync(filePath);
  const storagePath = `${ownerId}/releases/${slug}/${role}/${fileName}`;
  const bucket = "public-media";

  const { data: existing } = await supabase
    .from("media_assets")
    .select("id,public_url")
    .eq("owner_id", ownerId)
    .eq("content_hash", contentHash)
    .maybeSingle();

  if (existing?.public_url) {
    report.duplicateCandidates.push(`${slug}/${fileName} -> existing hash`);
    return existing;
  }

  if (dryRun) {
    report.assetsUploaded += 1;
    return { id: "dry-run", public_url: `/dry-run/${storagePath}` };
  }

  const buffer = readFileSync(filePath);
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType: mimeType(fileName),
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const publicUrl = supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
  const { data: asset, error } = await supabase
    .from("media_assets")
    .upsert(
      {
        owner_id: ownerId,
        bucket_name: bucket,
        storage_path: storagePath,
        public_url: publicUrl,
        asset_type: role,
        mime_type: mimeType(fileName),
        file_size: stats.size,
        content_hash: contentHash,
        visibility: "public",
      },
      { onConflict: "owner_id,bucket_name,storage_path" },
    )
    .select("*")
    .single();
  if (error) throw error;
  report.assetsUploaded += 1;
  return asset;
}

function collectFiles(releaseDir) {
  const files = [];
  function walk(current, prefix = "") {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const rel = path.join(prefix, entry.name).replace(/\\/g, "/");
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else files.push(rel);
    }
  }
  walk(releaseDir);
  return files;
}

function parseSoundCloudId(url) {
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

async function importRelease(ownerId, slug, releaseDir) {
  const manifestPath = path.join(releaseDir, "release.json");
  let manifest = {};
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    report.failures.push(`${slug}: invalid release.json`);
    return;
  }

  const tracks = Array.isArray(manifest.tracks) ? manifest.tracks : [];
  const albumLinks = Array.isArray(manifest.albumLinks) ? manifest.albumLinks : [];
  const link = (platform) =>
    albumLinks.find((item) => String(item.platform).toLowerCase().includes(platform))?.href || null;

  const releaseRow = {
    owner_id: ownerId,
    title: manifest.title || slug,
    slug,
    release_type: releaseType(manifest.type, tracks.length || 1),
    status:
      manifest.releaseDate && Date.parse(manifest.releaseDate) <= Date.now()
        ? "Live"
        : "Scheduled",
    publish_state:
      manifest.releaseDate && Date.parse(manifest.releaseDate) <= Date.now()
        ? "live"
        : "scheduled",
    is_public: true,
    published_at:
      manifest.releaseDate && Date.parse(manifest.releaseDate) <= Date.now()
        ? new Date().toISOString()
        : null,
    release_date: manifest.releaseDate || null,
    story: manifest.description || null,
    artist: manifest.artist || "Atlas Irwin",
    spotify_url: link("spotify"),
    soundcloud_url: manifest.soundcloudUrl || null,
    youtube_url: link("youtube"),
    smart_link_url: manifest.ctaHref || null,
    cta_label: manifest.ctaLabel || null,
    cta_href: manifest.ctaHref || null,
    cover_alt: manifest.coverAlt || null,
    genre: manifest.genre || null,
    subgenre: manifest.subgenre || null,
    label: manifest.label || null,
    upc: manifest.upc || null,
    is_featured: Boolean(manifest.featured),
    homepage_eligible: true,
    public_slug: slug,
    public_release_path: `public/releases/${slug}/release.json`,
  };

  if (dryRun) {
    report.releasesImported += 1;
    report.tracksImported += tracks.length;
    return;
  }

  const { data: release, error } = await supabase
    .from("releases")
    .upsert(releaseRow, { onConflict: "owner_id,slug" })
    .select("id")
    .single();
  if (error) throw error;

  const files = collectFiles(releaseDir);
  let displayOrder = 0;
  for (const relativePath of files) {
    if (relativePath === "release.json") continue;
    const role = classifyAsset(relativePath, manifest);
    if (!role) {
      report.unmappedFiles.push(`${slug}/${relativePath}`);
      continue;
    }
    if (role === "audio_preview") {
      const fullPath = path.join(releaseDir, relativePath);
      const size = statSync(fullPath).size;
      if (size > LARGE_AUDIO_BYTES) {
        report.skippedAssets += 1;
        report.missingMedia.push(`${slug}/${relativePath} flagged large (${size} bytes)`);
        continue;
      }
    }
    try {
      const asset = await uploadPublicAsset(
        ownerId,
        release.id,
        slug,
        path.join(releaseDir, relativePath),
        role,
      );
      await supabase.from("media_links").insert({
        owner_id: ownerId,
        media_asset_id: asset.id,
        release_id: release.id,
        role,
        is_primary: role === "cover" || role === "canvas_video",
        display_order: displayOrder++,
      });
      if (role === "cover" && asset.public_url) {
        await supabase
          .from("releases")
          .update({ artwork_url: asset.public_url })
          .eq("id", release.id);
      }
    } catch (error) {
      report.failures.push(`${slug}/${relativePath}: ${error.message}`);
    }
  }

  const trackRows = [];
  for (const [index, track] of tracks.entries()) {
    const soundcloudUrl = track.soundcloudUrl || (index === 0 ? manifest.soundcloudUrl : null);
    trackRows.push({
      owner_id: ownerId,
      release_id: release.id,
      title: track.title || `Track ${index + 1}`,
      version: soundcloudUrl ? "SoundCloud catalog" : "Public preview",
      duration: durationSeconds(track.duration),
      audio_url: track.file ? `/releases/${slug}/audio/${track.file}` : null,
      soundcloud_url: soundcloudUrl || null,
      spotify_url:
        Array.isArray(track.links)
          ? track.links.find((item) =>
              String(item.platform).toLowerCase().includes("spotify"),
            )?.href || null
          : null,
      is_primary: Boolean(track.active) || index === 0,
      track_number: index + 1,
      display_order: index,
    });
  }

  if (trackRows.length) {
    const { data: savedTracks, error: trackError } = await supabase
      .from("tracks")
      .upsert(trackRows, { onConflict: "release_id,title" })
      .select("*");
    if (trackError) throw trackError;

    for (const savedTrack of savedTracks ?? []) {
      if (savedTrack.soundcloud_url) {
        const scId = parseSoundCloudId(savedTrack.soundcloud_url);
        if (scId) {
          await supabase.from("track_external_ids").upsert(
            {
              owner_id: ownerId,
              track_id: savedTrack.id,
              provider: "soundcloud",
              external_id: scId,
              external_url: savedTrack.soundcloud_url,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "track_id,provider" },
          );
        }
      }
    }
    report.tracksImported += savedTracks?.length ?? 0;
  }

  for (const albumLink of albumLinks) {
    if (!albumLink.href) continue;
    await supabase.from("release_external_links").upsert(
      {
        owner_id: ownerId,
        release_id: release.id,
        provider: String(albumLink.platform).toLowerCase().includes("spotify")
          ? "spotify"
          : String(albumLink.platform).toLowerCase().includes("youtube")
            ? "youtube"
            : "other",
        external_url: albumLink.href,
        label: albumLink.label || albumLink.platform,
      },
      { onConflict: "release_id,provider,external_url" },
    );
  }

  await supabase.from("homepage_placements").upsert(
    {
      owner_id: ownerId,
      release_id: release.id,
      enabled: true,
      display_order: report.releasesImported,
      placement_type: manifest.featured ? "featured" : "catalog",
      default_track_id: null,
    },
    { onConflict: "owner_id,release_id" },
  );

  report.releasesImported += 1;
}

const { data: profile, error: profileError } = await supabase
  .from("profiles")
  .select("id")
  .eq("email", email)
  .single();
if (profileError || !profile) {
  throw new Error(`Admin profile not found for ${email}.`);
}

if (!existsSync(ROOT)) {
  console.log("No public/releases directory found.");
  process.exit(0);
}

const entries = await readdir(ROOT, { withFileTypes: true });
for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith("_"))) {
  try {
    await importRelease(profile.id, entry.name, path.join(ROOT, entry.name));
  } catch (error) {
    report.failures.push(`${entry.name}: ${error.message}`);
  }
}

console.log(`Legacy import ${dryRun ? "(dry run) " : ""}report`);
console.log(`Releases imported: ${report.releasesImported}`);
console.log(`Tracks imported: ${report.tracksImported}`);
console.log(`Assets uploaded: ${report.assetsUploaded}`);
console.log(`Skipped assets: ${report.skippedAssets}`);
if (report.unmappedFiles.length) console.log(`Unmapped files:\n- ${report.unmappedFiles.join("\n- ")}`);
if (report.duplicateCandidates.length) {
  console.log(`Duplicate candidates:\n- ${report.duplicateCandidates.join("\n- ")}`);
}
if (report.missingMedia.length) console.log(`Flagged media:\n- ${report.missingMedia.join("\n- ")}`);
if (report.failures.length) console.log(`Failures:\n- ${report.failures.join("\n- ")}`);
