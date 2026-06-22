use base64::{Engine as _, engine::general_purpose};
use sha2::{Sha256, Digest};
use enigo::{Enigo, MouseControllable, KeyboardControllable, MouseButton, Key};
use arboard::Clipboard;
use std::time::Duration;
use screenshots::Screen;

mod signaling;
mod streamer;

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
    MouseMove { x: i32, y: i32 },
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
            enigo.mouse_move_to(x, y);
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
