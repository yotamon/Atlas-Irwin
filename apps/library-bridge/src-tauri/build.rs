use std::{fs::File, path::PathBuf};

fn generated_windows_icon() -> PathBuf {
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR")
            .expect("CARGO_MANIFEST_DIR is required during Tauri build"),
    );
    let source = manifest_dir.join("../../../public/android-chrome-512x512.png");
    println!("cargo:rerun-if-changed={}", source.display());

    let source_image = image::open(&source)
        .unwrap_or_else(|error| {
            panic!(
                "failed to decode canonical Ensemblis app icon {}: {error}",
                source.display()
            )
        })
        .into_rgba8();

    let mut icon = ico::IconDir::new(ico::ResourceType::Icon);
    for size in [32u32, 16, 24, 48, 64, 256] {
        let resized = image::imageops::resize(
            &source_image,
            size,
            size,
            image::imageops::FilterType::Lanczos3,
        );
        let layer = ico::IconImage::from_rgba_data(size, size, resized.into_raw());
        icon.add_entry(ico::IconDirEntry::encode(&layer).unwrap_or_else(|error| {
            panic!("failed to encode {size}px Windows icon layer: {error}")
        }));
    }

    let out_dir =
        PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is required during Tauri build"));
    let output = out_dir.join("ensemblis-library-bridge.ico");
    let file = File::create(&output).unwrap_or_else(|error| {
        panic!(
            "failed to create generated Windows icon {}: {error}",
            output.display()
        )
    });
    icon.write(file).unwrap_or_else(|error| {
        panic!(
            "failed to write generated Windows icon {}: {error}",
            output.display()
        )
    });
    output
}

fn main() {
    let mut attributes = tauri_build::Attributes::new();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new().window_icon_path(generated_windows_icon()),
        );
    }

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
