//! The desktop shell is deliberately thin.
//!
//! All application logic lives in the shared web bundle so the desktop app and the
//! companion PWA cannot drift apart. Syllabus PDFs are picked and dropped through the web
//! bundle's own file input, so the shell registers no plugins; add one here only when the web
//! code actually imports its JavaScript API.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running SchoolQuest");
}
