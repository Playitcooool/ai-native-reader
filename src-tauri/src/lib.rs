pub mod ai;
pub mod commands;
pub mod db;
pub mod epub;
pub mod file_access;
pub mod ocr;
pub mod pdf;
pub mod secrets;

use commands::library::LibraryState;
use commands::settings::DbState;
use std::collections::HashSet;
use std::error::Error;
use std::io;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri::Manager;

fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    if event.id() == "open_pdf" {
        if let Some(window) = app.get_webview_window("main") {
            window.emit("menu-open-pdf", ()).ok();
        }
    } else if event.id() == "open_folder" {
        if let Some(window) = app.get_webview_window("main") {
            window.emit("menu-open-folder", ()).ok();
        }
    } else if event.id() == "settings" {
        if let Some(window) = app.get_webview_window("main") {
            window.emit("menu-open-settings", ()).ok();
        }
    }
}

fn configure_app(app: &mut tauri::App) -> Result<(), Box<dyn Error>> {
    let app_handle = app.handle().clone();
    let app_dir = app_handle.path().app_data_dir().map_err(|error| {
        io::Error::other(format!(
            "Could not locate the application data folder: {error}"
        ))
    })?;
    std::fs::create_dir_all(&app_dir).map_err(|error| {
        io::Error::other(format!(
            "Could not create the application data folder at {}: {error}",
            app_dir.display()
        ))
    })?;
    let db_path = app_dir.join("reader.db");
    let conn = db::migrations::initialize_database(&db_path).map_err(|error| {
        io::Error::other(format!(
            "Could not open the local database at {}: {error}",
            db_path.display()
        ))
    })?;
    if let Err(error) = secrets::migrate_provider_api_keys(&conn) {
        eprintln!("Warning: failed to migrate legacy provider API keys: {error}");
    }
    let http_client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .tcp_keepalive(Duration::from_secs(30))
        .user_agent("RustyBooks/1.0")
        .build()
        .map_err(|error| io::Error::other(format!("Could not initialize networking: {error}")))?;

    app.manage(DbState(Mutex::new(conn)));
    app.manage(commands::ai::AiCancelState(Mutex::new(HashSet::new())));
    app.manage(http_client);
    app.manage(LibraryState {
        watcher: Mutex::new(None),
        db_path: db_path.to_string_lossy().to_string(),
    });

    commands::library::init_watcher_if_configured(app.handle());

    let open = MenuItemBuilder::with_id("open_pdf", "Open Document…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let open_folder = MenuItemBuilder::with_id("open_folder", "Import Folder…")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "RustyBooks")
        .about(None)
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open)
        .item(&open_folder)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .fullscreen()
        .separator()
        .close_window()
        .separator()
        .bring_all_to_front()
        .build()?;
    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&window_menu)
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

fn show_startup_error(app: &tauri::App, error: &dyn Error) {
    eprintln!("RustyBooks startup failed: {error}");
    if let Some(window) = app.get_webview_window("main") {
        window.hide().ok();
    }
    rfd::MessageDialog::new()
        .set_title("RustyBooks couldn't start")
        .set_level(rfd::MessageLevel::Error)
        .set_description(format!(
            "RustyBooks could not finish starting.\n\n{error}\n\nCheck available disk space and app-data permissions, then reopen the app. Your PDF and EPUB files were not modified."
        ))
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if let Err(error) = configure_app(app) {
                show_startup_error(app, error.as_ref());
                std::process::exit(1);
            }
            Ok(())
        })
        .on_menu_event(handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            commands::documents::import_document,
            commands::documents::get_documents,
            commands::documents::get_document,
            commands::documents::read_document_bytes,
            commands::documents::mark_document_opened,
            commands::documents::update_last_page,
            commands::documents::update_last_zoom,
            commands::documents::update_page_count,
            commands::documents::refresh_document_metadata,
            commands::documents::delete_document,
            commands::documents::get_collections,
            commands::documents::create_collection,
            commands::documents::get_collection_memberships,
            commands::documents::add_document_to_collection,
            commands::documents::remove_document_from_collection,
            commands::pages::save_pages_text,
            commands::pages::get_pages_text,
            commands::pages::get_pages_text_coverage,
            commands::pages::count_indexed_pages,
            commands::pages::search_pages_text,
            commands::pages::clear_pdf_page_text_cache,
            commands::pages::mark_page_text_failed,
            commands::pages::ocr_page,
            commands::toc::save_toc_nodes,
            commands::toc::get_toc_tree,
            commands::notes::create_annotation,
            commands::notes::get_annotations,
            commands::notes::get_annotations_for_page,
            commands::notes::get_annotations_for_pages,
            commands::notes::update_annotation,
            commands::notes::delete_annotation,
            commands::settings::get_provider_settings,
            commands::settings::save_provider_settings,
            commands::settings::set_default_provider,
            commands::settings::test_provider,
            commands::settings::export_database_backup,
            commands::settings::restore_database_backup,
            commands::ai::list_ai_sessions,
            commands::ai::get_session_messages,
            commands::ai::clear_ai_history,
            commands::ai::compact_session,
            commands::ai::get_reading_state,
            commands::ai::get_citations_for_message,
            commands::ai::run_ai_workflow,
            commands::ai::cancel_ai_workflow,
            commands::library::set_library_folder,
            commands::library::get_library_folder,
            commands::library::clear_library_folder,
            commands::stats::record_reading_heartbeat,
            commands::stats::get_reading_stats,
            commands::epub::extract_epub_content,
            commands::epub::get_document_cover,
            commands::links::open_external_url,
            commands::translate::translate_text,
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("RustyBooks stopped: {error}");
        std::process::exit(1);
    }
}
