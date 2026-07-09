const PROVIDER_SECRET_SERVICE: &str = "com.rustybooks.reader.provider";

#[cfg(target_os = "macos")]
pub fn save_provider_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(
        PROVIDER_SECRET_SERVICE,
        provider_id,
        api_key.as_bytes(),
    )
    .map_err(|e| format!("Failed to save API key to Keychain: {e}"))
}

#[cfg(not(target_os = "macos"))]
pub fn save_provider_api_key(_provider_id: &str, _api_key: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn provider_api_key_for_database(
    provider_id: &str,
    api_key: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(key) = api_key {
        save_provider_api_key(provider_id, &key)?;
    }
    Ok(None)
}

#[cfg(not(target_os = "macos"))]
pub fn provider_api_key_for_database(
    _provider_id: &str,
    api_key: Option<String>,
) -> Result<Option<String>, String> {
    Ok(api_key)
}

#[cfg(target_os = "macos")]
pub fn provider_api_key(
    provider_id: &str,
    legacy_api_key: Option<String>,
) -> Result<Option<String>, String> {
    match security_framework::passwords::get_generic_password(PROVIDER_SECRET_SERVICE, provider_id)
    {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "Saved API key is not valid UTF-8.".to_string()),
        Err(_) => Ok(legacy_api_key),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn provider_api_key(
    _provider_id: &str,
    legacy_api_key: Option<String>,
) -> Result<Option<String>, String> {
    Ok(legacy_api_key)
}
