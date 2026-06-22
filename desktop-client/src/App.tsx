import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

// Check if running inside Tauri native shell or standard browser
const isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;

async function safeInvoke<T>(cmd: string, args?: Record<string, any>): Promise<T> {
  if (isTauri) {
    try {
      return await invoke<T>(cmd, args);
    } catch (e) {
      console.error(`Tauri invoke error for ${cmd}:`, e);
      throw e;
    }
  } else {
    console.log(`[Mock Invoke] ${cmd}`, args);
    if (cmd === "get_connection_id") {
      return "2A9-F8C-7E4" as unknown as T;
    }
    if (cmd === "get_hardware_guid") {
      return "7c5b81a2-ffaa-4cb4-8a17-640a1b6dfbb2" as unknown as T;
    }
    if (cmd === "ping_signaling_server") {
      return true as unknown as T;
    }
    if (cmd === "capture_screen") {
      return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" as unknown as T;
    }
    if (cmd === "get_clipboard") {
      return "Mock Clip content from browser" as unknown as T;
    }
    return Promise.resolve() as unknown as T;
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<"remote" | "settings" | "logs">("remote");
  const [connectionStatus, setConnectionStatus] = useState<"Disconnected" | "Connecting" | "Connected" | "PendingApproval">("Disconnected");
  const [statusMessage, setStatusMessage] = useState("System Idle. Awaiting connection parameters.");
  const [targetId, setTargetId] = useState("");
  const [hostIp, setHostIp] = useState(() => localStorage.getItem("amphub_gateway_ip") || "192.168.9.9");
  const [port, setPort] = useState(() => Number(localStorage.getItem("amphub_control_port")) || 7766);
  const [dashboardPort, setDashboardPort] = useState(() => Number(localStorage.getItem("amphub_dashboard_port")) || 3355);
  const [token, setToken] = useState("");
  const [isMock, setIsMock] = useState(!isTauri);
  const [myId, setMyId] = useState("Loading...");
  const [sessionRole, setSessionRole] = useState<"host" | "controller" | null>(null);
  const [remoteScreen, setRemoteScreen] = useState<string | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<{ ip: string; token?: string; requestId?: string } | null>(null);
  const [remoteStreamObject, setRemoteStreamObject] = useState<MediaStream | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastMoveSentRef = useRef<number>(0);
  const [isSignalingServerReachable, setIsSignalingServerReachable] = useState<boolean | null>(null);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [unattendedAccess, setUnattendedAccess] = useState(false);
  const [defaultPermission, setDefaultPermission] = useState<"ask" | "allow" | "deny">("ask");
  const [discoveryEnabled, setDiscoveryEnabled] = useState(true);
  const [isElevated, setIsElevated] = useState(false);
  const [uacSecureDesktop, setUacSecureDesktop] = useState(true);
  const [visualHelper, setVisualHelper] = useState<"hide" | "show" | "showOnMovement">(() => {
    return (localStorage.getItem("amphub_visual_helper") as any) || "showOnMovement";
  });
  const [followRemoteCursor, setFollowRemoteCursor] = useState(() => {
    return localStorage.getItem("amphub_follow_remote_cursor") === "true";
  });
  const [followWindowFocus, setFollowWindowFocus] = useState(() => {
    return localStorage.getItem("amphub_follow_window_focus") === "true";
  });
  const [showMoveSizeHelper, setShowMoveSizeHelper] = useState(() => {
    return localStorage.getItem("amphub_show_move_size_helper") === "true";
  });
  
  const [viewMode, setViewMode] = useState<"original" | "optimizeDisplay" | "optimizeScreen">(() => {
    return (localStorage.getItem("amphub_view_mode") as any) || "optimizeDisplay";
  });
  const [startFullScreen, setStartFullScreen] = useState(() => {
    return localStorage.getItem("amphub_start_full_screen") === "true";
  });
  const [useEdgeScrolling, setUseEdgeScrolling] = useState(() => {
    return localStorage.getItem("amphub_use_edge_scrolling") === "true";
  });
  const [exclusiveFullScreen, setExclusiveFullScreen] = useState(() => {
    const val = localStorage.getItem("amphub_exclusive_full_screen");
    return val === null ? true : val === "true";
  });

  const [hardwareAcceleration, setHardwareAcceleration] = useState<"opengl" | "direct3d" | "directdraw" | "disable">(() => {
    return (localStorage.getItem("amphub_hardware_acceleration") as any) || "direct3d";
  });
  const [use16BitRenderer, setUse16BitRenderer] = useState(() => {
    return localStorage.getItem("amphub_use_16bit_renderer") === "true";
  });
  const [recentConnections, setRecentConnections] = useState<string[]>([]);
  const [showMovementCursor, setShowMovementCursor] = useState(true);
  const cursorMovementTimeoutRef = useRef<any>(null);
  const [logs, setLogs] = useState<string[]>([
    "AMPHUB Core Client initialized.",
    `Mode: ${isTauri ? "AMPHUB Windows Client" : "Standard Browser Environment (Simulation Enabled)"}`
  ]);
  const [clipboardText, setClipboardText] = useState("");
  const [simulatedTermInput, setSimulatedTermInput] = useState("");
  const [termOutput, setTermOutput] = useState<string[]>([
    "AMPHUB Remote Terminal initialized.",
    "Type command and hit Enter to simulate execution on host."
  ]);

  const remoteScreenRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<any>(null);
  const unattendedAccessRef = useRef(false);
  const defaultPermissionRef = useRef<"ask" | "allow" | "deny">("ask");

  const clearPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const closeAllPeerConnections = () => {
    for (const pc of peerConnectionsRef.current.values()) {
      pc.close();
    }
    peerConnectionsRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setRemoteStreamObject(null);
  };

  const closePeerConnection = (peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }
    if (peerConnectionsRef.current.size === 0) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      setRemoteStreamObject(null);
    }
  };

  const getLocalStream = async (): Promise<MediaStream> => {
    if (localStreamRef.current && localStreamRef.current.active) {
      return localStreamRef.current;
    }
    // First, try native Chromium getDisplayMedia which is auto-approved via additionalBrowserArgs
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        addLog("[WebRTC] Requesting native display media stream...");
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: "monitor",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
            cursor: "always"
          } as any,
          audio: false
        });
        addLog("[WebRTC] Successfully acquired native display media stream.");
        return stream;
      }
    } catch (e) {
      addLog(`[WebRTC] getDisplayMedia failed, falling back to canvas capture loop: ${e}`);
    }

    addLog("[WebRTC] Initializing fallback programmatic canvas capture loop to share screen.");
    
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    
    const img = new Image();
    const updateCanvas = async () => {
      try {
        if (isTauri) {
          const b64 = await safeInvoke<string>("capture_screen");
          img.src = `data:image/png;base64,${b64}`;
          img.onload = () => {
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
          };
        } else {
          if (ctx) {
            ctx.fillStyle = "#1e293b";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#ef4444";
            ctx.font = "bold 30px sans-serif";
            ctx.fillText(`AMPHUB Streaming from ${myId}`, 100, 100);
            ctx.fillStyle = "#94a3b8";
            ctx.font = "20px monospace";
            ctx.fillText(`Timestamp: ${new Date().toLocaleTimeString()}`, 100, 150);
          }
        }
      } catch (err) {
        // ignore
      }
    };
    
    const intervalId = setInterval(updateCanvas, 100); // 100ms = 10 FPS capture loop
    const stream = (canvas as any).captureStream(10); // 10 fps
    stream.getTracks().forEach((track: any) => {
      const originalStop = track.stop;
      track.stop = () => {
        clearInterval(intervalId);
        if (originalStop) originalStop.call(track);
      };
    });
    return stream;
  };

  const initiateWebRTCOffer = async () => {
    addLog(`[WebRTC] Initiating P2P stream connection to host: ${targetId}`);
    closeAllPeerConnections();
    
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    peerConnectionsRef.current.set(targetId, pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        safeInvoke("send_signaling_message", {
          message: JSON.stringify({
            type: "ice-candidate",
            target: targetId,
            sender: myId,
            candidate: e.candidate
          })
        });
      }
    };

    pc.ontrack = (event) => {
      addLog("[WebRTC] Received remote stream track successfully!");
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        setRemoteStreamObject(stream);
        // Directly bind to the video element via ref for immediate playback
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch(err =>
            addLog(`[WebRTC] Video autoplay deferred by browser: ${err}`)
          );
        }
      }
    };

    pc.addTransceiver("video", { direction: "recvonly" });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    safeInvoke("send_signaling_message", {
      message: JSON.stringify({
        type: "offer",
        target: targetId,
        sender: myId,
        offer: offer
      })
    });
    addLog(`[WebRTC] Sent SDP Offer to host: ${targetId}`);
  };

  // Initialize client ID
  useEffect(() => {
    safeInvoke<string>("get_connection_id")
      .then((id) => {
        setMyId(id);
        addLog(`Hardware GUID hashed successfully. Connection ID: ${id}`);
      })
      .catch((err) => {
        setMyId("AMP-ERR-999");
        addLog(`Failed to resolve Hardware GUID: ${err}`);
      });
  }, []);

  // Initialize autostart status and security settings
  useEffect(() => {
    if (isTauri) {
      safeInvoke<boolean>("get_autostart_status")
        .then((status) => {
          setAutostartEnabled(status);
          addLog(`Windows startup registry queried: ${status ? "Enabled" : "Disabled"}`);
        })
        .catch((err) => {
          addLog(`Failed to query startup registry: ${err}`);
        });
      safeInvoke<boolean>("get_unattended_access")
        .then((v) => { setUnattendedAccess(v); unattendedAccessRef.current = v; })
        .catch(() => {});
      safeInvoke<string>("get_default_permission")
        .then((v) => { const perm = (v as any) || "ask"; setDefaultPermission(perm); defaultPermissionRef.current = perm; })
        .catch(() => {});
      safeInvoke<boolean>("get_discovery_enabled")
        .then((v) => setDiscoveryEnabled(v))
        .catch(() => {});
      safeInvoke<boolean>("get_is_elevated")
        .then((v) => {
          setIsElevated(v);
          addLog(`Admin elevation: ${v ? "Running as Administrator ✓" : "NOT elevated — UAC dialogs may not respond"}`);
        })
        .catch(() => {});
      safeInvoke<boolean>("get_uac_secure_desktop")
        .then((v) => setUacSecureDesktop(v))
        .catch(() => {});
    }
  }, []);

  // Load recent connections on startup
  useEffect(() => {
    try {
      const list = JSON.parse(localStorage.getItem("amphub_recent_connections") || "[]");
      setRecentConnections(list);
    } catch (e) {
      setRecentConnections([]);
    }
  }, []);

  // Save settings when they change
  useEffect(() => {
    localStorage.setItem("amphub_visual_helper", visualHelper);
  }, [visualHelper]);
  useEffect(() => {
    localStorage.setItem("amphub_follow_remote_cursor", String(followRemoteCursor));
  }, [followRemoteCursor]);
  useEffect(() => {
    localStorage.setItem("amphub_follow_window_focus", String(followWindowFocus));
  }, [followWindowFocus]);
  useEffect(() => {
    localStorage.setItem("amphub_show_move_size_helper", String(showMoveSizeHelper));
  }, [showMoveSizeHelper]);
  useEffect(() => {
    localStorage.setItem("amphub_view_mode", viewMode);
  }, [viewMode]);
  useEffect(() => {
    localStorage.setItem("amphub_start_full_screen", String(startFullScreen));
  }, [startFullScreen]);
  useEffect(() => {
    localStorage.setItem("amphub_use_edge_scrolling", String(useEdgeScrolling));
  }, [useEdgeScrolling]);
  useEffect(() => {
    localStorage.setItem("amphub_exclusive_full_screen", String(exclusiveFullScreen));
  }, [exclusiveFullScreen]);
  useEffect(() => {
    localStorage.setItem("amphub_hardware_acceleration", hardwareAcceleration);
  }, [hardwareAcceleration]);
  useEffect(() => {
    localStorage.setItem("amphub_use_16bit_renderer", String(use16BitRenderer));
  }, [use16BitRenderer]);


  const saveRecentConnection = (id: string) => {
    const cleanId = id.trim().toUpperCase();
    if (!cleanId) return;
    try {
      const list = JSON.parse(localStorage.getItem("amphub_recent_connections") || "[]");
      const updated = [cleanId, ...list.filter((x: string) => x !== cleanId)].slice(0, 6);
      localStorage.setItem("amphub_recent_connections", JSON.stringify(updated));
      setRecentConnections(updated);
    } catch (e) {
      console.error("Failed to save recent connection:", e);
    }
  };

  const removeRecentConnection = (id: string) => {
    try {
      const list = JSON.parse(localStorage.getItem("amphub_recent_connections") || "[]");
      const updated = list.filter((x: string) => x !== id);
      localStorage.setItem("amphub_recent_connections", JSON.stringify(updated));
      setRecentConnections(updated);
    } catch (e) {
      console.error("Failed to remove recent connection:", e);
    }
  };

  // Auto-save connection on successful connection
  useEffect(() => {
    if (connectionStatus === "Connected" && sessionRole === "controller" && targetId) {
      saveRecentConnection(targetId);
    }
  }, [connectionStatus, sessionRole, targetId]);

  const toggleAutostart = async () => {
    const nextVal = !autostartEnabled;
    if (!isTauri) {
      setAutostartEnabled(nextVal);
      addLog(`[Mock] Toggled startup setting to: ${nextVal ? "Enabled" : "Disabled"}`);
      return;
    }
    try {
      await safeInvoke("set_autostart_status", { enabled: nextVal });
      setAutostartEnabled(nextVal);
      addLog(`${nextVal ? "Enabled" : "Disabled"} Startup on Windows boot.`);
    } catch (err: any) {
      addLog(`Failed to update startup setting: ${err}`);
    }
  };

  const toggleUnattendedAccess = async () => {
    const nextVal = !unattendedAccess;
    setUnattendedAccess(nextVal);
    unattendedAccessRef.current = nextVal;
    try {
      await safeInvoke("set_unattended_access", { enabled: nextVal });
      addLog(`Unattended Access: ${nextVal ? "Enabled" : "Disabled"}`);
    } catch (err: any) {
      addLog(`Failed to set unattended access: ${err}`);
    }
  };

  const changeDefaultPermission = async (val: "ask" | "allow" | "deny") => {
    setDefaultPermission(val);
    defaultPermissionRef.current = val;
    try {
      await safeInvoke("set_default_permission", { permission: val });
      addLog(`Default permission set to: ${val}`);
    } catch (err: any) {
      addLog(`Failed to set default permission: ${err}`);
    }
  };

  const toggleDiscovery = async () => {
    const nextVal = !discoveryEnabled;
    setDiscoveryEnabled(nextVal);
    try {
      await safeInvoke("set_discovery_enabled", { enabled: nextVal });
      addLog(`Network Discovery: ${nextVal ? "Enabled" : "Disabled"}`);
    } catch (err: any) {
      addLog(`Failed to set discovery: ${err}`);
    }
  };

  const toggleUacSecureDesktop = async () => {
    const nextVal = !uacSecureDesktop;
    if (!isTauri) {
      setUacSecureDesktop(nextVal);
      addLog(`[Mock] Toggled UAC Secure Desktop setting to: ${nextVal ? "Enabled" : "Disabled"}`);
      return;
    }
    try {
      await safeInvoke("set_uac_secure_desktop", { enabled: nextVal });
      setUacSecureDesktop(nextVal);
      addLog(`${nextVal ? "Enabled" : "Disabled"} Windows UAC Secure Desktop.`);
    } catch (err: any) {
      addLog(`Failed to update UAC Secure Desktop: ${err}`);
      alert(err);
    }
  };

  // Auto-establish standby signaling connection on startup when not in mock mode
  useEffect(() => {
    if (myId && myId !== "Loading..." && myId !== "AMP-ERR-999") {
      if (!isMock) {
        addLog(`Auto-connecting to signaling server as standby host: ${myId}`);
        safeInvoke("start_signaling_connection", {
          host: hostIp,
          port: Number(port),
          token: "",
          isMock: false
        }).catch((err) => addLog(`Failed auto-connecting standby host: ${err}`));
      } else {
        safeInvoke("disconnect_signaling").catch(() => {});
      }
    }
  }, [myId, isMock, hostIp, port]);

  // Persist settings and ping signaling server
  useEffect(() => {
    localStorage.setItem("amphub_gateway_ip", hostIp);
    localStorage.setItem("amphub_control_port", String(port));
    localStorage.setItem("amphub_dashboard_port", String(dashboardPort));

    const checkPing = async () => {
      try {
        const reachable = await safeInvoke<boolean>("ping_signaling_server", { host: hostIp, port: Number(port) });
        setIsSignalingServerReachable(reachable);
        addLog(`Signaling server probe to ${hostIp}:${port}: ${reachable ? "REACHABLE" : "UNREACHABLE"}`);
      } catch (err) {
        setIsSignalingServerReachable(false);
      }
    };
    checkPing();
  }, [hostIp, port, dashboardPort]);

  // Handle automatic streaming based on connectionStatus
  // ROLE SEPARATION:
  //   Controller (PC-1): assigned "controller" role by server → pure receiver, MUST NOT capture own screen.
  //   Host     (PC-2): assigned "host" role by server → capture screen and stream.
  useEffect(() => {
    if (connectionStatus === "Connected" && sessionRole) {
      if (sessionRole === "controller") {
        // Controller role: act as pure WebRTC receiver.
        // Do NOT call start_desktop_stream — that would loopback our own screen.
        addLog("[CONTROLLER] Role confirmed by server. Awaiting remote host peer connection to initiate WebRTC offer.");
        if (startFullScreen) {
          setIsFullScreen(true);
          addLog("[View Mode] Automatically entering full screen session.");
        }
      } else if (sessionRole === "host") {
        // Host role: capture local screen and stream tracks to the controller.
        addLog("[HOST] Role confirmed by server. Starting local screen capture loop for streaming.");
        safeInvoke("start_desktop_stream")
          .then(() => addLog("[HOST] Desktop streamer capture loop active."))
          .catch(err => addLog(`[HOST] Failed to start streamer loop: ${err}`));
      }
    } else if (connectionStatus === "Disconnected") {
      setSessionRole(null);
      safeInvoke("stop_desktop_stream")
        .then(() => addLog("Desktop streamer capture loop stopped."))
        .catch(err => addLog(`Failed to stop streamer loop: ${err}`));

      closeAllPeerConnections();
    }
  }, [connectionStatus, sessionRole]);

  // Listen to Tauri signaling events
  useEffect(() => {
    let unlistenStatus: (() => void) | null = null;
    let unlistenMessage: (() => void) | null = null;
    let unlistenStream: (() => void) | null = null;

    if (isTauri) {
      listen("connection-status-changed", (event: any) => {
        const payload = event.payload as { status: "Disconnected" | "Connecting" | "Connected" | "PendingApproval"; message: string };
        setConnectionStatus(payload.status);
        setStatusMessage(payload.message);
        addLog(`[Status Update] ${payload.status}: ${payload.message}`);
        
        if (payload.status === "Connected") {
          startScreenSharing();
        } else {
          setRemoteScreen(null);
        }
      }).then(fn => { unlistenStatus = fn; });

      listen("session-message", async (event: any) => {
        const text = event.payload as string;
        if (text.startsWith("iVBOR") || text.length > 500 && !text.startsWith("{")) {
          // Received frame base64
          setRemoteScreen(text);
        } else {
          try {
            const data = JSON.parse(text);
            if (data.type === "role_assignment") {
              setSessionRole(data.role);
              addLog(`[Role Assignment] Server assigned role: ${data.role.toUpperCase()}`);
            } else if (data.type === "peer_joined") {
              addLog(`[Session] Peer connected: ${data.peerId} (${data.role})`);
              // Check current sessionRole state or read it from closure
              // (Note: inside this listener, sessionRole might be stale, so we can check data.role === "host")
              if (data.role === "host") {
                addLog("[CONTROLLER] Host peer is now online. Negotiating WebRTC peer connection...");
                initiateWebRTCOffer();
              }
            } else if (data.type === "admin_request" || data.action === "admin_request") {
              // Respect default permission setting:
              //  - "allow" (unattended) → auto-approve without popup
              //  - "deny"              → auto-deny silently
              //  - "ask" (default)     → show popup
              if (unattendedAccessRef.current || defaultPermissionRef.current === "allow") {
                addLog("[AutoApprove] Unattended access active — auto-accepting incoming connection.");
                // Auto-accept: connect directly using the provided token
                if (!isMock && data.token) {
                  safeInvoke("start_signaling_connection", {
                    host: hostIp,
                    port: Number(port),
                    token: data.token,
                    isMock: false
                  }).catch((err: any) => addLog(`Auto-connect failed: ${err}`));
                } else {
                  setConnectionStatus("Connected");
                  setStatusMessage("Auto-approved session active.");
                }
              } else if (defaultPermissionRef.current === "deny") {
                addLog("[AutoDeny] Default permission is deny — rejecting incoming connection.");
              } else {
                // Show popup to the user
                setIncomingRequest({
                  ip: data.ip || "192.168.9.9",
                  token: data.token,
                  requestId: data.requestId
                });
                safeInvoke("show_app_window").catch((err) => {
                  console.error("Failed to restore app window on access request:", err);
                });
              }
            } else if (data.type === "offer") {
              addLog(`[WebRTC] Received SDP Offer from controller: ${data.sender}`);
              const senderId = data.sender;
              closePeerConnection(senderId);
              
              const pc = new RTCPeerConnection({
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
              });
              peerConnectionsRef.current.set(senderId, pc);

              pc.onicecandidate = (e) => {
                if (e.candidate) {
                  safeInvoke("send_signaling_message", {
                    message: JSON.stringify({
                      type: "ice-candidate",
                      target: senderId,
                      sender: myId,
                      candidate: e.candidate
                    })
                  });
                }
              };

              try {
                const stream = await getLocalStream();
                stream.getTracks().forEach(track => pc.addTrack(track, stream));
                addLog("[WebRTC] Local screen stream tracks added using .addTrack()");
              } catch (streamErr) {
                addLog(`[WebRTC] Failed to capture screen: ${streamErr}`);
              }

              await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);

              safeInvoke("send_signaling_message", {
                message: JSON.stringify({
                  type: "answer",
                  target: senderId,
                  sender: myId,
                  answer: answer
                })
              });
              addLog(`[WebRTC] Sent SDP Answer to controller: ${senderId}`);
            } else if (data.type === "answer") {
              addLog(`[WebRTC] Received SDP Answer from host: ${data.sender}`);
              const pc = peerConnectionsRef.current.get(data.sender);
              if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
              }
            } else if (data.type === "ice-candidate") {
              const pc = peerConnectionsRef.current.get(data.sender);
              if (pc) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
              }
            } else if (["mouseMove", "mouseClick", "keyPress", "keyType"].includes(data.type)) {
              if (sessionRole === "host") {
                const action = { ...data };
                if (action.type === "mouseMove") {
                  action.x = Math.round(data.x * window.screen.width);
                  action.y = Math.round(data.y * window.screen.height);
                }
                safeInvoke("simulate_input", { action }).catch(err => {
                  console.error("Failed to simulate remote input:", err);
                });
              }
            } else if (data.type === "error") {
              addLog(`[Signaling Error] ${data.error}`);
            }
          } catch(e) {
            if (text.startsWith("iVBOR") || text.length > 500) {
              setRemoteScreen(text);
            } else {
              addLog(`[Signal Message] ${text}`);
            }
          }
        }
      }).then(fn => { unlistenMessage = fn; });

      listen("webrtc-stream-frame", (event: any) => {
        const b64 = event.payload as string;
        setRemoteScreen(b64);
      }).then(fn => { unlistenStream = fn; });
    }

    return () => {
      if (unlistenStatus) unlistenStatus();
      if (unlistenMessage) unlistenMessage();
      if (unlistenStream) unlistenStream();
      clearPolling();
      closeAllPeerConnections();
    };
  }, []);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 49)]);
  };

  const handleConnect = async () => {
    const cleanTargetId = targetId.trim().toUpperCase();
    if (!isMock && isSignalingServerReachable === false) {
      addLog("Error: Cannot connect to target. AMPHUB signaling server is unreachable.");
      setStatusMessage("Offline: Server connection required.");
      return;
    }

    try {
      addLog(`Initiating connection. Target: ${cleanTargetId}, Endpoint: ${hostIp}:${port}`);
      
      if (isMock) {
        // Browser mock flow
        setConnectionStatus("Connecting");
        setStatusMessage("Initiating mock handshake...");
        
        setTimeout(() => {
          setConnectionStatus("PendingApproval");
          setStatusMessage("Waiting for IT Admin approval on Port 3355...");
          addLog("Mock session created. PENDING administrator approval on port 3355.");
          
          setTimeout(() => {
            setConnectionStatus("Connected");
            setStatusMessage("Secure connection established via port 7766!");
            addLog("Mock session APPROVED. Remote screen capture started.");
            // Render a simulated remote screen background
            setRemoteScreen("mock");
          }, 2500);
        }, 1200);
        return;
      }

      // Real mode connection request flow
      if (token) {
        // Use manually supplied token if available
        addLog("Using provided session token to connect...");
        await safeInvoke("start_signaling_connection", {
          host: hostIp,
          port: Number(port),
          token: token,
          isMock: false
        });
      } else {
        // Request a new session and poll for approval
        setConnectionStatus("Connecting");
        setStatusMessage("Requesting session approval from admin...");
        addLog(`POSTing session request to /api/v1/sessions/request for target client: ${cleanTargetId}`);

        const response = await fetch(`http://${hostIp}:${dashboardPort}/api/v1/sessions/request`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            clientId: cleanTargetId,
            metadata: {
              controllerId: myId,
              platform: "Windows Client",
            }
          })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Failed to create session request");
        }

        const sessionRequest = await response.json();
        if (sessionRequest.status === "APPROVED" && sessionRequest.token) {
          clearPolling();
          addLog("Local connection auto-approved by server. Connecting directly...");
          setToken(sessionRequest.token);
          await safeInvoke("start_signaling_connection", {
            host: hostIp,
            port: Number(port),
            token: sessionRequest.token,
            isMock: false
          });
          return;
        }

        const requestId = sessionRequest.id;
        addLog(`Session request created. ID: ${requestId}. Status: ${sessionRequest.status}`);
        setConnectionStatus("PendingApproval");
        setStatusMessage("Awaiting administrator approval...");

        // Start polling status
        clearPolling();
        pollingRef.current = setInterval(async () => {
          try {
            const statusRes = await fetch(`http://${hostIp}:${dashboardPort}/api/v1/sessions/status/${requestId}`);
            if (!statusRes.ok) {
              addLog(`Polling error: ${statusRes.statusText}`);
              return;
            }
            const statusData = await statusRes.json();
            if (statusData.status === "APPROVED" && statusData.token) {
              clearPolling();
              addLog("Session approved! Connecting to signaling channel...");
              setToken(statusData.token);
              await safeInvoke("start_signaling_connection", {
                host: hostIp,
                port: Number(port),
                token: statusData.token,
                isMock: false
              });
            } else if (statusData.status === "DENIED") {
              clearPolling();
              setConnectionStatus("Disconnected");
              setStatusMessage("Session request denied by administrator.");
              addLog("Session request denied.");
            }
          } catch (pollErr: any) {
            addLog(`Error polling session status: ${pollErr.message || pollErr}`);
          }
        }, 2000);
      }
    } catch (e: any) {
      addLog(`Connection initialization failed: ${e.message || e}`);
      setStatusMessage(`Error: ${e.message || e}`);
      setConnectionStatus("Disconnected");
    }
  };

  const handleDisconnect = async () => {
    clearPolling();
    try {
      await safeInvoke("disconnect_signaling");
      setConnectionStatus("Disconnected");
      setStatusMessage("Disconnected. Ready for connection.");
      setRemoteScreen(null);
      addLog("Session closed.");
    } catch (e: any) {
      addLog(`Failed to close connection cleanly: ${e}`);
    }
  };

  const startScreenSharing = async () => {
    // If real connected, we could poll screen captures
    addLog("Starting screen capture streaming...");
  };

  // Clipboard commands
  const fetchClipboard = async () => {
    try {
      const text = await safeInvoke<string>("get_clipboard");
      setClipboardText(text);
      addLog(`Read OS Clipboard: "${text}"`);
    } catch (e: any) {
      addLog(`Clipboard read failed: ${e}`);
    }
  };

  const writeClipboard = async (text: string) => {
    try {
      await safeInvoke("set_clipboard", { text });
      addLog(`Wrote to OS Clipboard: "${text}"`);
    } catch (e: any) {
      addLog(`Clipboard write failed: ${e}`);
    }
  };

  const handleScreenInteraction = (e: React.MouseEvent<HTMLDivElement>, actionType: "click" | "move" | "rightclick") => {
    if (!remoteScreenRef.current) return;
    const rect = remoteScreenRef.current.getBoundingClientRect();
    
    // Scale local click/move coordinates to normalized ratio [0, 1]
    const ratioX = (e.clientX - rect.left) / rect.width;
    const ratioY = (e.clientY - rect.top) / rect.height;

    // virtual coordinates (1920x1080) for display/logging
    const dispX = Math.round(ratioX * 1920);
    const dispY = Math.round(ratioY * 1080);

    if (actionType === "click") {
      addLog(`Input Emulation: Left click at relative coordinates (${dispX}, ${dispY})`);
      if (connectionStatus === "Connected" && !isMock) {
        safeInvoke("send_signaling_message", {
          message: JSON.stringify({
            type: "mouseMove",
            x: ratioX,
            y: ratioY
          })
        }).then(() => {
          safeInvoke("send_signaling_message", {
            message: JSON.stringify({
              type: "mouseClick",
              button: "left"
            })
          });
        });
      } else {
        const localX = Math.round(ratioX * window.screen.width);
        const localY = Math.round(ratioY * window.screen.height);
        safeInvoke("simulate_input", {
          action: {
            type: "mouseMove",
            x: localX,
            y: localY
          }
        }).then(() => {
          safeInvoke("simulate_input", {
            action: {
              type: "mouseClick",
              button: "left"
            }
          });
        });
      }
    } else if (actionType === "rightclick") {
      addLog(`Input Emulation: Right click at relative coordinates (${dispX}, ${dispY})`);
      if (connectionStatus === "Connected" && !isMock) {
        safeInvoke("send_signaling_message", {
          message: JSON.stringify({
            type: "mouseMove",
            x: ratioX,
            y: ratioY
          })
        }).then(() => {
          safeInvoke("send_signaling_message", {
            message: JSON.stringify({
              type: "mouseClick",
              button: "right"
            })
          });
        });
      } else {
        const localX = Math.round(ratioX * window.screen.width);
        const localY = Math.round(ratioY * window.screen.height);
        safeInvoke("simulate_input", {
          action: {
            type: "mouseMove",
            x: localX,
            y: localY
          }
        }).then(() => {
          safeInvoke("simulate_input", {
            action: {
              type: "mouseClick",
              button: "right"
            }
          });
        });
      }
    } else if (actionType === "move") {
      const now = Date.now();
      if (now - lastMoveSentRef.current < 50) return; // limit to 20 moves per second (50ms interval)
      lastMoveSentRef.current = now;

      if (connectionStatus === "Connected" && !isMock) {
        safeInvoke("send_signaling_message", {
          message: JSON.stringify({
            type: "mouseMove",
            x: ratioX,
            y: ratioY
          })
        });
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const key = e.key;

    // Support exiting full screen view with Escape key
    if (key === "Escape") {
      setIsFullScreen(false);
      return;
    }

    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(key)) {
      return;
    }

    addLog(`Input Emulation: Key press: ${key}`);

    if (connectionStatus === "Connected" && !isMock) {
      safeInvoke("send_signaling_message", {
        message: JSON.stringify({
          type: "keyPress",
          key: key
        })
      });
    } else {
      safeInvoke("simulate_input", {
        action: {
          type: "keyPress",
          key: key
        }
      });
    }
  };

  const getCursorClass = () => {
    if (visualHelper === "hide") return "cursor-none";
    if (visualHelper === "show") return "cursor-default";
    return showMovementCursor ? "cursor-default" : "cursor-none";
  };

  const getViewportClass = () => {
    const base = isFullScreen 
      ? "fixed inset-0 z-50 bg-black w-screen h-screen flex items-center justify-center outline-none" 
      : "aspect-video bg-neutral-900 relative border-t border-slate-800 outline-none flex items-center justify-center group select-none";
    const overflowClass = viewMode === "original" ? "overflow-auto" : "overflow-hidden";
    const cursorClass = getCursorClass();
    return `${base} ${overflowClass} ${cursorClass}`;
  };

  const getObjectFitClass = () => {
    if (viewMode === "optimizeDisplay") return "object-contain w-full h-full";
    if (viewMode === "optimizeScreen") return "object-fill w-full h-full";
    // "original"
    return "object-none";
  };


  const executeTermCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simulatedTermInput.trim()) return;

    const cmd = simulatedTermInput.trim();
    setTermOutput(prev => [...prev, `> ${cmd}`]);
    setSimulatedTermInput("");

    // Simulate input typing on host if connected
    if (connectionStatus === "Connected") {
      addLog(`Typing text on host: "${cmd}"`);
      if (!isMock) {
        safeInvoke("send_signaling_message", {
          message: JSON.stringify({
            type: "keyType",
            text: cmd + "\n"
          })
        });
        setTermOutput(prev => [...prev, `[Signaling Router] Forwarded sequence: "${cmd}\\n"`]);
      } else {
        safeInvoke("simulate_input", {
          action: {
            type: "keyType",
            text: cmd + "\n"
          }
        });
        setTermOutput(prev => [...prev, `[Rust Emulation] Typed sequence: "${cmd}\\n"`]);
      }
    } else {
      setTermOutput(prev => [...prev, "Error: Must be connected to target to emulate keyboard inputs."]);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-slate-900 border-r border-slate-800 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo Header */}
          <div className="p-6 border-b border-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-600 to-rose-400 flex items-center justify-center shadow-lg shadow-rose-900/40">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h1 className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-rose-400 via-rose-500 to-orange-400 bg-clip-text text-transparent">AMPHUB</h1>
              <p className="text-xs text-slate-500 font-medium tracking-wider uppercase">Remote Workspace</p>
            </div>
          </div>

          {/* Connection ID Card */}
          <div className="p-5">
            <div className="bg-slate-950/60 rounded-2xl p-5 border border-slate-800/80 shadow-inner relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-xl pointer-events-none"></div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">Your Client ID</span>
                {(!isMock && isSignalingServerReachable === false) ? (
                  <span className="flex items-center gap-1.5 bg-rose-950/80 border border-rose-900 text-rose-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                    Offline
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 bg-emerald-950/80 border border-emerald-900 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                    Ready
                  </span>
                )}
              </div>
              <div className="text-2xl font-black font-mono tracking-wider text-slate-200 select-all py-1">
                {myId}
              </div>
              <div className="text-[11px] text-slate-500 mt-2 flex items-center justify-between">
                <span>Persistent Hardware MAC Hash</span>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(myId);
                    addLog("Copied Client Connection ID to clipboard.");
                  }}
                  className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer flex items-center gap-1 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  Copy
                </button>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <div className="px-4 space-y-1">
            <button
              onClick={() => setActiveTab("remote")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                activeTab === "remote"
                  ? "bg-rose-600/10 text-rose-400 border border-rose-900/30"
                  : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200 border border-transparent"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Remote Desktop
            </button>

            <button
              onClick={() => setActiveTab("settings")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                activeTab === "settings"
                  ? "bg-rose-600/10 text-rose-400 border border-rose-900/30"
                  : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200 border border-transparent"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings & Handshakes
            </button>

            <button
              onClick={() => setActiveTab("logs")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                activeTab === "logs"
                  ? "bg-rose-600/10 text-rose-400 border border-rose-900/30"
                  : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200 border border-transparent"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Telemetry Console
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800/60 bg-slate-950/20 text-xs text-slate-500 font-medium">
          <div>v2.11.3 • Windows x64</div>
        </div>
      </div>

      {/* Main Panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-950 relative overflow-y-auto">
        {/* Top Header / Status Bar */}
        <div className="h-16 border-b border-slate-900/80 bg-slate-900/30 backdrop-blur px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-400">Connection State:</span>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
              connectionStatus === "Connected" ? "bg-emerald-950/60 border border-emerald-800 text-emerald-400 shadow-lg shadow-emerald-950/30" :
              connectionStatus === "Connecting" ? "bg-amber-950/60 border border-amber-800 text-amber-400 animate-pulse" :
              connectionStatus === "PendingApproval" ? "bg-orange-950/60 border border-orange-800 text-orange-400 animate-pulse" :
              "bg-slate-900 border border-slate-800 text-slate-400"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                connectionStatus === "Connected" ? "bg-emerald-400" :
                connectionStatus === "Connecting" ? "bg-amber-400" :
                connectionStatus === "PendingApproval" ? "bg-orange-400" :
                "bg-slate-500"
              }`}></span>
              {connectionStatus === "PendingApproval" ? "Pending IT Approval" : connectionStatus}
            </span>
          </div>
          <div className="text-xs font-semibold text-slate-500 select-none">
            {statusMessage}
          </div>
        </div>

        {/* Dynamic Workspace Container */}
        <div className="flex-1 p-8 overflow-y-auto">
          {activeTab === "remote" && (
            <div className="space-y-8 max-w-6xl mx-auto">
              {/* Remote Control Connection Form */}
              {connectionStatus === "Disconnected" && (
                <div className="bg-slate-900/50 rounded-3xl border border-slate-800 p-8 shadow-2xl relative overflow-hidden backdrop-blur-sm">
                  <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-rose-500 via-orange-500 to-amber-500"></div>
                  <div className="max-w-xl">
                    <h2 className="text-2xl font-black tracking-tight text-white mb-2">Establish Connection Route</h2>
                    <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                      Enter the target host client address and connection port to initialize the encrypted WebSockets tunneling route.
                    </p>

                    <div className="space-y-4">
                      {/* Host IP and Port in Grid */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">AMPHUB Server Address</label>
                          <input
                            type="text"
                            value={hostIp}
                            onChange={(e) => setHostIp(e.target.value)}
                            placeholder="e.g. 192.168.1.100"
                            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-sm font-medium text-slate-200 placeholder:text-slate-700 focus:outline-none focus:border-rose-500/50 transition-colors shadow-inner"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Signaling Port</label>
                          <input
                            type="number"
                            value={port}
                            onChange={(e) => setPort(Number(e.target.value))}
                            placeholder="7766"
                            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-sm font-medium text-slate-200 focus:outline-none focus:border-rose-500/50 transition-colors shadow-inner"
                          />
                        </div>
                      </div>

                      {/* Connection ID */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Target Client ID</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={targetId}
                            onChange={(e) => setTargetId(e.target.value)}
                            placeholder="Enter 9-digit remote address (e.g. 2A9-F8C-7E4)"
                            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-4 pr-12 py-3 text-sm font-medium text-slate-200 placeholder:text-slate-700 focus:outline-none focus:border-rose-500/50 transition-colors shadow-inner font-mono tracking-wider"
                          />
                          <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-slate-600">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* Token Section */}
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Security Access JWT Token</label>
                          <span className="text-[10px] text-slate-600">Acquired from Web UI Port 3355</span>
                        </div>
                        <textarea
                          rows={2}
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          disabled={isMock}
                          placeholder={isMock ? "Not required in Mock Mode. Enable in Settings." : "Paste approved IT Admin session token signed by JWT_SECRET..."}
                          className={`w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-rose-500/50 transition-colors shadow-inner resize-none ${isMock ? "opacity-40 cursor-not-allowed select-none bg-slate-950" : ""}`}
                        />
                      </div>

                      {/* Mock Mode Switch */}
                      <div className="pt-2 flex items-center justify-between border-t border-slate-800/80 mt-2">
                        <div>
                          <div className="text-xs font-bold text-slate-300">Enable Simulated Environment</div>
                          <div className="text-[10px] text-slate-500">Allows demonstration of layout states without backend server docker socket</div>
                        </div>
                        <button
                          onClick={() => {
                            setIsMock(!isMock);
                            addLog(`Mock mode toggled to: ${!isMock ? "ENABLED" : "DISABLED"}`);
                          }}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isMock ? "bg-rose-600" : "bg-slate-800"}`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isMock ? "translate-x-5" : "translate-x-0"}`}></span>
                        </button>
                      </div>

                      {/* Connect Trigger */}
                      <div className="pt-4">
                        <button
                          onClick={handleConnect}
                          disabled={!isMock && isSignalingServerReachable === false}
                          className={`w-full cursor-pointer py-3.5 bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-rose-950/50 hover:shadow-rose-900/60 transform active:scale-[0.99] transition-all flex items-center justify-center gap-2 group ${(!isMock && isSignalingServerReachable === false) ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          <svg className="w-5 h-5 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                          Connect to Target Session
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Recent Connections */}
              {connectionStatus === "Disconnected" && recentConnections.length > 0 && (
                <div className="bg-slate-900/40 rounded-3xl border border-slate-800 p-6 shadow-xl relative overflow-hidden backdrop-blur-sm mt-4">
                  <h3 className="text-sm font-extrabold text-slate-300 mb-4 flex items-center gap-2">
                    <svg className="w-4 h-4 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Recent Connections
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {recentConnections.map((id) => (
                      <div 
                        key={id} 
                        className="bg-slate-950/80 rounded-xl p-3 border border-slate-800/80 hover:border-rose-500/40 transition-all flex items-center justify-between group"
                      >
                        <button
                          onClick={() => {
                            setTargetId(id);
                          }}
                          className="flex-1 text-left font-mono font-bold text-xs text-slate-300 hover:text-rose-400 transition-colors truncate cursor-pointer"
                        >
                          {id}
                        </button>
                        <button
                          onClick={() => removeRecentConnection(id)}
                          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-500 transition-all p-1 hover:bg-slate-800 rounded cursor-pointer"
                          title="Remove connection"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Connecting / Approval Spinner */}
              {(connectionStatus === "Connecting" || connectionStatus === "PendingApproval") && (
                <div className="bg-slate-900/50 rounded-3xl border border-slate-800 p-12 text-center shadow-2xl relative overflow-hidden backdrop-blur-sm">
                  <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-orange-500 via-amber-500 to-rose-500 animate-pulse"></div>
                  <div className="max-w-md mx-auto py-8">
                    <div className="relative w-24 h-24 mx-auto mb-8">
                      <div className="absolute inset-0 rounded-full border-4 border-slate-800"></div>
                      <div className={`absolute inset-0 rounded-full border-4 border-t-rose-600 animate-spin ${connectionStatus === "PendingApproval" ? "border-t-orange-500" : ""}`}></div>
                      <div className="absolute inset-0 flex items-center justify-center text-slate-500">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 009 11V7a3 3 0 016 0v4m-2 5h.01M3 19h16a2 2 0 002-2V7a2 2 0 00-2-2H3a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                    </div>

                    <h3 className="text-xl font-extrabold text-white mb-3">
                      {connectionStatus === "PendingApproval" ? "IT Admin Approval Required" : "Establishing Secure Tunnel"}
                    </h3>
                    <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                      {connectionStatus === "PendingApproval" 
                        ? `The signaling route is registered on port 7766. Please log in to the Administrative Web UI at http://<host_ip>:3355 and approve session request ID for Client ID: ${myId}`
                        : "Performing cryptographic authentication handshake and routing parameters."}
                    </p>

                    <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/80 text-xs font-mono text-slate-400 flex items-center justify-between mb-8 select-all">
                      <span>Status: {statusMessage}</span>
                    </div>

                    <button
                      onClick={handleDisconnect}
                      className="cursor-pointer px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-all"
                    >
                      Cancel Handshake
                    </button>
                  </div>
                </div>
              )}

              {/* Active Session Desktop Screen */}
              {connectionStatus === "Connected" && sessionRole === "controller" && (
                <div className="space-y-6">
                  {/* Remote Window Workspace */}
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
                    {/* Viewport Toolbar */}
                    <div className="bg-slate-950 px-5 py-3 border-b border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-rose-500"></span>
                        <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                        <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                        <span className="ml-3 text-xs font-extrabold text-slate-300 select-none tracking-wide">
                          REMOTE CLIENT SESSION: {targetId || "AMP-SIMULATED-DEV"}
                        </span>
                      </div>
                      
                      {/* Connection Actions */}
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setIsFullScreen(!isFullScreen)}
                          title="Toggle Full Screen view"
                          className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-md border border-slate-800 transition-colors cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {isFullScreen ? (
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4" />
                            ) : (
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4h4m12 4V4h-4M4 16v4h4m12-4v4h-4" />
                            )}
                          </svg>
                        </button>
                        <button 
                          onClick={fetchClipboard}
                          title="Sync target clipboard to local clipboard"
                          className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-md border border-slate-800 transition-colors cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                        </button>
                        <button 
                          onClick={() => {
                            if (isMock) {
                              safeInvoke<string>("capture_screen").then((b64) => {
                                addLog("Captured remote monitor screen.");
                                setRemoteScreen(b64);
                              });
                            } else {
                              addLog("Screenshot manual capture is handled via real-time WebSocket screen stream.");
                            }
                          }}
                          title="Capture host monitor screenshot"
                          className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-md border border-slate-800 transition-colors cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </button>
                        <button 
                          onClick={handleDisconnect}
                          className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-extrabold rounded-md shadow transition-colors cursor-pointer"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>

                    {/* Viewport Screen */}
                    <div 
                      ref={remoteScreenRef}
                      tabIndex={0}
                      onClick={(e) => handleScreenInteraction(e, "click")}
                      onMouseMove={(e) => handleScreenInteraction(e, "move")}
                      onContextMenu={(e) => { e.preventDefault(); handleScreenInteraction(e, "rightclick"); }}
                      onKeyDown={(e) => handleKeyPress(e)}
                      className={getViewportClass()}
                    >
                      {isFullScreen && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setIsFullScreen(false); }}
                          className="absolute top-4 right-4 z-50 p-2.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-850 text-slate-400 hover:text-rose-400 rounded-xl transition-all shadow-xl flex items-center gap-1.5 cursor-pointer font-sans text-xs font-bold"
                          title="Exit Full Screen (Esc)"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Exit Full Screen
                        </button>
                      )}
                      {remoteScreen === "mock" ? (
                        /* Simulated Remote Windows OS environment */
                        <div className="absolute inset-0 bg-gradient-to-tr from-slate-900 via-indigo-950 to-slate-900 flex flex-col justify-between p-6">
                          {/* Desktop icons */}
                          <div className="space-y-4">
                            <div className="w-16 flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all select-none">
                              <div className="w-9 h-9 bg-rose-500/20 border border-rose-500/40 rounded-lg flex items-center justify-center text-rose-400">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2" />
                                </svg>
                              </div>
                              <span className="text-[10px] text-slate-300 font-semibold truncate text-center w-full">AMPHUB Db</span>
                            </div>

                            <div className="w-16 flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all select-none">
                              <div className="w-9 h-9 bg-blue-500/20 border border-blue-500/40 rounded-lg flex items-center justify-center text-blue-400">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h5l2 2h9a2 2 0 012 2v8a2 2 0 01-2 2H5z" />
                                </svg>
                              </div>
                              <span className="text-[10px] text-slate-300 font-semibold truncate text-center w-full">Shared files</span>
                            </div>
                          </div>

                          {/* Interactive terminal popup inside mock desktop */}
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 max-w-lg bg-black/90 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col">
                            <div className="bg-slate-900/80 px-4 py-2 border-b border-slate-800 flex justify-between items-center">
                              <span className="text-[10px] font-mono text-slate-400">Host Terminal - cmd.exe</span>
                              <span className="text-[10px] text-rose-500 font-bold">● Connected</span>
                            </div>
                            <div className="p-4 font-mono text-xs text-rose-400 space-y-1.5 h-48 overflow-y-auto">
                              {termOutput.map((out, idx) => (
                                <div key={idx} className={out.startsWith(">") ? "text-slate-300 font-bold" : "text-emerald-400 font-medium"}>
                                  {out}
                                </div>
                              ))}
                            </div>
                            <form onSubmit={executeTermCommand} className="border-t border-slate-800 flex">
                              <span className="bg-slate-900/60 px-3 py-2 text-xs font-mono text-slate-500 select-none">&gt;</span>
                              <input
                                type="text"
                                value={simulatedTermInput}
                                onChange={(e) => setSimulatedTermInput(e.target.value)}
                                placeholder="Type input command to emulate keyType..."
                                className="flex-1 bg-slate-950 border-none outline-none text-xs font-mono text-slate-200 px-3 py-2"
                              />
                            </form>
                          </div>

                          {/* Desktop Taskbar */}
                          <div className="w-full h-11 bg-slate-950/70 border border-white/5 backdrop-blur-xl rounded-xl flex items-center justify-between px-4 select-none">
                            <div className="flex items-center gap-3">
                              {/* Start Button */}
                              <div className="w-7 h-7 rounded-md bg-rose-600 flex items-center justify-center text-white shadow shadow-rose-900/50 hover:bg-rose-500 transition-colors cursor-pointer">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16M4 18h16" />
                                </svg>
                              </div>
                              <span className="text-xs text-slate-400 font-semibold">Start Menu</span>
                            </div>
                            
                            <div className="text-[10px] text-slate-500 font-mono">
                              1920x1080 • Simulated Desktop Screen
                            </div>
                          </div>
                        </div>
                      ) : remoteStreamObject ? (
                        <video
                          id="remote-video-viewport"
                          ref={(el) => {
                            remoteVideoRef.current = el;
                            if (el && el.srcObject !== remoteStreamObject) {
                              el.srcObject = remoteStreamObject;
                              el.play().catch(err =>
                                console.error("[WebRTC] Video autoplay failed:", err)
                              );
                            }
                          }}
                          className={getObjectFitClass()}
                          autoPlay
                          playsInline
                          muted
                        />
                      ) : remoteScreen ? (
                        /* Real captured image stream */
                        <img 
                          src={remoteScreen.startsWith("iVBOR") ? `data:image/png;base64,${remoteScreen}` : `data:image/jpeg;base64,${remoteScreen}`}
                          alt="Remote monitor display stream"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="text-slate-500 text-sm font-semibold flex flex-col items-center gap-2">
                          <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-rose-500 animate-spin"></div>
                          Retrieving Remote Screen Frame...
                        </div>
                      )}
                      
                      {/* Interaction tooltip overlay */}
                      <div className="absolute top-4 left-4 bg-black/60 backdrop-blur border border-slate-800 text-[10px] text-slate-400 px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none font-mono">
                        Mouse/Keyboard Capture Active • Click to Emulate Input
                      </div>
                    </div>
                  </div>

                  {/* Remote Clipboard Sync Tool */}
                  <div className="bg-slate-900/60 rounded-2xl border border-slate-800/80 p-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div>
                        <h4 className="text-sm font-extrabold text-white">Cryptographic Clipboard Synchronization</h4>
                        <p className="text-[11px] text-slate-500">Access and control host OS clipboard data securely using Tauri system privileges</p>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950 border border-emerald-900 px-2 py-0.5 rounded-full uppercase">Enabled</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={clipboardText}
                        onChange={(e) => setClipboardText(e.target.value)}
                        placeholder="Retrieve or enter clipboard payload..."
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-rose-500/50"
                      />
                      <button 
                        onClick={fetchClipboard}
                        className="cursor-pointer px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors"
                      >
                        Read Host
                      </button>
                      <button 
                        onClick={() => writeClipboard(clipboardText)}
                        className="cursor-pointer px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold shadow shadow-rose-950 transition-colors"
                      >
                        Write Host
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {connectionStatus === "Connected" && sessionRole === "host" && (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center shadow-2xl relative overflow-hidden backdrop-blur-sm max-w-lg mx-auto">
                  <div className="absolute top-0 left-0 w-full h-[4px] bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-400 animate-pulse"></div>
                  <div className="py-8">
                    <div className="w-24 h-24 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center text-emerald-400 mx-auto mb-8 shadow-lg shadow-emerald-950/50">
                      <svg className="w-12 h-12 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-extrabold text-white mb-3">AMPHUB sharing you screen.</h3>
                    <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                      A remote controller is currently viewing and controlling your desktop. Your actions and screen are encrypted and streamed in real-time.
                    </p>
                    <button
                      onClick={handleDisconnect}
                      className="cursor-pointer px-6 py-3.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-950 transition-all active:scale-[0.98]"
                    >
                      Stop Sharing
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "settings" && (
            <div className="max-w-2xl mx-auto space-y-6">
              {/* Configuration Inputs Menu */}
              <div className="bg-slate-900/50 rounded-2xl border border-slate-800 p-6 space-y-4">
                <h3 className="text-base font-extrabold text-white">Client Setup Configurations</h3>
                <p className="text-xs text-slate-400">
                  Update your gateway endpoints, access ports, and verify service visibility.
                </p>

                <div className="space-y-4 pt-3 border-t border-slate-800/80">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">AMPHUB Server Address</label>
                    <input
                      type="text"
                      value={hostIp}
                      onChange={(e) => setHostIp(e.target.value)}
                      placeholder="e.g. localhost or 192.168.9.9"
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-rose-500/50 transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Control Signal Port</label>
                      <input
                        type="number"
                        value={port}
                        onChange={(e) => setPort(Number(e.target.value))}
                        placeholder="7766"
                        className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-rose-500/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Web Dashboard Port</label>
                      <input
                        type="number"
                        value={dashboardPort}
                        onChange={(e) => setDashboardPort(Number(e.target.value))}
                        placeholder="3355"
                        className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-rose-500/50 transition-colors"
                      />
                    </div>
                  </div>

                  {/* Signaling Server Reachability status */}
                  <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-800/40">
                    <span className="text-slate-400 font-semibold">Signaling Server Probe State:</span>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                      isSignalingServerReachable === true ? "bg-emerald-950/60 border border-emerald-900 text-emerald-400" :
                      isSignalingServerReachable === false ? "bg-rose-950/60 border border-rose-900 text-rose-400" :
                      "bg-slate-900 border border-slate-800 text-slate-500"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        isSignalingServerReachable === true ? "bg-emerald-400" :
                        isSignalingServerReachable === false ? "bg-rose-400" :
                        "bg-slate-500"
                      }`}></span>
                      {isSignalingServerReachable === true ? "Reachable" :
                       isSignalingServerReachable === false ? "Unreachable" : "Checking..."}
                    </span>
                  </div>

                  {/* Autostart Startup Toggle */}
                  <div className="flex justify-between items-center text-xs pt-3.5 border-t border-slate-800/40">
                    <div>
                      <span className="text-slate-400 font-semibold block">Start on Windows Boot</span>
                      <span className="text-[10px] text-slate-500">Automatically launch AMPHUB when your computer starts</span>
                    </div>
                    <button
                      onClick={toggleAutostart}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
                        autostartEnabled ? "bg-rose-600" : "bg-slate-800"
                      }`}
                    >
                      <span
                        className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
                        style={{ transform: autostartEnabled ? 'translateX(16px)' : 'translateX(4px)' }}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Security & Access Settings */}
              <div className="bg-slate-900/50 rounded-2xl border border-slate-800 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <h3 className="text-base font-extrabold text-white">Security &amp; Access Control</h3>
                </div>
                <p className="text-xs text-slate-400">
                  Configure how AMPHUB handles incoming remote access requests and device discovery.
                </p>

                <div className="space-y-4 pt-3 border-t border-slate-800/80">
                  {/* Unattended Access Toggle */}
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-sm font-semibold text-slate-300 block">Unattended Access</span>
                      <span className="text-[10px] text-slate-500">Allow connections without requiring your approval each time (like AnyDesk unattended)</span>
                    </div>
                    <button
                      onClick={toggleUnattendedAccess}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${unattendedAccess ? "bg-rose-600" : "bg-slate-800"}`}
                    >
                      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${unattendedAccess ? "translate-x-5" : "translate-x-0"}`}></span>
                    </button>
                  </div>

                  {/* Default Permission */}
                  <div className="pt-3 border-t border-slate-800/40">
                    <span className="text-sm font-semibold text-slate-300 block mb-1">Default Permission</span>
                    <span className="text-[10px] text-slate-500 block mb-3">What happens when a connection request arrives (overrides Unattended Access if set)</span>
                    <div className="grid grid-cols-3 gap-2">
                      {(["ask", "allow", "deny"] as const).map((opt) => (
                        <button
                          key={opt}
                          onClick={() => changeDefaultPermission(opt)}
                          className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                            defaultPermission === opt
                              ? opt === "allow" ? "bg-emerald-600/20 border-emerald-500/60 text-emerald-400"
                              : opt === "deny" ? "bg-rose-600/20 border-rose-500/60 text-rose-400"
                              : "bg-amber-600/20 border-amber-500/60 text-amber-400"
                              : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700"
                          }`}
                        >
                          {opt === "ask" ? "Ask Always" : opt === "allow" ? "Allow All" : "Deny All"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Network Discovery */}
                  <div className="flex justify-between items-center pt-3 border-t border-slate-800/40">
                    <div>
                      <span className="text-sm font-semibold text-slate-300 block">Network Discovery</span>
                      <span className="text-[10px] text-slate-500">Allow other AMPHUB clients on your network to discover this device</span>
                    </div>
                    <button
                      onClick={toggleDiscovery}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${discoveryEnabled ? "bg-emerald-600" : "bg-slate-800"}`}
                    >
                      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${discoveryEnabled ? "translate-x-5" : "translate-x-0"}`}></span>
                    </button>
                  </div>
                </div>

                {/* Test incoming request */}
                <div className="pt-3 border-t border-slate-800/40">
                  <p className="text-[10px] text-slate-500 mb-2">Test incoming access request simulation:</p>
                  <button
                    onClick={() => {
                      setIncomingRequest({ ip: "192.168.9.9" });
                      addLog("Triggered mock incoming Admin request from 192.168.9.9.");
                    }}
                    className="cursor-pointer w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                  >
                    Simulate Incoming Access Request
                  </button>
                </div>
              </div>

              {/* Debug / Native Diagnostics panel */}
              <div className="bg-slate-900/50 rounded-2xl border border-slate-800 p-6 space-y-4">
                <h3 className="text-base font-extrabold text-white">Native API Diagnostics</h3>
                <div className="space-y-4 pt-3 border-t border-slate-800/80">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400 font-semibold">AMPHUB Client Sandbox:</span>
                    <span className="font-mono text-slate-300 bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800">
                      {isTauri ? "Windows Native x64" : "Vite Dev Server (Web)"}
                    </span>
                  </div>

                  <div className="pt-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Direct OS Clipboard Interface Test</label>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          const val = await safeInvoke<string>("get_clipboard");
                          alert(`Clipboard Content: "${val}"`);
                        }}
                        className="cursor-pointer px-4 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-lg text-xs font-bold text-slate-300"
                      >
                        Call get_clipboard()
                      </button>
                      <button
                        onClick={async () => {
                          const testVal = `AMPHUB_CLIPBOARD_TEST_${Math.floor(Math.random() * 1000)}`;
                          await safeInvoke("set_clipboard", { text: testVal });
                          alert(`Successfully wrote "${testVal}" into OS clipboard!`);
                        }}
                        className="cursor-pointer px-4 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-lg text-xs font-bold text-slate-300"
                      >
                        Call set_clipboard()
                      </button>
                    </div>
                  </div>

                  <div className="pt-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Direct Monitor Capture Test</label>
                    <button
                      onClick={async () => {
                        try {
                          const b64 = await safeInvoke<string>("capture_screen");
                          alert(`Screen Captured! Length: ${b64.length} chars (Base64)`);
                        } catch (err) {
                          alert(`Capture failed: ${err}`);
                        }
                      }}
                      className="cursor-pointer px-4 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-lg text-xs font-bold text-slate-300"
                    >
                      Call capture_screen()
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "logs" && (
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-base font-extrabold text-white">System Telemetry Log</h3>
                <button
                  onClick={() => setLogs(["Console cleared."])}
                  className="cursor-pointer text-xs font-bold text-slate-500 hover:text-rose-400 transition-colors"
                >
                  Clear logs
                </button>
              </div>
              <div className="bg-slate-950/80 border border-slate-900 rounded-2xl p-6 font-mono text-xs text-rose-400 space-y-2.5 h-[500px] overflow-y-auto shadow-inner">
                {logs.length === 0 ? (
                  <div className="text-slate-600 text-center py-12">No events logged yet.</div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className="border-b border-slate-900/30 pb-1.5 last:border-0">
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {incomingRequest && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[4px] bg-gradient-to-r from-rose-500 to-orange-500 animate-pulse"></div>
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Remote Access Request</h3>
                <p className="text-xs text-slate-500">Incoming administrator connection</p>
              </div>
            </div>
            <p className="text-sm text-slate-300 mb-6 leading-relaxed">
              An administrator from <span className="font-mono text-rose-400 font-bold bg-slate-950 px-2 py-0.5 rounded border border-slate-800">{incomingRequest.ip}</span> is requesting remote control of your desktop.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setIncomingRequest(null);
                  addLog("Denied remote access request from " + incomingRequest.ip);
                }}
                className="cursor-pointer px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Deny Access
              </button>
              <button
                onClick={async () => {
                  const ip = incomingRequest.ip;
                  const requestToken = incomingRequest.token;
                  setIncomingRequest(null);
                  addLog("Approved remote access request from " + ip);
                  if (!isMock && requestToken) {
                    try {
                      setConnectionStatus("Connecting");
                      setStatusMessage("Establishing connection for session...");
                      await safeInvoke("start_signaling_connection", {
                        host: hostIp,
                        port: Number(port),
                        token: requestToken,
                        isMock: false
                      });
                    } catch (err: any) {
                      addLog(`Failed to connect host: ${err}`);
                      setConnectionStatus("Disconnected");
                    }
                  } else {
                    setConnectionStatus("Connected");
                    setStatusMessage("Admin control session active from " + ip);
                    safeInvoke("start_desktop_stream");
                    setRemoteScreen("mock");
                  }
                }}
                className="cursor-pointer px-5 py-2.5 bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-950 transition-all"
              >
                Approve & Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
