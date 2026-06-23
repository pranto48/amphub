use std::sync::Arc;
use tokio::sync::Mutex;
use screenshots::Screen;
use base64::{Engine as _, engine::general_purpose};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use super::SignalingState;

pub struct StreamerState {
    pub is_streaming: Arc<Mutex<bool>>,
    pub stop_tx: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    pub active_screen_index: Arc<Mutex<usize>>,
}

impl StreamerState {
    pub fn new() -> Self {
        Self {
            is_streaming: Arc::new(Mutex::new(false)),
            stop_tx: Arc::new(Mutex::new(None)),
            active_screen_index: Arc::new(Mutex::new(0)),
        }
    }
}

#[tauri::command]
pub async fn set_active_screen_index(
    index: usize,
    state: tauri::State<'_, StreamerState>,
) -> Result<(), String> {
    let mut active = state.active_screen_index.lock().await;
    *active = index;
    Ok(())
}

#[tauri::command]
pub async fn start_desktop_stream(
    app: AppHandle,
    state: tauri::State<'_, StreamerState>,
    sig_state: tauri::State<'_, SignalingState>,
) -> Result<(), String> {
    let mut streaming_lock = state.is_streaming.lock().await;
    if *streaming_lock {
        return Ok(()); // Already streaming
    }
    *streaming_lock = true;

    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
    *state.stop_tx.lock().await = Some(stop_tx);

    let is_streaming_clone = Arc::clone(&state.is_streaming);
    let ws_tx_clone = Arc::clone(&sig_state.ws_tx);
    let active_screen_index_clone = Arc::clone(&state.active_screen_index);

    tokio::spawn(async move {
        println!("[STREAMER] Starting WebRTC screen capture loop...");
        loop {
            // Check if stopped
            if stop_rx.try_recv().is_ok() {
                break;
            }

            let screen_idx = {
                let active = active_screen_index_clone.lock().await;
                *active
            };

            // Capture screen
            match Screen::all() {
                Ok(screens) => {
                    let screen = screens.get(screen_idx).or_else(|| screens.first());
                    if let Some(screen) = screen {
                        match screen.capture() {
                            Ok(image) => {
                                let mut jpeg_bytes = Vec::new();
                                let mut cursor = std::io::Cursor::new(&mut jpeg_bytes);
                                // Compress to JPEG for WebRTC streaming efficiency
                                if image.write_to(&mut cursor, screenshots::image::ImageFormat::Jpeg).is_ok() {
                                    let b64 = general_purpose::STANDARD.encode(jpeg_bytes);
                                    
                                    // Forward frame over WebSocket if signaling connection is active
                                    let ws_tx_lock = ws_tx_clone.lock().await;
                                    if let Some(tx) = &*ws_tx_lock {
                                        let _ = tx.send(b64.clone()).await;
                                    }
                                    
                                    // Emit frame event to the frontend
                                    let _ = app.emit("webrtc-stream-frame", b64);
                                }
                            }
                            Err(e) => println!("[STREAMER] Capture failed: {:?}", e),
                        }
                    }
                }
                Err(e) => println!("[STREAMER] Failed to query screens: {:?}", e),
            }

            // Wait 200ms
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        let mut s = is_streaming_clone.lock().await;
        *s = false;
        println!("[STREAMER] WebRTC screen capture loop stopped.");
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_desktop_stream(
    state: tauri::State<'_, StreamerState>,
) -> Result<(), String> {
    let mut stop_lock = state.stop_tx.lock().await;
    if let Some(stop) = stop_lock.take() {
        let _ = stop.send(());
    }
    Ok(())
}
