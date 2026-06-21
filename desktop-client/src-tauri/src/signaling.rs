use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use serde::{Serialize, Deserialize};
use std::time::Duration;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    PendingApproval,
}

pub struct SignalingState {
    pub status: Arc<Mutex<ConnectionStatus>>,
    pub ws_tx: Arc<Mutex<Option<tokio::sync::mpsc::Sender<String>>>>,
    pub stop_tx: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
}

impl SignalingState {
    pub fn new() -> Self {
        Self {
            status: Arc::new(Mutex::new(ConnectionStatus::Disconnected)),
            ws_tx: Arc::new(Mutex::new(None)),
            stop_tx: Arc::new(Mutex::new(None)),
        }
    }
}

// Event payload
#[derive(Clone, Serialize)]
struct StatusPayload {
    status: ConnectionStatus,
    message: String,
}

#[tauri::command]
pub async fn get_connection_status(state: tauri::State<'_, SignalingState>) -> Result<ConnectionStatus, String> {
    let status = state.status.lock().await;
    Ok(status.clone())
}

#[tauri::command]
pub async fn disconnect_signaling(
    app: AppHandle,
    state: tauri::State<'_, SignalingState>,
) -> Result<(), String> {
    let mut status_lock = state.status.lock().await;
    *status_lock = ConnectionStatus::Disconnected;
    
    // Trigger stop channel
    let mut stop_lock = state.stop_tx.lock().await;
    if let Some(stop) = stop_lock.take() {
        let _ = stop.send(());
    }
    
    // Clear ws tx
    let mut ws_lock = state.ws_tx.lock().await;
    *ws_lock = None;

    app.emit("connection-status-changed", StatusPayload {
        status: ConnectionStatus::Disconnected,
        message: "Disconnected by user".to_string(),
    }).unwrap();

    Ok(())
}

#[tauri::command]
pub async fn send_signaling_message(
    state: tauri::State<'_, SignalingState>,
    message: String,
) -> Result<(), String> {
    let ws_tx_lock = state.ws_tx.lock().await;
    if let Some(tx) = &*ws_tx_lock {
        match tx.send(message).await {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to send message over WebSocket channel: {}", e)),
        }
    } else {
        Err("WebSocket connection is not active".to_string())
    }
}

#[tauri::command]
pub async fn start_signaling_connection(
    app: AppHandle,
    state: tauri::State<'_, SignalingState>,
    host: String,
    port: u16,
    token: String,
    is_mock: bool,
) -> Result<(), String> {
    // If already connected/connecting, disconnect first
    let _ = disconnect_signaling(app.clone(), state.clone()).await;

    let status_clone = Arc::clone(&state.status);
    let ws_tx_clone = Arc::clone(&state.ws_tx);
    let stop_tx_clone = Arc::clone(&state.stop_tx);

    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
    *stop_tx_clone.lock().await = Some(stop_tx);

    let mut status_lock = state.status.lock().await;
    *status_lock = ConnectionStatus::Connecting;
    
    app.emit("connection-status-changed", StatusPayload {
        status: ConnectionStatus::Connecting,
        message: "Initiating connection handshake...".to_string(),
    }).unwrap();

    tokio::spawn(async move {
        if is_mock {
            // Simulated AnyDesk connection logic for verification
            tokio::select! {
                _ = &mut stop_rx => {
                    return;
                }
                _ = tokio::time::sleep(Duration::from_secs(1)) => {
                    // Transition to Pending IT Admin Approval
                    {
                        let mut s = status_clone.lock().await;
                        if *s != ConnectionStatus::Connecting { return; }
                        *s = ConnectionStatus::PendingApproval;
                    }
                    app.emit("connection-status-changed", StatusPayload {
                        status: ConnectionStatus::PendingApproval,
                        message: "Waiting for IT Admin approval on Port 3355...".to_string(),
                    }).unwrap();
                }
            }

            tokio::select! {
                _ = &mut stop_rx => {
                    return;
                }
                _ = tokio::time::sleep(Duration::from_secs(2)) => {
                    // Transition to Connected
                    {
                        let mut s = status_clone.lock().await;
                        if *s != ConnectionStatus::PendingApproval { return; }
                        *s = ConnectionStatus::Connected;
                    }
                    app.emit("connection-status-changed", StatusPayload {
                        status: ConnectionStatus::Connected,
                        message: "Secure connection established successfully via port 7766!".to_string(),
                    }).unwrap();
                }
            }
            
            // Periodically log updates or simulate events
            loop {
                tokio::select! {
                    _ = &mut stop_rx => {
                        return;
                    }
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {
                        // Check status
                        let s = status_clone.lock().await;
                        if *s != ConnectionStatus::Connected { break; }
                        
                        // Emit mock remote events (e.g. heartbeat or mock frames info)
                        app.emit("session-message", "Mock ping from remote signaling server".to_string()).unwrap();
                    }
                }
            }
        } else {
            // Real connection logic using WebSockets
            let my_id = super::get_connection_id();
            let ws_url = format!("ws://{}:{}/ws?token={}&myId={}", host, port, token, my_id);
            let mut retry_count = 0;
            
            loop {
                // Check if stopped
                if stop_rx.try_recv().is_ok() {
                    return;
                }

                match connect_async(&ws_url).await {
                    Ok((ws_stream, _response)) => {
                        {
                            let mut s = status_clone.lock().await;
                            *s = ConnectionStatus::Connected;
                        }
                        app.emit("connection-status-changed", StatusPayload {
                            status: ConnectionStatus::Connected,
                            message: format!("Connected to signaling server on port {}!", port),
                        }).unwrap();

                        let (mut write, mut read) = ws_stream.split();
                        let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(30);
                        
                        // Store tx handle to let other commands send messages
                        {
                            let mut ws_tx_lock = ws_tx_clone.lock().await;
                            *ws_tx_lock = Some(tx.clone());
                        }

                        // Send registration handshake immediately
                        let register_msg = format!("{{\"type\":\"register\",\"clientId\":\"{}\"}}", my_id);
                        let _ = tx.send(register_msg).await;

                        // Spawn writer loop
                        tokio::spawn(async move {
                            while let Some(msg_str) = rx.recv().await {
                                if write.send(Message::Text(msg_str)).await.is_err() {
                                    break;
                                }
                            }
                        });

                        // Read loop
                        while let Some(message) = read.next().await {
                            match message {
                                Ok(Message::Text(text)) => {
                                    // Try deserializing it as InputAction to simulate locally (if this is the host)
                                    if let Ok(action) = serde_json::from_str::<super::InputAction>(&text) {
                                        let _ = super::simulate_input(action);
                                    } else {
                                        app.emit("session-message", text.clone()).unwrap();
                                    }
                                }
                                Ok(Message::Close(_)) => {
                                    break;
                                }
                                Err(_) => {
                                    break;
                                }
                                _ => {}
                            }
                        }

                        // Closed or error, reset status
                        {
                            let mut s = status_clone.lock().await;
                            *s = ConnectionStatus::Disconnected;
                        }
                        app.emit("connection-status-changed", StatusPayload {
                            status: ConnectionStatus::Disconnected,
                            message: "Connection closed by remote".to_string(),
                        }).unwrap();
                        break;
                    }
                    Err(e) => {
                        // Check if 401 Unauthorized (which signifies pending approval)
                        let is_unauthorized = match &e {
                            tokio_tungstenite::tungstenite::Error::Http(resp) => {
                                resp.status() == 401
                            }
                            _ => false,
                        };

                        if is_unauthorized {
                            {
                                let mut s = status_clone.lock().await;
                                *s = ConnectionStatus::PendingApproval;
                            }
                            app.emit("connection-status-changed", StatusPayload {
                                status: ConnectionStatus::PendingApproval,
                                message: "IT Admin approval pending... Retrying connection.".to_string(),
                            }).unwrap();
                        } else {
                            retry_count += 1;
                            if retry_count > 5 {
                                {
                                    let mut s = status_clone.lock().await;
                                    *s = ConnectionStatus::Disconnected;
                                }
                                app.emit("connection-status-changed", StatusPayload {
                                    status: ConnectionStatus::Disconnected,
                                    message: format!("Connection failed: {}", e),
                                }).unwrap();
                                break;
                            }
                        }

                        // Wait before retry
                        tokio::select! {
                            _ = &mut stop_rx => {
                                return;
                            }
                            _ = tokio::time::sleep(Duration::from_secs(3)) => {}
                        }
                    }
                }
            }
        }
    });

    Ok(())
}
