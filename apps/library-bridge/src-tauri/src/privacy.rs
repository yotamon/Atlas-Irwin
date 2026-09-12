use serde_json::Value;

const FORBIDDEN_LOCAL_KEYS: &[&str] = &[
    "path",
    "filepath",
    "file_path",
    "localpath",
    "local_path",
    "location",
    "fileuri",
    "file_uri",
    "rootpath",
    "root_path",
];

pub fn is_recording_fingerprint(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub fn assert_recording_fingerprint(value: &str, field: &str) -> anyhow::Result<()> {
    if !is_recording_fingerprint(value) {
        anyhow::bail!("{field} must be a content SHA-256 recording identity");
    }
    Ok(())
}

fn looks_like_local_locator(text: &str) -> bool {
    let text = text.trim();
    let lower = text.to_ascii_lowercase();
    let bytes = text.as_bytes();
    let windows_drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/');
    lower.starts_with("file://")
        || lower.starts_with("\\\\")
        || lower.starts_with("/users/")
        || lower.starts_with("/home/")
        || lower.starts_with("/volumes/")
        || lower.starts_with("/mnt/")
        || lower.starts_with("/media/")
        || windows_drive
}

pub fn assert_path_free_value(value: &Value, field: &str) -> anyhow::Result<()> {
    match value {
        Value::String(text) => {
            if looks_like_local_locator(text) {
                anyhow::bail!("{field} contains a device-local locator");
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                assert_path_free_value(item, &format!("{field}[{index}]"))?;
            }
        }
        Value::Object(map) => {
            for (key, nested) in map {
                let normalized = key.to_ascii_lowercase();
                if FORBIDDEN_LOCAL_KEYS.contains(&normalized.as_str()) {
                    anyhow::bail!("{field}.{key} is device-local and cannot enter portable state");
                }
                assert_path_free_value(nested, &format!("{field}.{key}"))?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn path_firewall_blocks_keys_and_locator_strings() {
        assert!(assert_path_free_value(&json!({"filePath": "/tmp/private.wav"}), "value").is_err());
        assert!(assert_path_free_value(&json!({"note": "C:\\Users\\Example\\track.wav"}), "value").is_err());
        assert!(assert_path_free_value(&json!({"note": "portable semantic value"}), "value").is_ok());
    }

    #[test]
    fn recording_fingerprint_is_strict_lowercase_sha256() {
        assert!(is_recording_fingerprint(&format!("sha256:{}", "a".repeat(64))));
        assert!(!is_recording_fingerprint(&format!("sha256:{}", "A".repeat(64))));
        assert!(!is_recording_fingerprint("sha256:abc"));
    }
}
