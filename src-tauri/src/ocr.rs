use leptess::LepTess;
use std::sync::OnceLock;

static TESSDATA_PATH: OnceLock<String> = OnceLock::new();

/// Initialize the tessdata path at runtime. Called once from the command handler.
pub fn init_tessdata_path(path: &str) {
    let _ = TESSDATA_PATH.set(path.to_string());
}

/// Returns the cached tessdata path, if any.
pub fn get_tessdata_path() -> Option<&'static str> {
    TESSDATA_PATH.get().map(|s| s.as_str())
}

/// Run OCR on PNG image bytes. Returns recognized UTF-8 text (trimmed).
///
/// Creates a fresh LepTess instance per call. Init overhead is ~100-200ms
/// (loading language model). Acceptable for on-demand single-page OCR;
/// add a cached `Mutex<LepTess>` if batch OCR is ever needed.
pub fn ocr_png_bytes(png_bytes: &[u8], tessdata_path: &str) -> Result<String, String> {
    if png_bytes.is_empty() {
        return Err("Empty image data received from page render".to_string());
    }

    let mut lt = LepTess::new(Some(tessdata_path), "eng")
        .map_err(|e| format!("Failed to init Tesseract: {}", e))?;

    lt.set_image_from_mem(png_bytes)
        .map_err(|e| format!("Failed to set image: {}", e))?;

    // Use Tesseract default page segmentation (PSM 3 — fully automatic).
    // Do NOT override — PSM 6 (single block) garbles multi-column layouts.
    // Let Tesseract detect the layout automatically.

    let text = lt
        .get_utf8_text()
        .map_err(|e| format!("OCR recognition failed: {}", e))?;

    Ok(text.trim().to_string())
}
