//! The desktop shell is deliberately thin.
//!
//! All application logic lives in the shared web bundle so the desktop app and the
//! companion PWA cannot drift apart. Rust is here only for what a browser tab cannot do:
//! the native file dialog used to pick a syllabus PDF.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running SchoolQuest");
}
