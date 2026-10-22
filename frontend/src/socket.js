import { io } from "socket.io-client";
import { API_URL } from "./api";

let socket = null;

export function getSocket() {
  if (socket) return socket;
  const token = localStorage.getItem("checkm8_token");
  socket = io(API_URL, {
    auth: { token },
    autoConnect: !!token,
  });
  return socket;
}

export function reconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  return getSocket();
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
