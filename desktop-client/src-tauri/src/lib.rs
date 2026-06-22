use base64::{Engine as _, engine::general_purpose};
use sha2::{Sha256, Digest};
use enigo::{Enigo, MouseControllable, KeyboardControllable, MouseButton, Key};
use arboard::Clipboard;
use std::time::Duration;
use screenshots::Screen;
use tauri::Manager;

mod signaling;
mod streamer;

// Get physical screen dimensions using screenshots crate (already a dependency)
fn get_screen_dimensions() -> (i32, i32) {
    if let Ok(screens) = Screen::all() {
        if let Some(screen) = screens.first() {
            let info = screen.display_info;
            return (info.width as i32, info.height as i32);
        }
    }
    (1920, 1080)
}

use signaling::{
    SignalingState,
    get_connection_status,
    disconnect_signaling,
    start_signaling_connection,
    send_signaling_message,
};

use streamer::{
    StreamerState,
    start_desktop_stream,
    stop_desktop_stream,
};

#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InputAction {
    // x and y are normalized coordinates in [0.0, 1.0]
    MouseMove { x: f64, y: f64 },
    MouseClick { button: String },
    KeyPress { key: String },
    KeyType { text: String },
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg(target_os = "windows")]
fn get_machine_guid() -> Result<String, String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let crypto = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography").map_err(|e| e.to_string())?;
    let guid: String = crypto.get_value("MachineGuid").map_err(|e| e.to_string())?;
    Ok(guid)
}

#[cfg(not(target_os = "windows"))]
fn get_machine_guid() -> Result<String, String> {
    // Stable mockup GUID for non-windows platforms (e.g. mac/linux testing)
    Ok("7c5b81a2-ffaa-4cb4-8a17-640a1b6dfbb2".to_string())
}

#[tauri::command]
fn get_hardware_guid() -> String {
    match get_machine_guid() {
        Ok(guid) => guid.to_uppercase(),
        Err(_) => "7C5B81A2-FFAA-4CB4-8A17-640A1B6DFBB2".to_string()
    }
}

#[tauri::command]
fn get_connection_id() -> String {
    let guid = get_hardware_guid();
    let mut hasher = Sha256::new();
    hasher.update(guid.as_bytes());
    let result = hasher.finalize();
    let hex_str = format!("{:x}", result);
    // Format first 9 hex digits as "XXX-XXX-XXX"
    if hex_str.len() >= 9 {
        let part1 = &hex_str[0..3];
        let part2 = &hex_str[3..6];
        let part3 = &hex_str[6..9];
        format!("{}-{}-{}", part1, part2, part3).to_uppercase()
    } else {
        "AMP-776-633".to_string()
    }
}

#[tauri::command]
async fn ping_signaling_server(host: String, port: u16) -> bool {
    let addr = format!("{}:{}", host, port);
    match tokio::time::timeout(
        Duration::from_millis(1500),
        tokio::net::TcpStream::connect(&addr)
    ).await {
        Ok(Ok(_)) => true,
        _ => false,
    }
}

#[tauri::command]
fn simulate_input(action: InputAction) -> Result<(), String> {
    let mut enigo = Enigo::new();
    match action {
        InputAction::MouseMove { x, y } => {
            // x and y are normalized [0.0, 1.0] — convert to actual screen pixel coords
            let (sw, sh) = get_screen_dimensions();
            let px = (x.clamp(0.0, 1.0) * sw as f64).round() as i32;
            let py = (y.clamp(0.0, 1.0) * sh as f64).round() as i32;
            enigo.mouse_move_to(px, py);
        }
        InputAction::MouseClick { button } => {
            let btn = match button.to_lowercase().as_str() {
                "right" => MouseButton::Right,
                "middle" => MouseButton::Middle,
                _ => MouseButton::Left,
            };
            enigo.mouse_click(btn);
        }
        InputAction::KeyPress { key } => {
            if key.len() == 1 {
                let c = key.chars().next().unwrap();
                enigo.key_click(Key::Layout(c));
            } else {
                match key.to_lowercase().as_str() {
                    "enter" | "return" => enigo.key_click(Key::Return),
                    "space" => enigo.key_click(Key::Space),
                    "backspace" => enigo.key_click(Key::Backspace),
                    "tab" => enigo.key_click(Key::Tab),
                    "escape" => enigo.key_click(Key::Escape),
                    "arrowup" | "up" => enigo.key_click(Key::UpArrow),
                    "arrowdown" | "down" => enigo.key_click(Key::DownArrow),
                    "arrowleft" | "left" => enigo.key_click(Key::LeftArrow),
                    "arrowright" | "right" => enigo.key_click(Key::RightArrow),
                    _ => {}
                }
            }
        }
        InputAction::KeyType { text } => {
            enigo.key_sequence(&text);
        }
    }
    Ok(())
}

#[tauri::command]
fn capture_screen() -> Result<String, String> {
    match Screen::all() {
        Ok(screens) => {
            if let Some(screen) = screens.first() {
                match screen.capture() {
                    Ok(image) => {
                        let mut png_bytes = Vec::new();
                        let mut cursor = std::io::Cursor::new(&mut png_bytes);
                        match image.write_to(&mut cursor, screenshots::image::ImageFormat::Png) {
                            Ok(()) => {
                                return Ok(general_purpose::STANDARD.encode(png_bytes));
                            }
                            Err(e) => println!("PNG conversion failed: {:?}", e),
                        }
                    }
                    Err(e) => println!("Screen capture failed: {:?}", e),
                }
            }
        }
        Err(e) => println!("Failed to query screens: {:?}", e),
    }
    // Fallback: return a transparent 1x1 PNG base64 string
    Ok("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=".to_string())
}

#[tauri::command]
fn get_clipboard() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart_status() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
            .map_err(|e| e.to_string())?;
        
        let val: Result<String, _> = run_key.get_value("AMPHUB");
        return Ok(val.is_ok());
    }
    
    #[cfg(not(target_os = "windows"))]
    Ok(false)
}

#[tauri::command]
fn set_autostart_status(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (run_key, _) = hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
            .map_err(|e| e.to_string())?;
        
        if enabled {
            let exe_path = std::env::current_exe()
                .map_err(|e| format!("Failed to get current executable path: {}", e))?;
            let exe_str = exe_path.to_string_lossy().to_string();
            run_key.set_value("AMPHUB", &exe_str)
                .map_err(|e| e.to_string())?;
            println!("[AUTOSTART] Enabled startup path: {}", exe_str);
        } else {
            let _ = run_key.delete_value("AMPHUB");
            println!("[AUTOSTART] Disabled startup key.");
        }
        return Ok(());
    }
    
    #[cfg(not(target_os = "windows"))]
    Ok(())
}

#[tauri::command]
fn get_screen_dimensions_cmd() -> (i32, i32) {
    get_screen_dimensions()
}

#[tauri::command]
fn get_unattended_access() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey("Software\\AMPHUB") {
            let val: Result<u32, _> = key.get_value("UnattendedAccess");
            return val.map(|v| v == 1).unwrap_or(false);
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    false
}

#[tauri::command]
fn set_unattended_access(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu.create_subkey("Software\\AMPHUB").map_err(|e| e.to_string())?;
        let val: u32 = if enabled { 1 } else { 0 };
        key.set_value("UnattendedAccess", &val).map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    Ok(())
}

#[tauri::command]
fn get_default_permission() -> String {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey("Software\\AMPHUB") {
            let val: Result<String, _> = key.get_value("DefaultPermission");
            return val.unwrap_or_else(|_| "ask".to_string());
        }
        "ask".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    "ask".to_string()
}

#[tauri::command]
fn set_default_permission(permission: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu.create_subkey("Software\\AMPHUB").map_err(|e| e.to_string())?;
        key.set_value("DefaultPermission", &permission).map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    Ok(())
}

#[tauri::command]
fn get_discovery_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey("Software\\AMPHUB") {
            let val: Result<u32, _> = key.get_value("DiscoveryEnabled");
            return val.map(|v| v == 1).unwrap_or(true);
        }
        true
    }
    #[cfg(not(target_os = "windows"))]
    true
}

#[tauri::command]
fn set_discovery_enabled(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu.create_subkey("Software\\AMPHUB").map_err(|e| e.to_string())?;
        let val: u32 = if enabled { 1 } else { 0 };
        key.set_value("DiscoveryEnabled", &val).map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    Ok(())
}

/// Check whether AMPHUB is currently running with Administrator privileges.
#[tauri::command]
fn get_is_elevated() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        // Attempt to open a write-protected HKLM key — only succeeds as Admin
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        match hklm.create_subkey("SOFTWARE\\AMPHUB_ELEVATION_CHECK") {
            Ok(_) => {
                let _ = hklm.delete_subkey("SOFTWARE\\AMPHUB_ELEVATION_CHECK");
                true
            }
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "windows"))]
    false
}

/// Read the Windows UAC Secure Desktop policy.
/// When true (default), UAC prompts run on the secure desktop — isolated from SendInput.
/// When false, UAC prompts run on the regular desktop — AMPHUB's input simulation can reach them.
#[tauri::command]
fn get_uac_secure_desktop() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(key) = hklm.open_subkey(
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System"
        ) {
            let val: Result<u32, _> = key.get_value("PromptOnSecureDesktop");
            return val.unwrap_or(1) == 1;
        }
        true
    }
    #[cfg(not(target_os = "windows"))]
    true
}

/// Toggle the Windows UAC Secure Desktop.
/// Requires AMPHUB to be running as Administrator.
/// Setting enabled=false makes UAC dialogs appear on the normal desktop
/// so that AMPHUB's input simulation (SendInput via enigo) can click Yes/No on them.
#[tauri::command]
fn set_uac_secure_desktop(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let (key, _) = hklm
            .create_subkey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System")
            .map_err(|e| format!("Registry access denied — ensure AMPHUB runs as Administrator: {}", e))?;
        let val: u32 = if enabled { 1 } else { 0 };
        key.set_value("PromptOnSecureDesktop", &val)
            .map_err(|e| format!("Failed to write registry value: {}", e))?;
        println!(
            "[UAC] PromptOnSecureDesktop = {} ({})",
            val,
            if enabled { "Secure Desktop ON (default)" } else { "Normal Desktop — input simulation can reach UAC" }
        );
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    Ok(())
}

#[tauri::command]
fn show_app_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(())
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SignalingState::new())
        .manage(StreamerState::new())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_connection_id,
            get_hardware_guid,
            simulate_input,
            capture_screen,
            get_clipboard,
            set_clipboard,
            get_connection_status,
            disconnect_signaling,
            start_signaling_connection,
            send_signaling_message,
            ping_signaling_server,
            start_desktop_stream,
            stop_desktop_stream,
            get_autostart_status,
            set_autostart_status,
            show_app_window,
            get_screen_dimensions_cmd,
            get_unattended_access,
            set_unattended_access,
            get_default_permission,
            set_default_permission,
            get_discovery_enabled,
            set_discovery_enabled,
            get_is_elevated,
            get_uac_secure_desktop,
            set_uac_secure_desktop,
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                if get_is_elevated() {
                    println!("[STARTUP] Elevated privileges detected. Automatically configuring UAC PromptOnSecureDesktop = 0 to enable remote input simulation.");
                    if let Err(e) = set_uac_secure_desktop(false) {
                        println!("[STARTUP] Failed to configure UAC secure desktop policy: {}", e);
                    }
                } else {
                    println!("[STARTUP] Running in standard user mode. UAC secure desktop modification skipped.");
                }
            }

            // Setup tray menu
            let quit_i = tauri::menu::MenuItem::with_id(app, "quit", "Quit AMPHUB", true, None::<&str>)?;
            let show_i = tauri::menu::MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show_i, &quit_i])?;

            if let Some(icon) = app.default_window_icon() {
                let _tray = tauri::tray::TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            } else {
                println!("[TRAY] Warning: default window icon not found, tray icon not created.");
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
