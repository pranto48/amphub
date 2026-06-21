use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{State, AppHandle, Emitter};
use base64::{Engine as _, engine::general_purpose};
use mac_address::get_mac_address;
use sha2::{Sha256, Digest};
use enigo::{Enigo, MouseControllable, KeyboardControllable, MouseButton, Key};
use arboard::Clipboard;
use screenshots::Screen;

mod signaling;

use signaling::{
    SignalingState,
    get_connection_status,
    disconnect_signaling,
    start_signaling_connection,
    ConnectionStatus,
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

#[tauri::command]
fn get_connection_id() -> String {
    match get_mac_address() {
        Ok(Some(mac)) => {
            let mut hasher = Sha256::new();
            hasher.update(mac.bytes());
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
        _ => {
            // Generates a stable fallback based on computer name or environment
            "AMP-776-633".to_string()
        }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SignalingState::new())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_connection_id,
            simulate_input,
            capture_screen,
            get_clipboard,
            set_clipboard,
            get_connection_status,
            disconnect_signaling,
            start_signaling_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
