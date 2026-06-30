"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
export function AssetUpload({
  folder,
  name = "cover_asset",
}: {
  folder: string;
  name?: string;
}) {
  const [path, setPath] = useState("");
  const [message, setMessage] = useState("");
  return (
    <div className="field">
      <span>Upload private asset</span>
      <input type="hidden" name={name} value={path} />
      <input
        type="file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setMessage("Uploading…");
          const client = createClient();
          const { data } = await client.auth.getUser();
          if (!data.user) {
            setMessage("Session expired");
            return;
          }
          const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
          const objectPath = `${data.user.id}/${folder}/${crypto.randomUUID()}-${safe}`;
          const { error } = await client.storage
            .from("studio-assets")
            .upload(objectPath, file, { upsert: false });
          if (error) {
            setMessage(error.message);
            return;
          }
          setPath(objectPath);
          setMessage("Uploaded securely. Save the release to attach it.");
        }}
      />
      <small>{message}</small>
    </div>
  );
}
