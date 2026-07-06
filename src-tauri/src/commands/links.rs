use std::process::Command;

fn is_allowed_external_url(url: &str) -> bool {
    if url.is_empty() || url.chars().any(|c| c.is_control()) {
        return false;
    }
    matches!(
        url.split_once(':').map(|(scheme, _)| scheme.to_ascii_lowercase()),
        Some(scheme) if matches!(scheme.as_str(), "http" | "https" | "mailto" | "tel" | "ftp")
    )
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("unsupported URL scheme".into());
    }

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&url).spawn();

    #[cfg(target_os = "windows")]
    let result = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&url).spawn();

    result.map(|_| ()).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_allowed_external_url;

    #[test]
    fn validates_external_url_schemes() {
        assert!(is_allowed_external_url("https://example.com"));
        assert!(is_allowed_external_url("mailto:test@example.com"));
        assert!(!is_allowed_external_url(""));
        assert!(!is_allowed_external_url("file:///tmp/a.pdf"));
        assert!(!is_allowed_external_url("javascript:alert(1)"));
        assert!(!is_allowed_external_url("https://example.com/\nnext"));
    }
}
