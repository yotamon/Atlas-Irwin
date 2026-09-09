use anyhow::Context;
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

pub fn fingerprint_file(path: &Path) -> anyhow::Result<String> {
    let mut file = File::open(path).with_context(|| format!("could not open {}", path.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("sha256:{}", hex::encode(digest.finalize())))
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("sha256:{}", hex::encode(digest.finalize()))
}

pub fn hash_text(value: &str) -> String {
    hash_bytes(value.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn fingerprint_survives_file_move() {
        let directory = tempdir().unwrap();
        let original = directory.path().join("first.wav");
        let moved = directory.path().join("nested").join("renamed.wav");
        fs::write(&original, b"exact same audio bytes").unwrap();
        fs::create_dir_all(moved.parent().unwrap()).unwrap();
        let before = fingerprint_file(&original).unwrap();
        fs::rename(&original, &moved).unwrap();
        let after = fingerprint_file(&moved).unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn different_bytes_have_different_identity() {
        assert_ne!(hash_bytes(b"one"), hash_bytes(b"two"));
    }
}
