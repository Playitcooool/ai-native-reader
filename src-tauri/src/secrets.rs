use keyring::v1::{Entry, Error};

const PROVIDER_SECRET_SERVICE: &str = "com.rustybooks.reader.provider";

fn provider_entry(provider_id: &str) -> Result<Entry, String> {
    Entry::new(PROVIDER_SECRET_SERVICE, provider_id)
        .map_err(|e| format!("Failed to access secure credential storage: {e}"))
}

pub fn save_provider_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    provider_entry(provider_id)?
        .set_password(api_key)
        .map_err(|e| format!("Failed to save API key to secure credential storage: {e}"))
}

pub fn provider_api_key_for_database(
    provider_id: &str,
    api_key: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(key) = api_key {
        save_provider_api_key(provider_id, &key)?;
    }
    Ok(None)
}

pub fn provider_api_key(
    provider_id: &str,
    legacy_api_key: Option<String>,
) -> Result<Option<String>, String> {
    match provider_entry(provider_id)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(Error::NoEntry) => match legacy_api_key {
            Some(key) => {
                save_provider_api_key(provider_id, &key)?;
                Ok(Some(key))
            }
            None => Ok(None),
        },
        Err(e) => Err(format!(
            "Failed to read API key from secure credential storage: {e}"
        )),
    }
}

pub fn migrate_provider_api_keys(conn: &rusqlite::Connection) -> Result<usize, String> {
    migrate_provider_api_keys_with(conn, save_provider_api_key)
}

fn migrate_provider_api_keys_with(
    conn: &rusqlite::Connection,
    mut save: impl FnMut(&str, &str) -> Result<(), String>,
) -> Result<usize, String> {
    let legacy_keys = {
        let mut stmt = conn
            .prepare("SELECT id, api_key FROM provider_settings WHERE api_key IS NOT NULL AND TRIM(api_key) <> ''")
            .map_err(|e| e.to_string())?;
        let keys = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        keys
    };

    for (provider_id, api_key) in &legacy_keys {
        save(provider_id, api_key)?;
    }
    for (provider_id, _) in &legacy_keys {
        conn.execute(
            "UPDATE provider_settings SET api_key = NULL WHERE id = ?1",
            rusqlite::params![provider_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(legacy_keys.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider_database() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE provider_settings (id TEXT PRIMARY KEY, api_key TEXT)",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn migrates_legacy_keys_before_clearing_plaintext() {
        let conn = provider_database();
        conn.execute(
            "INSERT INTO provider_settings (id, api_key) VALUES ('p1', 'secret'), ('p2', NULL)",
            [],
        )
        .unwrap();
        let mut saved = Vec::new();

        let count = migrate_provider_api_keys_with(&conn, |id, key| {
            saved.push((id.to_string(), key.to_string()));
            Ok(())
        })
        .unwrap();

        assert_eq!(count, 1);
        assert_eq!(saved, [("p1".into(), "secret".into())]);
        let key: Option<String> = conn
            .query_row(
                "SELECT api_key FROM provider_settings WHERE id = 'p1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(key.is_none());
    }

    #[test]
    fn keeps_plaintext_when_secure_storage_fails() {
        let conn = provider_database();
        conn.execute(
            "INSERT INTO provider_settings (id, api_key) VALUES ('p1', 'secret')",
            [],
        )
        .unwrap();

        assert!(migrate_provider_api_keys_with(&conn, |_, _| Err("locked".into())).is_err());
        let key: String = conn
            .query_row(
                "SELECT api_key FROM provider_settings WHERE id = 'p1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(key, "secret");
    }
}
