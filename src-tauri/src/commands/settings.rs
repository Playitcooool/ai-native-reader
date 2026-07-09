use crate::db::models::{ProviderSettings, ProviderSettingsInput, TestProviderResult};
use chrono::Utc;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

pub struct DbState(pub Mutex<rusqlite::Connection>);

fn public_provider_settings(
    id: String,
    provider_type: String,
    base_url: Option<String>,
    model: String,
    is_default: Option<bool>,
    is_translation: Option<bool>,
    created_at: String,
    updated_at: String,
) -> ProviderSettings {
    ProviderSettings {
        id,
        provider_type,
        base_url,
        api_key: None,
        model,
        is_default,
        is_translation,
        created_at,
        updated_at,
    }
}

fn api_key_for_update(
    input_api_key: Option<String>,
    existing_api_key: Option<String>,
) -> Option<String> {
    input_api_key.or(existing_api_key)
}

#[tauri::command]
pub fn get_provider_settings(db: State<DbState>) -> Result<Vec<ProviderSettings>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, provider_type, base_url, model, is_default, is_translation, created_at, updated_at FROM provider_settings ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let settings = stmt
        .query_map([], |row| {
            Ok(public_provider_settings(
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get::<_, Option<bool>>(4)?,
                row.get::<_, Option<bool>>(5)?,
                row.get(6)?,
                row.get(7)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(settings)
}

#[tauri::command]
pub fn save_provider_settings(
    db: State<DbState>,
    input: ProviderSettingsInput,
) -> Result<ProviderSettings, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    match &input.id {
        Some(id) => {
            // UPDATE existing row
            let is_default = input.is_default.unwrap_or(false);
            let is_translation = input.is_translation.unwrap_or(false);
            let existing_api_key: Option<String> = tx
                .query_row(
                    "SELECT api_key FROM provider_settings WHERE id = ?1",
                    rusqlite::params![id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            let api_key = api_key_for_update(input.api_key.clone(), existing_api_key);
            if is_default {
                tx.execute("UPDATE provider_settings SET is_default = 0", [])
                    .map_err(|e| e.to_string())?;
            }
            if is_translation {
                tx.execute("UPDATE provider_settings SET is_translation = 0", [])
                    .map_err(|e| e.to_string())?;
            }
            tx.execute(
                "UPDATE provider_settings SET provider_type = ?1, base_url = ?2, api_key = ?3, model = ?4, is_default = ?5, is_translation = ?6, updated_at = ?7 WHERE id = ?8",
                rusqlite::params![input.provider_type, input.base_url, api_key, input.model, is_default, is_translation, now, id],
            ).map_err(|e| e.to_string())?;

            // Read back the updated row
            let row = tx.query_row(
                "SELECT id, provider_type, base_url, api_key, model, is_default, is_translation, created_at, updated_at FROM provider_settings WHERE id = ?1",
                rusqlite::params![id],
                |row| {
                    Ok(public_provider_settings(
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(4)?,
                        row.get::<_, Option<bool>>(5)?,
                        row.get::<_, Option<bool>>(6)?,
                        row.get(7)?,
                        row.get(8)?,
                    ))
                },
            ).map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(row)
        }
        None => {
            // INSERT new row
            let id = Uuid::new_v4().to_string();
            let is_default = input.is_default.unwrap_or(false);
            let is_translation = input.is_translation.unwrap_or(false);
            if is_default {
                tx.execute("UPDATE provider_settings SET is_default = 0", [])
                    .map_err(|e| e.to_string())?;
            }
            if is_translation {
                tx.execute("UPDATE provider_settings SET is_translation = 0", [])
                    .map_err(|e| e.to_string())?;
            }
            tx.execute(
                "INSERT INTO provider_settings (id, provider_type, base_url, api_key, model, is_default, is_translation, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![id, input.provider_type, input.base_url, input.api_key, input.model, is_default, is_translation, now, now],
            ).map_err(|e| e.to_string())?;

            tx.commit().map_err(|e| e.to_string())?;
            Ok(ProviderSettings {
                id,
                provider_type: input.provider_type,
                base_url: input.base_url,
                api_key: None,
                model: input.model,
                is_default: Some(is_default),
                is_translation: Some(is_translation),
                created_at: now.clone(),
                updated_at: now,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_settings_response_redacts_api_key() {
        let settings = public_provider_settings(
            "p1".into(),
            "openai_compatible".into(),
            Some("https://api.example/v1".into()),
            "model".into(),
            Some(true),
            Some(false),
            "now".into(),
            "now".into(),
        );

        assert_eq!(settings.api_key, None);
    }

    #[test]
    fn blank_api_key_update_keeps_existing_secret() {
        assert_eq!(
            api_key_for_update(None, Some("existing".into())),
            Some("existing".into())
        );
        assert_eq!(
            api_key_for_update(Some("replacement".into()), Some("existing".into())),
            Some("replacement".into())
        );
    }
}

#[tauri::command]
pub fn set_default_provider(db: State<DbState>, provider_id: String) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("UPDATE provider_settings SET is_default = 0", [])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE provider_settings SET is_default = 1 WHERE id = ?1",
        rusqlite::params![provider_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn test_provider(
    http_client: State<'_, reqwest::Client>,
    db: State<'_, DbState>,
    provider_id: String,
) -> Result<TestProviderResult, String> {
    let (provider_type, base_url, api_key, model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT provider_type, base_url, api_key, model FROM provider_settings WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(rusqlite::params![provider_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.next()
            .ok_or("Provider not found")?
            .map_err(|e| e.to_string())?
    };

    let base_url = base_url.ok_or("Provider is missing a base URL. Check Settings.")?;
    let api_key = api_key.ok_or("Provider is missing an API key. Check Settings.")?;

    let result = crate::ai::provider::test_provider(
        &http_client,
        &provider_type,
        &base_url,
        &api_key,
        &model,
    )
    .await;
    Ok(TestProviderResult {
        ok: result.ok,
        provider_id,
        model: result.model,
        latency_ms: Some(result.latency_ms),
        error_code: result.error_code,
        error_message: result.error_message,
    })
}
